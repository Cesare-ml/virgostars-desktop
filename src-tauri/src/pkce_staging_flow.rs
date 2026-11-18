//! Inert staging login coordinator: bound loopback -> browser -> callback -> token.
//!
//! This composes previously isolated Rust primitives with an injected browser
//! and HTTP transport. No Tauri IPC, UI, external network adapter or live
//! authorization feature flag is enabled by registering this module.
#![allow(dead_code)]

use crate::pkce_loopback::{LoginCancelHandle, LoopbackError, LoopbackLogin, SystemBrowserOpener};
use crate::pkce_token_exchange::{
    exchange_approved_code, valid_staging_token_endpoint, NativeAccessGrant,
    TokenExchangeError, TokenHttpTransport,
};
use std::time::{Duration, Instant};
use url::Url;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StagingLoginError {
    InvalidEndpoint,
    Listener(LoopbackError),
    TokenExchange(TokenExchangeError),
    Cancelled,
}

/// A native worker may move this value to its background thread while the
/// future native session manager retains a cloned cancellation handle.
pub struct StagingLoginAttempt {
    loopback: LoopbackLogin,
    token_endpoint: Url,
    cancellation: LoginCancelHandle,
}

impl StagingLoginAttempt {
    /// Reject invalid token destinations *before* opening the system browser.
    pub fn begin<B: SystemBrowserOpener>(
        browser: &B,
        staging_consent_page: &str,
        staging_token_endpoint: &str,
    ) -> Result<Self, StagingLoginError> {
        let endpoint = valid_staging_token_endpoint(staging_token_endpoint)
            .ok_or(StagingLoginError::InvalidEndpoint)?;
        let loopback = LoopbackLogin::start(browser, staging_consent_page)
            .map_err(StagingLoginError::Listener)?;
        let cancellation = loopback.cancellation_handle();
        Ok(Self {loopback, token_endpoint:endpoint, cancellation})
    }

    pub fn attempt_id(&self) -> &str { self.loopback.attempt_id() }

    pub fn cancellation_handle(&self) -> LoginCancelHandle { self.cancellation.clone() }

    /// Blocking native-only worker operation; never run on Tauri/Angular UI.
    /// A cancelled result must never reach the caller as a usable token, even
    /// if cancellation races with an HTTP response.
    pub fn wait_and_exchange<T: TokenHttpTransport>(
        mut self,
        transport: &T,
        max_wait: Duration,
    ) -> Result<NativeAccessGrant, StagingLoginError> {
        if self.cancellation.is_cancelled() {
            self.loopback.cancel();
            return Err(StagingLoginError::Cancelled);
        }
        let redirect = self.loopback.bound_redirect_uri().to_owned();
        let result = self.loopback.wait_for_callback(max_wait).map_err(|error| {
            if error == LoopbackError::Cancelled {
                StagingLoginError::Cancelled
            } else {
                StagingLoginError::Listener(error)
            }
        })?;
        if self.cancellation.is_cancelled() { return Err(StagingLoginError::Cancelled); }
        let grant = exchange_approved_code(
            transport,
            self.token_endpoint.as_str(),
            &redirect,
            result,
            Instant::now(),
        ).map_err(StagingLoginError::TokenExchange)?;
        // Atomic finalization: if cancellation wins the race, the token is
        // dropped/zeroized. If completion wins, later cancellation is inert.
        if !self.cancellation.finish_success() { return Err(StagingLoginError::Cancelled); }
        Ok(grant)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pkce_token_exchange::{TokenHttpResponse, TokenScope};
    use std::cell::Cell;
    use std::io::{Read, Write};
    use std::net::{Ipv4Addr, TcpStream};
    use std::sync::Mutex;
    use std::thread;

    const CONSENT: &str = "https://staging.virgostars.it/collega-dispositivo";
    const TOKEN: &str = "https://staging.virgostars.it/chart-sync/v1/token";

    #[derive(Default)]
    struct SyntheticBrowser {
        launches: Cell<u32>,
        send_callback: bool,
        callback_worker: Mutex<Option<thread::JoinHandle<()>>>,
    }

    impl SystemBrowserOpener for SyntheticBrowser {
        fn open_in_system_browser(&self, url: &Url) -> Result<(), ()> {
            self.launches.set(self.launches.get() + 1);
            if !self.send_callback { return Ok(()); }
            let fields: Vec<_> = url.query_pairs().collect();
            let redirect = fields.iter().find(|(k,_)| k == "redirect_uri").unwrap().1.to_string();
            let state = fields.iter().find(|(k,_)| k == "state").unwrap().1.to_string();
            let worker = thread::spawn(move || {
                thread::sleep(Duration::from_millis(30));
                let mut callback = Url::parse(&redirect).unwrap();
                callback.query_pairs_mut().append_pair("code", &"A".repeat(43)).append_pair("state", &state);
                let port = callback.port().unwrap();
                let mut stream = TcpStream::connect((Ipv4Addr::LOCALHOST, port)).unwrap();
                let request = format!("GET {}?{} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n",
                    callback.path(), callback.query().unwrap());
                stream.write_all(request.as_bytes()).unwrap();
                let mut response = Vec::new();
                stream.read_to_end(&mut response).unwrap();
                assert!(response.starts_with(b"HTTP/1.1 200"));
            });
            *self.callback_worker.lock().unwrap() = Some(worker);
            Ok(())
        }
    }

    #[derive(Default)]
    struct FakeHttp { calls: Cell<u32> }

    impl TokenHttpTransport for FakeHttp {
        fn post_form(&self, endpoint: &Url, body: &str, timeout: Duration, max: usize) -> Result<TokenHttpResponse, ()> {
            self.calls.set(self.calls.get() + 1);
            assert_eq!(endpoint.as_str(), TOKEN);
            assert!(body.contains("grant_type=authorization_code"));
            assert_eq!(timeout, Duration::from_secs(10));
            assert_eq!(max, 8192);
            let jwt = format!("{}.{}.{}", "A".repeat(43), "B".repeat(43), "C".repeat(100));
            Ok(TokenHttpResponse {
                status:200,
                content_type:"application/json".to_owned(),
                body:format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read"}}"#).into_bytes(),
            })
        }
    }

    #[test]
    fn synthetic_callback_to_token_flow_stays_entirely_native() {
        let browser = SyntheticBrowser {send_callback:true, ..Default::default()};
        let http = FakeHttp::default();
        let attempt = StagingLoginAttempt::begin(&browser, CONSENT, TOKEN).unwrap();
        assert_eq!(browser.launches.get(), 1);
        assert_eq!(attempt.attempt_id().len(), 36);
        let grant = attempt.wait_and_exchange(&http, Duration::from_secs(3)).unwrap();
        assert_eq!(http.calls.get(), 1);
        assert_eq!(grant.scope(), TokenScope::Read);
        browser.callback_worker.lock().unwrap().take().unwrap().join().unwrap();
    }

    #[test]
    fn cancelled_attempt_does_not_exchange_or_return_a_grant() {
        let browser = SyntheticBrowser::default();
        let http = FakeHttp::default();
        let attempt = StagingLoginAttempt::begin(&browser, CONSENT, TOKEN).unwrap();
        let cancel = attempt.cancellation_handle();
        cancel.cancel();
        assert!(matches!(attempt.wait_and_exchange(&http, Duration::from_secs(3)), Err(StagingLoginError::Cancelled)));
        assert_eq!(http.calls.get(), 0);
    }

    #[test]
    fn invalid_staging_endpoint_cannot_launch_a_browser() {
        let browser = SyntheticBrowser::default();
        assert!(matches!(StagingLoginAttempt::begin(&browser,CONSENT,"https://www.virgostars.it/chart-sync/v1/token"),Err(StagingLoginError::InvalidEndpoint)));
        assert_eq!(browser.launches.get(), 0);
    }
}
