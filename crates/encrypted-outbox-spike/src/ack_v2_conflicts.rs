//! Non-destructive, fictional-only SQLCipher v2 conflict receipts.
//! No cloud authentication or Tauri integration; a SHA-256 digest is NOT proof
//! of server identity. An unresolved conflict cannot be silently resolved.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{storage_error, synthetic_id, Result, StoreError, SyntheticEncryptedStore};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictReceiptDisposition { Recorded, Replayed }

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticConflictSummary {
    pub mutation_id: String,
    pub entity_id: String,
    pub remote_revision: String,
}

fn valid_hash(value: &str) -> bool {
    value.len() == 64
        && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}
fn valid_revision(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128
        && value.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

impl SyntheticEncryptedStore {
    /// The caller supplies an expected fingerprint for consistency only, not
    /// server authentication. No local subject or pending payload is deleted.
    pub fn record_synthetic_v2_conflict(
        &mut self,
        profile: &str,
        mutation: &str,
        expected_fingerprint: &str,
        remote_revision: &str,
        fail_before_commit: bool,
    ) -> Result<ConflictReceiptDisposition> {
        if !synthetic_id(profile) || !synthetic_id(mutation)
            || !valid_hash(expected_fingerprint) || !valid_revision(remote_revision)
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
        self.require_v2_for_ack()?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        type Pending = (
            i64, String, String, String, Option<String>, Option<String>,
            String, String, Option<String>,
        );
        let found: Option<Pending> = tx.query_row(
            "SELECT sequence,entity_type,entity_id,operation,payload_json,
                    base_server_revision,created_at_utc,state,conflict_server_revision
             FROM local_outbox
             WHERE profile_id=?1 AND mutation_id=?2",
            params![profile, mutation],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?, row.get(8)?,
            )),
        ).optional().map_err(storage_error)?;
        let Some((
            sequence, entity_type, entity_id, operation, payload_json,
            base_revision, created_at, state, previous_remote,
        )) = found else {
            return Err(StoreError::InvalidSyntheticInput);
        };
        if entity_type != "subject" || !synthetic_id(&entity_id) {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let payload = match (operation.as_str(), payload_json) {
            ("upsert", Some(json)) => Some(serde_json::from_str(&json)
                .map_err(|_| StoreError::InvalidSyntheticInput)?),
            ("delete", None) => None,
            _ => return Err(StoreError::InvalidSyntheticInput),
        };
        let snapshot = AckRequest {
            profile: profile.to_owned(), mutation: mutation.to_owned(),
            entity_type: entity_type.clone(), entity: entity_id.clone(),
            operation, payload, base_revision: base_revision.clone(), created_at,
        };
        if fingerprint(&snapshot).map_err(|_| StoreError::InvalidSyntheticInput)?
            != expected_fingerprint
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
        if state == "conflict" {
            if previous_remote.as_deref() == Some(remote_revision) {
                return Ok(ConflictReceiptDisposition::Replayed);
            }
            return Err(StoreError::InvalidSyntheticInput);
        }
        if state != "pending" || previous_remote.is_some()
            || base_revision.as_deref() == Some(remote_revision)
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let oldest: i64 = tx.query_row(
            "SELECT min(sequence) FROM local_outbox
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity_id],
            |row| row.get(0),
        ).map_err(storage_error)?;
        if oldest != sequence {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let current: Option<String> = tx.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity_id],
            |row| row.get(0),
        ).map_err(storage_error)?;
        if current != base_revision {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let changed = tx.execute(
            "UPDATE local_outbox SET state='conflict', conflict_server_revision=?1
             WHERE profile_id=?2 AND mutation_id=?3
               AND state='pending' AND conflict_server_revision IS NULL",
            params![remote_revision, profile, mutation],
        ).map_err(storage_error)?;
        if changed != 1 || fail_before_commit {
            return Err(StoreError::StorageFailure);
        }
        tx.commit().map_err(storage_error)?;
        Ok(ConflictReceiptDisposition::Recorded)
    }

    /// Returns metadata only, and never includes a birth record or payload.
    pub fn list_synthetic_v2_conflicts(
        &self, profile: &str, limit: usize,
    ) -> Result<Vec<SyntheticConflictSummary>> {
        if !synthetic_id(profile) || !(1..=500).contains(&limit) {
            return Err(StoreError::InvalidSyntheticInput);
        }
        self.require_v2_for_ack()?;
        let mut stmt = self.conn.prepare(
            "SELECT mutation_id,entity_id,conflict_server_revision
             FROM local_outbox
             WHERE profile_id=?1 AND entity_type='subject'
               AND state='conflict' AND conflict_server_revision IS NOT NULL
             ORDER BY sequence LIMIT ?2",
        ).map_err(storage_error)?;
        let mapped = stmt.query_map(params![profile, limit as i64], |row| {
            Ok(SyntheticConflictSummary {
                mutation_id: row.get(0)?,
                entity_id: row.get(1)?,
                remote_revision: row.get(2)?,
            })
        }).map_err(storage_error)?;
        let items = mapped.collect::<rusqlite::Result<Vec<SyntheticConflictSummary>>>()
            .map_err(storage_error)?;
        Ok(items)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StoreKey, FIXTURE_TIME};
    use tempfile::tempdir;

    fn key() -> StoreKey { StoreKey::from_external_key_material([77_u8; 32]).unwrap() }
    fn setup() -> (tempfile::TempDir, std::path::PathBuf, SyntheticEncryptedStore) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-conflict-v2.db");
        let mut store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.create_synthetic_profile("synthetic-b").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        (dir, path, store)
    }
    fn stage(store: &mut SyntheticEncryptedStore, profile: &str, id: &str, entity: &str) -> String {
        let request = AckRequest {
            profile: profile.to_owned(), mutation: id.to_owned(),
            entity_type: "subject".into(), entity: entity.to_owned(),
            operation: "upsert".into(), base_revision: None,
            created_at: FIXTURE_TIME.into(),
            payload: Some(serde_json::json!({"label":"Fictional"})),
        };
        let hash = fingerprint(&request).unwrap();
        store.stage_synthetic_v2_mutation(&request, false).unwrap();
        hash
    }

    #[test]
    fn persists_conflict_without_overwriting_local_edit() {
        let (_dir, _, mut store) = setup();
        let hash = stage(&mut store,"synthetic-a","synthetic-m1","synthetic-e1");
        assert_eq!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&hash,"rev-remote",false).unwrap(),
            ConflictReceiptDisposition::Recorded);
        let data: (String,Option<String>) = store.conn.query_row(
            "SELECT payload_json,server_revision FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-e1'",
            [],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(data,(r#"{"label":"Fictional"}"#.into(),None));
        let conflicts=store.list_synthetic_v2_conflicts("synthetic-a",10).unwrap();
        assert_eq!(conflicts.len(),1);
        assert_eq!(conflicts[0].remote_revision,"rev-remote");
    }

    #[test]
    fn identical_replay_succeeds_but_changed_fingerprint_or_revision_fails() {
        let (_, _, mut store) = setup();
        let hash = stage(&mut store,"synthetic-a","synthetic-m1","synthetic-e1");
        store.record_synthetic_v2_conflict("synthetic-a","synthetic-m1",&hash,"rev-x",false).unwrap();
        assert_eq!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&hash,"rev-x",false).unwrap(),
            ConflictReceiptDisposition::Replayed);
        assert!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&hash,"rev-y",false).is_err());
        assert!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&"0".repeat(64),"rev-x",false).is_err());
    }

    #[test]
    fn stale_or_out_of_order_mutation_cannot_be_marked_conflicted() {
        let (_, _, mut store) = setup();
        let first=stage(&mut store,"synthetic-a","synthetic-m1","synthetic-e1");
        let second=stage(&mut store,"synthetic-a","synthetic-m2","synthetic-e1");
        assert!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m2",&second,"rev-x",false).is_err());
        store.apply_synthetic_v2_receipt(
            "synthetic-a","synthetic-m1",&first,"accepted","rev-server",false).unwrap();
        assert!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m2",&second,"rev-x",false).is_err());
    }

    #[test]
    fn conflict_listing_is_scoped_per_profile() {
        let (_, _, mut store) = setup();
        let hash=stage(&mut store,"synthetic-b","synthetic-m1","synthetic-e1");
        store.record_synthetic_v2_conflict("synthetic-b","synthetic-m1",&hash,"rev-b",false).unwrap();
        assert!(store.list_synthetic_v2_conflicts("synthetic-a",10).unwrap().is_empty());
        let b=store.list_synthetic_v2_conflicts("synthetic-b",10).unwrap();
        assert_eq!(b.len(),1);
        assert_eq!(b[0].mutation_id,"synthetic-m1");
    }

    #[test]
    fn failed_commit_is_rolled_back_on_encrypted_reopen() {
        let (_, path, mut store) = setup();
        let hash=stage(&mut store,"synthetic-a","synthetic-m1","synthetic-e1");
        assert!(store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&hash,"rev-x",true).is_err());
        drop(store);
        let mut reopened=SyntheticEncryptedStore::open_synthetic_v2(&path,&key()).unwrap();
        assert!(reopened.list_synthetic_v2_conflicts("synthetic-a",10).unwrap().is_empty());
        assert_eq!(reopened.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&hash,"rev-x",false).unwrap(),
            ConflictReceiptDisposition::Recorded);
    }

    #[test]
    fn unresolved_conflict_blocks_ack_and_new_edit_only_for_same_entity() {
        let (_, _, mut store) = setup();
        let hash=stage(&mut store,"synthetic-a","synthetic-m1","synthetic-e1");
        store.record_synthetic_v2_conflict("synthetic-a","synthetic-m1",&hash,"rev-x",false).unwrap();
        assert!(store.apply_synthetic_v2_receipt(
            "synthetic-a","synthetic-m1",&hash,"accepted","rev-x",false).is_err());
        let other=AckRequest{
            profile:"synthetic-a".into(),mutation:"synthetic-m3".into(),
            entity_type:"subject".into(),entity:"synthetic-e2".into(),
            operation:"upsert".into(),base_revision:None,created_at:FIXTURE_TIME.into(),
            payload:Some(serde_json::json!({"label":"Fictional"})),
        };
        let mut same=other.clone();
        same.entity="synthetic-e1".into();
        assert!(store.stage_synthetic_v2_mutation(&same,false).is_err());
        assert!(store.stage_synthetic_v2_mutation(&other,false).is_ok());
    }
}
