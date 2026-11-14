//! Internal, synthetic-only guard against publishing stale native profile-status replies.
//!
//! This module deliberately exposes NO Tauri command, credentials, identifiers,
//! SQL/SQLCipher connection, filesystem path or profile-unlock capability.
//! In particular, a current ticket is NOT a permission to read personal data.
//!
//! A future audited Rust profile adapter may use this fence *after* it has
//! independently verified profile ownership, key material and local unlock.

use std::sync::{Arc, Mutex};

#[derive(Default)]
struct GenerationState {
    revision: u64,
    pending: bool,
    exhausted: bool,
}

/// An instance-bound, opaque status reply generation. Not serializable and not
/// an identity, session credential, authorization ticket or storage key.
#[derive(Clone, Debug)]
pub(crate) struct ProfileStatusTicket {
    instance: Arc<()>,
    revision: u64,
}

/// Separate fences never accept each other's tokens, even at equal revisions.
/// Only one reply from the most recent status read can be accepted.
#[derive(Default)]
pub(crate) struct ProfileStatusGenerationFence {
    instance: Arc<()>,
    state: Mutex<GenerationState>,
}

impl ProfileStatusGenerationFence {
    /// Begin a new local *status* observation, invalidating older completions.
    /// Refuse new work if the mutex is poisoned or the generation overflows.
    pub(crate) fn begin(&self) -> Option<ProfileStatusTicket> {
        let mut state = self.state.lock().ok()?;
        state.pending = false;
        if state.exhausted {
            return None;
        }
        let next = match state.revision.checked_add(1) {
            Some(value) => value,
            None => {
                state.exhausted = true;
                return None;
            }
        };
        state.revision = next;
        state.pending = true;
        Some(ProfileStatusTicket {
            instance: Arc::clone(&self.instance),
            revision: next,
        })
    }

    /// Check a reply generation without consuming it. A true result is only a
    /// freshness hint, NOT authorization. Never check-then-read private data.
    pub(crate) fn is_current(&self, ticket: &ProfileStatusTicket) -> bool {
        if !Arc::ptr_eq(&self.instance, &ticket.instance) {
            return false;
        }
        match self.state.lock() {
            Ok(state) => !state.exhausted && state.pending && state.revision == ticket.revision,
            Err(_) => false,
        }
    }

    /// Accept the newest status reply *once*. The returned bool means only
    /// "fresh", not "valid", "unlocked", "synced" or "authenticated".
    pub(crate) fn complete(&self, ticket: &ProfileStatusTicket) -> bool {
        if !Arc::ptr_eq(&self.instance, &ticket.instance) {
            return false;
        }
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return false,
        };
        if state.exhausted || !state.pending || state.revision != ticket.revision {
            return false;
        }
        state.pending = false;
        true
    }

    /// Synchronous native-side invalidation on logout, account switch, local
    /// lock or profile teardown. Does not revoke an already copied offline DB.
    pub(crate) fn invalidate(&self) {
        match self.state.lock() {
            Ok(mut state) => {
                state.pending = false;
                if !state.exhausted {
                    if let Some(next) = state.revision.checked_add(1) {
                        state.revision = next;
                    } else {
                        state.exhausted = true;
                    }
                }
            }
            Err(poisoned) => {
                // When an earlier panic leaves state uncertain, never allow a
                // future status reply to be published from this fence.
                let mut state = poisoned.into_inner();
                state.pending = false;
                state.exhausted = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;

    #[test]
    fn latest_only_and_single_use() {
        let gate = ProfileStatusGenerationFence::default();
        let older = gate.begin().expect("first synthetic status");
        let newest = gate.begin().expect("second synthetic status");
        assert!(!gate.is_current(&older));
        assert!(!gate.complete(&older));
        assert!(gate.is_current(&newest));
        assert!(gate.complete(&newest));
        assert!(!gate.complete(&newest));
        assert!(!gate.is_current(&newest));
    }

    #[test]
    fn lock_revokes_pending_status() {
        let gate = ProfileStatusGenerationFence::default();
        let pending = gate.begin().expect("synthetic read");
        gate.invalidate();
        assert!(!gate.is_current(&pending));
        assert!(!gate.complete(&pending));
        assert!(gate.complete(&gate.begin().expect("new synthetic read")));
    }

    #[test]
    fn separate_profiles_cannot_exchange_equal_revision_tickets() {
        let a = ProfileStatusGenerationFence::default();
        let b = ProfileStatusGenerationFence::default();
        let a_token = a.begin().expect("a");
        let b_token = b.begin().expect("b");
        assert!(!a.complete(&b_token));
        assert!(!b.complete(&a_token));
        assert!(a.complete(&a_token));
        assert!(b.complete(&b_token));
    }

    #[test]
    fn many_rapid_refreshes_do_not_resurrect_previous_status() {
        let gate = ProfileStatusGenerationFence::default();
        let mut tokens = Vec::new();
        for _ in 0..10_000 {
            tokens.push(gate.begin().expect("synthetic refresh"));
        }
        for token in &tokens[..tokens.len() - 1] {
            assert!(!gate.complete(token));
        }
        assert!(gate.complete(tokens.last().expect("latest")));
    }

    #[test]
    fn competing_completions_accept_exactly_one() {
        let gate = Arc::new(ProfileStatusGenerationFence::default());
        let ticket = gate.begin().expect("synthetic request");
        let mut threads = Vec::new();
        for _ in 0..16 {
            let gate = Arc::clone(&gate);
            let ticket = ticket.clone();
            threads.push(thread::spawn(move || gate.complete(&ticket)));
        }
        let successful = threads.into_iter().filter(|worker| worker.join().expect("thread")).count();
        assert_eq!(successful, 1);
    }

    #[test]
    fn generation_exhaustion_permanently_fails_closed() {
        let gate = ProfileStatusGenerationFence::default();
        {
            let mut state = gate.state.lock().expect("synthetic setup");
            state.revision = u64::MAX;
        }
        assert!(gate.begin().is_none());
        gate.invalidate();
        assert!(gate.begin().is_none());
    }

    #[test]
    fn poisoned_generation_cannot_publish_or_restart() {
        let gate = Arc::new(ProfileStatusGenerationFence::default());
        let ticket = gate.begin().expect("synthetic request");
        let other = Arc::clone(&gate);
        let failed = thread::spawn(move || {
            let _guard = other.state.lock().expect("synthetic setup");
            panic!("synthetic poison");
        });
        assert!(failed.join().is_err());
        assert!(!gate.complete(&ticket));
        assert!(!gate.is_current(&ticket));
        assert!(gate.begin().is_none());
        gate.invalidate();
        assert!(gate.begin().is_none());
    }
}
