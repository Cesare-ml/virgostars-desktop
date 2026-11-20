//! Staging-only OAuth authorization-code token exchange boundary for Desktop.
//!
//! The guarded login flow uses a native HTTPS transport and ephemeral grants.
//! Access tokens are never serialized or logged to the WebView.
#![allow(dead_code)]

use crate::pkce_login::{valid_consent_origin, valid_loopback_uri, CallbackDecision};
use std::time::{Duration, Instant};
use url::{form_urlencoded, Url};
use zeroize::{Zeroize, Zeroizing};

const TOKEN_PATH: &str = "/chart-sync/v1/token";
const MAX_FORM_BYTES: usize = 2048;
const MAX_RESPONSE_BYTES: usize = 8192;
const HTTP_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_ACCESS_SECONDS: u64 = 15 * 60;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenExchangeError {
    Denied,
    InvalidEndpoint,
    InvalidRedirect,
    InvalidCode,
    TransportUnavailable,
    Rejected,
    InvalidResponse,
}

/// Transport port must verify TLS hostname/certificate, enforce timeout and
/// response byte limit, reject HTTP redirects and never log the request body.
/// These properties are NOT provided by this trait automatically; a future
/// concrete transport needs an independent review and integration tests.
pub trait TokenHttpTransport {
    /// Advisory connectivity check only; a successful check does not make a
    /// later token request safe to retry after an uncertain outcome.
    fn reachable(&self, _endpoint: &Url) -> bool { true }
    fn post_form(
        &self,
        endpoint: &Url,
        body: &str,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Result<TokenHttpResponse, ()>;

    /// A syntactically valid token is not proof of an active backend session.
    /// Implementations must fail closed until the backend confirms the grant.
    fn verify_grant(&self, _endpoint: &Url, _grant: &NativeAccessGrant) -> Result<String, ()> {
        Err(())
    }
}

/// Raw bytes are zeroized by the exchanger immediately after transport. A
/// transport implementation must also clear its own intermediate buffers.
pub struct TokenHttpResponse {
    pub status: u16,
    pub content_type: String,
    pub body: Vec<u8>,
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct TokenSuccessResponse {
    token_type: String,
    access_token: String,
    expires_in: u64,
    scope: String,
    #[cfg(feature = "persistent-connected-account")]
    refresh_token: Option<String>,
}

impl Drop for TokenSuccessResponse {
    fn drop(&mut self) {
        self.access_token.zeroize();
        #[cfg(feature = "persistent-connected-account")]
        if let Some(value) = self.refresh_token.as_mut() { value.zeroize(); }
    }
}

/// Native host-only short-lived access token; no Serialize, Debug or Clone.
/// Deliberately no refresh credentials: the staging backend issues none yet.
pub struct NativeAccessGrant {
    access_token: Zeroizing<String>,
    scope: TokenScope,
    expires_at: Instant,
    profile_ref: Option<String>,
    token_endpoint: Option<Url>,
    #[cfg(feature = "persistent-connected-account")]
    refresh_credential: Option<crate::refresh_credential_store::Credential>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenScope { Read, ReadAndGroupWrite, ReadAndChartWrite, ReadAndBothWrites,
    ReadAndManage, ReadGroupAndManage, ReadChartAndManage, ReadBothAndManage }

impl TokenScope {
    pub fn as_str(self) -> &'static str {
        match self { Self::Read => "chart_sync:read", Self::ReadAndGroupWrite => "chart_sync:read chart_sync:groups:write",
            Self::ReadAndChartWrite => "chart_sync:read chart_sync:charts:write",
            Self::ReadAndBothWrites => "chart_sync:read chart_sync:groups:write chart_sync:charts:write",
            Self::ReadAndManage => "chart_sync:read chart_sync:charts:manage",
            Self::ReadGroupAndManage => "chart_sync:read chart_sync:groups:write chart_sync:charts:manage",
            Self::ReadChartAndManage => "chart_sync:read chart_sync:charts:write chart_sync:charts:manage",
            Self::ReadBothAndManage => "chart_sync:read chart_sync:groups:write chart_sync:charts:write chart_sync:charts:manage" }
    }
    pub fn allows_group_write(self) -> bool { matches!(self,Self::ReadAndGroupWrite | Self::ReadAndBothWrites | Self::ReadGroupAndManage | Self::ReadBothAndManage) }
    pub fn allows_chart_write(self) -> bool { matches!(self,Self::ReadAndChartWrite | Self::ReadAndBothWrites | Self::ReadChartAndManage | Self::ReadBothAndManage) }
    pub fn allows_chart_manage(self) -> bool { matches!(self,Self::ReadAndManage | Self::ReadGroupAndManage | Self::ReadChartAndManage | Self::ReadBothAndManage) }
}

impl NativeAccessGrant {
    pub fn scope(&self) -> TokenScope { self.scope }
    #[cfg(feature = "persistent-connected-account")]
    pub(crate) fn take_refresh_credential(&mut self) -> Option<crate::refresh_credential_store::Credential> {
        self.refresh_credential.take()
    }
    pub fn remaining_seconds(&self, now: Instant) -> u64 {
        self.expires_at.saturating_duration_since(now).as_secs()
    }
    /// Only a future native HTTPS client may borrow this value to call the
    /// owner-authorized backend. Never return it from Tauri IPC or print it.
    pub(crate) fn bearer(&self) -> &str { &self.access_token }
    pub(crate) fn bind_profile(&mut self, profile_ref: String) -> Result<(), ()> {
        if !crate::chart_archive::valid_id(&profile_ref) || self.profile_ref.is_some() { return Err(()); }
        self.profile_ref = Some(profile_ref);
        Ok(())
    }
    pub(crate) fn profile_ref(&self) -> Option<&str> { self.profile_ref.as_deref() }
    pub(crate) fn matches_token_endpoint(&self, endpoint: &Url) -> bool {
        self.token_endpoint.as_ref() == Some(endpoint)
    }
    #[cfg(feature = "persistent-connected-account")]
    pub(crate) fn bind_token_endpoint(&mut self, endpoint: &Url) { self.token_endpoint = Some(endpoint.clone()); }
    /// A bounded native worker can own a short-lived copy without holding the
    /// session mutex over network I/O. Both copies are zeroized on drop.
    pub(crate) fn copy_for_worker(&self, now: Instant) -> Option<Self> {
        if self.remaining_seconds(now) == 0 || self.profile_ref.is_none() { return None; }
        Some(Self {access_token:Zeroizing::new(self.access_token.to_string()), scope:self.scope,
            expires_at:self.expires_at, profile_ref:self.profile_ref.clone(),token_endpoint:self.token_endpoint.clone(),
            #[cfg(feature = "persistent-connected-account")] refresh_credential:None})
    }
    #[cfg(test)]
    pub(crate) fn synthetic_for_test(scope: TokenScope, profile: &str) -> Self {
        Self {access_token:Zeroizing::new("synthetic.test.token".into()),scope,
            expires_at:Instant::now() + Duration::from_secs(60), profile_ref:Some(profile.into()),
            token_endpoint:Url::parse("https://staging.virgostars.it/chart-sync/v1/token").ok(),
            #[cfg(feature = "persistent-connected-account")] refresh_credential:None}
    }
}

pub(crate) fn valid_staging_token_endpoint(value: &str) -> Option<Url> {
    if value.len() > 512 { return None; }
    let uri = Url::parse(value).ok()?;
    if uri.scheme() != "https" || uri.path() != TOKEN_PATH ||
        uri.port().is_some() || uri.query().is_some() || uri.fragment().is_some() ||
        !uri.username().is_empty() || uri.password().is_some() || uri.as_str() != value {
        return None;
    }
    // The production API has a different hostname from its consent page.
    if cfg!(feature = "production-connected-account") && uri.host_str() == Some("api.virgostars.it") {
        return Some(uri);
    }
    // Reuse the browser allowlist for staging.
    let mut browser_page = uri.clone();
    browser_page.set_path("/collega-dispositivo");
    valid_consent_origin(browser_page.as_str())?;
    if uri.host_str() == Some("virgostars.it") { return None; }
    Some(uri)
}

fn urlsafe_43(value: &str) -> bool {
    value.len() == 43 && value.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
}

fn plausible_bearer(value: &str) -> bool {
    if value.len() < 100 || value.len() > 4096 { return false; }
    let parts: Vec<_> = value.split('.').collect();
    parts.len() == 3 && parts.iter().all(|part| !part.is_empty() &&
        part.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_'))
}

pub(crate) fn parse_response(response: TokenHttpResponse, now: Instant) -> Result<NativeAccessGrant, TokenExchangeError> {
    // This zeroizes the raw bearer-token JSON; token value is separately
    // moved into a zeroizing string on the success path.
    let bytes = Zeroizing::new(response.body);
    if response.status != 200 { return Err(TokenExchangeError::Rejected); }
    if bytes.is_empty() || bytes.len() > MAX_RESPONSE_BYTES { return Err(TokenExchangeError::InvalidResponse); }
    let content_type = response.content_type.to_ascii_lowercase();
    if content_type != "application/json" && content_type != "application/json; charset=utf-8" {
        return Err(TokenExchangeError::InvalidResponse);
    }
    // A typed, deny-unknown-fields struct also rejects duplicate JSON keys.
    let mut parsed: TokenSuccessResponse = serde_json::from_slice(&bytes)
        .map_err(|_| TokenExchangeError::InvalidResponse)?;
    // Take the secret first: every validation error below zeroizes the token.
    let raw_token = Zeroizing::new(std::mem::take(&mut parsed.access_token));
    if parsed.token_type != "Bearer" || !plausible_bearer(&raw_token) {
        return Err(TokenExchangeError::InvalidResponse);
    }
    let expires = parsed.expires_in;
    if expires == 0 || expires > MAX_ACCESS_SECONDS { return Err(TokenExchangeError::InvalidResponse); }
    let scope = match parsed.scope.as_str() {
        "chart_sync:read" => TokenScope::Read,
        "chart_sync:read chart_sync:groups:write" => TokenScope::ReadAndGroupWrite,
        "chart_sync:read chart_sync:charts:write" => TokenScope::ReadAndChartWrite,
        "chart_sync:read chart_sync:groups:write chart_sync:charts:write" => TokenScope::ReadAndBothWrites,
        "chart_sync:read chart_sync:charts:manage" => TokenScope::ReadAndManage,
        "chart_sync:read chart_sync:groups:write chart_sync:charts:manage" => TokenScope::ReadGroupAndManage,
        "chart_sync:read chart_sync:charts:write chart_sync:charts:manage" => TokenScope::ReadChartAndManage,
        "chart_sync:read chart_sync:groups:write chart_sync:charts:write chart_sync:charts:manage" => TokenScope::ReadBothAndManage,
        _ => return Err(TokenExchangeError::InvalidResponse),
    };
    let expires_at = now.checked_add(Duration::from_secs(expires))
        .ok_or(TokenExchangeError::InvalidResponse)?;
    #[cfg(feature = "persistent-connected-account")]
    let refresh_credential = parsed.refresh_token.take().map(crate::refresh_credential_store::Credential::ready)
        .transpose().map_err(|_|TokenExchangeError::InvalidResponse)?;
    Ok(NativeAccessGrant { access_token: raw_token, scope, expires_at, profile_ref: None, token_endpoint:None,
        #[cfg(feature = "persistent-connected-account")] refresh_credential })
}

/// Consumes the one-time callback. A denial never contacts the network.
/// Only a definite HTTP 400/413 can fall back to the older temporary-session
/// contract; a timeout or uncertain response always requires a new attempt.
pub fn exchange_approved_code<T: TokenHttpTransport>(
    transport: &T,
    staging_token_url: &str,
    bound_redirect_uri: &str,
    decision: CallbackDecision,
    now: Instant,
) -> Result<NativeAccessGrant, TokenExchangeError> {
    let CallbackDecision::Approved { code, code_verifier } = decision else {
        return Err(TokenExchangeError::Denied);
    };
    let endpoint = valid_staging_token_endpoint(staging_token_url)
        .ok_or(TokenExchangeError::InvalidEndpoint)?;
    if !valid_loopback_uri(bound_redirect_uri) { return Err(TokenExchangeError::InvalidRedirect); }
    if !urlsafe_43(&code) || !urlsafe_43(&code_verifier) { return Err(TokenExchangeError::InvalidCode); }

    let mut serializer = form_urlencoded::Serializer::new(String::new());
    serializer
        .append_pair("grant_type", "authorization_code")
        .append_pair("client_id", "virgostars-desktop")
        .append_pair("redirect_uri", bound_redirect_uri)
        .append_pair("code", &code)
        .append_pair("code_verifier", &code_verifier);
    #[cfg(feature = "persistent-connected-account")]
    serializer.append_pair("persistent", "true");
    let body = Zeroizing::new(serializer.finish());
    if body.len() > MAX_FORM_BYTES { return Err(TokenExchangeError::InvalidCode); }
    let response = transport.post_form(&endpoint, &body, HTTP_TIMEOUT, MAX_RESPONSE_BYTES)
        .map_err(|_| TokenExchangeError::TransportUnavailable)?;
    #[cfg(feature = "persistent-connected-account")]
    let response = if matches!(response.status, 400 | 413) {
        let mut fallback = form_urlencoded::Serializer::new(String::new());
        fallback.append_pair("grant_type", "authorization_code")
            .append_pair("client_id", "virgostars-desktop")
            .append_pair("redirect_uri", bound_redirect_uri)
            .append_pair("code", &code).append_pair("code_verifier", &code_verifier);
        let fallback = Zeroizing::new(fallback.finish());
        transport.post_form(&endpoint, &fallback, HTTP_TIMEOUT, MAX_RESPONSE_BYTES)
            .map_err(|_|TokenExchangeError::TransportUnavailable)?
    } else { response };
    let mut grant = parse_response(response, now)?;
    grant.token_endpoint = Some(endpoint);
    Ok(grant)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct FakeTransport { calls: Cell<u32>, response: Vec<u8>, status: u16, content_type: &'static str }
    impl TokenHttpTransport for FakeTransport {
        fn post_form(&self, endpoint: &Url, body: &str, timeout: Duration, max: usize) -> Result<TokenHttpResponse, ()> {
            self.calls.set(self.calls.get() + 1);
            assert_eq!(endpoint.as_str(), "https://staging.virgostars.it/chart-sync/v1/token");
            assert_eq!(timeout, Duration::from_secs(10));
            assert_eq!(max, 8192);
            let fields: Vec<_> = form_urlencoded::parse(body.as_bytes()).collect();
            assert_eq!(fields.len(), if cfg!(feature = "persistent-connected-account") { 6 } else { 5 });
            assert_eq!(fields[0].1, "authorization_code");
            assert_eq!(fields[1].1, "virgostars-desktop");
            assert_eq!(fields[2].1, "http://127.0.0.1:49152/virgostars/oauth/callback");
            assert_eq!(fields[3].1.len(), 43);
            assert_eq!(fields[4].1.len(), 43);
            #[cfg(feature = "persistent-connected-account")]
            assert_eq!((&*fields[5].0, &*fields[5].1), ("persistent", "true"));
            Ok(TokenHttpResponse {status:self.status, content_type:self.content_type.to_owned(), body:self.response.clone()})
        }
    }

    fn approved() -> CallbackDecision {
        CallbackDecision::Approved {
            code: Zeroizing::new("C".repeat(43)),
            code_verifier: Zeroizing::new("V".repeat(43)),
        }
    }

    fn response() -> Vec<u8> {
        let jwt = format!("{}.{}.{}", "A".repeat(43), "B".repeat(43), "C".repeat(100));
        format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read"}}"#).into_bytes()
    }

    fn fake() -> FakeTransport {
        FakeTransport {calls:Cell::new(0),response:response(),status:200,content_type:"application/json"}
    }

    #[cfg(feature = "persistent-connected-account")]
    #[test]
    fn old_backend_falls_back_only_after_a_definite_rejection() {
        struct Legacy { calls: Cell<usize>, network_fails: bool, rejection:u16 }
        impl TokenHttpTransport for Legacy {
            fn post_form(&self, _: &Url, body: &str, _: Duration, _: usize) -> Result<TokenHttpResponse, ()> {
                let n=self.calls.get(); self.calls.set(n+1);
                let pairs:Vec<_>=form_urlencoded::parse(body.as_bytes()).collect();
                assert_eq!(pairs.len(),if n==0 {6} else {5});
                if self.network_fails { return Err(()); }
                if n==0 { return Ok(TokenHttpResponse {status:self.rejection,content_type:String::new(),body:Vec::new()}); }
                let jwt=format!("{}.{}.{}","A".repeat(43),"B".repeat(43),"C".repeat(100));
                Ok(TokenHttpResponse {status:200,content_type:"application/json".into(),
                    body:format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read"}}"#).into_bytes()})
            }
        }
        for rejection in [400,413] {
            let legacy=Legacy {calls:Cell::new(0),network_fails:false,rejection};
            let mut grant=exchange_approved_code(&legacy,TOKEN,REDIRECT,approved(),Instant::now()).unwrap();
            assert!(grant.take_refresh_credential().is_none());
            assert_eq!(legacy.calls.get(),2);
        }
        let uncertain=Legacy {calls:Cell::new(0),network_fails:true,rejection:400};
        assert!(matches!(exchange_approved_code(&uncertain,TOKEN,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::TransportUnavailable)));
        assert_eq!(uncertain.calls.get(),1);
    }

    const REDIRECT: &str = "http://127.0.0.1:49152/virgostars/oauth/callback";
    const TOKEN: &str = "https://staging.virgostars.it/chart-sync/v1/token";

    #[test]
    fn exchange_uses_exact_form_and_returns_native_short_lived_grant() {
        let http = fake();
        let now = Instant::now();
        let grant = exchange_approved_code(&http, TOKEN, REDIRECT, approved(), now).unwrap();
        assert_eq!(http.calls.get(), 1);
        assert_eq!(grant.scope(), TokenScope::Read);
        assert_eq!(grant.remaining_seconds(now), 900);
        assert!(plausible_bearer(grant.bearer()));
    }

    #[test]
    fn production_endpoint_requires_opt_in_and_exact_api_host() {
        assert_eq!(valid_staging_token_endpoint("https://api.virgostars.it/chart-sync/v1/token").is_some(), cfg!(feature = "production-connected-account"));
        for endpoint in ["https://virgostars.it/chart-sync/v1/token", "https://api.virgostars.it.evil.test/chart-sync/v1/token", "https://api.virgostars.it/chart-sync/v1/token?next=evil", "http://api.virgostars.it/chart-sync/v1/token"] {
            assert!(valid_staging_token_endpoint(endpoint).is_none());
        }
    }

    #[test]
    fn denial_or_untrusted_endpoint_never_performs_network_post() {
        let http = fake();
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,CallbackDecision::Denied,Instant::now()),Err(TokenExchangeError::Denied)));
        for endpoint in [
            "https://www.virgostars.it/chart-sync/v1/token",
            "http://staging.virgostars.it/chart-sync/v1/token",
            "https://staging.virgostars.it.evil.test/chart-sync/v1/token",
            "https://staging.virgostars.it/chart-sync/v1/token?next=evil",
            "https://staging.virgostars.it/chart-sync/v1/other",
        ] {
            assert!(matches!(exchange_approved_code(&http,endpoint,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::InvalidEndpoint)));
        }
        assert_eq!(http.calls.get(), 0);
    }

    #[test]
    fn bad_redirect_and_malformed_code_fail_before_transport() {
        let http = fake();
        assert!(matches!(exchange_approved_code(&http,TOKEN,"http://localhost:49152/virgostars/oauth/callback",approved(),Instant::now()),Err(TokenExchangeError::InvalidRedirect)));
        let invalid = CallbackDecision::Approved{code:Zeroizing::new("short".to_owned()),code_verifier:Zeroizing::new("V".repeat(43))};
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,invalid,Instant::now()),Err(TokenExchangeError::InvalidCode)));
        assert_eq!(http.calls.get(), 0);
    }

    #[test]
    fn redirects_and_malformed_or_overprivileged_responses_fail_closed() {
        let mut http = fake();
        http.status = 302;
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::Rejected)));
        http.status = 200;
        http.content_type = "text/html";
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::InvalidResponse)));
        http.content_type = "application/json";
        http.response = br#"{"token_type":"Bearer","access_token":"fake","expires_in":900,"scope":"admin"}"#.to_vec();
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::InvalidResponse)));
        http.response = br#"{"token_type":"Bearer","access_token":"fake","expires_in":3600,"scope":"chart_sync:read"}"#.to_vec();
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::InvalidResponse)));
        http.response = br#"{"token_type":"Bearer","token_type":"Bearer","access_token":"fake","expires_in":900,"scope":"chart_sync:read"}"#.to_vec();
        assert!(matches!(exchange_approved_code(&http,TOKEN,REDIRECT,approved(),Instant::now()),Err(TokenExchangeError::InvalidResponse)));
    }

    #[test]
    fn connected_schema_and_exchange_allow_only_reviewed_scopes() {
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../contracts/connected-account-status.v1.schema.json"
        )).unwrap();
        assert_eq!(schema["properties"]["scope"]["enum"], serde_json::json!(["chart_sync:read", "chart_sync:read chart_sync:groups:write", "chart_sync:read chart_sync:charts:write", "chart_sync:read chart_sync:groups:write chart_sync:charts:write", "chart_sync:read chart_sync:charts:manage", "chart_sync:read chart_sync:groups:write chart_sync:charts:manage", "chart_sync:read chart_sync:charts:write chart_sync:charts:manage", "chart_sync:read chart_sync:groups:write chart_sync:charts:write chart_sync:charts:manage"]));
        let now = Instant::now();
        let jwt = format!("{}.{}.{}", "A".repeat(43), "B".repeat(43), "C".repeat(100));
        let response = |scope: &str| TokenHttpResponse {
            status: 200,
            content_type: "application/json".to_owned(),
            body: format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"{scope}"}}"#).into_bytes(),
        };
        assert!(parse_response(response("chart_sync:read"), now).is_ok());
        assert!(parse_response(response("chart_sync:read chart_sync:groups:write"), now).is_ok());
        let chart=parse_response(response("chart_sync:read chart_sync:charts:write"),now).unwrap();
        assert!(chart.scope().allows_chart_write());
        assert!(!chart.scope().allows_group_write());
        let both=parse_response(response("chart_sync:read chart_sync:groups:write chart_sync:charts:write"),now).unwrap();
        assert!(both.scope().allows_group_write() && both.scope().allows_chart_write());
        assert!(!both.scope().allows_chart_manage());
        let manage=parse_response(response("chart_sync:read chart_sync:groups:write chart_sync:charts:write chart_sync:charts:manage"),now).unwrap();
        assert!(manage.scope().allows_group_write() && manage.scope().allows_chart_write() && manage.scope().allows_chart_manage());
        assert!(matches!(parse_response(response("chart_sync:read chart_sync:notes"), now), Err(TokenExchangeError::InvalidResponse)));
        assert!(matches!(parse_response(response("charts:read"), now), Err(TokenExchangeError::InvalidResponse)));
    }
}
