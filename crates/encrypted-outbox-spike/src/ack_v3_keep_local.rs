//! Fictional-only v3 conflict decision writer. NOT Tauri/production/authenticated.
//!
//! A deliberate "keep local" choice retires a conflicted outbox ID and
//! requeues exactly its stored payload under a different ID and a revised
//! remote precondition. Decision history is append-only at the SQL layer.
//! No remote snapshot or server authorization is provided by this experiment.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{
    storage_error, synthetic_id, validate_schema_v3, validate_synthetic_fixture_rows,
    Result, StoreError, SyntheticEncryptedStore,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeepLocalDisposition {
    Requeued,
    AlreadyDecided,
}

fn hex_sha256(value: &str) -> bool {
    value.len() == 64
        && value.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

impl SyntheticEncryptedStore {
    fn require_v3_for_decision(&self) -> Result<()> {
        let version: i64 = self.conn.pragma_query_value(
            None, "user_version", |row| row.get(0),
        ).map_err(storage_error)?;
        if version != 3 {
            return Err(StoreError::UnsupportedSchema);
        }
        validate_schema_v3(&self.conn)?;
        validate_synthetic_fixture_rows(&self.conn)?;
        Ok(())
    }

    /// Test-only explicit user choice to preserve the original fictional
    /// local payload. No user click/UI or server authentication exists here.
    ///
    /// All original mutation data are retained in immutable v3 decision
    /// history. Replacement ID must be new, and its remote base is the
    /// recorded conflict revision. Unlike an ACK, the new mutation is still
    /// pending and must be independently accepted by an authenticated server
    /// before it could ever be called synced.
    pub fn keep_synthetic_v3_local_conflict(
        &mut self,
        profile: &str,
        original_mutation: &str,
        replacement_mutation: &str,
        expected_fingerprint: &str,
        decision_time: &str,
        fail_before_commit: bool,
    ) -> Result<KeepLocalDisposition> {
        if !synthetic_id(profile)
            || !synthetic_id(original_mutation)
            || !synthetic_id(replacement_mutation)
            || original_mutation == replacement_mutation
            || !hex_sha256(expected_fingerprint)
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
        self.require_v3_for_decision()?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;

        let decided: Option<(String, String, String, String)> = tx.query_row(
            "SELECT original_fingerprint,replacement_mutation_id,choice,decided_at_utc
             FROM local_conflict_decisions
             WHERE profile_id=?1 AND original_mutation_id=?2",
            params![profile, original_mutation],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        ).optional().map_err(storage_error)?;
        if let Some((digest, replacement, choice, timestamp)) = decided {
            if digest == expected_fingerprint
                && replacement == replacement_mutation
                && choice == "keep_local"
                && timestamp == decision_time
            {
                return Ok(KeepLocalDisposition::AlreadyDecided);
            }
            return Err(StoreError::InvalidSyntheticInput);
        }

        type Original = (
            String, String, String, Option<String>, Option<String>,
            String, String, Option<String>,
        );
        let old: Option<Original> = tx.query_row(
            "SELECT entity_type,entity_id,operation,payload_json,
                    base_server_revision,created_at_utc,state,
                    conflict_server_revision
             FROM local_outbox
             WHERE profile_id=?1 AND mutation_id=?2",
            params![profile, original_mutation],
            |r| Ok((
                r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?,
                r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?,
            )),
        ).optional().map_err(storage_error)?;
        let Some((
            entity_type, entity_id, operation, payload_json, base_revision,
            original_time, state, remote_revision,
        )) = old else {
            return Err(StoreError::InvalidSyntheticInput);
        };
        if entity_type != "subject" || !synthetic_id(&entity_id) || state != "conflict" {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let Some(remote_revision) = remote_revision else {
            return Err(StoreError::InvalidSyntheticInput);
        };
        let parsed_payload = match (operation.as_str(), payload_json.as_deref()) {
            ("upsert", Some(text)) => Some(serde_json::from_str::<serde_json::Value>(text)
                .map_err(|_| StoreError::InvalidSyntheticInput)?),
            ("delete", None) => None,
            _ => return Err(StoreError::InvalidSyntheticInput),
        };
        let original = AckRequest {
            profile: profile.to_owned(),
            mutation: original_mutation.to_owned(),
            entity_type: entity_type.clone(),
            entity: entity_id.clone(),
            operation: operation.clone(),
            base_revision: base_revision.clone(),
            created_at: original_time.clone(),
            payload: parsed_payload,
        };
        let old_hash = fingerprint(&original)
            .map_err(|_| StoreError::InvalidSyntheticInput)?;
        if old_hash != expected_fingerprint {
            return Err(StoreError::InvalidSyntheticInput);
        }

        // A replacement is a completely new request; it must pass the
        // canonicalization/version rules before the old conflict is removed.
        let mut next = original.clone();
        next.mutation = replacement_mutation.to_owned();
        next.base_revision = Some(remote_revision.clone());
        next.created_at = decision_time.to_owned();
        fingerprint(&next).map_err(|_| StoreError::InvalidSyntheticInput)?;

        // Scope ID uniqueness to the synthetic profile, but cover every
        // lifetime state: queued, ACKed, retired original and replacement.
        let reused: i64 = tx.query_row(
            "SELECT
                 EXISTS(SELECT 1 FROM local_outbox
                        WHERE profile_id=?1 AND mutation_id=?2)
                 OR EXISTS(SELECT 1 FROM local_ack_ledger
                        WHERE profile_id=?1 AND mutation_id=?2)
                 OR EXISTS(SELECT 1 FROM local_conflict_decisions
                        WHERE profile_id=?1 AND
                        (original_mutation_id=?2 OR replacement_mutation_id=?2))",
            params![profile, replacement_mutation],
            |r| r.get(0),
        ).map_err(storage_error)?;
        if reused != 0 {
            return Err(StoreError::InvalidSyntheticInput);
        }

        // A dependent offline edit could hold a more recent local payload.
        // Refuse to overwrite/discard any such work; require separate review.
        let siblings: i64 = tx.query_row(
            "SELECT count(*) FROM local_outbox
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity_id],
            |r| r.get(0),
        ).map_err(storage_error)?;
        if siblings != 1 {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let local: Option<(Option<String>, Option<String>, i64)> = tx.query_row(
            "SELECT payload_json,server_revision,locally_deleted
             FROM local_entities
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        ).optional().map_err(storage_error)?;
        let Some((local_payload, local_server, deleted)) = local else {
            return Err(StoreError::InvalidSyntheticInput);
        };
        if local_payload != payload_json
            || local_server != base_revision
            || deleted != i64::from(operation == "delete")
        {
            return Err(StoreError::InvalidSyntheticInput);
        }

        // The SQL trigger forbids using an ID after it appears in immutable
        // decision history. Thus the exact transaction order is important:
        // retire old queue row, update base, create new queue row, THEN write
        // its immutable history record. All four operations roll back as one.
        let removed = tx.execute(
            "DELETE FROM local_outbox
             WHERE profile_id=?1 AND mutation_id=?2
               AND state='conflict' AND conflict_server_revision=?3",
            params![profile, original_mutation, remote_revision],
        ).map_err(storage_error)?;
        let advanced = tx.execute(
            "UPDATE local_entities SET server_revision=?1
             WHERE profile_id=?2 AND entity_type='subject' AND entity_id=?3",
            params![remote_revision, profile, entity_id],
        ).map_err(storage_error)?;
        let inserted = tx.execute(
            "INSERT INTO local_outbox(
                 profile_id,mutation_id,entity_type,entity_id,operation,
                 payload_json,base_server_revision,created_at_utc
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                profile, replacement_mutation, entity_type, entity_id, operation,
                payload_json, remote_revision, decision_time,
            ],
        ).map_err(storage_error)?;
        let historical = tx.execute(
            "INSERT INTO local_conflict_decisions(
                 profile_id,original_mutation_id,original_fingerprint,
                 entity_type,entity_id,original_operation,original_payload_json,
                 original_base_server_revision,original_created_at_utc,
                 replacement_mutation_id,remote_revision,choice,decided_at_utc
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'keep_local',?12)",
            params![
                profile, original_mutation, old_hash, entity_type, entity_id,
                operation, payload_json, base_revision, original_time,
                replacement_mutation, remote_revision, decision_time,
            ],
        ).map_err(storage_error)?;
        if removed != 1 || advanced != 1 || inserted != 1 || historical != 1
            || fail_before_commit
        {
            return Err(StoreError::StorageFailure);
        }
        tx.commit().map_err(storage_error)?;
        Ok(KeepLocalDisposition::Requeued)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StoreKey, FIXTURE_TIME};
    use tempfile::tempdir;

    const DECISION_TIME: &str = "2026-11-11T21:30:00Z";

    fn key() -> StoreKey {
        StoreKey::from_external_key_material([97_u8; 32]).unwrap()
    }
    fn request(profile: &str, mutation: &str, entity: &str) -> AckRequest {
        AckRequest {
            profile: profile.into(), mutation: mutation.into(),
            entity_type: "subject".into(), entity: entity.into(),
            operation: "upsert".into(), base_revision: None,
            created_at: FIXTURE_TIME.into(),
            payload: Some(serde_json::json!({"label":"Fictional"})),
        }
    }
    fn setup() -> (tempfile::TempDir, std::path::PathBuf, SyntheticEncryptedStore, String) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic-v3-decision.db");
        let mut store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.create_synthetic_profile("synthetic-b").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        let req = request("synthetic-a", "synthetic-old", "synthetic-e1");
        let hash = fingerprint(&req).unwrap();
        store.stage_synthetic_v2_mutation(&req, false).unwrap();
        store.record_synthetic_v2_conflict(
            "synthetic-a", "synthetic-old", &hash, "rev-remote", false,
        ).unwrap();
        store.migrate_synthetic_v2_to_v3().unwrap();
        (dir, path, store, hash)
    }
    fn history_count(store: &SyntheticEncryptedStore) -> i64 {
        store.conn.query_row(
            "SELECT count(*) FROM local_conflict_decisions",
            [], |r| r.get(0),
        ).unwrap()
    }

    #[test]
    fn keeps_original_payload_history_and_queues_new_revision() {
        let (_dir, _path, mut store, hash) = setup();
        assert_eq!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            DECISION_TIME,false,
        ).unwrap(), KeepLocalDisposition::Requeued);
        let history: (String, String, String, String) = store.conn.query_row(
            "SELECT original_payload_json,original_fingerprint,remote_revision,
                    replacement_mutation_id FROM local_conflict_decisions",
            [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?)),
        ).unwrap();
        assert_eq!(history, (
            r#"{"label":"Fictional"}"#.into(), hash,
            "rev-remote".into(), "synthetic-new".into(),
        ));
        let staged: (String, String) = store.conn.query_row(
            "SELECT payload_json,base_server_revision FROM local_outbox",
            [], |r| Ok((r.get(0)?,r.get(1)?)),
        ).unwrap();
        assert_eq!(staged, (r#"{"label":"Fictional"}"#.into(), "rev-remote".into()));
    }

    #[test]
    fn exact_decision_replay_noops_and_divergent_replay_is_rejected() {
        let (_dir, _path, mut store, hash) = setup();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,DECISION_TIME,false,
        ).unwrap();
        assert_eq!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,DECISION_TIME,false,
        ).unwrap(), KeepLocalDisposition::AlreadyDecided);
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-other",&hash,DECISION_TIME,false,
        ).is_err());
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,FIXTURE_TIME,false,
        ).is_err());
        assert_eq!(history_count(&store),1);
    }

    #[test]
    fn wrong_hash_reused_replacement_and_missing_profile_fail_closed() {
        let (_dir, _path, mut store, hash) = setup();
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&"0".repeat(64),
            DECISION_TIME,false,
        ).is_err());
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-old",&hash,
            DECISION_TIME,false,
        ).is_err());
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-b","synthetic-old","synthetic-new",&hash,
            DECISION_TIME,false,
        ).is_err());
        assert_eq!(history_count(&store),0);
    }

    #[test]
    fn refuses_dependent_offline_edit_without_removing_its_local_payload() {
        let (_dir, _path, mut store, hash) = setup();
        store.conn.execute(
            "INSERT INTO local_outbox(
                 profile_id,mutation_id,entity_type,entity_id,operation,
                 payload_json,created_at_utc)
             VALUES ('synthetic-a','synthetic-dependent','subject',
                     'synthetic-e1','upsert','{\"label\":\"Fictional\"}',
                     '2026-11-11T21:30:00Z')",
            [],
        ).unwrap();
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            DECISION_TIME,false,
        ).is_err());
        assert_eq!(history_count(&store),0);
        let waiting: i64 = store.conn.query_row(
            "SELECT count(*) FROM local_outbox", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(waiting,2);
    }

    #[test]
    fn injected_error_rolls_back_all_changes_across_encrypted_reopen() {
        let (_dir, path, mut store, hash) = setup();
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            DECISION_TIME,true,
        ).is_err());
        drop(store);
        let reopened = SyntheticEncryptedStore::open_synthetic_v3(&path,&key()).unwrap();
        assert_eq!(history_count(&reopened),0);
        let state: (String, Option<String>) = reopened.conn.query_row(
            "SELECT state,base_server_revision FROM local_outbox",
            [], |r| Ok((r.get(0)?,r.get(1)?)),
        ).unwrap();
        assert_eq!(state,("conflict".into(),None));
        let current: Option<String> = reopened.conn.query_row(
            "SELECT server_revision FROM local_entities WHERE entity_id='synthetic-e1'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(current,None);
    }

    #[test]
    fn immutable_history_and_original_id_survive_reopen_and_raw_sql() {
        let (_dir, path, mut store, hash) = setup();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,DECISION_TIME,false,
        ).unwrap();
        drop(store);
        let reopened = SyntheticEncryptedStore::open_synthetic_v3(&path,&key()).unwrap();
        assert_eq!(history_count(&reopened),1);
        assert!(reopened.conn.execute(
            "UPDATE local_conflict_decisions
             SET remote_revision='rev-forged' WHERE profile_id='synthetic-a'",
            [],
        ).is_err());
        assert!(reopened.conn.execute(
            "DELETE FROM local_conflict_decisions WHERE profile_id='synthetic-a'",
            [],
        ).is_err());
        assert!(reopened.conn.execute(
            "INSERT INTO local_outbox(
                profile_id,mutation_id,entity_type,entity_id,operation,
                payload_json,created_at_utc)
             VALUES('synthetic-a','synthetic-old','subject','synthetic-e1',
                    'upsert','{}','2026-11-11T21:30:00Z')",
            [],
        ).is_err());
    }

    #[test]
    fn delete_tombstone_is_requeued_without_inventing_a_payload() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic-delete-v3.db");
        let mut store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        let mut deletion = request("synthetic-a", "synthetic-old", "synthetic-e1");
        deletion.operation = "delete".into();
        deletion.payload = None;
        let hash = fingerprint(&deletion).unwrap();
        store.stage_synthetic_v2_mutation(&deletion, false).unwrap();
        store.record_synthetic_v2_conflict(
            "synthetic-a", "synthetic-old", &hash, "rev-delete", false,
        ).unwrap();
        store.migrate_synthetic_v2_to_v3().unwrap();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a", "synthetic-old", "synthetic-new", &hash,
            DECISION_TIME, false,
        ).unwrap();
        let archived: (String, Option<String>) = store.conn.query_row(
            "SELECT original_operation,original_payload_json
             FROM local_conflict_decisions", [], |r| Ok((r.get(0)?,r.get(1)?)),
        ).unwrap();
        assert_eq!(archived, ("delete".into(), None));
        let latest: (String, Option<String>, String) = store.conn.query_row(
            "SELECT operation,payload_json,base_server_revision
             FROM local_outbox", [], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
        ).unwrap();
        assert_eq!(latest, ("delete".into(), None, "rev-delete".into()));
        let tombstone: i64 = store.conn.query_row(
            "SELECT locally_deleted FROM local_entities", [], |r| r.get(0),
        ).unwrap();
        assert_eq!(tombstone, 1);
    }

    #[test]
    fn prior_ack_id_cannot_be_reused_as_replacement() {
        let (_dir, _path, mut store, hash) = setup();
        store.conn.execute(
            "INSERT INTO local_ack_ledger(
                 profile_id,mutation_id,entity_type,entity_id,request_fingerprint,
                 result,server_revision,acknowledged_at_utc
             ) VALUES (?1,?2,'subject','synthetic-e1',?3,'accepted','rev-ack',?4)",
            rusqlite::params![
                "synthetic-a", "synthetic-acked", "a".repeat(64), FIXTURE_TIME
            ],
        ).unwrap();
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a", "synthetic-old", "synthetic-acked", &hash,
            DECISION_TIME, false,
        ).is_err());
        assert_eq!(history_count(&store), 0);
        let state: String = store.conn.query_row(
            "SELECT state FROM local_outbox
             WHERE profile_id='synthetic-a' AND mutation_id='synthetic-old'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(state, "conflict");
    }

    #[test]
    fn newer_local_edits_or_tampering_are_not_overwritten() {
        let (_dir, _path, mut store, hash) = setup();
        store.conn.execute(
            "UPDATE local_entities SET payload_json='{\"label\":\"Newer\"}'
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-e1'",
            [],
        ).unwrap();
        assert!(store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,DECISION_TIME,false,
        ).is_err());
        assert_eq!(history_count(&store),0);
    }
}
