//! Native-only owner of one staging login attempt and its short-lived grant.
//!
//! This code has no Tauri command, serialization, WebView or persistent store.
//! The future app-level session manager must still enforce a single active
//! attempt and must not expose tokens through status IPC.
#![allow(dead_code)]

use crate::pkce_loopback::{LoginCancelHandle, LoopbackError, SystemBrowserOpener};
use crate::pkce_staging_flow::{StagingLoginAttempt, StagingLoginError};
use crate::pkce_token_exchange::{NativeAccessGrant, TokenExchangeError, TokenHttpTransport, TokenScope};
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
    Offline,
    Disconnected,
}

/// All status fields are safe to surface to a future narrowly scoped IPC.
/// No access token, authorization code, verifier or callback URL is included.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NativeLoginSnapshot {
    pub attempt_id: String,
    pub phase: NativeLoginPhase,
    pub remaining_seconds: u64,
    pub scope: Option<TokenScope>,
    pub persistent: bool,
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
    Offline,
    Disconnected,
}

/// A single attempt is owned by a native host. On drop the attempt is
/// cancelled, and any stored grant is immediately dropped and zeroized.
pub struct NativeLoginSession {
    attempt_id: String,
    cancellation: LoginCancelHandle,
    state: Arc<Mutex<SecretState>>,
    deadline: Instant,
    #[cfg(feature = "persistent-connected-account")]
    owns_credential: Arc<std::sync::atomic::AtomicBool>,
}

impl NativeLoginSession {
    #[cfg(feature = "persistent-connected-account")]
    pub(crate) fn attempt_id(&self) -> &str { &self.attempt_id }
    #[cfg(test)]
    pub(crate) fn synthetic_connected_for_test(attempt_id: &str, grant: NativeAccessGrant) -> Self {
        Self {attempt_id:attempt_id.into(),cancellation:LoginCancelHandle::synthetic_for_test(),
            state:Arc::new(Mutex::new(SecretState::Connected(grant))),deadline:Instant::now()+Duration::from_secs(60),
            #[cfg(feature = "persistent-connected-account")] owns_credential:Arc::new(std::sync::atomic::AtomicBool::new(false))}
    }
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
        #[cfg(all(feature = "persistent-connected-account", not(test)))]
        {
            use crate::refresh_credential_store::RefreshCredentialStore;
            if crate::refresh_credential_store::OsRefreshCredentialStore.load()
                .map_err(|_|NativeSessionStartError::WorkerUnavailable)?.is_some() {
                return Err(NativeSessionStartError::WorkerUnavailable);
            }
        }
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
        #[cfg(feature = "persistent-connected-account")]
        let owns_credential = Arc::new(std::sync::atomic::AtomicBool::new(false));
        #[cfg(feature = "persistent-connected-account")]
        let owns_for_worker = Arc::clone(&owns_credential);
        #[cfg(feature = "persistent-connected-account")]
        let endpoint_for_worker = token_endpoint.to_owned();

        // No JoinHandle is retained on the UI: dropping it detaches the
        // bounded worker. Shared state and the cancel handle remain owned by
        // this session until it is explicitly disconnected or dropped.
        thread::Builder::new()
            .name("virgostars-staging-pkce".to_owned())
            .spawn(move || {
                let mut outcome = Some(attempt.wait_and_exchange(&transport, deadline.saturating_duration_since(Instant::now())));
                if let Ok(mut current) = state_for_worker.lock() {
                    // Explicit disconnect/drop wins even when the backend
                    // response arrives after the native owner has gone away.
                    if matches!(*current, SecretState::Pending) {
                        *current = if Instant::now() >= deadline {
                            SecretState::Expired
                        } else { match outcome.take().expect("one login outcome") {
                            Ok(grant) => {
                                #[cfg(feature = "persistent-connected-account")]
                                {
                                    use crate::refresh_credential_store::RefreshCredentialStore;
                                    let mut grant = grant;
                                    match grant.take_refresh_credential() {
                                        Some(credential) if crate::refresh_credential_store::OsRefreshCredentialStore.store(&credential).is_ok() => {
                                            owns_for_worker.store(true, std::sync::atomic::Ordering::SeqCst);
                                            SecretState::Connected(grant)
                                        },
                                        Some(credential) => {
                                            if let Ok(http) = crate::persistent_transport::PersistentTransport::new(&transport, &endpoint_for_worker) {
                                                let _ = http.revoke_unstored(&credential);
                                            }
                                            SecretState::Failed
                                        },
                                        None => SecretState::Connected(grant),
                                    }
                                }
                                #[cfg(not(feature = "persistent-connected-account"))]
                                { SecretState::Connected(grant) }
                            },
                            Err(StagingLoginError::Cancelled) => SecretState::Cancelled,
                            Err(StagingLoginError::Listener(LoopbackError::Expired)) => SecretState::Expired,
                            Err(StagingLoginError::TokenExchange(TokenExchangeError::Denied)) => SecretState::Denied,
                            Err(_) => SecretState::Failed,
                        }};
                    }
                }
                #[cfg(feature = "persistent-connected-account")]
                if let Some(Ok(mut grant)) = outcome {
                    if let Some(credential) = grant.take_refresh_credential() {
                        if let Ok(http) = crate::persistent_transport::PersistentTransport::new(&transport, &endpoint_for_worker) {
                            let _ = http.revoke_unstored(&credential);
                        }
                    }
                }
                // Expiry must clear the token even if the WebView is frozen
                // or never asks for another status snapshot.
                #[cfg(feature = "persistent-connected-account")]
                if owns_for_worker.load(std::sync::atomic::Ordering::SeqCst) {
                    Self::persistent_loop(&state_for_worker, &transport, &endpoint_for_worker);
                } else { Self::ephemeral_loop(&state_for_worker); }
                #[cfg(not(feature = "persistent-connected-account"))]
                Self::ephemeral_loop(&state_for_worker);
            })
            .map_err(|_| {
                cancel_if_spawn_fails.cancel();
                NativeSessionStartError::WorkerUnavailable
            })?;

        Ok(Self {attempt_id, cancellation, state, deadline,
            #[cfg(feature = "persistent-connected-account")] owns_credential})
    }

    fn ephemeral_loop(state: &Arc<Mutex<SecretState>>) {
        loop {
            let Ok(mut current) = state.lock() else { break; };
            match &*current {
                SecretState::Connected(grant) if grant.remaining_seconds(Instant::now()) == 0 => {
                    *current = SecretState::Expired; break;
                }
                SecretState::Connected(_) => {},
                _ => break,
            }
            drop(current);
            thread::sleep(Duration::from_millis(250));
        }
    }

    #[cfg(feature = "persistent-connected-account")]
    fn persistent_loop<T: TokenHttpTransport>(state: &Arc<Mutex<SecretState>>, transport: &T, endpoint: &str) {
        use crate::refresh_credential_store::OsRefreshCredentialStore;
        loop {
            let Ok(mut current) = state.lock() else { break; };
            let SecretState::Connected(grant) = &*current else { break; };
            if grant.remaining_seconds(Instant::now()) > 60 {
                drop(current);
                thread::sleep(Duration::from_secs(1));
                continue;
            }
            let expected_profile = grant.profile_ref().map(str::to_owned);
            let Ok(http) = crate::persistent_transport::PersistentTransport::new(transport, endpoint) else {
                *current = SecretState::Failed; break;
            };
            let rotated = crate::refresh_cycle::refresh_once(&OsRefreshCredentialStore, &http);
            if matches!(&rotated,Err(crate::refresh_cycle::RefreshError::Offline)) {
                *current = SecretState::Offline; break;
            }
            let refreshed = rotated.ok().and_then(|mut next| {
                    let profile = transport.verify_grant(&http.endpoint, &next).ok()?;
                    if Some(profile.as_str()) != expected_profile.as_deref() { return None; }
                    next.bind_profile(profile).ok()?;
                    Some(next)
                });
            match refreshed { Some(next) => *current = SecretState::Connected(next),
                None => { *current = SecretState::Expired; break; } }
        }
    }

    /// Restores only an OS-stored credential. No browser or identity is taken
    /// from the WebView. An uncertain prior rotation is never replayed.
    #[cfg(feature = "persistent-connected-account")]
    pub fn restore<T: TokenHttpTransport + Send + 'static>(transport: T, endpoint: &str) -> Result<Option<Self>, NativeSessionStartError> {
        use crate::refresh_credential_store::{OsRefreshCredentialStore, RefreshCredentialStore};
        let stored = OsRefreshCredentialStore.load().map_err(|_|NativeSessionStartError::WorkerUnavailable)?;
        let Some(stored) = stored else { return Ok(None); };
        if stored.revoke_pending() {
            let http = crate::persistent_transport::PersistentTransport::new(&transport, endpoint)
                .map_err(|_|NativeSessionStartError::WorkerUnavailable)?;
            http.revoke(&OsRefreshCredentialStore).map_err(|_|NativeSessionStartError::WorkerUnavailable)?;
            return Ok(None);
        }
        let attempt_id = crate::pkce_login::random_uuid_v4().map_err(|_|NativeSessionStartError::WorkerUnavailable)?;
        let cancellation = LoginCancelHandle::for_restore();
        let worker_cancel = cancellation.clone();
        let deadline = Instant::now() + Duration::from_secs(60);
        let state = Arc::new(Mutex::new(SecretState::Pending));
        let worker_state = Arc::clone(&state);
        let endpoint = endpoint.to_owned();
        thread::Builder::new().name("virgostars-restore".into()).spawn(move || {
            let Ok(mut current) = worker_state.lock() else { return; };
            if worker_cancel.is_cancelled() { *current = SecretState::Cancelled; return; }
            let Ok(http) = crate::persistent_transport::PersistentTransport::new(&transport, &endpoint) else {
                *current = SecretState::Failed; return;
            };
            let rotated = crate::refresh_cycle::refresh_once(&OsRefreshCredentialStore, &http);
            if matches!(&rotated,Err(crate::refresh_cycle::RefreshError::Offline)) {
                *current = SecretState::Offline; return;
            }
            let result = rotated.ok().and_then(|mut grant| {
                let profile = transport.verify_grant(&http.endpoint, &grant).ok()?;
                grant.bind_profile(profile).ok()?;
                Some(grant)
            });
            if worker_cancel.is_cancelled() { *current = SecretState::Cancelled; return; }
            match result {
                Some(grant) if worker_cancel.finish_success() => *current = SecretState::Connected(grant),
                _ => { *current = SecretState::Expired; return; }
            }
            drop(current);
            Self::persistent_loop(&worker_state, &transport, &endpoint);
        }).map_err(|_|NativeSessionStartError::WorkerUnavailable)?;
        Ok(Some(Self {attempt_id, cancellation, state, deadline,
            owns_credential:Arc::new(std::sync::atomic::AtomicBool::new(true))}))
    }

    #[cfg(feature = "persistent-connected-account")]
    pub fn revoke<T: TokenHttpTransport>(&self, transport: &T, endpoint: &str) -> Result<(), ()> {
        let mut current = self.state.lock().map_err(|_|())?;
        *current = SecretState::Disconnected;
        if !self.owns_credential.load(std::sync::atomic::Ordering::SeqCst) { return Ok(()); }
        crate::persistent_transport::PersistentTransport::new(transport, endpoint)?
            .revoke(&crate::refresh_credential_store::OsRefreshCredentialStore)
    }

    pub fn snapshot(&self) -> NativeLoginSnapshot {
        let now = Instant::now();
        let mut state = match self.state.lock() {
            Ok(guard) => guard,
            Err(_) => return NativeLoginSnapshot {
                attempt_id: self.attempt_id.clone(),
                phase: NativeLoginPhase::Failed,
                remaining_seconds: 0,
                scope: None,
                persistent: false,
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
            SecretState::Offline => (NativeLoginPhase::Offline, 0),
            SecretState::Disconnected => (NativeLoginPhase::Disconnected, 0),
        };
        let scope = match &*state { SecretState::Connected(grant) => Some(grant.scope()), _ => None };
        #[cfg(feature = "persistent-connected-account")]
        let persistent = phase == NativeLoginPhase::Connected && self.owns_credential.load(std::sync::atomic::Ordering::SeqCst);
        #[cfg(not(feature = "persistent-connected-account"))]
        let persistent = false;
        NativeLoginSnapshot {attempt_id:self.attempt_id.clone(), phase, remaining_seconds, scope, persistent}
    }

    pub(crate) fn copy_active_grant(&self) -> Option<NativeAccessGrant> {
        let state = self.state.lock().ok()?;
        match &*state { SecretState::Connected(grant) => grant.copy_for_worker(Instant::now()), _ => None }
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
        fn verify_grant(&self, _: &Url, _: &NativeAccessGrant) -> Result<String, ()> { Ok("44444444-4444-4444-8444-444444444444".into()) }
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
            let fields: Vec<_> = url::form_urlencoded::parse(consent.fragment().unwrap().as_bytes()).collect();
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

    #[cfg(feature = "persistent-connected-account")]
    #[test]
    fn persistent_login_reopens_and_explicit_signout_clears_the_credential() {
        use crate::refresh_credential_store::{OsRefreshCredentialStore, RefreshCredentialStore};
        let store=OsRefreshCredentialStore;
        store.delete().unwrap();
        struct PersistentFake;
        impl TokenHttpTransport for PersistentFake {
            fn post_form(&self, _: &Url, body:&str, _:Duration, _:usize) -> Result<TokenHttpResponse,()> {
                let pairs:Vec<_>=url::form_urlencoded::parse(body.as_bytes()).collect();
                let operation=pairs.iter().find(|(key,_)|key=="grant_type").ok_or(())?.1.as_ref();
                let body=if operation=="revoke" {r#"{"status":"revoked"}"#.to_owned()} else {
                    let refresh=if operation=="authorization_code" {"a".repeat(43)} else {"b".repeat(43)};
                    let jwt=format!("{}.{}.{}","a".repeat(43),"b".repeat(43),"c".repeat(100));
                    format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":900,"scope":"chart_sync:read","refresh_token":"{refresh}"}}"#)
                };
                Ok(TokenHttpResponse {status:200,content_type:"application/json".into(),body:body.into_bytes()})
            }
            fn verify_grant(&self,_:&Url,_:&NativeAccessGrant)->Result<String,()> {
                Ok("44444444-4444-4444-8444-444444444444".into())
            }
        }
        fn await_connected(session:&NativeLoginSession) {
            let limit=Instant::now()+Duration::from_secs(3);
            loop {
                let phase=session.snapshot().phase;
                if phase==NativeLoginPhase::Connected {break;}
                assert_eq!(phase,NativeLoginPhase::Pending);
                assert!(Instant::now()<limit);
                thread::sleep(Duration::from_millis(10));
            }
        }
        let first=NativeLoginSession::start(&CallbackBrowser,PersistentFake,CONSENT,TOKEN,Duration::from_secs(3)).unwrap();
        await_connected(&first);
        assert!(store.load().unwrap().is_some());
        drop(first);
        assert!(store.load().unwrap().is_some());
        let restored=NativeLoginSession::restore(PersistentFake,TOKEN).unwrap().unwrap();
        await_connected(&restored);
        restored.revoke(&PersistentFake,TOKEN).unwrap();
        assert!(store.load().unwrap().is_none());
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
        fn verify_grant(&self, _: &Url, _: &NativeAccessGrant) -> Result<String, ()> {
            self.entered.send(()).map_err(|_| ())?;
            self.release.recv_timeout(Duration::from_secs(3)).map_err(|_| ())?;
            Ok("44444444-4444-4444-8444-444444444444".into())
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

    struct ShortLivedHttp;
    impl TokenHttpTransport for ShortLivedHttp {
        fn post_form(&self, _: &Url, _: &str, _: Duration, _: usize) -> Result<TokenHttpResponse, ()> {
            let jwt = format!("{}.{}.{}", "A".repeat(43), "B".repeat(43), "C".repeat(100));
            Ok(TokenHttpResponse { status: 200, content_type: "application/json".to_owned(),
                body: format!(r#"{{"token_type":"Bearer","access_token":"{jwt}","expires_in":2,"scope":"chart_sync:read"}}"#).into_bytes() })
        }
        fn verify_grant(&self, _: &Url, _: &NativeAccessGrant) -> Result<String, ()> { Ok("44444444-4444-4444-8444-444444444444".into()) }
    }

    #[test]
    fn expired_grant_is_dropped_without_polling_status() {
        let session = NativeLoginSession::start(&CallbackBrowser, ShortLivedHttp,
            CONSENT, TOKEN, Duration::from_secs(2)).unwrap();
        let until = Instant::now() + Duration::from_secs(5);
        loop {
            let expired = matches!(*session.state.lock().unwrap(), SecretState::Expired);
            if expired { break; }
            assert!(Instant::now() < until);
            thread::sleep(Duration::from_millis(20));
        }
    }
}
