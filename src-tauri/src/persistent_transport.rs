//! Native-only refresh and revocation over the existing restricted HTTPS port.
//! No credential is returned to IPC or emitted to logs.
use crate::pkce_token_exchange::{parse_response, valid_staging_token_endpoint, NativeAccessGrant, TokenHttpTransport};
use crate::refresh_credential_store::{Credential, RefreshCredentialStore};
use crate::refresh_cycle::{RefreshTransport, TransportFailure};
use std::time::{Duration, Instant};
use url::{form_urlencoded, Url};
use zeroize::Zeroizing;

pub struct PersistentTransport<'a, T> { pub transport: &'a T, pub endpoint: Url }
impl<'a, T: TokenHttpTransport> PersistentTransport<'a, T> {
    pub fn new(transport: &'a T, endpoint: &str) -> Result<Self, ()> {
        Ok(Self {transport, endpoint:valid_staging_token_endpoint(endpoint).ok_or(())?})
    }
    fn request(&self, operation: &str, token: &str) -> Result<crate::pkce_token_exchange::TokenHttpResponse, ()> {
        let mut fields = form_urlencoded::Serializer::new(String::new());
        fields.append_pair("grant_type", operation).append_pair("client_id", "virgostars-desktop")
            .append_pair("refresh_token", token);
        let body = Zeroizing::new(fields.finish());
        self.transport.post_form(&self.endpoint, &body, Duration::from_secs(10), 8192)
    }
    /// Local sign-out is recorded before network I/O; an uncertain remote
    /// outcome stays pending and is never restored as an active session.
    pub fn revoke<S: RefreshCredentialStore>(&self, store: &S) -> Result<(), ()> {
        let Some(mut credential) = store.load()? else { return Err(()); };
        credential.mark_revoke_pending();
        store.store(&credential)?;
        self.revoke_unstored(&credential)?;
        store.delete()
    }
    pub fn revoke_unstored(&self, credential: &Credential) -> Result<(), ()> {
        let response = self.request("revoke", credential.token())?;
        let bytes = Zeroizing::new(response.body);
        if response.status != 200 || bytes.len() > 8192 ||
            !(response.content_type.eq_ignore_ascii_case("application/json") ||
              response.content_type.eq_ignore_ascii_case("application/json; charset=utf-8")) { return Err(()); }
        #[derive(serde::Deserialize)]
        #[serde(deny_unknown_fields)]
        struct RevokeReply { status: String }
        let reply: RevokeReply = serde_json::from_slice(&bytes).map_err(|_|())?;
        if reply.status != "revoked" { return Err(()); }
        Ok(())
    }
}
impl<T: TokenHttpTransport> RefreshTransport for PersistentTransport<'_, T> {
    type Grant = NativeAccessGrant;
    fn reachable(&self) -> bool { self.transport.reachable(&self.endpoint) }
    fn refresh(&self, token: &str) -> Result<(NativeAccessGrant, Credential), TransportFailure> {
        let response = self.request("refresh_token", token).map_err(|_|TransportFailure::Uncertain)?;
        if response.status == 400 { return Err(TransportFailure::Invalid); }
        let mut grant = parse_response(response, Instant::now()).map_err(|_|TransportFailure::Uncertain)?;
        let replacement = grant.take_refresh_credential().ok_or(TransportFailure::Uncertain)?;
        grant.bind_token_endpoint(&self.endpoint);
        Ok((grant,replacement))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pkce_token_exchange::TokenHttpResponse;
    use std::cell::{Cell, RefCell};

    struct Memory(RefCell<Option<(String,u8)>>);
    impl RefreshCredentialStore for Memory {
        fn load(&self) -> Result<Option<Credential>, ()> {
            self.0.borrow().as_ref().map(|(value,state)| {
                let mut c=Credential::ready(value.clone())?;
                if *state==1 {c.mark_in_flight()} else if *state==2 {c.mark_revoke_pending()}
                Ok(c)
            }).transpose()
        }
        fn store(&self, c:&Credential) -> Result<(),()> {
            *self.0.borrow_mut()=Some((c.token().to_owned(),if c.revoke_pending(){2}else if c.in_flight(){1}else{0})); Ok(())
        }
        fn delete(&self) -> Result<(),()> { *self.0.borrow_mut()=None; Ok(()) }
    }
    struct Fake {count:Cell<usize>,fail_revoke:bool}
    impl TokenHttpTransport for Fake {
        fn post_form(&self, _: &Url, body:&str, _:Duration, _:usize) -> Result<TokenHttpResponse,()> {
            self.count.set(self.count.get()+1);
            let pairs:Vec<_>=form_urlencoded::parse(body.as_bytes()).collect();
            assert_eq!(pairs.len(),3);
            assert_eq!(pairs[1].1,"virgostars-desktop");
            let response = if pairs[0].1=="revoke" {
                if self.fail_revoke {return Err(());} "{\"status\":\"revoked\"}".to_owned()
            } else {
                assert_eq!(pairs[0].1,"refresh_token");
                let jwt=format!("{}.{}.{}","a".repeat(43),"b".repeat(43),"c".repeat(100));
                format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read","refresh_token":"{}"}}"#,"b".repeat(43))
            };
            Ok(TokenHttpResponse {status:200,content_type:"application/json".into(),body:response.into_bytes()})
        }
    }
    #[test]
    fn refresh_rotates_and_signout_revokes_before_deletion() {
        let store=Memory(RefCell::new(Some(("a".repeat(43),0))));
        let fake=Fake{count:Cell::new(0),fail_revoke:false};
        let http=PersistentTransport::new(&fake,"https://staging.virgostars.it/chart-sync/v1/token").unwrap();
        assert!(crate::refresh_cycle::refresh_once(&store,&http).is_ok());
        assert_eq!(store.0.borrow().as_ref().unwrap(),&("b".repeat(43),0));
        assert!(http.revoke(&store).is_ok());
        assert!(store.0.borrow().is_none());
        assert_eq!(fake.count.get(),2);
    }
    #[test]
    fn offline_signout_remains_marked_and_cannot_be_restored() {
        let store=Memory(RefCell::new(Some(("a".repeat(43),0))));
        let fake=Fake{count:Cell::new(0),fail_revoke:true};
        let http=PersistentTransport::new(&fake,"https://staging.virgostars.it/chart-sync/v1/token").unwrap();
        assert!(http.revoke(&store).is_err());
        assert_eq!(store.0.borrow().as_ref().unwrap().1,2);
        assert!(matches!(crate::refresh_cycle::refresh_once(&store,&http),Err(crate::refresh_cycle::RefreshError::Uncertain)));
        assert_eq!(fake.count.get(),1);
    }
}
