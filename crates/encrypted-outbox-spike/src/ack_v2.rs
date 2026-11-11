//! Synthetic-only, explicitly version-2 SQLCipher acknowledgement writer.
//!
//! ACK-FP-001 fingerprints are constructed from the durable outbox row, not
//! from a UI-provided payload. A matching digest is NOT an authenticated
//! server receipt. Real ownership/identity and authorization remain unbuilt.
//! This module is intentionally a child of the isolated storage spike.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{
    storage_error, synthetic_id, validate_schema_v2, validate_synthetic_fixture_rows,
    Result, StoreError, SyntheticEncryptedStore, FIXTURE_TIME,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AckV2Disposition {
    Acknowledged,
    Replayed,
}

fn is_lowercase_sha256_hex(hash: &str) -> bool {
    hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn safe_server_revision(revision: &str) -> bool {
    !revision.is_empty()
        && revision.len() <= 128
        && revision.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

impl SyntheticEncryptedStore {
    pub(crate) fn require_v2_for_ack(&self) -> Result<()> {
        let version: i64 = self.conn.pragma_query_value(
            None, "user_version", |row| row.get(0),
        ).map_err(storage_error)?;
        if version != 2 {
            return Err(StoreError::UnsupportedSchema);
        }
        validate_schema_v2(&self.conn)?;
        validate_synthetic_fixture_rows(&self.conn)?;
        Ok(())
    }

    /// Apply an independently authenticated server receipt in a future
    /// integration. THIS PROTOTYPE DOES NOT VERIFY SERVER IDENTITY.
    ///
    /// The supplied fingerprint is only a consistency expectation: the
    /// actual digest is computed from the persisted, immutable outbox snapshot.
    /// Exact accepted ACK + revision + deletion share one SQLCipher transaction.
    pub fn apply_synthetic_v2_receipt(
        &mut self,
        profile: &str,
        mutation: &str,
        expected_fingerprint: &str,
        result: &str,
        server_revision: &str,
        fail_before_commit: bool,
    ) -> Result<AckV2Disposition> {
        if !synthetic_id(profile)
            || !synthetic_id(mutation)
            || !is_lowercase_sha256_hex(expected_fingerprint)
            || !matches!(result, "accepted" | "already_applied")
            || !safe_server_revision(server_revision)
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
        self.require_v2_for_ack()?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;

        let seen: Option<(String, String, String)> = tx.query_row(
            "SELECT request_fingerprint,result,server_revision
             FROM local_ack_ledger WHERE profile_id=?1 AND mutation_id=?2",
            params![profile, mutation],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(storage_error)?;
        if let Some((old_hash, old_result, old_revision)) = seen {
            if old_hash == expected_fingerprint
                && old_result == result
                && old_revision == server_revision
            {
                return Ok(AckV2Disposition::Replayed);
            }
            return Err(StoreError::InvalidSyntheticInput);
        }

        type Pending = (
            i64, String, String, String, Option<String>, Option<String>,
            String, String,
        );
        let row: Option<Pending> = tx.query_row(
            "SELECT sequence,entity_type,entity_id,operation,payload_json,
                    base_server_revision,created_at_utc,state
             FROM local_outbox WHERE profile_id=?1 AND mutation_id=?2",
            params![profile, mutation],
            |row| Ok((
                row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?,
                row.get(4)?, row.get(5)?, row.get(6)?, row.get(7)?,
            )),
        ).optional().map_err(storage_error)?;
        let Some((
            sequence, entity_type, entity_id, operation,
            payload_json, base_server_revision, created_at, state,
        )) = row else {
            return Err(StoreError::InvalidSyntheticInput);
        };

        if state != "pending" || entity_type != "subject" || !synthetic_id(&entity_id) {
            return Err(StoreError::InvalidSyntheticInput);
        }

        let payload = match (operation.as_str(), payload_json) {
            ("upsert", Some(json)) => {
                Some(serde_json::from_str::<serde_json::Value>(&json)
                    .map_err(|_| StoreError::InvalidSyntheticInput)?)
            }
            ("delete", None) => None,
            _ => return Err(StoreError::InvalidSyntheticInput),
        };
        let snapshot = AckRequest {
            profile: profile.to_owned(),
            mutation: mutation.to_owned(),
            entity_type: entity_type.clone(),
            entity: entity_id.clone(),
            operation: operation.clone(),
            base_revision: base_server_revision.clone(),
            created_at,
            payload,
        };
        let actual_fingerprint = fingerprint(&snapshot)
            .map_err(|_| StoreError::InvalidSyntheticInput)?;
        if actual_fingerprint != expected_fingerprint {
            return Err(StoreError::InvalidSyntheticInput);
        }

        let first: i64 = tx.query_row(
            "SELECT min(sequence) FROM local_outbox
             WHERE profile_id=?1 AND entity_type=?2 AND entity_id=?3",
            params![profile, entity_type, entity_id],
            |row| row.get(0),
        ).map_err(storage_error)?;
        if first != sequence {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let current: Option<String> = tx.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id=?1 AND entity_type=?2 AND entity_id=?3",
            params![profile, entity_type, entity_id],
            |row| row.get(0),
        ).map_err(storage_error)?;
        if current != base_server_revision {
            // A second offline change must wait for an explicit rebase.
            return Err(StoreError::InvalidSyntheticInput);
        }

        tx.execute(
            "INSERT INTO local_ack_ledger (
                 profile_id,mutation_id,entity_type,entity_id,request_fingerprint,
                 result,server_revision,acknowledged_at_utc
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                profile, mutation, entity_type, entity_id,
                actual_fingerprint, result, server_revision, FIXTURE_TIME
            ],
        ).map_err(storage_error)?;
        let updated = tx.execute(
            "UPDATE local_entities SET server_revision=?1
             WHERE profile_id=?2 AND entity_type=?3 AND entity_id=?4",
            params![server_revision, profile, entity_type, entity_id],
        ).map_err(storage_error)?;
        let deleted = tx.execute(
            "DELETE FROM local_outbox WHERE profile_id=?1 AND mutation_id=?2",
            params![profile, mutation],
        ).map_err(storage_error)?;
        if updated != 1 || deleted != 1 || fail_before_commit {
            return Err(StoreError::StorageFailure);
        }
        tx.commit().map_err(storage_error)?;
        Ok(AckV2Disposition::Acknowledged)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StoreKey, FIXTURE_TIME};
    use rusqlite::OptionalExtension;
    use tempfile::tempdir;

    fn key() -> StoreKey {
        StoreKey::from_external_key_material([61_u8; 32]).unwrap()
    }

    fn request(profile: &str, mutation: &str, entity: &str, payload: Option<&str>, operation: &str) -> AckRequest {
        AckRequest {
            profile: profile.to_owned(), mutation: mutation.to_owned(),
            entity_type: "subject".to_owned(), entity: entity.to_owned(),
            operation: operation.to_owned(), base_revision: None,
            created_at: FIXTURE_TIME.to_owned(),
            payload: payload.map(|p| serde_json::from_str(p).unwrap()),
        }
    }

    fn setup() -> (tempfile::TempDir, std::path::PathBuf, SyntheticEncryptedStore) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-v2-encrypted.db");
        let store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        (dir, path, store)
    }

    #[test]
    fn accepted_ack_is_durable_and_exact_replay_survives_encrypted_reopen() {
        let (_dir, path, mut store) = setup();
        let profile = "synthetic-a";
        let mutation = "synthetic-m1";
        let entity = "synthetic-1";
        let json = r#"{"label":"Fictional"}"#;
        store.create_synthetic_profile(profile).unwrap();
        store.stage_synthetic_subject(profile, entity, mutation, json).unwrap();
        let digest = fingerprint(&request(profile, mutation, entity, Some(json), "upsert")).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        assert_eq!(store.apply_synthetic_v2_receipt(
            profile, mutation, &digest, "accepted", "rev-1", false,
        ).unwrap(), AckV2Disposition::Acknowledged);
        drop(store);
        assert!(SyntheticEncryptedStore::open(&path, &key()).is_err());
        let mut reopened = SyntheticEncryptedStore::open_synthetic_v2(&path, &key()).unwrap();
        assert_eq!(reopened.apply_synthetic_v2_receipt(
            profile, mutation, &digest, "accepted", "rev-1", false,
        ).unwrap(), AckV2Disposition::Replayed);
        assert!(reopened.apply_synthetic_v2_receipt(
            profile, mutation, &digest, "accepted", "rev-2", false,
        ).is_err());
        let (queued, acked): (i64, i64) = reopened.conn.query_row(
            "SELECT (SELECT count(*) FROM local_outbox),
                    (SELECT count(*) FROM local_ack_ledger)", [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!((queued, acked), (0, 1));
    }

    #[test]
    fn mismatched_fingerprint_and_out_of_order_receipts_do_not_change_queue() {
        let (_dir, _path, mut store) = setup();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject("synthetic-a", "synthetic-1", "synthetic-m1", r#"{"a":1}"#).unwrap();
        store.stage_synthetic_subject("synthetic-a", "synthetic-1", "synthetic-m2", r#"{"a":2}"#).unwrap();
        let one = fingerprint(&request("synthetic-a", "synthetic-m1", "synthetic-1", Some(r#"{"a":1}"#), "upsert")).unwrap();
        let two = fingerprint(&request("synthetic-a", "synthetic-m2", "synthetic-1", Some(r#"{"a":2}"#), "upsert")).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        assert!(store.apply_synthetic_v2_receipt("synthetic-a", "synthetic-m1",
            &two, "accepted", "rev-1", false).is_err());
        assert!(store.apply_synthetic_v2_receipt("synthetic-a", "synthetic-m2",
            &two, "accepted", "rev-2", false).is_err());
        assert_eq!(store.apply_synthetic_v2_receipt("synthetic-a", "synthetic-m1",
            &one, "accepted", "rev-1", false).unwrap(), AckV2Disposition::Acknowledged);
        // Second modification is based on old null revision: do not rebase.
        assert!(store.apply_synthetic_v2_receipt("synthetic-a", "synthetic-m2",
            &two, "accepted", "rev-2", false).is_err());
        let unacknowledged: i64 = store.conn.query_row(
            "SELECT count(*) FROM local_outbox WHERE mutation_id='synthetic-m2'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(unacknowledged, 1);
    }

    #[test]
    fn injected_failure_rolls_back_ledger_revision_and_outbox_together() {
        let (_dir, path, mut store) = setup();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject("synthetic-a", "synthetic-1", "synthetic-m1", r#"{"a":1}"#).unwrap();
        let digest = fingerprint(&request("synthetic-a", "synthetic-m1", "synthetic-1", Some(r#"{"a":1}"#), "upsert")).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        assert!(store.apply_synthetic_v2_receipt(
            "synthetic-a", "synthetic-m1", &digest, "accepted", "rev-1", true,
        ).is_err());
        drop(store);
        let reopened = SyntheticEncryptedStore::open_synthetic_v2(&path, &key()).unwrap();
        let acked: i64 = reopened.conn.query_row(
            "SELECT count(*) FROM local_ack_ledger", [], |row| row.get(0),
        ).unwrap();
        let queued: i64 = reopened.conn.query_row(
            "SELECT count(*) FROM local_outbox", [], |row| row.get(0),
        ).unwrap();
        let revision: Option<String> = reopened.conn.query_row(
            "SELECT server_revision FROM local_entities WHERE profile_id='synthetic-a'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!((acked, queued, revision), (0, 1, None));
    }

    #[test]
    fn delete_tombstone_is_preserved_after_ack_and_duplicate_id_is_remembered() {
        let (_dir, path, mut store) = setup();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_delete("synthetic-a", "synthetic-1", "synthetic-del").unwrap();
        let digest = fingerprint(&request("synthetic-a", "synthetic-del", "synthetic-1", None, "delete")).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        assert_eq!(store.apply_synthetic_v2_receipt(
            "synthetic-a", "synthetic-del", &digest, "accepted", "rev-del", false,
        ).unwrap(), AckV2Disposition::Acknowledged);
        drop(store);
        let mut reopened = SyntheticEncryptedStore::open_synthetic_v2(&path, &key()).unwrap();
        let deleted: i64 = reopened.conn.query_row(
            "SELECT locally_deleted FROM local_entities WHERE profile_id='synthetic-a'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(deleted, 1);
        assert!(reopened.apply_synthetic_v2_receipt(
            "synthetic-a", "synthetic-del", &"0".repeat(64), "accepted", "rev-del", false,
        ).is_err());
        assert_eq!(reopened.apply_synthetic_v2_receipt(
            "synthetic-a", "synthetic-del", &digest, "accepted", "rev-del", false,
        ).unwrap(), AckV2Disposition::Replayed);
    }

    #[test]
    fn same_mutation_id_in_separate_synthetic_profiles_remains_isolated() {
        let (_dir, _path, mut store) = setup();
        for profile in ["synthetic-a", "synthetic-b"] {
            store.create_synthetic_profile(profile).unwrap();
            store.stage_synthetic_subject(
                profile, "synthetic-1", "synthetic-m1", r#"{"label":"Fictional"}"#,
            ).unwrap();
        }
        let digest_b = fingerprint(&request(
            "synthetic-b", "synthetic-m1", "synthetic-1", Some(r#"{"label":"Fictional"}"#), "upsert",
        )).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        store.apply_synthetic_v2_receipt(
            "synthetic-b", "synthetic-m1", &digest_b, "accepted", "rev-b", false,
        ).unwrap();
        let a_pending: i64 = store.conn.query_row(
            "SELECT count(*) FROM local_outbox WHERE profile_id='synthetic-a'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(a_pending, 1);
        let a_revision: Option<String> = store.conn.query_row(
            "SELECT server_revision FROM local_entities WHERE profile_id='synthetic-a'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(a_revision, None);
    }

    #[test]
    fn v2_explicit_open_refuses_v1_wrong_key_and_unsupported_ack() {
        let (_dir, path, mut store) = setup();
        assert!(SyntheticEncryptedStore::open_synthetic_v2(&path, &key()).is_err());
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject("synthetic-a", "synthetic-1", "synthetic-m1", r#"{"a":1}"#).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        drop(store);
        let wrong = StoreKey::from_external_key_material([99_u8; 32]).unwrap();
        assert!(SyntheticEncryptedStore::open_synthetic_v2(&path, &wrong).is_err());
        let mut reopened = SyntheticEncryptedStore::open_synthetic_v2(&path, &key()).unwrap();
        assert!(reopened.apply_synthetic_v2_receipt(
            "synthetic-a", "synthetic-m1", &"0".repeat(64), "untrusted",
            "rev-1", false,
        ).is_err());
        let unknown: Option<i64> = reopened.conn.query_row(
            "SELECT 1 FROM local_ack_ledger LIMIT 1", [], |row| row.get(0),
        ).optional().unwrap();
        assert_eq!(unknown, None);
    }
}
