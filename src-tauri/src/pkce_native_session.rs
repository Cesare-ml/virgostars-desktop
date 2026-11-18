//! Native-only owner of one staging login attempt and its short-lived grant.
//!
//! This code has no Tauri command, serialization, WebView or persistent store.
//! The future app-level session manager must still enforce a single active
//! attempt and must not expose tokens through status IPC.
#![allow(dead_code)]

use crate::pkce_loopback::{LoginCancelHandle, LoopbackError, SystemBrowserOpener};
use crate::pkce_staging_flow::{StagingLoginAttempt, StagingLoginError};
use crate::pkce_token_exchange::{NativeAccessGrant, TokenExchangeError, TokenHttpTransport};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeLoginPhase {
    Pending,
    Connected,
    Failed,
    Denied,
    Cancelled,
    Expired,
    Disconnected,
}

/// All status fields are safe to surface to a future narrowly scoped IPC.
/// No access token, authorization code, verifier or callback URL is included.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeLoginSnapshot {
    pub attempt_id: String,
    pub phase: NativeLoginPhase,
    pub remaining_seconds: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeSessionStartError {
    Login(StagingLoginError),
    WorkerUnavailable,
}

enum SecretState {
    Pending,
    Connected(NativeAccessGrant),
    Failed,
    Denied,
    Cancelled,
    Expired,
    Disconnected,
}

/// A single attempt is owned by a native host. On drop the attempt is
/// cancelled, and any stored grant is immediately dropped and zeroized.
pub struct NativeLoginSession {
    attempt_id: String,
    cancellation: LoginCancelHandle,
    state: Arc<Mutex<SecretState>>,
    deadline: Instant,
}

impl NativeLoginSession {
    /// `start` opens the already allowlisted consent page and immediately
    /// schedules a dedicated Rust worker. Do not invoke on an async executor;
    /// the future host will provide a bounded native owner and off-UI launch.
    pub fn start<B, T>(
        browser: &B,
        transport: T,
        consent_url: &str,
        token_endpoint: &str,
        max_wait: Duration,
    ) -> Result<Self, NativeSessionStartError>
    where
        B: SystemBrowserOpener,
        T: TokenHttpTransport + Send + 'static,
    {
        if max_wait.is_zero() || max_wait > Duration::from_secs(600) {
            return Err(NativeSessionStartError::WorkerUnavailable);
        }
        let deadline = Instant::now().checked_add(max_wait).ok_or(NativeSessionStartError::WorkerUnavailable)?;
        let attempt = StagingLoginAttempt::begin(browser, consent_url, token_endpoint)
            .map_err(NativeSessionStartError::Login)?;
        if Instant::now() >= deadline {
            return Err(NativeSessionStartError::WorkerUnavailable);
        }
        let attempt_id = attempt.attempt_id().to_owned();
        let cancellation = attempt.cancellation_handle();
        let state = Arc::new(Mutex::new(SecretState::Pending));
        let state_for_worker = Arc::clone(&state);
        let cancel_if_spawn_fails = cancellation.clone();

        // No JoinHandle is retained on the UI: dropping it detaches the
        // bounded worker. Shared state and the cancel handle remain owned by
        // this session until it is explicitly disconnected or dropped.
        thread::Builder::new()
            .name("virgostars-staging-pkce".to_owned())
            .spawn(move || {
                let outcome = attempt.wait_and_exchange(&transport, deadline.saturating_duration_since(Instant::now()));
                if let Ok(mut current) = state_for_worker.lock() {
                    // Explicit disconnect/drop wins even when the backend
                    // response arrives after the native owner has gone away.
                    if matches!(*current, SecretState::Pending) {
                        *current = if Instant::now() >= deadline {
                            SecretState::Expired
                        } else { match outcome {
                            Ok(grant) => SecretState::Connected(grant),
                            Err(StagingLoginError::Cancelled) => SecretState::Cancelled,
                            Err(StagingLoginError::Listener(LoopbackError::Expired)) => SecretState::Expired,
                            Err(StagingLoginError::TokenExchange(TokenExchangeError::Denied)) => SecretState::Denied,
                            Err(_) => SecretState::Failed,
                        }};
                    }
                }
            })
            .map_err(|_| {
                cancel_if_spawn_fails.cancel();
                NativeSessionStartError::WorkerUnavailable
            })?;

        Ok(Self {attempt_id, cancellation, state, deadline})
    }

    pub fn snapshot(&self) -> NativeLoginSnapshot {
        let now = Instant::now();
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(_) => return NativeLoginSnapshot {
                attempt_id: self.attempt_id.clone(),
                phase: NativeLoginPhase::Failed,
                remaining_seconds: 0,
            },
        };
        let (phase, remaining_seconds) = match &*state {
            SecretState::Pending => {
                if now >= self.deadline {
                    self.cancellation.cancel();
                    *state = SecretState::Expired;
                    (NativeLoginPhase::Expired, 0)
                } else {
                    let remaining = self.deadline.duration_since(now);
                    (NativeLoginPhase::Pending, remaining.as_secs() + u64::from(remaining.subsec_nanos() != 0))
                }
            },
            SecretState::Connected(grant) => {
                let remaining = grant.remaining_seconds(now);
                if remaining == 0 {
                    // Drop the expired secret now, rather than holding it in
                    // native RAM until the session owner is destroyed.
                    *state = SecretState::Expired;
                    (NativeLoginPhase::Expired, 0)
                } else {
                    (NativeLoginPhase::Connected, remaining)
                }
            }
            SecretState::Failed => (NativeLoginPhase::Failed, 0),
            SecretState::Denied => (NativeLoginPhase::Denied, 0),
            SecretState::Cancelled => (NativeLoginPhase::Cancelled, 0),
            SecretState::Expired => (NativeLoginPhase::Expired, 0),
            SecretState::Disconnected => (NativeLoginPhase::Disconnected, 0),
        };
        NativeLoginSnapshot {attempt_id:self.attempt_id.clone(), phase, remaining_seconds}
    }

    /// Cancels only an in-flight login. If native completion already won,
    /// `cancel()` is inert; `disconnect()` revokes the local grant instead.
    pub fn cancel(&self) {
        self.cancellation.cancel();
        if self.cancellation.is_cancelled() {
            if let Ok(mut current) = self.state.lock() {
                if matches!(*current, SecretState::Pending) {
                    *current = SecretState::Cancelled;
                }
            }
        }
    }

    /// Local-only disconnect, not remote token revocation. The stored access
    /// token is dropped/zeroized and a late worker result cannot resurrect it.
    pub fn disconnect(&self) {
        self.cancellation.cancel();
        if let Ok(mut current) = self.state.lock() {
            *current = SecretState::Disconnected;
        }
    }
}

impl Drop for NativeLoginSession {
    fn drop(&mut self) { self.disconnect(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pkce_loopback::SystemBrowserOpener;
    use crate::pkce_token_exchange::TokenHttpResponse;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use url::Url;

    const CONSENT: &str = "https://staging.virgostars.it/collega-dispositivo";
    const TOKEN: &str = "https://staging.virgostars.it/chart-sync/v1/token";

    #[derive(Default)]
    struct SilentBrowser { opened: AtomicUsize }
    impl SystemBrowserOpener for SilentBrowser {
        fn open_in_system_browser(&self, _: &Url) -> Result<(), ()> {
            self.opened.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct FakeHttp { posts: Arc<AtomicUsize> }
    impl TokenHttpTransport for FakeHttp {
        fn post_form(&self, _: &Url, _: &str, _: Duration, _: usize) -> Result<TokenHttpResponse, ()> {
            self.posts.fetch_add(1, Ordering::SeqCst);
            let jwt = format!("{}.{}.{}", "A".repeat(43), "B".repeat(43), "C".repeat(100));
            Ok(TokenHttpResponse {
                status: 200,
                content_type: "application/json".to_owned(),
                body: format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read"}}"#).into_bytes(),
            })
        }
        fn verify_grant(&self, _: &Url, _: &NativeAccessGrant) -> Result<(), ()> { Ok(()) }
    }

    #[test]
    fn cancellation_never_exchanges_or_returns_secrets_in_snapshot() {
        let browser = SilentBrowser::default();
        let posts = Arc::new(AtomicUsize::new(0));
        let session = NativeLoginSession::start(
            &browser, FakeHttp { posts:Arc::clone(&posts) }, CONSENT, TOKEN, Duration::from_secs(2),
        ).unwrap();
        assert_eq!(session.snapshot().phase, NativeLoginPhase::Pending);
        assert!((1..=2).contains(&session.snapshot().remaining_seconds));
        session.cancel();
        let status = session.snapshot();
        assert_eq!(status.phase, NativeLoginPhase::Cancelled);
        assert_eq!(status.remaining_seconds, 0);
        assert_eq!(status.attempt_id.len(), 36);
        assert_eq!(posts.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn invalid_endpoint_or_wait_rejected_before_browser_launch() {
        let browser = SilentBrowser::default();
        let posts = Arc::new(AtomicUsize::new(0));
        assert!(NativeLoginSession::start(
            &browser, FakeHttp { posts:Arc::clone(&posts) }, CONSENT,
            "https://www.virgostars.it/chart-sync/v1/token", Duration::from_secs(2),
        ).is_err());
        assert!(NativeLoginSession::start(
            &browser, FakeHttp { posts:Arc::clone(&posts) }, CONSENT, TOKEN, Duration::ZERO,
        ).is_err());
        assert_eq!(browser.opened.load(Ordering::SeqCst), 0);
        assert_eq!(posts.load(Ordering::SeqCst), 0);
    }

    struct CallbackBrowser;
    impl SystemBrowserOpener for CallbackBrowser {
        fn open_in_system_browser(&self, consent: &Url) -> Result<(), ()> {
            let fields: Vec<_> = consent.query_pairs().collect();
            let redirect = fields.iter().find(|(k,_)| k == "redirect_uri").ok_or(())?.1.to_string();
            let state = fields.iter().find(|(k,_)| k == "state").ok_or(())?.1.to_string();
            thread::spawn(move || {
                thread::sleep(Duration::from_millis(30));
                let mut callback = Url::parse(&redirect).unwrap();
                callback.query_pairs_mut().append_pair("code", &"A".repeat(43)).append_pair("state", &state);
                let port = callback.port().unwrap();
                let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
                let request = format!("GET {}?{} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n",callback.path(),callback.query().unwrap());
                stream.write_all(request.as_bytes()).unwrap();
                let mut response = Vec::new();
                stream.read_to_end(&mut response).unwrap();
                assert!(response.starts_with(b"HTTP/1.1 200"));
            });
            Ok(())
        }
    }

    #[test]
    fn synthetic_callback_reaches_native_connected_then_local_disconnect() {
        let posts = Arc::new(AtomicUsize::new(0));
        let session = NativeLoginSession::start(
            &CallbackBrowser, FakeHttp {posts:Arc::clone(&posts)}, CONSENT,TOKEN,Duration::from_secs(2),
        ).unwrap();
        let deadline = Instant::now() + Duration::from_secs(2);
        let connected = loop {
            let snapshot = session.snapshot();
            if snapshot.phase != NativeLoginPhase::Pending || Instant::now() >= deadline { break snapshot; }
            thread::sleep(Duration::from_millis(10));
        };
        assert_eq!(connected.phase, NativeLoginPhase::Connected);
        assert!(connected.remaining_seconds > 0 && connected.remaining_seconds <= 900);
        assert_eq!(posts.load(Ordering::SeqCst), 1);
        session.cancel(); // completion already won: no backward transition
        assert_eq!(session.snapshot().phase, NativeLoginPhase::Connected);
        session.disconnect();
        assert_eq!(session.snapshot().phase, NativeLoginPhase::Disconnected);
    }

    struct SlowVerify {
        entered: std::sync::mpsc::Sender<()>,
        release: std::sync::mpsc::Receiver<()>,
    }
    impl TokenHttpTransport for SlowVerify {
        fn post_form(&self, _: &Url, _: &str, _: Duration, _: usize) -> Result<TokenHttpResponse, ()> {
            let jwt = format!("{}.{}.{}", "A".repeat(43), "B".repeat(43), "C".repeat(100));
            Ok(TokenHttpResponse { status: 200, content_type: "application/json".to_owned(),
                body: format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read"}}"#).into_bytes() })
        }
        fn verify_grant(&self, _: &Url, _: &NativeAccessGrant) -> Result<(), ()> {
            self.entered.send(()).map_err(|_| ())?;
            self.release.recv_timeout(Duration::from_secs(3)).map_err(|_| ())
        }
    }

    #[test]
    fn cancellation_during_session_verification_never_installs_late_grant() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let session = NativeLoginSession::start(&CallbackBrowser,
            SlowVerify { entered: entered_tx, release: release_rx }, CONSENT, TOKEN, Duration::from_secs(2)).unwrap();
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        session.cancel();
        assert_eq!(session.snapshot().phase, NativeLoginPhase::Cancelled);
        release_tx.send(()).unwrap();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(session.snapshot().phase, NativeLoginPhase::Cancelled);
    }

    #[test]
    fn pending_authorization_expires_without_a_callback() {
        let browser = SilentBrowser::default();
        let posts = Arc::new(AtomicUsize::new(0));
        let session = NativeLoginSession::start(&browser, FakeHttp { posts:Arc::clone(&posts) },
            CONSENT, TOKEN, Duration::from_millis(100)).unwrap();
        let until = Instant::now() + Duration::from_secs(2);
        loop {
            let status = session.snapshot();
            if status.phase == NativeLoginPhase::Expired { break; }
            assert!(Instant::now() < until);
            thread::sleep(Duration::from_millis(10));
        }
        assert_eq!(posts.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn verification_finishing_after_deadline_cannot_install_grant() {
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let session = NativeLoginSession::start(&CallbackBrowser,
            SlowVerify { entered: entered_tx, release: release_rx }, CONSENT, TOKEN, Duration::from_millis(200)).unwrap();
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        thread::sleep(Duration::from_millis(250));
        release_tx.send(()).unwrap();
        thread::sleep(Duration::from_millis(50));
        assert_eq!(session.snapshot().phase, NativeLoginPhase::Expired);
    }
}
