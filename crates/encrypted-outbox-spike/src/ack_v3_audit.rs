//! Bounded, read-only semantic audit of fictional v3 SQLCipher records.
//! The existing encrypted-open gate checks SQL layout/HMAC. This additional
//! audit checks cross-table meaning, not only SQLite catalogue integrity.
//! It NEVER repairs, deletes, exports or logs any local subject payload.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{
    storage_error, synthetic_id, validate_schema_v3, validate_synthetic_fixture_rows,
    Result, StoreError, SyntheticEncryptedStore,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

const MAX_AUDIT_ROWS: usize = 10_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SyntheticV3AuditSummary {
    pub outbox_rows: usize,
    pub acknowledgements: usize,
    pub decision_rows: usize,
}

fn suspicious() -> StoreError {
    StoreError::InvalidSyntheticInput
}

fn stored_request(
    profile: String, mutation: String, entity_type: String, entity: String,
    operation: String, raw_payload: Option<String>, base_revision: Option<String>,
    created_at: String,
) -> Result<AckRequest> {
    let payload = match (operation.as_str(), raw_payload) {
        ("upsert", Some(json)) => Some(serde_json::from_str(&json).map_err(|_| suspicious())?),
        ("delete", None) => None,
        _ => return Err(suspicious()),
    };
    Ok(AckRequest {
        profile, mutation, entity_type, entity, operation,
        payload, base_revision, created_at,
    })
}

impl SyntheticEncryptedStore {
    /// Read-only, consistent SQLite snapshot for fictional v3 records only.
    /// Returns aggregate counts, never payloads, identifiers or secret keys.
    /// Refuses ambiguous, invalid and over-limit data; never repairs the DB.
    pub fn audit_synthetic_v3_readonly(&mut self) -> Result<SyntheticV3AuditSummary> {
        // DEFERRED gives a consistent snapshot once the first SELECT begins;
        // all following queries use the same transaction/connection.
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(storage_error)?;
        validate_schema_v3(&tx)?;
        validate_synthetic_fixture_rows(&tx)?;
        let mut outbox_rows = 0usize;
        {
            let mut stmt = tx.prepare(
                "SELECT profile_id,mutation_id,entity_type,entity_id,operation,
                        payload_json,base_server_revision,created_at_utc,state,
                        conflict_server_revision
                 FROM local_outbox ORDER BY sequence"
            ).map_err(storage_error)?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?, r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?, r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?, r.get::<_, Option<String>>(5)?,
                    r.get::<_, Option<String>>(6)?, r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?, r.get::<_, Option<String>>(9)?,
                ))
            }).map_err(storage_error)?;
            for row in rows {
                outbox_rows += 1;
                if outbox_rows > MAX_AUDIT_ROWS { return Err(suspicious()); }
                let (profile, mutation, entity_type, entity, operation,
                     payload, base, created, state, conflict) = row.map_err(storage_error)?;
                let request = stored_request(
                    profile.clone(), mutation.clone(), entity_type, entity,
                    operation, payload, base.clone(), created,
                )?;
                fingerprint(&request).map_err(|_| suspicious())?;
                match (state.as_str(), conflict.as_deref()) {
                    ("pending", None) => {}
                    ("conflict", Some(remote)) if !remote.is_empty()
                        && remote.len() <= 128
                        && remote.bytes().all(|b| (0x20..=0x7e).contains(&b))
                        && base.as_deref() != Some(remote) => {}
                    _ => return Err(suspicious()),
                }
                let overlaps: i64 = tx.query_row(
                    "SELECT
                         EXISTS(SELECT 1 FROM local_ack_ledger
                                WHERE profile_id=?1 AND mutation_id=?2)
                         OR EXISTS(SELECT 1 FROM local_conflict_decisions
                                   WHERE profile_id=?1 AND original_mutation_id=?2)",
                    params![profile, mutation],
                    |r| r.get(0),
                ).map_err(storage_error)?;
                if overlaps != 0 { return Err(suspicious()); }
            }
        }

        let mut acknowledgements = 0usize;
        {
            let mut stmt = tx.prepare(
                "SELECT profile_id,mutation_id,entity_id
                 FROM local_ack_ledger ORDER BY profile_id,mutation_id"
            ).map_err(storage_error)?;
            let rows = stmt.query_map([], |r| {
                Ok((r.get::<_, String>(0)?,r.get::<_, String>(1)?,r.get::<_, String>(2)?))
            }).map_err(storage_error)?;
            for row in rows {
                acknowledgements += 1;
                if acknowledgements > MAX_AUDIT_ROWS { return Err(suspicious()); }
                let (profile, mutation, entity) = row.map_err(storage_error)?;
                if !synthetic_id(&profile) || !synthetic_id(&mutation)
                    || !synthetic_id(&entity) { return Err(suspicious()); }
                let in_outbox: i64 = tx.query_row(
                    "SELECT count(*) FROM local_outbox
                     WHERE profile_id=?1 AND mutation_id=?2",
                    params![profile, mutation], |r| r.get(0),
                ).map_err(storage_error)?;
                if in_outbox != 0 { return Err(suspicious()); }
            }
        }

        let mut decision_rows = 0usize;
        {
            let mut stmt = tx.prepare(
                "SELECT profile_id,original_mutation_id,original_fingerprint,
                        entity_type,entity_id,original_operation,original_payload_json,
                        original_base_server_revision,original_created_at_utc,
                        replacement_mutation_id,remote_revision,decided_at_utc
                 FROM local_conflict_decisions
                 ORDER BY profile_id,original_mutation_id"
            ).map_err(storage_error)?;
            let rows = stmt.query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,r.get::<_, String>(3)?,
                    r.get::<_, String>(4)?,r.get::<_, String>(5)?,
                    r.get::<_, Option<String>>(6)?,r.get::<_, Option<String>>(7)?,
                    r.get::<_, String>(8)?,r.get::<_, String>(9)?,
                    r.get::<_, String>(10)?,r.get::<_, String>(11)?,
                ))
            }).map_err(storage_error)?;
            for row in rows {
                decision_rows += 1;
                if decision_rows > MAX_AUDIT_ROWS { return Err(suspicious()); }
                let (profile, original_id, expected_hash, entity_type, entity,
                    operation, raw_payload, original_base, original_time,
                    replacement_id, remote_revision, decided_at) =
                    row.map_err(storage_error)?;
                if !synthetic_id(&replacement_id) { return Err(suspicious()); }
                let original = stored_request(
                    profile.clone(), original_id.clone(), entity_type.clone(),
                    entity.clone(), operation.clone(), raw_payload.clone(),
                    original_base, original_time,
                )?;
                let actual = fingerprint(&original).map_err(|_| suspicious())?;
                if actual != expected_hash { return Err(suspicious()); }
                if remote_revision.is_empty() || remote_revision.len() > 128
                    || !remote_revision.bytes().all(|b| (0x20..=0x7e).contains(&b))
                { return Err(suspicious()); }

                let old_reuse: i64 = tx.query_row(
                    "SELECT
                         EXISTS(SELECT 1 FROM local_outbox
                                WHERE profile_id=?1 AND mutation_id=?2)
                         OR EXISTS(SELECT 1 FROM local_ack_ledger
                                   WHERE profile_id=?1 AND mutation_id=?2)",
                    params![profile, original_id], |r| r.get(0),
                ).map_err(storage_error)?;
                if old_reuse != 0 { return Err(suspicious()); }

                // A replacement is either still pending, already ACKed,
                // or itself retired by a later explicit keep-local decision.
                let replacement: Option<(String, String, String, Option<String>,
                                          Option<String>, String)> = tx.query_row(
                    "SELECT entity_type,entity_id,operation,payload_json,
                            base_server_revision,created_at_utc
                     FROM local_outbox WHERE profile_id=?1 AND mutation_id=?2",
                    params![profile, replacement_id],
                    |r| Ok((
                        r.get(0)?,r.get(1)?,r.get(2)?,
                        r.get(3)?,r.get(4)?,r.get(5)?,
                    )),
                ).optional().map_err(storage_error)?;
                if let Some((new_type, new_entity, new_op, new_payload,
                             new_base, new_time)) = replacement {
                    if new_type != entity_type || new_entity != entity
                        || new_op != operation || new_payload != raw_payload
                        || new_base.as_deref() != Some(remote_revision.as_str())
                        || new_time != decided_at
                    { return Err(suspicious()); }
                } else {
                    let ack: Option<(String, String)> = tx.query_row(
                        "SELECT entity_type,entity_id FROM local_ack_ledger
                         WHERE profile_id=?1 AND mutation_id=?2",
                        params![profile, replacement_id],
                        |r| Ok((r.get(0)?,r.get(1)?)),
                    ).optional().map_err(storage_error)?;
                    if let Some((acked_type, acked_entity)) = ack {
                        if acked_type != entity_type || acked_entity != entity {
                            return Err(suspicious());
                        }
                    } else {
                        // Chained keep-local decisions are legal, but the next
                        // history row must correspond to the exact replacement
                        // that this preceding decision created.
                        type NextOld = (String, String, String, Option<String>,
                                        Option<String>, String);
                        let chain: Option<NextOld> = tx.query_row(
                            "SELECT entity_type,entity_id,original_operation,
                                    original_payload_json,
                                    original_base_server_revision,original_created_at_utc
                             FROM local_conflict_decisions
                             WHERE profile_id=?1 AND original_mutation_id=?2",
                            params![profile, replacement_id],
                            |r| Ok((
                                r.get(0)?,r.get(1)?,r.get(2)?,
                                r.get(3)?,r.get(4)?,r.get(5)?,
                            )),
                        ).optional().map_err(storage_error)?;
                        let Some((next_type, next_entity, next_op,
                                  next_payload, next_base, next_time)) = chain else {
                            return Err(suspicious());
                        };
                        if next_type != entity_type || next_entity != entity
                            || next_op != operation || next_payload != raw_payload
                            || next_base.as_deref() != Some(remote_revision.as_str())
                            || next_time != decided_at
                        { return Err(suspicious()); }
                    }
                }
            }
        }
        tx.commit().map_err(storage_error)?;
        Ok(SyntheticV3AuditSummary {
            outbox_rows, acknowledgements, decision_rows,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StoreKey, FIXTURE_TIME};
    use tempfile::tempdir;

    fn key() -> StoreKey {
        StoreKey::from_external_key_material([105_u8;32]).unwrap()
    }
    fn setup() -> (tempfile::TempDir, std::path::PathBuf,
                   SyntheticEncryptedStore, AckRequest, String) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic-audit-v3.db");
        let mut store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        let original = AckRequest {
            profile: "synthetic-a".into(), mutation: "synthetic-old".into(),
            entity_type: "subject".into(), entity: "synthetic-e1".into(),
            operation: "upsert".into(), base_revision: None,
            created_at: FIXTURE_TIME.into(),
            payload: Some(serde_json::json!({"label":"Fictional"})),
        };
        let digest = fingerprint(&original).unwrap();
        store.stage_synthetic_v2_mutation(&original, false).unwrap();
        store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-old",&digest,"rev-remote",false,
        ).unwrap();
        store.migrate_synthetic_v2_to_v3().unwrap();
        (dir, path, store, original, digest)
    }

    #[test]
    fn validates_undecided_conflict_without_writing_anything() {
        let (_dir, _path, mut store, _, _) = setup();
        let summary = store.audit_synthetic_v3_readonly().unwrap();
        assert_eq!(summary,SyntheticV3AuditSummary {
            outbox_rows:1,acknowledgements:0,decision_rows:0
        });
        assert_eq!(store.audit_synthetic_v3_readonly().unwrap(),summary);
    }

    #[test]
    fn validates_kept_local_decision_across_encrypted_reopen() {
        let (_dir, path, mut store, _, hash) = setup();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            "2026-11-11T21:30:00Z",false,
        ).unwrap();
        assert_eq!(store.audit_synthetic_v3_readonly().unwrap(),
            SyntheticV3AuditSummary {
                outbox_rows:1,acknowledgements:0,decision_rows:1
            });
        drop(store);
        let mut reopened = SyntheticEncryptedStore::open_synthetic_v3(&path,&key()).unwrap();
        assert_eq!(reopened.audit_synthetic_v3_readonly().unwrap().decision_rows,1);
    }

    #[test]
    fn mismatched_archived_fingerprint_is_rejected() {
        let (_dir, _path, mut store, _, hash) = setup();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            "2026-11-11T21:30:00Z",false,
        ).unwrap();
        // We cannot UPDATE immutable history; inject a separate fake row
        // pointing at the same existing fictional subject.
        store.conn.execute(
            "INSERT INTO local_conflict_decisions(
                profile_id,original_mutation_id,original_fingerprint,
                entity_type,entity_id,original_operation,original_payload_json,
                original_created_at_utc,replacement_mutation_id,remote_revision,
                choice,decided_at_utc
             ) VALUES ('synthetic-a','synthetic-fake',
                       '0000000000000000000000000000000000000000000000000000000000000000',
                       'subject','synthetic-e1','upsert','{\"label\":\"Fictional\"}',
                       '2026-11-11T21:30:00Z','synthetic-orphan',
                       'rev-remote','keep_local','2026-11-11T21:30:00Z')",
            [],
        ).unwrap();
        assert!(store.audit_synthetic_v3_readonly().is_err());
    }

    #[test]
    fn invalid_queued_payload_is_rejected_even_if_json_check_passes() {
        let (_dir, _path, mut store, _, _) = setup();
        store.conn.execute(
            "UPDATE local_outbox SET payload_json='{\"position\":12.5}'",
            [],
        ).unwrap();
        assert!(store.audit_synthetic_v3_readonly().is_err());
    }

    #[test]
    fn an_ack_and_pending_row_with_same_id_are_rejected() {
        let (_dir, _path, mut store, _, _) = setup();
        store.conn.execute(
            "INSERT INTO local_ack_ledger(
                profile_id,mutation_id,entity_type,entity_id,request_fingerprint,
                result,server_revision,acknowledged_at_utc)
             VALUES ('synthetic-a','synthetic-old','subject','synthetic-e1',
               'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
               'accepted','rev-x','2026-11-11T21:30:00Z')", [],
        ).unwrap();
        assert!(store.audit_synthetic_v3_readonly().is_err());
    }

    #[test]
    fn original_retired_id_cannot_also_be_acknowledged() {
        let (_dir, _path, mut store, _, hash) = setup();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            "2026-11-11T21:30:00Z",false,
        ).unwrap();
        store.conn.execute(
            "INSERT INTO local_ack_ledger(
                profile_id,mutation_id,entity_type,entity_id,request_fingerprint,
                result,server_revision,acknowledged_at_utc)
             VALUES('synthetic-a','synthetic-old','subject','synthetic-e1',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'accepted','rev-forged','2026-11-11T21:30:00Z')", [],
        ).unwrap();
        assert!(store.audit_synthetic_v3_readonly().is_err());
    }

    #[test]
    fn acknowledged_replacement_must_reference_the_same_subject() {
        let (_dir, _path, mut store, _, hash) = setup();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-old","synthetic-new",&hash,
            "2026-11-11T21:30:00Z",false,
        ).unwrap();
        store.conn.execute(
            "DELETE FROM local_outbox WHERE mutation_id='synthetic-new'", [],
        ).unwrap();
        store.conn.execute(
            "INSERT INTO local_ack_ledger(
                profile_id,mutation_id,entity_type,entity_id,request_fingerprint,
                result,server_revision,acknowledged_at_utc)
             VALUES('synthetic-a','synthetic-new','subject','synthetic-other',
                    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                    'accepted','rev-forged','2026-11-11T21:30:00Z')", [],
        ).unwrap();
        assert!(store.audit_synthetic_v3_readonly().is_err());
    }

    #[test]
    fn audit_is_refused_on_pre_v3_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic-v2-audit-refusal.db");
        let mut store = SyntheticEncryptedStore::open(&path,&key()).unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        assert!(store.audit_synthetic_v3_readonly().is_err());
    }
}
