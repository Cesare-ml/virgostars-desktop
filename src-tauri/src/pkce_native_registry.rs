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
pub struct NativeLoginRegistry { inner: Mutex<RegistryState>, sync_busy: AtomicBool }

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct GroupSyncProgress { pub processed: usize, pub conflicts: usize }

struct SyncReservation<'a>(&'a AtomicBool);
impl Drop for SyncReservation<'_> { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }

impl Default for NativeLoginRegistry {
    fn default() -> Self { Self::new() }
}

impl NativeLoginRegistry {
    pub fn new() -> Self {
        Self { inner: Mutex::new(RegistryState { closed: false, slot: Slot::Idle }), sync_busy: AtomicBool::new(false) }
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

    /// Native-only candidate for a bounded group synchronization pass. The
    /// caller must run this on a blocking worker, never the Tauri UI executor.
    /// A new session/logout wins over a late response; the server operation
    /// may already have completed, and will be safely retried idempotently.
    #[allow(dead_code)]
    pub(crate) fn sync_pending_groups<T: crate::pkce_reqwest_https::GroupWriteTransport>(
        &self, expected_attempt_id: &str, token_endpoint: &str,
        paths: &crate::chart_archive::ArchivePaths, keys: &dyn crate::archive_keys::KeyStore,
        transport: &T,
    ) -> Result<GroupSyncProgress, NativeRegistryError> {
        if self.sync_busy.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err() {
            return Err(NativeRegistryError::Busy);
        }
        let _reservation = SyncReservation(&self.sync_busy);
        let endpoint = crate::pkce_token_exchange::valid_staging_token_endpoint(token_endpoint)
            .ok_or(NativeRegistryError::Unavailable)?;
        let grant = {
            let state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
            if state.closed { return Err(NativeRegistryError::Closed); }
            let Slot::Active(session) = &state.slot else { return Err(NativeRegistryError::Unavailable); };
            if session.snapshot().attempt_id != expected_attempt_id { return Err(NativeRegistryError::Unavailable); }
            session.copy_active_grant().ok_or(NativeRegistryError::Unavailable)?
        };
        if grant.scope() != crate::pkce_token_exchange::TokenScope::ReadAndGroupWrite || !grant.matches_token_endpoint(&endpoint) {
            return Err(NativeRegistryError::Unavailable);
        }
        let profile = grant.profile_ref().ok_or(NativeRegistryError::Unavailable)?;
        let pending = crate::chart_archive::pending_groups_for_profile(paths,keys,profile)
            .map_err(|_| NativeRegistryError::Unavailable)?;
        let mut progress = GroupSyncProgress {processed:0,conflicts:0};
        for update in pending.iter().take(20) {
            {
                let state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
                let Slot::Active(session) = &state.slot else { return Err(NativeRegistryError::Closed); };
                if state.closed || session.snapshot().attempt_id != expected_attempt_id
                    || session.copy_active_grant().and_then(|current| current.profile_ref().map(str::to_owned)).as_deref() != Some(profile) {
                    return Err(NativeRegistryError::Closed);
                }
            }
            let result = transport.replace_groups(&endpoint,&grant,&update.remote_sync_id,&update.base_groups,&update.groups)
                .map_err(|_| NativeRegistryError::Unavailable)?;
            // Revalidate under the registry lock immediately before persisting.
            // Logout/new login cannot race the local acknowledgement.
            let state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
            let Slot::Active(session) = &state.slot else { return Err(NativeRegistryError::Closed); };
            if state.closed || session.snapshot().attempt_id != expected_attempt_id
                || session.copy_active_grant().and_then(|current| current.profile_ref().map(str::to_owned)).as_deref() != Some(profile) {
                return Err(NativeRegistryError::Closed);
            }
            crate::chart_archive::apply_group_sync_result(paths,keys,profile,update,&result)
                .map_err(|_| NativeRegistryError::Unavailable)?;
            if matches!(result,crate::pkce_reqwest_https::GroupWriteResult::Conflict(_)) { progress.conflicts += 1; }
            progress.processed += 1;
        }
        Ok(progress)
    }

    /// Read-only reconciliation for already linked charts. Missing remote
    /// records are not treated as deletions; initial linking is separate.
    #[allow(dead_code)]
    pub(crate) fn refresh_linked_groups<T: crate::pkce_reqwest_https::GroupSnapshotTransport>(
        &self, expected_attempt_id: &str, token_endpoint: &str,
        paths: &crate::chart_archive::ArchivePaths, keys: &dyn crate::archive_keys::KeyStore,
        transport: &T,
    ) -> Result<usize, NativeRegistryError> {
        if self.sync_busy.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err() {
            return Err(NativeRegistryError::Busy);
        }
        let _reservation = SyncReservation(&self.sync_busy);
        let endpoint = crate::pkce_token_exchange::valid_staging_token_endpoint(token_endpoint)
            .ok_or(NativeRegistryError::Unavailable)?;
        let grant = {
            let state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
            if state.closed { return Err(NativeRegistryError::Closed); }
            let Slot::Active(session) = &state.slot else { return Err(NativeRegistryError::Unavailable); };
            if session.snapshot().attempt_id != expected_attempt_id { return Err(NativeRegistryError::Unavailable); }
            session.copy_active_grant().ok_or(NativeRegistryError::Unavailable)?
        };
        if !grant.matches_token_endpoint(&endpoint) { return Err(NativeRegistryError::Unavailable); }
        let profile = grant.profile_ref().ok_or(NativeRegistryError::Unavailable)?;
        let baselines = crate::chart_archive::group_baselines_for_profile(paths,keys,profile)
            .map_err(|_| NativeRegistryError::Unavailable)?;
        let remote = transport.fetch_groups(&endpoint,&grant).map_err(|_| NativeRegistryError::Unavailable)?;
        {
            let state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
            let Slot::Active(session) = &state.slot else { return Err(NativeRegistryError::Closed); };
            if state.closed || session.snapshot().attempt_id != expected_attempt_id
                || session.copy_active_grant().and_then(|current| current.profile_ref().map(str::to_owned)).as_deref() != Some(profile) {
                return Err(NativeRegistryError::Closed);
            }
        }
        let mut applied = 0;
        for baseline in &baselines {
            let Some(groups) = remote.get(&baseline.remote_sync_id) else { continue; };
            let state = self.inner.lock().map_err(|_| NativeRegistryError::Unavailable)?;
            let Slot::Active(session) = &state.slot else { return Err(NativeRegistryError::Closed); };
            if state.closed || session.snapshot().attempt_id != expected_attempt_id
                || session.copy_active_grant().and_then(|current| current.profile_ref().map(str::to_owned)).as_deref() != Some(profile) {
                return Err(NativeRegistryError::Closed);
            }
            match crate::chart_archive::apply_remote_group_snapshot(paths,keys,profile,baseline,groups) {
                Ok(()) => applied += 1,
                Err("conflict_pending" | "stale_sync") => {},
                Err(_) => return Err(NativeRegistryError::Unavailable),
            }
        }
        Ok(applied)
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

    #[test]
    fn group_worker_commits_only_current_profile_and_keeps_pending_after_logout_race() {
        use crate::archive_keys::fake::FakeKeyStore;
        use crate::chart_archive::{self, ArchivePaths, ArchiveRequestV1, ChartRecordV1};
        use crate::pkce_reqwest_https::{GroupWriteResult, GroupWriteTransport};
        use crate::pkce_token_exchange::{NativeAccessGrant, TokenScope};
        use std::fs;
        const PROFILE: &str = "44444444-4444-4444-8444-444444444444";
        const CHART: &str = "11111111-1111-4111-8111-111111111111";
        const ATTEMPT: &str = "123e4567-e89b-42d3-a456-426614174000";
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
        let fixture = Fixture(std::env::temp_dir().join(format!("virgo-sync-test-{}-{:?}", std::process::id(), std::thread::current().id())).with_extension("tmp"));
        fs::create_dir_all(&fixture.0).unwrap();
        let paths = ArchivePaths::in_folder(&fixture.0);
        let keys = FakeKeyStore::empty();
        let chart = ChartRecordV1 {id:CHART.into(),name:"Fittizio".into(),utc_iso:"2001-02-03T04:05:06.000Z".into(),
            time_zone:"Europe/Rome".into(),lat_micro:44_000_000,lng_micro:11_000_000,place_name:"Fittizio".into()};
        let save = ArchiveRequestV1 {protocol_version:1,operation:"save".into(),chart:Some(chart),id:None,groups:None};
        assert_eq!(chart_archive::handle(&paths,&keys,&save,1000).status,"ok");
        chart_archive::link_groups_to_verified_profile(&paths,&keys,CHART,PROFILE,CHART,&[]).unwrap();
        let groups = |name: &str| ArchiveRequestV1 {protocol_version:1,operation:"set_groups".into(),chart:None,
            id:Some(CHART.into()),groups:Some(vec![name.into()])};
        assert_eq!(chart_archive::handle(&paths,&keys,&groups("Primo"),2000).status,"ok");
        let registry = Arc::new(NativeLoginRegistry::new());
        registry.inner.lock().unwrap().slot = Slot::Active(NativeLoginSession::synthetic_connected_for_test(
            ATTEMPT,NativeAccessGrant::synthetic_for_test(TokenScope::ReadAndGroupWrite,PROFILE)));
        struct FakeGroup { registry: Arc<NativeLoginRegistry>, disconnect: bool }
        impl GroupWriteTransport for FakeGroup {
            fn replace_groups(&self, _: &Url, _: &NativeAccessGrant, _: &str, _: &[String], _: &[String]) -> Result<GroupWriteResult,()> {
                if self.disconnect { assert!(self.registry.disconnect(ATTEMPT)); }
                Ok(GroupWriteResult::Updated)
            }
        }
        let transport = FakeGroup {registry:Arc::clone(&registry),disconnect:false};
        assert_eq!(registry.sync_pending_groups(ATTEMPT,"https://preview.virgostars.it/chart-sync/v1/token",&paths,&keys,&transport),Err(NativeRegistryError::Unavailable));
        assert_eq!(chart_archive::pending_groups_for_profile(&paths,&keys,PROFILE).unwrap().len(),1);
        assert_eq!(registry.sync_pending_groups(ATTEMPT,TOKEN,&paths,&keys,&transport),Ok(GroupSyncProgress {processed:1,conflicts:0}));
        assert!(chart_archive::pending_groups_for_profile(&paths,&keys,PROFILE).unwrap().is_empty());
        assert_eq!(chart_archive::handle(&paths,&keys,&groups("Secondo"),3000).status,"ok");
        let transport = FakeGroup {registry:Arc::clone(&registry),disconnect:true};
        assert_eq!(registry.sync_pending_groups(ATTEMPT,TOKEN,&paths,&keys,&transport),Err(NativeRegistryError::Closed));
        let pending = chart_archive::pending_groups_for_profile(&paths,&keys,PROFILE).unwrap();
        assert_eq!(pending.len(),1);
        assert_eq!(pending[0].base_groups,["Primo"]);
        assert_eq!(pending[0].groups,["Secondo"]);
    }

    #[test]
    fn group_refresh_applies_linked_data_and_drops_a_late_logout_response() {
        use crate::archive_keys::fake::FakeKeyStore;
        use crate::chart_archive::{self, ArchivePaths, ArchiveRequestV1, ChartRecordV1};
        use crate::pkce_reqwest_https::GroupSnapshotTransport;
        use crate::pkce_token_exchange::{NativeAccessGrant, TokenScope};
        use std::{collections::HashMap,fs};
        const PROFILE: &str = "44444444-4444-4444-8444-444444444444";
        const CHART: &str = "11111111-1111-4111-8111-111111111111";
        const ATTEMPT: &str = "123e4567-e89b-42d3-a456-426614174000";
        struct Fixture(std::path::PathBuf);
        impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
        let fixture = Fixture(std::env::temp_dir().join(format!("virgo-refresh-test-{}-{:?}",std::process::id(),std::thread::current().id())).with_extension("tmp"));
        fs::create_dir_all(&fixture.0).unwrap();
        let paths = ArchivePaths::in_folder(&fixture.0);
        let keys = FakeKeyStore::empty();
        let chart = ChartRecordV1 {id:CHART.into(),name:"Fittizio".into(),utc_iso:"2001-02-03T04:05:06.000Z".into(),
            time_zone:"Europe/Rome".into(),lat_micro:44_000_000,lng_micro:11_000_000,place_name:"Fittizio".into()};
        let save = ArchiveRequestV1 {protocol_version:1,operation:"save".into(),chart:Some(chart),id:None,groups:None};
        let list = ArchiveRequestV1 {protocol_version:1,operation:"list".into(),chart:None,id:None,groups:None};
        assert_eq!(chart_archive::handle(&paths,&keys,&save,1000).status,"ok");
        chart_archive::link_groups_to_verified_profile(&paths,&keys,CHART,PROFILE,CHART,&[]).unwrap();
        let registry = Arc::new(NativeLoginRegistry::new());
        registry.inner.lock().unwrap().slot = Slot::Active(NativeLoginSession::synthetic_connected_for_test(
            ATTEMPT,NativeAccessGrant::synthetic_for_test(TokenScope::Read,PROFILE)));
        struct FakeSnapshot { registry: Arc<NativeLoginRegistry>, disconnect: bool, name: &'static str }
        impl GroupSnapshotTransport for FakeSnapshot {
            fn fetch_groups(&self, _: &Url, _: &NativeAccessGrant) -> Result<HashMap<String,Vec<String>>,()> {
                if self.disconnect { assert!(self.registry.disconnect(ATTEMPT)); }
                Ok(HashMap::from([(CHART.into(),vec![self.name.into()])]))
            }
        }
        let first = FakeSnapshot {registry:Arc::clone(&registry),disconnect:false,name:"Web"};
        assert_eq!(registry.refresh_linked_groups(ATTEMPT,TOKEN,&paths,&keys,&first),Ok(1));
        assert_eq!(chart_archive::handle(&paths,&keys,&list,2000).charts.unwrap()[0].groups,["Web"]);
        let late = FakeSnapshot {registry:Arc::clone(&registry),disconnect:true,name:"Tardivo"};
        assert_eq!(registry.refresh_linked_groups(ATTEMPT,TOKEN,&paths,&keys,&late),Err(NativeRegistryError::Closed));
        assert_eq!(chart_archive::handle(&paths,&keys,&list,3000).charts.unwrap()[0].groups,["Web"]);
    }

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
