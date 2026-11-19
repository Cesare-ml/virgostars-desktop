//! Isolated transaction protocol for a native refresh. The caller must
//! serialize all login/refresh/logout operations across the process. No IPC
//! or production network transport is attached to this candidate.
#![allow(dead_code)]

use crate::refresh_credential_store::{Credential, RefreshCredentialStore};

pub enum RefreshError { NoCredential, Offline, Uncertain, Invalid, Storage }
pub enum TransportFailure { Invalid, Uncertain }

pub trait RefreshTransport {
    type Grant;
    fn reachable(&self) -> bool { true }
    fn refresh(&self, token: &str) -> Result<(Self::Grant, Credential), TransportFailure>;
}

/// Record the potentially consumed token before network I/O. If the response
/// is lost or the replacement cannot be durably stored, never replay it.
/// An explicit disconnect may still revoke with the retained old token.
pub fn refresh_once<S: RefreshCredentialStore, T: RefreshTransport>(store: &S, transport: &T)
    -> Result<T::Grant, RefreshError> {
    let mut old = store.load().map_err(|_| RefreshError::Storage)?.ok_or(RefreshError::NoCredential)?;
    if old.in_flight() || old.revoke_pending() { return Err(RefreshError::Uncertain); }
    if !transport.reachable() { return Err(RefreshError::Offline); }
    old.mark_in_flight();
    store.store(&old).map_err(|_| RefreshError::Storage)?;
    let (grant, replacement) = match transport.refresh(old.token()) {
        Ok(result) => result,
        Err(TransportFailure::Invalid) => return Err(RefreshError::Invalid),
        Err(TransportFailure::Uncertain) => return Err(RefreshError::Uncertain),
    };
    if replacement.in_flight() || replacement.revoke_pending() || replacement.token() == old.token() { return Err(RefreshError::Uncertain); }
    store.store(&replacement).map_err(|_| RefreshError::Storage)?;
    Ok(grant)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::{Cell, RefCell};

    struct Memory { value: RefCell<Option<(String,bool)>>, writes: Cell<usize>, fail_on: usize }
    impl RefreshCredentialStore for Memory {
        fn load(&self) -> Result<Option<Credential>, ()> {
            self.value.borrow().as_ref().map(|(s,pending)| {
                let mut value = Credential::ready(s.clone())?;
                if *pending { value.mark_in_flight(); }
                Ok(value)
            }).transpose()
        }
        fn store(&self, value: &Credential) -> Result<(), ()> {
            let n = self.writes.get() + 1; self.writes.set(n);
            if n == self.fail_on { return Err(()); }
            *self.value.borrow_mut() = Some((value.token().to_owned(),value.in_flight())); Ok(())
        }
        fn delete(&self) -> Result<(), ()> { *self.value.borrow_mut() = None; Ok(()) }
    }
    struct Fake { calls: Cell<usize>, lost: bool }
    impl RefreshTransport for Fake {
        type Grant = ();
        fn refresh(&self, _: &str) -> Result<((), Credential), TransportFailure> {
            self.calls.set(self.calls.get()+1);
            if self.lost { return Err(TransportFailure::Uncertain); }
            Ok(((),Credential::ready("b".repeat(43)).unwrap()))
        }
    }
    fn store(fail_on: usize) -> Memory { Memory { value:RefCell::new(Some(("a".repeat(43),false))), writes:Cell::new(0),fail_on } }

    #[test]
    fn success_replaces_credential_and_a_lost_response_is_never_replayed() {
        let saved = store(0); let server = Fake{calls:Cell::new(0),lost:false};
        assert!(refresh_once(&saved,&server).is_ok());
        assert_eq!(saved.value.borrow().as_ref().unwrap(), &("b".repeat(43),false));
        let saved = store(0); let server = Fake{calls:Cell::new(0),lost:true};
        assert!(matches!(refresh_once(&saved,&server),Err(RefreshError::Uncertain)));
        assert!(matches!(refresh_once(&saved,&server),Err(RefreshError::Uncertain)));
        assert_eq!(server.calls.get(),1);
    }

    #[test]
    fn storage_failure_never_sends_early_or_silently_replays() {
        let saved = store(1); let server = Fake{calls:Cell::new(0),lost:false};
        assert!(matches!(refresh_once(&saved,&server),Err(RefreshError::Storage)));
        assert_eq!(server.calls.get(),0);
        let saved = store(2); let server = Fake{calls:Cell::new(0),lost:false};
        assert!(matches!(refresh_once(&saved,&server),Err(RefreshError::Storage)));
        assert!(matches!(refresh_once(&saved,&server),Err(RefreshError::Uncertain)));
        assert_eq!(server.calls.get(),1);
    }

    #[test]
    fn known_offline_before_dispatch_preserves_credential_for_retry() {
        struct Offline;
        impl RefreshTransport for Offline {
            type Grant = ();
            fn reachable(&self) -> bool { false }
            fn refresh(&self, _: &str) -> Result<((),Credential),TransportFailure> { panic!("must not dispatch") }
        }
        let saved=store(0);
        assert!(matches!(refresh_once(&saved,&Offline),Err(RefreshError::Offline)));
        assert_eq!(saved.writes.get(),0);
        assert_eq!(saved.value.borrow().as_ref().unwrap(), &("a".repeat(43),false));
    }
}
