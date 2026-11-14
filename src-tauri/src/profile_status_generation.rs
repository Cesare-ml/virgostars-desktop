//! Internal, synthetic-only guard against publishing stale native profile-status replies.
//!
//! This module deliberately exposes NO Tauri command, credentials, identifiers,
//! SQL/SQLCipher connection, filesystem path or profile-unlock capability.
//! In particular, a current ticket is NOT a permission to read personal data.
//!
//! A future audited Rust profile adapter may use this fence *after* it has
//! independently verified profile ownership, key material and local unlock.

use std::sync::{Arc, Mutex};

/// Presentation-only hint. `SyntheticReady` never grants profile access,
/// decrypts a record, authenticates a user or enables cloud synchronization.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum ProfileStatusUiHint {
    #[default]
    Blocked,
    SyntheticReady,
}

#[derive(Default)]
struct GenerationState {
    revision: u64,
    pending: bool,
    exhausted: bool,
    visible: ProfileStatusUiHint,
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
        state.visible = ProfileStatusUiHint::Blocked;
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

    /// Atomically commit a status-only UI hint for the newest pending reply.
    /// This consumes the ticket; no separate check-then-publish is exposed.
    /// This is NOT an authorization decision, a native DB read, or an IPC reply.
    pub(crate) fn publish_hint(
        &self,
        ticket: &ProfileStatusTicket,
        hint: ProfileStatusUiHint,
    ) -> bool {
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
        state.visible = hint;
        true
    }

    /// Read the last committed UI hint. An invalidation always clears it,
    /// and a poisoned mutex always maps to the blocked state.
    pub(crate) fn visible_hint(&self) -> ProfileStatusUiHint {
        match self.state.lock() {
            Ok(state) if !state.exhausted => state.visible,
            _ => ProfileStatusUiHint::Blocked,
        }
    }

    /// Synchronous native-side invalidation on logout, account switch, local
    /// lock or profile teardown. Does not revoke an already copied offline DB.
    pub(crate) fn invalidate(&self) {
        match self.state.lock() {
            Ok(mut state) => {
                state.pending = false;
                state.visible = ProfileStatusUiHint::Blocked;
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
                state.visible = ProfileStatusUiHint::Blocked;
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
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        assert!(!gate.publish_hint(&older, ProfileStatusUiHint::SyntheticReady));
        assert!(gate.publish_hint(&newest, ProfileStatusUiHint::SyntheticReady));
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::SyntheticReady);
        assert!(!gate.publish_hint(&newest, ProfileStatusUiHint::SyntheticReady));
        let next = gate.begin().expect("subsequent synthetic status");
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        assert!(gate.publish_hint(&next, ProfileStatusUiHint::Blocked));
    }

    #[test]
    fn lock_revokes_pending_status() {
        let gate = ProfileStatusGenerationFence::default();
        let pending = gate.begin().expect("synthetic read");
        gate.invalidate();
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        assert!(!gate.publish_hint(&pending, ProfileStatusUiHint::SyntheticReady));
        let fresh = gate.begin().expect("new synthetic read");
        assert!(gate.publish_hint(&fresh, ProfileStatusUiHint::SyntheticReady));
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::SyntheticReady);
        gate.invalidate();
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        assert!(!gate.publish_hint(&fresh, ProfileStatusUiHint::SyntheticReady));
    }

    #[test]
    fn separate_profiles_cannot_exchange_equal_revision_tickets() {
        let a = ProfileStatusGenerationFence::default();
        let b = ProfileStatusGenerationFence::default();
        let a_token = a.begin().expect("a");
        let b_token = b.begin().expect("b");
        assert!(!a.publish_hint(&b_token, ProfileStatusUiHint::SyntheticReady));
        assert!(!b.publish_hint(&a_token, ProfileStatusUiHint::SyntheticReady));
        assert_eq!(a.visible_hint(), ProfileStatusUiHint::Blocked);
        assert_eq!(b.visible_hint(), ProfileStatusUiHint::Blocked);
        assert!(a.publish_hint(&a_token, ProfileStatusUiHint::SyntheticReady));
        assert!(b.publish_hint(&b_token, ProfileStatusUiHint::Blocked));
        assert_eq!(a.visible_hint(), ProfileStatusUiHint::SyntheticReady);
        assert_eq!(b.visible_hint(), ProfileStatusUiHint::Blocked);
    }

    #[test]
    fn many_rapid_refreshes_do_not_resurrect_previous_status() {
        let gate = ProfileStatusGenerationFence::default();
        let mut tokens = Vec::new();
        for _ in 0..10_000 {
            tokens.push(gate.begin().expect("synthetic refresh"));
        }
        for token in &tokens[..tokens.len() - 1] {
            assert!(!gate.publish_hint(token, ProfileStatusUiHint::SyntheticReady));
        }
        assert!(gate.publish_hint(tokens.last().expect("latest"), ProfileStatusUiHint::SyntheticReady));
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::SyntheticReady);
    }

    #[test]
    fn competing_completions_accept_exactly_one() {
        let gate = Arc::new(ProfileStatusGenerationFence::default());
        let ticket = gate.begin().expect("synthetic request");
        let mut threads = Vec::new();
        for _ in 0..16 {
            let gate = Arc::clone(&gate);
            let ticket = ticket.clone();
            threads.push(thread::spawn(move ||
                gate.publish_hint(&ticket, ProfileStatusUiHint::SyntheticReady)
            ));
        }
        let successful = threads
            .into_iter()
            .map(|worker| worker.join().expect("thread"))
            .filter(|accepted| *accepted)
            .count();
        assert_eq!(successful, 1);
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::SyntheticReady);
        gate.invalidate();
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);

        // Deterministic final-state invariant across both lock-first and
        // publish-first interleavings: after invalidate returns, the native
        // presentation hint cannot remain ready.
        for _ in 0..32 {
            let gate = Arc::new(ProfileStatusGenerationFence::default());
            let ticket = gate.begin().expect("synthetic race");
            let barrier = Arc::new(std::sync::Barrier::new(3));
            let publish_gate = Arc::clone(&gate);
            let publish_barrier = Arc::clone(&barrier);
            let publisher = thread::spawn(move || {
                publish_barrier.wait();
                publish_gate.publish_hint(&ticket, ProfileStatusUiHint::SyntheticReady)
            });
            let lock_gate = Arc::clone(&gate);
            let lock_barrier = Arc::clone(&barrier);
            let locker = thread::spawn(move || {
                lock_barrier.wait();
                lock_gate.invalidate();
            });
            barrier.wait();
            let _ = publisher.join().expect("publisher");
            locker.join().expect("locker");
            assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        }
    }

    #[test]
    fn generation_exhaustion_permanently_fails_closed() {
        let gate = ProfileStatusGenerationFence::default();
        {
            let mut state = gate.state.lock().expect("synthetic setup");
            state.revision = u64::MAX;
        }
        assert!(gate.begin().is_none());
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        gate.invalidate();
        assert!(gate.begin().is_none());
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
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
        assert!(!gate.publish_hint(&ticket, ProfileStatusUiHint::SyntheticReady));
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
        assert!(gate.begin().is_none());
        gate.invalidate();
        assert!(gate.begin().is_none());
        assert_eq!(gate.visible_hint(), ProfileStatusUiHint::Blocked);
    }
}
