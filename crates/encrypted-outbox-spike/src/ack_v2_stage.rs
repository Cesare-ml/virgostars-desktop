//! Experimental v2 offline enqueue for *synthetic* SQLCipher subjects only.
//!
//! This method is NOT exposed over Tauri IPC, has no authentication, and may
//! not process real people, locations, text names or astronomical decimals.
//! It stages entity + outbox together, remembers acknowledgements forever,
//! and refuses stale/conflicted or reused mutation IDs without side effects.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{storage_error, Result, StoreError, SyntheticEncryptedStore};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum V2StageDisposition {
    Queued,
    AlreadyAcknowledged,
}

impl SyntheticEncryptedStore {
    /// Stage an already-validated fictional request on an explicitly opened
    /// SQLCipher schema v2. The request's SHA-256 is a consistency fingerprint
    /// only and does not prove a server receipt or authorize an account.
    pub fn stage_synthetic_v2_mutation(
        &mut self,
        request: &AckRequest,
        fail_before_commit: bool,
    ) -> Result<V2StageDisposition> {
        let hash = fingerprint(request).map_err(|_| StoreError::InvalidSyntheticInput)?;
        // Shared HMAC/schema/foreign-key/synthetic guards from the v2 writer.
        self.require_v2_for_ack()?;
        let payload_json = request.payload.as_ref()
            .map(|payload| serde_json::to_string(payload)
                .map_err(|_| StoreError::InvalidSyntheticInput))
            .transpose()?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;

        // A previously acknowledged ID is forever reserved for this profile,
        // even after a crash or purge of the original outbox row.
        let already_acknowledged: Option<String> = tx.query_row(
            "SELECT request_fingerprint FROM local_ack_ledger
             WHERE profile_id=?1 AND mutation_id=?2",
            params![request.profile.as_str(), request.mutation.as_str()],
            |row| row.get(0),
        ).optional().map_err(storage_error)?;
        if let Some(older) = already_acknowledged {
            if older == hash {
                return Ok(V2StageDisposition::AlreadyAcknowledged);
            }
            return Err(StoreError::InvalidSyntheticInput);
        }
        // Never treat a second enqueue of an unacknowledged mutation as an
        // idempotent edit: no UI may silently overwrite its immutable snapshot.
        let pending_id: Option<i64> = tx.query_row(
            "SELECT 1 FROM local_outbox
             WHERE profile_id=?1 AND mutation_id=?2",
            params![request.profile.as_str(), request.mutation.as_str()],
            |row| row.get(0),
        ).optional().map_err(storage_error)?;
        if pending_id.is_some() {
            return Err(StoreError::InvalidSyntheticInput);
        }

        let profile_exists: Option<i64> = tx.query_row(
            "SELECT 1 FROM local_profiles WHERE profile_id=?1",
            [request.profile.as_str()], |row| row.get(0),
        ).optional().map_err(storage_error)?;
        if profile_exists != Some(1) {
            return Err(StoreError::InvalidSyntheticInput);
        }

        let current_revision: Option<String> = tx.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![request.profile.as_str(), request.entity.as_str()],
            |row| row.get(0),
        ).optional().map_err(storage_error)?.flatten();
        if current_revision.as_deref() != request.base_revision.as_deref() {
            return Err(StoreError::InvalidSyntheticInput);
        }

        // Allow multiple pending local edits with the SAME unchanged server
        // base; once any receipt advances it, a stale dependent cannot be
        // silently sent, updated or rebased. A conflict freezes that entity.
        let blocked: i64 = tx.query_row(
            "SELECT count(*) FROM local_outbox
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2
               AND (state='conflict' OR base_server_revision IS NOT ?3)",
            params![
                request.profile.as_str(),
                request.entity.as_str(),
                current_revision.as_deref()
            ],
            |row| row.get(0),
        ).map_err(storage_error)?;
        if blocked != 0 {
            return Err(StoreError::InvalidSyntheticInput);
        }

        let locally_deleted = i64::from(request.operation == "delete");
        tx.execute(
            "INSERT INTO local_entities
                 (profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision)
             VALUES (?1,'subject',?2,?3,?4,1)
             ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET
                 payload_json=excluded.payload_json,
                 locally_deleted=excluded.locally_deleted,
                 local_revision=local_entities.local_revision+1",
            params![
                request.profile.as_str(), request.entity.as_str(),
                payload_json.as_deref(), locally_deleted
            ],
        ).map_err(storage_error)?;
        tx.execute(
            "INSERT INTO local_outbox
                (profile_id,mutation_id,entity_type,entity_id,operation,
                 payload_json,base_server_revision,created_at_utc)
             VALUES (?1,?2,'subject',?3,?4,?5,?6,?7)",
            params![
                request.profile.as_str(), request.mutation.as_str(),
                request.entity.as_str(), request.operation.as_str(),
                payload_json.as_deref(), request.base_revision.as_deref(),
                request.created_at.as_str()
            ],
        ).map_err(storage_error)?;

        // Reconstruct the canonical request from durable SQL, never from
        // assumed serialization behavior in memory. If either representation
        // disagrees, the whole staged edit is rolled back.
        let stored: (String, String, Option<String>, Option<String>, String) = tx.query_row(
            "SELECT entity_id,operation,payload_json,base_server_revision,created_at_utc
             FROM local_outbox WHERE profile_id=?1 AND mutation_id=?2",
            params![request.profile.as_str(), request.mutation.as_str()],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        ).map_err(storage_error)?;
        let stored_payload = match (stored.1.as_str(), stored.2) {
            ("upsert", Some(json)) => Some(serde_json::from_str(&json)
                .map_err(|_| StoreError::InvalidSyntheticInput)?),
            ("delete", None) => None,
            _ => return Err(StoreError::InvalidSyntheticInput),
        };
        let stored_request = AckRequest {
            profile: request.profile.clone(),
            mutation: request.mutation.clone(),
            entity_type: "subject".to_owned(),
            entity: stored.0,
            operation: stored.1,
            payload: stored_payload,
            base_revision: stored.3,
            created_at: stored.4,
        };
        if fingerprint(&stored_request).map_err(|_| StoreError::InvalidSyntheticInput)? != hash {
            return Err(StoreError::InvalidSyntheticInput);
        }
        if fail_before_commit {
            return Err(StoreError::StorageFailure);
        }
        tx.commit().map_err(storage_error)?;
        Ok(V2StageDisposition::Queued)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AckV2Disposition, StoreKey, FIXTURE_TIME};
    use serde_json::json;
    use tempfile::tempdir;

    fn key() -> StoreKey {
        StoreKey::from_external_key_material([83_u8; 32]).unwrap()
    }
    fn request(profile: &str, mutation: &str, entity: &str) -> AckRequest {
        AckRequest {
            profile: profile.to_owned(), mutation: mutation.to_owned(),
            entity_type: "subject".to_owned(), entity: entity.to_owned(),
            operation: "upsert".to_owned(), base_revision: None,
            created_at: FIXTURE_TIME.to_owned(),
            payload: Some(json!({"label":"Fictional chart"})),
        }
    }
    fn setup() -> (tempfile::TempDir, std::path::PathBuf, SyntheticEncryptedStore) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-stage-v2.db");
        let mut store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.create_synthetic_profile("synthetic-b").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        (dir, path, store)
    }
    fn queue_count(store: &SyntheticEncryptedStore) -> i64 {
        store.conn.query_row("SELECT count(*) FROM local_outbox", [], |row| row.get(0)).unwrap()
    }

    #[test]
    fn stage_v2_and_ack_by_persisted_fingerprint_without_reencoding_mismatch() {
        let (_dir, path, mut store) = setup();
        let first = request("synthetic-a", "synthetic-m1", "synthetic-e1");
        assert_eq!(store.stage_synthetic_v2_mutation(&first, false).unwrap(),
                   V2StageDisposition::Queued);
        assert_eq!(queue_count(&store), 1);
        let hash = fingerprint(&first).unwrap();
        assert_eq!(store.apply_synthetic_v2_receipt("synthetic-a","synthetic-m1",
            &hash,"accepted","rev-1",false).unwrap(),AckV2Disposition::Acknowledged);
        drop(store);
        let mut reopened = SyntheticEncryptedStore::open_synthetic_v2(&path, &key()).unwrap();
        assert_eq!(reopened.stage_synthetic_v2_mutation(&first,false).unwrap(),
                   V2StageDisposition::AlreadyAcknowledged);
        assert_eq!(queue_count(&reopened),0);
    }

    #[test]
    fn pending_id_reuse_rejects_different_payload_without_changing_entity() {
        let (_dir, _path, mut store) = setup();
        let first = request("synthetic-a", "synthetic-m1", "synthetic-e1");
        store.stage_synthetic_v2_mutation(&first,false).unwrap();
        let mut changed = first.clone();
        changed.payload = Some(json!({"label":"Different"}));
        assert!(store.stage_synthetic_v2_mutation(&changed,false).is_err());
        assert!(store.stage_synthetic_v2_mutation(&first,false).is_err());
        let (json, revision): (String,i64) = store.conn.query_row(
            "SELECT payload_json,local_revision FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-e1'",
            [], |row| Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(json,r#"{"label":"Fictional chart"}"#);
        assert_eq!(revision,1);
        assert_eq!(queue_count(&store),1);
    }

    #[test]
    fn acknowledged_id_reuse_with_different_payload_fails_after_reopen() {
        let (_dir, path, mut store) = setup();
        let first = request("synthetic-a", "synthetic-m1", "synthetic-e1");
        store.stage_synthetic_v2_mutation(&first,false).unwrap();
        store.apply_synthetic_v2_receipt("synthetic-a","synthetic-m1",
            &fingerprint(&first).unwrap(),"accepted","rev-1",false).unwrap();
        drop(store);
        let mut store = SyntheticEncryptedStore::open_synthetic_v2(&path,&key()).unwrap();
        let mut changed=first.clone();
        changed.payload=Some(json!({"label":"Imposter"}));
        assert!(store.stage_synthetic_v2_mutation(&changed,false).is_err());
        assert_eq!(store.stage_synthetic_v2_mutation(&first,false).unwrap(),
                   V2StageDisposition::AlreadyAcknowledged);
    }

    #[test]
    fn stale_queued_edits_and_conflicts_block_entity_but_not_other_entities() {
        let (_dir, _path, mut store) = setup();
        let first = request("synthetic-a","synthetic-m1","synthetic-e1");
        let second = request("synthetic-a","synthetic-m2","synthetic-e1");
        store.stage_synthetic_v2_mutation(&first,false).unwrap();
        store.stage_synthetic_v2_mutation(&second,false).unwrap();
        store.apply_synthetic_v2_receipt("synthetic-a","synthetic-m1",
            &fingerprint(&first).unwrap(),"accepted","rev-1",false).unwrap();
        let newer=request("synthetic-a","synthetic-m3","synthetic-e1");
        assert!(store.stage_synthetic_v2_mutation(&newer,false).is_err());
        assert_eq!(store.stage_synthetic_v2_mutation(
            &request("synthetic-a","synthetic-m4","synthetic-e2"),false).unwrap(),
            V2StageDisposition::Queued);
        store.conn.execute(
            "UPDATE local_outbox SET state='conflict', conflict_server_revision='rev-x'
             WHERE profile_id='synthetic-a' AND mutation_id='synthetic-m2'", [],
        ).unwrap();
        assert!(store.stage_synthetic_v2_mutation(
            &request("synthetic-a","synthetic-m5","synthetic-e1"),false).is_err());
    }

    #[test]
    fn injected_failure_rolls_back_entity_and_intent_after_file_reopen() {
        let (_dir, path, mut store) = setup();
        let first = request("synthetic-a","synthetic-m1","synthetic-e1");
        assert!(store.stage_synthetic_v2_mutation(&first,true).is_err());
        assert_eq!(queue_count(&store),0);
        drop(store);
        let store = SyntheticEncryptedStore::open_synthetic_v2(&path,&key()).unwrap();
        let n: i64=store.conn.query_row(
            "SELECT count(*) FROM local_entities WHERE entity_id='synthetic-e1'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(n,0);
        assert_eq!(queue_count(&store),0);
    }

    #[test]
    fn v2_delete_sets_tombstone_and_is_queued_without_a_payload() {
        let (_dir, _path, mut store) = setup();
        let mut deletion=request("synthetic-a","synthetic-del","synthetic-e1");
        deletion.operation="delete".to_owned();
        deletion.payload=None;
        assert_eq!(store.stage_synthetic_v2_mutation(&deletion,false).unwrap(),
                   V2StageDisposition::Queued);
        let (deleted,payload): (i64,Option<String>)=store.conn.query_row(
            "SELECT locally_deleted,payload_json FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-e1'",
            [], |row|Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(deleted,1);
        assert_eq!(payload,None);
    }

    #[test]
    fn independent_profiles_can_use_the_same_mutation_id() {
        let (_dir, _path, mut store) = setup();
        let a=request("synthetic-a","synthetic-m1","synthetic-e1");
        let b=request("synthetic-b","synthetic-m1","synthetic-e1");
        store.stage_synthetic_v2_mutation(&a,false).unwrap();
        store.stage_synthetic_v2_mutation(&b,false).unwrap();
        assert_eq!(queue_count(&store),2);
        store.apply_synthetic_v2_receipt("synthetic-b","synthetic-m1",
            &fingerprint(&b).unwrap(),"accepted","rev-b",false).unwrap();
        let pending_a: i64=store.conn.query_row(
            "SELECT count(*) FROM local_outbox WHERE profile_id='synthetic-a'",
            [],|row|row.get(0),
        ).unwrap();
        assert_eq!(pending_a,1);
    }

    #[test]
    fn unsupported_payloads_and_absent_profiles_fail_closed() {
        let (_dir, _path, mut store) = setup();
        let mut invalid=request("synthetic-a","synthetic-m1","synthetic-e1");
        invalid.payload=Some(json!({"name":"Café"}));
        assert!(store.stage_synthetic_v2_mutation(&invalid,false).is_err());
        invalid.payload=Some(json!({"angle":12.5}));
        assert!(store.stage_synthetic_v2_mutation(&invalid,false).is_err());
        invalid=request("synthetic-unknown","synthetic-m1","synthetic-e1");
        assert!(store.stage_synthetic_v2_mutation(&invalid,false).is_err());
        assert_eq!(queue_count(&store),0);
    }
}
