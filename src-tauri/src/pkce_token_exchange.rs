//! Staging-only OAuth authorization-code token exchange boundary for Desktop.
//!
//! This module only constructs/verifies form and response contracts; a real
//! HTTPS transport, credential store, Tauri IPC and UI are NOT connected.
//! Access tokens are ephemeral and never serialized or logged to the WebView.
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
    fn post_form(
        &self,
        endpoint: &Url,
        body: &str,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Result<TokenHttpResponse, ()>;
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
}

impl Drop for TokenSuccessResponse {
    fn drop(&mut self) { self.access_token.zeroize(); }
}

/// Native host-only short-lived access token; no Serialize, Debug or Clone.
/// Deliberately no refresh credentials: the staging backend issues none yet.
pub struct NativeAccessGrant {
    access_token: Zeroizing<String>,
    scope: TokenScope,
    expires_at: Instant,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TokenScope { Read, ReadAndNotes }

impl NativeAccessGrant {
    pub fn scope(&self) -> TokenScope { self.scope }
    pub fn remaining_seconds(&self, now: Instant) -> u64 {
        self.expires_at.saturating_duration_since(now).as_secs()
    }
    /// Only a future native HTTPS client may borrow this value to call the
    /// owner-authorized backend. Never return it from Tauri IPC or print it.
    pub(crate) fn bearer(&self) -> &str { &self.access_token }
}

pub(crate) fn valid_staging_token_endpoint(value: &str) -> Option<Url> {
    if value.len() > 512 { return None; }
    let uri = Url::parse(value).ok()?;
    if uri.scheme() != "https" || uri.path() != TOKEN_PATH ||
        uri.port().is_some() || uri.query().is_some() || uri.fragment().is_some() ||
        !uri.username().is_empty() || uri.password().is_some() || uri.as_str() != value {
        return None;
    }
    // Reuse the browser allowlist, including the refusal of production hosts.
    let mut browser_page = uri.clone();
    browser_page.set_path("/collega-dispositivo");
    valid_consent_origin(browser_page.as_str())?;
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

fn parse_response(response: TokenHttpResponse, now: Instant) -> Result<NativeAccessGrant, TokenExchangeError> {
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
        "chart_sync:read chart_sync:notes" => TokenScope::ReadAndNotes,
        _ => return Err(TokenExchangeError::InvalidResponse),
    };
    let expires_at = now.checked_add(Duration::from_secs(expires))
        .ok_or(TokenExchangeError::InvalidResponse)?;
    Ok(NativeAccessGrant { access_token: raw_token, scope, expires_at })
}

/// Consumes the one-time callback. A denial never contacts the network. No
/// retries of the same authorization code are performed here: a timeout or
/// uncertain server response requires a new PKCE attempt.
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
    let body = Zeroizing::new(serializer.finish());
    if body.len() > MAX_FORM_BYTES { return Err(TokenExchangeError::InvalidCode); }
    let response = transport.post_form(&endpoint, &body, HTTP_TIMEOUT, MAX_RESPONSE_BYTES)
        .map_err(|_| TokenExchangeError::TransportUnavailable)?;
    parse_response(response, now)
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
            assert_eq!(fields.len(), 5);
            assert_eq!(fields[0].1, "authorization_code");
            assert_eq!(fields[1].1, "virgostars-desktop");
            assert_eq!(fields[2].1, "http://127.0.0.1:49152/virgostars/oauth/callback");
            assert_eq!(fields[3].1.len(), 43);
            assert_eq!(fields[4].1.len(), 43);
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
}
