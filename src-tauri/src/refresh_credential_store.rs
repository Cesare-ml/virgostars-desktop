//! OS-protected refresh credential primitive. This module is not yet wired
//! into login or IPC. The in-flight marker prevents silent replay after an
//! ambiguous network result or process termination during rotation.
#![allow(dead_code)]

use zeroize::Zeroizing;

const SERVICE: &str = "it.virgostars.desktop";
const ACCOUNT: &str = "connected-refresh-v1";
const READY: u8 = 1;
const IN_FLIGHT: u8 = 2;
const REVOKE_PENDING: u8 = 3;

pub struct Credential {
    token: Zeroizing<String>,
    state: u8,
}

impl Credential {
    pub fn ready(token: String) -> Result<Self, ()> {
        let token = Zeroizing::new(token);
        if token.len() != 43 || !token.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') { return Err(()); }
        Ok(Self {token, state:READY})
    }
    pub fn token(&self) -> &str { &self.token }
    pub fn in_flight(&self) -> bool { self.state == IN_FLIGHT }
    pub fn revoke_pending(&self) -> bool { self.state == REVOKE_PENDING }
    pub fn mark_in_flight(&mut self) { self.state = IN_FLIGHT; }
    pub fn mark_revoke_pending(&mut self) { self.state = REVOKE_PENDING; }
    fn encode(&self) -> Zeroizing<Vec<u8>> {
        let mut bytes = Zeroizing::new(Vec::with_capacity(44));
        bytes.push(self.state);
        bytes.extend_from_slice(self.token.as_bytes());
        bytes
    }
    fn decode(bytes: &[u8]) -> Result<Self, ()> {
        if bytes.len() != 44 || !matches!(bytes[0], READY | IN_FLIGHT | REVOKE_PENDING) { return Err(()); }
        let value = std::str::from_utf8(&bytes[1..]).map_err(|_| ())?.to_owned();
        let mut credential = Self::ready(value)?;
        credential.state = bytes[0];
        Ok(credential)
    }
}

pub trait RefreshCredentialStore {
    fn load(&self) -> Result<Option<Credential>, ()>;
    fn store(&self, credential: &Credential) -> Result<(), ()>;
    fn delete(&self) -> Result<(), ()>;
}

pub struct OsRefreshCredentialStore;
#[cfg(test)]
static TEST_SECRET: std::sync::Mutex<Option<Vec<u8>>> = std::sync::Mutex::new(None);
impl OsRefreshCredentialStore {
    fn entry() -> Result<keyring::Entry, ()> { keyring::Entry::new(SERVICE, ACCOUNT).map_err(|_| ()) }
}
impl RefreshCredentialStore for OsRefreshCredentialStore {
    fn load(&self) -> Result<Option<Credential>, ()> {
        #[cfg(test)]
        return TEST_SECRET.lock().map_err(|_|())?.as_ref().map(|bytes|Credential::decode(bytes)).transpose();
        #[cfg(not(test))]
        match Self::entry()?.get_secret() {
            Ok(bytes) => Credential::decode(&Zeroizing::new(bytes)).map(Some),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(()),
        }
    }
    fn store(&self, credential: &Credential) -> Result<(), ()> {
        #[cfg(test)]
        { *TEST_SECRET.lock().map_err(|_|())? = Some(credential.encode().to_vec()); return Ok(()); }
        #[cfg(not(test))]
        Self::entry()?.set_secret(&credential.encode()).map_err(|_| ())
    }
    fn delete(&self) -> Result<(), ()> {
        #[cfg(test)]
        { *TEST_SECRET.lock().map_err(|_|())? = None; return Ok(()); }
        #[cfg(not(test))]
        match Self::entry()?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_valid_bounded_credentials_round_trip_and_pending_is_preserved() {
        assert!(Credential::ready("short".into()).is_err());
        assert!(Credential::ready("!".repeat(43)).is_err());
        let mut credential = Credential::ready("a".repeat(43)).unwrap();
        let decoded = Credential::decode(&credential.encode()).unwrap();
        assert!(!decoded.in_flight());
        assert_eq!(decoded.token(), "a".repeat(43));
        credential.mark_in_flight();
        assert!(Credential::decode(&credential.encode()).unwrap().in_flight());
        assert!(Credential::decode(&[4;44]).is_err());
    }

    #[cfg(target_os = "windows")]
    #[test]
    #[ignore = "explicit Windows credential-store smoke test; uses a disposable synthetic entry"]
    fn windows_credential_store_synthetic_round_trip() {
        let id=crate::pkce_login::random_uuid_v4().unwrap();
        let entry=keyring::Entry::new("it.virgostars.desktop.synthetic-test",&id).unwrap();
        struct Cleanup<'a>(&'a keyring::Entry);
        impl Drop for Cleanup<'_> { fn drop(&mut self) { let _=self.0.delete_credential(); } }
        let _cleanup=Cleanup(&entry);
        let value=Credential::ready("s".repeat(43)).unwrap();
        entry.set_secret(&value.encode()).unwrap();
        let bytes=Zeroizing::new(entry.get_secret().unwrap());
        assert_eq!(Credential::decode(&bytes).unwrap().token(),"s".repeat(43));
        entry.delete_credential().unwrap();
        assert!(matches!(entry.get_secret(),Err(keyring::Error::NoEntry)));
    }
}
