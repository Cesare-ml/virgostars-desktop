//! Native-only OAuth 2 PKCE S256 attempt and strict loopback callback validation.
//!
//! This is an isolated host primitive, NOT a Tauri command, browser launcher,
//! TCP listener, token exchange or working account login. All secrets remain in
//! Rust and are not serialized to Angular. The server-owned consent UI is still
//! disabled pending real website-session/CSRF integration and security review.
#![allow(dead_code)]

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use std::time::{Duration, Instant};
use url::Url;
use zeroize::{Zeroize, Zeroizing};

const LOGIN_LIFETIME: Duration = Duration::from_secs(600);
const CALLBACK_PATH: &str = "/virgostars/oauth/callback";
const CLIENT_ID: &str = "virgostars-desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LoginError {
    Unavailable,
    InvalidRedirect,
    InvalidConsentOrigin,
    InvalidCallback,
    Expired,
    AlreadyFinished,
}

/// Internal Rust-only decision. This type MUST NOT derive Serialize or Debug:
/// the code and verifier must never reach IPC, logs or the Angular WebView.
pub enum CallbackDecision {
    Approved {
        code: Zeroizing<String>,
        code_verifier: Zeroizing<String>,
    },
    Denied,
}

pub struct PendingPkceLogin {
    attempt_id: String,
    redirect_uri: String,
    state: Zeroizing<String>,
    verifier: Zeroizing<String>,
    challenge: String,
    expires_at: Instant,
    finished: bool,
}

fn random_base64url_256() -> Result<Zeroizing<String>, LoginError> {
    let mut bytes = Zeroizing::new([0u8; 32]);
    getrandom::fill(&mut bytes[..]).map_err(|_| LoginError::Unavailable)?;
    Ok(Zeroizing::new(URL_SAFE_NO_PAD.encode(&bytes[..])))
}

pub(crate) fn random_uuid_v4() -> Result<String, LoginError> {
    let mut bytes = Zeroizing::new([0u8; 16]);
    getrandom::fill(&mut bytes[..]).map_err(|_| LoginError::Unavailable)?;
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let mut id = String::with_capacity(36);
    for (index, byte) in bytes.iter().enumerate() {
        if matches!(index, 4 | 6 | 8 | 10) { id.push('-'); }
        write!(&mut id, "{byte:02x}").map_err(|_| LoginError::Unavailable)?;
    }
    Ok(id)
}

pub(crate) fn valid_loopback_uri(candidate: &str) -> bool {
    if candidate.len() > 512 { return false; }
    let Ok(uri) = Url::parse(candidate) else { return false; };
    let Some(port) = uri.port() else { return false; };
    uri.scheme() == "http" && uri.host_str() == Some("127.0.0.1") &&
        port >= 1024 && uri.path() == CALLBACK_PATH &&
        uri.username().is_empty() && uri.password().is_none() &&
        uri.query().is_none() && uri.fragment().is_none() &&
        uri.as_str() == candidate
}

/// Production consent is accepted only by an explicitly opted-in build.
/// Staging/preview remains available for isolated integration tests.
pub(crate) fn valid_consent_origin(candidate: &str) -> Option<Url> {
    let uri = Url::parse(candidate).ok()?;
    let host = uri.host_str()?;
    let labels: Vec<_> = host.split('.').collect();
    let staging_host = labels.len() >= 3 &&
        labels[labels.len() - 2] == "virgostars" &&
        labels[labels.len() - 1] == "it" &&
        labels[..labels.len() - 2].iter().any(|label| matches!(*label, "staging" | "preview"));
    if uri.scheme() != "https" ||
        !(staging_host || (cfg!(feature = "production-connected-account") && host == "virgostars.it")) ||
        uri.port().is_some() || uri.path() != "/collega-dispositivo" ||
        uri.query().is_some() || uri.fragment().is_some() ||
        !uri.username().is_empty() || uri.password().is_some() ||
        uri.as_str() != candidate {
        return None;
    }
    Some(uri)
}

impl PendingPkceLogin {
    /// The host must bind an exclusive IPv4 loopback socket first and pass its
    /// actual port. Merely choosing an unbound port is insecure/racy.
    pub fn new(bound_loopback_port: u16, now: Instant) -> Result<Self, LoginError> {
        let redirect_uri = format!("http://127.0.0.1:{bound_loopback_port}{CALLBACK_PATH}");
        if !valid_loopback_uri(&redirect_uri) { return Err(LoginError::InvalidRedirect); }
        let verifier = random_base64url_256()?;
        let state = random_base64url_256()?;
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let expires_at = now.checked_add(LOGIN_LIFETIME).ok_or(LoginError::Unavailable)?;
        Ok(Self {
            attempt_id: random_uuid_v4()?, redirect_uri, state, verifier,
            challenge, expires_at, finished: false,
        })
    }

    /// Opaque ID only, safe for Angular to request status/cancellation.
    pub fn attempt_id(&self) -> &str { &self.attempt_id }

    /// Host-only redirect URI from the already bound listener. Never place
    /// this or the PKCE parameters in an Angular IPC response.
    pub(crate) fn bound_redirect_uri(&self) -> &str { &self.redirect_uri }

    pub fn remaining_seconds(&self, now: Instant) -> u64 {
        self.expires_at.saturating_duration_since(now).as_secs()
    }

    /// This URL is handed by the Rust host to the **system browser only**;
    /// it must not be returned from a Tauri IPC response or logged.
    pub fn consent_url(&self, page: &str) -> Result<Url, LoginError> {
        if self.finished { return Err(LoginError::AlreadyFinished); }
        let mut url = valid_consent_origin(page).ok_or(LoginError::InvalidConsentOrigin)?;
        // Fragments are not sent in the initial HTTP request, so state and
        // the loopback address do not enter the website's access logs.
        let mut fields = url::form_urlencoded::Serializer::new(String::new());
        fields.append_pair("client_id", CLIENT_ID)
            .append_pair("redirect_uri", &self.redirect_uri)
            .append_pair("code_challenge", &self.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("state", &self.state)
            .append_pair("request_groups_write", "true")
            .append_pair("request_charts_write", "true");
        url.set_fragment(Some(&fields.finish()));
        Ok(url)
    }

    pub fn cancel(&mut self) {
        self.finished = true;
        self.state.zeroize();
        self.verifier.zeroize();
    }

    /// Validates the absolute callback URL reconstructed by an exclusively
    /// bound loopback listener. A matching callback consumes the attempt once.
    /// Invalid or spoofed callbacks do not consume it; a timeout/cancel does.
    pub fn accept_callback(&mut self, candidate: &str, now: Instant) -> Result<CallbackDecision, LoginError> {
        if self.finished { return Err(LoginError::AlreadyFinished); }
        if now >= self.expires_at {
            self.cancel();
            return Err(LoginError::Expired);
        }
        if candidate.len() > 2048 { return Err(LoginError::InvalidCallback); }
        let uri = Url::parse(candidate).map_err(|_| LoginError::InvalidCallback)?;
        if uri.scheme() != "http" || uri.host_str() != Some("127.0.0.1") ||
            uri.username() != "" || uri.password().is_some() ||
            uri.fragment().is_some() || uri.as_str() != candidate ||
            uri.port() != Url::parse(&self.redirect_uri).ok().and_then(|u| u.port()) ||
            uri.path() != CALLBACK_PATH { return Err(LoginError::InvalidCallback); }

        let Some(query) = uri.query() else { return Err(LoginError::InvalidCallback); };
        if query.len() > 1024 { return Err(LoginError::InvalidCallback); }
        let fields: Vec<_> = uri.query_pairs().collect();
        if fields.len() != 2 || fields.iter().any(|(key, _)| key != "code" && key != "state" && key != "error") {
            return Err(LoginError::InvalidCallback);
        }
        let state = fields.iter().find(|(key, _)| key == "state")
            .map(|(_, value)| value.as_ref()).ok_or(LoginError::InvalidCallback)?;
        if state != self.state.as_str() { return Err(LoginError::InvalidCallback); }
        let code = fields.iter().find(|(key, _)| key == "code").map(|(_, value)| value.as_ref());
        let error = fields.iter().find(|(key, _)| key == "error").map(|(_, value)| value.as_ref());
        if error == Some("access_denied") && code.is_none() {
            if query != format!("state={state}&error=access_denied") &&
                query != format!("error=access_denied&state={state}") {
                return Err(LoginError::InvalidCallback);
            }
            self.cancel();
            return Ok(CallbackDecision::Denied);
        }
        let Some(code) = code else { return Err(LoginError::InvalidCallback); };
        if error.is_some() || code.len() != 43 ||
            !code.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_') {
            return Err(LoginError::InvalidCallback);
        }
        // The two values are URL-unreserved; any percent-encoded alias or
        // alternate raw representation is unnecessary and therefore rejected.
        if query != format!("code={code}&state={state}") &&
            query != format!("state={state}&code={code}") {
            return Err(LoginError::InvalidCallback);
        }
        // Only the host-side TLS token exchanger receives these zeroizing values.
        let verifier = std::mem::replace(&mut self.verifier, Zeroizing::new(String::new()));
        self.finished = true;
        self.state.zeroize();
        Ok(CallbackDecision::Approved {code: Zeroizing::new(code.to_owned()), code_verifier: verifier})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new() -> (PendingPkceLogin, Instant) {
        let now = Instant::now();
        (PendingPkceLogin::new(49152, now).unwrap(), now)
    }

    fn callback(attempt: &PendingPkceLogin, code: &str) -> String {
        let mut url = Url::parse(&attempt.redirect_uri).unwrap();
        url.query_pairs_mut().append_pair("code", code).append_pair("state", &attempt.state);
        url.to_string()
    }

    #[test]
    fn generates_random_challenge_and_state_with_expected_wire_format() {
        let (a, now) = new();
        let (b, _) = new();
        assert_ne!(a.state.as_str(), b.state.as_str());
        assert_ne!(a.verifier.as_str(), b.verifier.as_str());
        assert_ne!(a.attempt_id, b.attempt_id);
        assert_eq!(a.state.len(), 43);
        assert_eq!(a.verifier.len(), 43);
        assert_eq!(a.challenge.len(), 43);
        assert_eq!(a.challenge, URL_SAFE_NO_PAD.encode(Sha256::digest(a.verifier.as_bytes())));
        assert_eq!(a.remaining_seconds(now), 600);
    }

    #[test]
    fn sha256_challenge_matches_rfc_7636_appendix_b() {
        let verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        assert_eq!(challenge, "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
    }

    #[test]
    fn consent_url_puts_authorization_parameters_in_the_fragment() {
        let (a, _) = new();
        let url = a.consent_url("https://staging.virgostars.it/collega-dispositivo").unwrap();
        assert!(url.query().is_none());
        let query: Vec<_> = url::form_urlencoded::parse(url.fragment().unwrap().as_bytes()).collect();
        assert_eq!(query.len(), 7);
        assert_eq!(query.iter().find(|(key, _)| key == "request_groups_write").unwrap().1, "true");
        assert_eq!(query.iter().find(|(key, _)| key == "request_charts_write").unwrap().1, "true");
        assert_eq!(url.path(), "/collega-dispositivo");
        assert_eq!(query.iter().find(|(key, _)| key == "code_challenge_method").unwrap().1, "S256");
        assert_eq!(query.iter().find(|(key, _)| key == "redirect_uri").unwrap().1.as_ref(), a.redirect_uri.as_str());
        assert!(a.consent_url("https://preview.virgostars.it/collega-dispositivo").is_ok());
        assert!(a.consent_url("https://www.virgostars.it/collega-dispositivo").is_err());
        assert_eq!(a.consent_url("https://virgostars.it/collega-dispositivo").is_ok(), cfg!(feature = "production-connected-account"));
        assert!(a.consent_url("http://www.virgostars.it/collega-dispositivo").is_err());
        assert!(a.consent_url("https://virgostars.it.evil.test/collega-dispositivo").is_err());
        assert!(a.consent_url("https://staging.virgostars.it.evil.test/collega-dispositivo").is_err());
        assert!(a.consent_url("https://staging.virgostars.it/collega-dispositivo?next=https://evil.test").is_err());
        assert!(a.consent_url("https://staging.virgostars.it/collega-dispositivo#evil").is_err());
        assert!(a.consent_url("https://staging.virgostars.it:8443/collega-dispositivo").is_err());
    }

    #[test]
    fn exact_loopback_redirect_requires_approved_path_and_nonprivileged_port() {
        for port in [0, 80, 443, 1023] { assert!(PendingPkceLogin::new(port, Instant::now()).is_err()); }
        assert!(PendingPkceLogin::new(1024, Instant::now()).is_ok());
        assert!(PendingPkceLogin::new(u16::MAX, Instant::now()).is_ok());
        for uri in ["http://localhost:49152/virgostars/oauth/callback", "http://[::1]:49152/virgostars/oauth/callback", "http://127.0.0.1:49152/else", "https://127.0.0.1:49152/virgostars/oauth/callback", "http://127.0.0.1:49152/virgostars/oauth/callback?x=1"] {
            assert!(!valid_loopback_uri(uri), "{uri}");
        }
    }

    #[test]
    fn accepted_code_can_be_used_exactly_once_and_verifier_stays_native() {
        let (mut a, now) = new();
        let code = "A".repeat(43);
        let redirect = callback(&a, &code);
        let result = a.accept_callback(&redirect, now).unwrap();
        match result {
            CallbackDecision::Approved {code: actual, code_verifier} => {
                assert_eq!(actual.as_str(), code);
                assert_eq!(code_verifier.len(), 43);
            }
            CallbackDecision::Denied => panic!("expected authorization code"),
        }
        assert!(matches!(a.accept_callback(&redirect, now), Err(LoginError::AlreadyFinished)));
        assert!(matches!(a.consent_url("https://staging.virgostars.it/collega-dispositivo"), Err(LoginError::AlreadyFinished)));
    }

    #[test]
    fn reject_wrong_state_extra_duplicate_and_malformed_callbacks() {
        let (mut a, now) = new();
        let good = callback(&a, &"A".repeat(43));
        for bad in [
            good.replace(&a.state[..], &"Z".repeat(43)),
            format!("{good}&state=duplicate"),
            format!("{good}&token=not-allowed"),
            good.replace("code=", "Code="),
            good.replace("127.0.0.1", "localhost"),
            good.replace("49152", "49153"),
            good.replace("/virgostars/oauth/callback", "/else"),
            good.replace("http://", "https://"),
            format!("{good}#fragment"),
            good.replace("code=", "code=%41"),
        ] {
            assert!(matches!(a.accept_callback(&bad, now), Err(LoginError::InvalidCallback)), "bad callback accepted");
        }
        assert!(matches!(a.accept_callback(&good, now), Ok(CallbackDecision::Approved {..})));
    }

    #[test]
    fn cancelled_and_expired_attempts_never_accept_a_late_callback() {
        let (mut cancelled, now) = new();
        let cancelled_callback = callback(&cancelled, &"A".repeat(43));
        cancelled.cancel();
        assert!(matches!(cancelled.accept_callback(&cancelled_callback, now), Err(LoginError::AlreadyFinished)));
        let (mut expired, now) = new();
        let callback = callback(&expired, &"A".repeat(43));
        assert!(matches!(expired.accept_callback(&callback, now + LOGIN_LIFETIME), Err(LoginError::Expired)));
        assert!(matches!(expired.accept_callback(&callback, now + LOGIN_LIFETIME), Err(LoginError::AlreadyFinished)));
    }

    #[test]
    fn denial_uses_matching_state_and_single_use() {
        let (mut a, now) = new();
        let mut url = Url::parse(&a.redirect_uri).unwrap();
        url.query_pairs_mut().append_pair("state", &a.state).append_pair("error", "access_denied");
        let callback = url.to_string();
        assert!(matches!(a.accept_callback(&callback, now), Ok(CallbackDecision::Denied)));
        assert!(matches!(a.accept_callback(&callback, now), Err(LoginError::AlreadyFinished)));
    }
}
