//! Single-owner native staging login registry.
//!
//! This registry is intended to be owned once by a future native app host.
//! It reserves the only login slot *before* opening a browser, prevents stale
//! attempt IDs from cancelling later sessions, and closes safely on shutdown.
#![allow(dead_code)]

use crate::pkce_loopback::SystemBrowserOpener;
use crate::pkce_native_session::{
    NativeLoginPhase, NativeLoginSession, NativeLoginSnapshot, NativeSessionStartError,
};
use crate::pkce_token_exchange::TokenHttpTransport;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::time::Duration;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum NativeRegistryError {
    Busy,
    Closed,
    Unavailable,
    Start(NativeSessionStartError),
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum NativeRegistrySnapshot {
    Idle,
    Starting,
    Active(NativeLoginSnapshot),
    Closed,
    Unavailable,
}

enum Slot {
    Idle,
    Starting(Arc<AtomicBool>),
    Active(NativeLoginSession),
}

struct RegistryState {
    closed: bool,
    slot: Slot,
}

/// Not a network client or secret store: only one ephemeral Rust session may
/// occupy this app-owned registry at a time. There is no Serialize or Debug.
pub struct NativeLoginRegistry { inner: Mutex<RegistryState> }

impl Default for NativeLoginRegistry {
    fn default() -> Self { Self::new() }
}

impl NativeLoginRegistry {
    pub fn new() -> Self {
        Self { inner: Mutex::new(RegistryState { closed: false, slot: Slot::Idle }) }
    }

    /// Must be invoked by a bounded native owner, never on Angular/UI or an
    /// async executor. The reservation is installed without holding the mutex
    /// during the (possibly blocking) system-browser launch.
    pub fn start<B, T>(
        &self,
        browser: &B,
        transport: T,
        consent_url: &str,
        token_endpoint: &str,
        max_wait: Duration,
    ) -> Result<String, NativeRegistryError>
    where
        B: SystemBrowserOpener,
        T: TokenHttpTransport + Send + 'static,
    {
        let reservation = Arc::new(AtomicBool::new(false));
        {
            let mut state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
            if state.closed { return Err(NativeRegistryError::Closed); }
            if !matches!(&state.slot, Slot::Idle) { return Err(NativeRegistryError::Busy); }
            state.slot = Slot::Starting(Arc::clone(&reservation));
        }

        let candidate = NativeLoginSession::start(
            browser, transport, consent_url, token_endpoint, max_wait,
        );
        let mut state = match self.inner.lock() {
            Ok(guard) => guard,
            Err(_) => {
                // A successfully created candidate is destroyed here, which
                // cancels its worker and drops any native-only token.
                return Err(NativeRegistryError::Unavailable);
            }
        };
        let reservation_matches = matches!(
            &state.slot,
            Slot::Starting(current) if Arc::ptr_eq(current, &reservation)
        );
        if state.closed || reservation.load(Ordering::SeqCst) || !reservation_matches {
            if reservation_matches { state.slot = Slot::Idle; }
            return Err(NativeRegistryError::Closed);
        }
        match candidate {
            Ok(session) => {
                let attempt_id = session.snapshot().attempt_id;
                state.slot = Slot::Active(session);
                Ok(attempt_id)
            }
            Err(error) => {
                state.slot = Slot::Idle;
                Err(NativeRegistryError::Start(error))
            }
        }
    }

    pub fn snapshot(&self) -> NativeRegistrySnapshot {
        let state = match self.inner.lock() {
            Ok(guard) => guard,
            Err(_) => return NativeRegistrySnapshot::Unavailable,
        };
        if state.closed { return NativeRegistrySnapshot::Closed; }
        match &state.slot {
            Slot::Idle => NativeRegistrySnapshot::Idle,
            Slot::Starting(_) => NativeRegistrySnapshot::Starting,
            Slot::Active(session) => NativeRegistrySnapshot::Active(session.snapshot()),
        }
    }

    /// Explicit attempt ID guards against a stale UI action cancelling a
    /// newer login. Cancellation only applies to a pending active session.
    pub fn cancel(&self, expected_attempt_id: &str) -> bool {
        let Ok(state) = self.inner.lock() else { return false; };
        if state.closed { return false; }
        let Slot::Active(session) = &state.slot else { return false; };
        let snapshot = session.snapshot();
        if snapshot.attempt_id != expected_attempt_id || snapshot.phase != NativeLoginPhase::Pending {
            return false;
        }
        session.cancel();
        session.snapshot().phase == NativeLoginPhase::Cancelled
    }

    /// Explicit local-only disconnect, including pending work. Returns false
    /// when the identifier is stale or no session is present.
    pub fn disconnect(&self, expected_attempt_id: &str) -> bool {
        let old = {
            let Ok(mut state) = self.inner.lock() else { return false; };
            if state.closed { return false; }
            let Slot::Active(session) = &state.slot else { return false; };
            if session.snapshot().attempt_id != expected_attempt_id { return false; }
            std::mem::replace(&mut state.slot, Slot::Idle)
        };
        // Destroy secrets and signal cancellation outside the registry lock.
        drop(old);
        true
    }

    /// Permanently closes this registry. If a browser opener is blocked in
    /// `start`, its reservation is invalidated so it cannot install a session
    /// after shutdown. This does not forcibly kill an OS browser process.
    pub fn shutdown(&self) {
        let old = {
            let Ok(mut state) = self.inner.lock() else { return; };
            state.closed = true;
            std::mem::replace(&mut state.slot, Slot::Idle)
        };
        match old {
            Slot::Starting(reservation) => reservation.store(true, Ordering::SeqCst),
            Slot::Active(session) => drop(session),
            Slot::Idle => {},
        }
    }
}

impl Drop for NativeLoginRegistry {
    fn drop(&mut self) { self.shutdown(); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pkce_token_exchange::TokenHttpResponse;
    use std::sync::{mpsc, atomic::AtomicUsize};
    use std::thread;
    use url::Url;

    const CONSENT: &str = "https://staging.virgostars.it/collega-dispositivo";
    const TOKEN: &str = "https://staging.virgostars.it/chart-sync/v1/token";

    #[derive(Default)]
    struct QuietBrowser { opens: AtomicUsize }
    impl SystemBrowserOpener for QuietBrowser {
        fn open_in_system_browser(&self, _: &Url) -> Result<(), ()> {
            self.opens.fetch_add(1, Ordering::SeqCst);
            Ok(())
        }
    }

    struct NoHttp;
    impl TokenHttpTransport for NoHttp {
        fn post_form(&self, _: &Url, _: &str, _: Duration, _: usize) -> Result<TokenHttpResponse, ()> {
            panic!("no HTTP exchange should be invoked without an approved callback")
        }
    }

    #[test]
    fn admits_one_attempt_then_rejects_busy_and_stale_cancel() {
        let registry = NativeLoginRegistry::new();
        let browser = QuietBrowser::default();
        let first = registry.start(&browser,NoHttp,CONSENT,TOKEN,Duration::from_secs(2)).unwrap();
        assert!(matches!(registry.snapshot(), NativeRegistrySnapshot::Active(_)));
        assert_eq!(registry.start(&browser,NoHttp,CONSENT,TOKEN,Duration::from_secs(2)),Err(NativeRegistryError::Busy));
        assert_eq!(browser.opens.load(Ordering::SeqCst), 1);
        assert!(!registry.cancel("stale-attempt-id"));
        assert!(!registry.disconnect("stale-attempt-id"));
        assert!(registry.disconnect(&first));
        assert_eq!(registry.snapshot(), NativeRegistrySnapshot::Idle);
        let second = registry.start(&browser,NoHttp,CONSENT,TOKEN,Duration::from_secs(2)).unwrap();
        assert_ne!(first, second);
        assert!(!registry.cancel(&first));
        assert!(!registry.disconnect(&first));
        assert!(registry.cancel(&second));
        assert!(registry.disconnect(&second));
    }

    #[test]
    fn failed_start_releases_the_reserved_slot() {
        let registry = NativeLoginRegistry::new();
        let browser = QuietBrowser::default();
        assert!(matches!(registry.start(
            &browser,NoHttp,CONSENT,"https://www.virgostars.it/chart-sync/v1/token",Duration::from_secs(2),
        ),Err(NativeRegistryError::Start(_))));
        assert_eq!(registry.snapshot(), NativeRegistrySnapshot::Idle);
        assert_eq!(browser.opens.load(Ordering::SeqCst), 0);
        assert!(registry.start(&browser,NoHttp,CONSENT,TOKEN,Duration::from_secs(2)).is_ok());
        registry.shutdown();
        assert_eq!(registry.snapshot(), NativeRegistrySnapshot::Closed);
    }

    struct BlockingBrowser { entered: mpsc::Sender<()>, release: mpsc::Receiver<()> }
    impl SystemBrowserOpener for BlockingBrowser {
        fn open_in_system_browser(&self, _: &Url) -> Result<(), ()> {
            self.entered.send(()).map_err(|_| ())?;
            self.release.recv_timeout(Duration::from_secs(3)).map_err(|_| ())
        }
    }

    #[test]
    fn shutdown_during_browser_launch_prevents_late_session_installation() {
        let registry = Arc::new(NativeLoginRegistry::new());
        let (entered_tx, entered_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let owner = Arc::clone(&registry);
        let worker = thread::spawn(move || {
            owner.start(&BlockingBrowser { entered:entered_tx, release:release_rx },
                NoHttp,CONSENT,TOKEN,Duration::from_secs(2))
        });
        entered_rx.recv_timeout(Duration::from_secs(2)).unwrap();
        assert_eq!(registry.snapshot(), NativeRegistrySnapshot::Starting);
        assert_eq!(registry.start(&QuietBrowser::default(),NoHttp,CONSENT,TOKEN,Duration::from_secs(2)),Err(NativeRegistryError::Busy));
        registry.shutdown();
        release_tx.send(()).unwrap();
        assert_eq!(worker.join().unwrap(),Err(NativeRegistryError::Closed));
        assert_eq!(registry.snapshot(), NativeRegistrySnapshot::Closed);
        assert_eq!(registry.start(&QuietBrowser::default(),NoHttp,CONSENT,TOKEN,Duration::from_secs(2)),Err(NativeRegistryError::Closed));
    }
}
