//! Synthetic-only v3 conflict previews for a future desktop review screen.
//! This module is NOT account authorization, IPC, server reconciliation,
//! production sync, or an API for leaking real birth-chart payloads.
//!
//! A preview is a stale-able hint, never permission to write. The v3
//! keep-local writer revalidates every precondition inside BEGIN IMMEDIATE.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{
    storage_error, synthetic_id, validate_schema_v3, validate_synthetic_fixture_rows,
    Result, StoreError, SyntheticEncryptedStore,
};
use rusqlite::{params, OptionalExtension, TransactionBehavior};

const MAX_PREVIEW_ROWS: usize = 100;
// Shared JavaScript/Rust cursor contract: JSON numbers cannot represent
// arbitrary i64 SQLite sequences without losing integer precision.
const MAX_CURSOR_SEQUENCE: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticV3ConflictPreview {
    pub mutation_id: String,
    pub entity_id: String,
    pub remote_revision: String,
    /// Consistency token over the persisted fictional original request;
    /// SHA-256 is NOT authentication and should not be exposed over IPC.
    pub original_fingerprint: String,
    /// Advisory only. The native decision writer MUST check again atomically.
    pub can_keep_local: bool,
}

/// Only the current page is inspected. A cursor is a FIFO position, not a
/// snapshot authorization or a token that grants access to another profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SyntheticV3ConflictPage {
    pub items: Vec<SyntheticV3ConflictPreview>,
    pub next_after_sequence: Option<i64>,
}

impl SyntheticEncryptedStore {
    /// Metadata-only, profile-scoped and bounded fictional v3 conflict list.
    /// Reads no network state and never updates a stored subject or outbox.
    /// The original fingerprint is returned only to this isolated Rust caller.
    pub fn list_synthetic_v3_conflict_previews(
        &mut self,
        profile: &str,
        limit: usize,
    ) -> Result<Vec<SyntheticV3ConflictPreview>> {
        Ok(self.page_synthetic_v3_conflict_previews(profile, None, limit)?.items)
    }

    /// Keyset pagination for the same fictional profile. A cursor is the
    /// durable local_outbox.sequence of the last *returned* row. Do not use
    /// OFFSET, which can duplicate/skip rows when prior edits are removed.
    ///
    /// Between separate calls the queue can change. This is a bounded
    /// review hint, NOT a stable snapshot or permission to resolve a conflict.
    pub fn page_synthetic_v3_conflict_previews(
        &mut self,
        profile: &str,
        after_sequence: Option<i64>,
        limit: usize,
    ) -> Result<SyntheticV3ConflictPage> {
        let after = after_sequence.unwrap_or(0);
        if !synthetic_id(profile) || !(1..=MAX_PREVIEW_ROWS).contains(&limit)
            || !(0..=MAX_CURSOR_SEQUENCE).contains(&after)
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Deferred)
            .map_err(storage_error)?;
        validate_schema_v3(&tx)?;
        validate_synthetic_fixture_rows(&tx)?;

        let previews = {
            let mut stmt = tx.prepare(
                "SELECT sequence,mutation_id,entity_id,operation,payload_json,
                        base_server_revision,created_at_utc,conflict_server_revision
                 FROM local_outbox
                 WHERE profile_id=?1 AND entity_type='subject' AND state='conflict'
                   AND sequence > ?2
                 ORDER BY sequence LIMIT ?3"
            ).map_err(storage_error)?;
            // Fetch one extra row to prove another page exists; do not
            // fabricate a next cursor merely because this page is full.
            let rows = stmt.query_map(params![profile, after, (limit + 1) as i64], |r| Ok((
                r.get::<_, i64>(0)?, r.get::<_, String>(1)?,
                r.get::<_, String>(2)?, r.get::<_, String>(3)?,
                r.get::<_, Option<String>>(4)?, r.get::<_, Option<String>>(5)?,
                r.get::<_, String>(6)?, r.get::<_, Option<String>>(7)?,
            ))).map_err(storage_error)?;
            let mut items = Vec::new();
            let mut last_sequence = None;
            let mut has_more = false;
            for row in rows {
                let (sequence, mutation, entity, operation, payload_json,
                     base, created, remote) = row.map_err(storage_error)?;
                if sequence <= after || sequence > MAX_CURSOR_SEQUENCE {
                    return Err(StoreError::InvalidSyntheticInput);
                }
                if items.len() == limit {
                    has_more = true;
                    break;
                }
                last_sequence = Some(sequence);
                if !synthetic_id(&mutation) || !synthetic_id(&entity) {
                    return Err(StoreError::InvalidSyntheticInput);
                }
                let Some(remote) = remote else {
                    return Err(StoreError::InvalidSyntheticInput);
                };
                if remote.is_empty() || remote.len() > 128
                    || !remote.bytes().all(|b| (0x20..=0x7e).contains(&b))
                    || base.as_deref() == Some(remote.as_str())
                {
                    return Err(StoreError::InvalidSyntheticInput);
                }
                let payload = match (operation.as_str(), payload_json.as_deref()) {
                    ("upsert", Some(json)) => Some(serde_json::from_str(json)
                        .map_err(|_| StoreError::InvalidSyntheticInput)?),
                    ("delete", None) => None,
                    _ => return Err(StoreError::InvalidSyntheticInput),
                };
                let original = AckRequest {
                    profile: profile.to_owned(), mutation: mutation.clone(),
                    entity_type: "subject".into(), entity: entity.clone(),
                    operation: operation.clone(), payload,
                    base_revision: base.clone(), created_at: created,
                };
                let original_fingerprint = fingerprint(&original)
                    .map_err(|_| StoreError::InvalidSyntheticInput)?;

                let queued: i64 = tx.query_row(
                    "SELECT count(*) FROM local_outbox
                     WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
                    params![profile, entity], |r| r.get(0),
                ).map_err(storage_error)?;
                let local: Option<(Option<String>, Option<String>, i64)> = tx.query_row(
                    "SELECT payload_json,server_revision,locally_deleted
                     FROM local_entities
                     WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
                    params![profile, entity],
                    |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)),
                ).optional().map_err(storage_error)?;
                let eligible = queued == 1 && local.is_some_and(|(p, server, deleted)| {
                    p == payload_json
                        && server == base
                        && deleted == i64::from(operation == "delete")
                });
                items.push(SyntheticV3ConflictPreview {
                    mutation_id: mutation,
                    entity_id: entity,
                    remote_revision: remote,
                    original_fingerprint,
                    can_keep_local: eligible,
                });
            }
            SyntheticV3ConflictPage {
                items,
                next_after_sequence: if has_more { last_sequence } else { None },
            }
        };
        // The snapshot transaction only read data; no writes or repairs.
        tx.commit().map_err(storage_error)?;
        Ok(previews)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{StoreKey, FIXTURE_TIME};
    use tempfile::tempdir;

    fn key() -> StoreKey {
        StoreKey::from_external_key_material([114_u8; 32]).unwrap()
    }
    fn request(profile: &str, mutation: &str, entity: &str, label: &str) -> AckRequest {
        AckRequest {
            profile: profile.into(), mutation: mutation.into(),
            entity_type: "subject".into(), entity: entity.into(),
            operation: "upsert".into(), base_revision: None,
            created_at: FIXTURE_TIME.into(),
            payload: Some(serde_json::json!({"label":label})),
        }
    }
    fn setup() -> (tempfile::TempDir, std::path::PathBuf, SyntheticEncryptedStore, String) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-v3-previews.db");
        let mut store = SyntheticEncryptedStore::open(&path, &key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.create_synthetic_profile("synthetic-b").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        let req = request("synthetic-a","synthetic-m1","synthetic-e1","Fictional");
        let digest = fingerprint(&req).unwrap();
        store.stage_synthetic_v2_mutation(&req, false).unwrap();
        store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&digest,"rev-remote",false,
        ).unwrap();
        store.migrate_synthetic_v2_to_v3().unwrap();
        (dir, path, store, digest)
    }

    #[test]
    fn returns_only_fictional_conflict_metadata_and_original_hash() {
        let (_dir,_path,mut store,digest) = setup();
        let preview = store.list_synthetic_v3_conflict_previews("synthetic-a",10).unwrap();
        assert_eq!(preview.len(),1);
        assert_eq!(preview[0],SyntheticV3ConflictPreview {
            mutation_id:"synthetic-m1".into(), entity_id:"synthetic-e1".into(),
            remote_revision:"rev-remote".into(), original_fingerprint:digest,
            can_keep_local:true,
        });
        assert!(store.list_synthetic_v3_conflict_previews("synthetic-b",10).unwrap().is_empty());
    }

    #[test]
    fn eligibility_is_only_a_hint_and_disappears_after_resolution() {
        let (_dir,_path,mut store,digest) = setup();
        assert!(store.list_synthetic_v3_conflict_previews("synthetic-a",1).unwrap()[0].can_keep_local);
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-m1","synthetic-next",&digest,
            "2026-11-11T21:30:00Z",false,
        ).unwrap();
        assert!(store.list_synthetic_v3_conflict_previews("synthetic-a",10).unwrap().is_empty());
    }

    #[test]
    fn dependent_queued_edit_requires_manual_review() {
        let dir=tempdir().unwrap();
        let path=dir.path().join("synthetic-dependents.db");
        let mut store=SyntheticEncryptedStore::open(&path,&key()).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        let first=request("synthetic-a","synthetic-m1","synthetic-e1","First");
        let second=request("synthetic-a","synthetic-m2","synthetic-e1","Second");
        let hash=fingerprint(&first).unwrap();
        store.stage_synthetic_v2_mutation(&first,false).unwrap();
        store.stage_synthetic_v2_mutation(&second,false).unwrap();
        store.record_synthetic_v2_conflict(
            "synthetic-a","synthetic-m1",&hash,"rev-remote",false,
        ).unwrap();
        store.migrate_synthetic_v2_to_v3().unwrap();
        let items=store.list_synthetic_v3_conflict_previews("synthetic-a",10).unwrap();
        assert_eq!(items.len(),1);
        assert!(!items[0].can_keep_local);
        assert_eq!(items[0].original_fingerprint,hash);
    }

    #[test]
    fn changed_materialized_subject_blocks_one_click_keep_local_hint() {
        let (_dir,_path,mut store,_) = setup();
        store.conn.execute(
            "UPDATE local_entities SET payload_json='{\"label\":\"Changed without queue\"}'
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-e1'", [],
        ).unwrap();
        assert!(!store.list_synthetic_v3_conflict_previews("synthetic-a",10)
            .unwrap()[0].can_keep_local);
    }

    #[test]
    fn list_validates_limit_profile_and_v3_schema() {
        let (_dir,_path,mut store,_) = setup();
        assert!(store.list_synthetic_v3_conflict_previews("synthetic-a",0).is_err());
        assert!(store.list_synthetic_v3_conflict_previews("synthetic-a",101).is_err());
        assert!(store.list_synthetic_v3_conflict_previews("other",10).is_err());
        let dir=tempdir().unwrap();
        let path=dir.path().join("fictional-v2-only.db");
        let mut v2=SyntheticEncryptedStore::open(&path,&key()).unwrap();
        v2.migrate_synthetic_v1_to_v2().unwrap();
        assert!(v2.list_synthetic_v3_conflict_previews("synthetic-a",10).is_err());
    }

    #[test]
    fn keyset_pages_keep_fifo_order_without_skipping_and_end_cleanly() {
        let (_dir, _path, mut store, _) = setup();
        for suffix in ["two", "three"] {
            let entity = format!("synthetic-e-{suffix}");
            let mutation = format!("synthetic-m-{suffix}");
            let payload = serde_json::json!({"label":suffix}).to_string();
            store.conn.execute(
                "INSERT INTO local_entities(
                     profile_id,entity_type,entity_id,payload_json,local_revision)
                 VALUES (?1,'subject',?2,?3,1)",
                rusqlite::params!["synthetic-a",entity,payload],
            ).unwrap();
            store.conn.execute(
                "INSERT INTO local_outbox(
                     profile_id,mutation_id,entity_type,entity_id,operation,
                     payload_json,created_at_utc,state,conflict_server_revision)
                 VALUES (?1,?2,'subject',?3,'upsert',?4,?5,'conflict',?6)",
                rusqlite::params![
                    "synthetic-a",mutation,entity,payload,FIXTURE_TIME,"rev-remote",
                ],
            ).unwrap();
        }
        let first = store.page_synthetic_v3_conflict_previews("synthetic-a",None,2).unwrap();
        assert_eq!(first.items.len(),2);
        assert!(first.next_after_sequence.is_some());
        assert_eq!(first.items[0].mutation_id,"synthetic-m1");
        assert_eq!(first.items[1].mutation_id,"synthetic-m-two");
        let second = store.page_synthetic_v3_conflict_previews(
            "synthetic-a",first.next_after_sequence,2,
        ).unwrap();
        assert_eq!(second.items.len(),1);
        assert_eq!(second.items[0].mutation_id,"synthetic-m-three");
        assert_eq!(second.next_after_sequence,None);
        assert!(store.page_synthetic_v3_conflict_previews(
            "synthetic-a",Some(MAX_CURSOR_SEQUENCE),2,
        ).unwrap().items.is_empty());
    }

    #[test]
    fn keyset_rejects_invalid_cursors_and_preserves_profile_isolation() {
        let (_dir,_path,mut store,_) = setup();
        for invalid in [-1,MAX_CURSOR_SEQUENCE+1] {
            assert!(store.page_synthetic_v3_conflict_previews(
                "synthetic-a",Some(invalid),10,
            ).is_err());
        }
        assert!(store.page_synthetic_v3_conflict_previews(
            "synthetic-a",Some(0),0,
        ).is_err());
        assert!(store.page_synthetic_v3_conflict_previews(
            "synthetic-b",Some(0),10,
        ).unwrap().items.is_empty());
        assert!(store.page_synthetic_v3_conflict_previews(
            "not-a-profile",Some(0),10,
        ).is_err());
    }

    #[test]
    fn keyset_survives_prior_conflict_resolution_without_duplicate() {
        let (_dir, _path, mut store, digest) = setup();
        store.conn.execute(
            "INSERT INTO local_entities(
                 profile_id,entity_type,entity_id,payload_json,local_revision)
             VALUES ('synthetic-a','subject','synthetic-e2',
                     '{\"label\":\"Other fictional\"}',1)",
            [],
        ).unwrap();
        store.conn.execute(
            "INSERT INTO local_outbox(
                 profile_id,mutation_id,entity_type,entity_id,operation,
                 payload_json,created_at_utc,state,conflict_server_revision)
             VALUES ('synthetic-a','synthetic-m2','subject','synthetic-e2',
                     'upsert','{\"label\":\"Other fictional\"}',
                     '2026-11-10T19:00:00Z','conflict','rev-remote')",
            [],
        ).unwrap();
        let first = store.page_synthetic_v3_conflict_previews(
            "synthetic-a",None,1,
        ).unwrap();
        assert_eq!(first.items[0].mutation_id,"synthetic-m1");
        let cursor = first.next_after_sequence;
        assert!(cursor.is_some());

        // Resolve the earlier conflict between page requests. The next
        // page must still show the later conflict exactly once, never the
        // newly pending replacement and never the retired original.
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a","synthetic-m1","synthetic-next",&digest,
            "2026-11-11T21:30:00Z",false,
        ).unwrap();
        let after = store.page_synthetic_v3_conflict_previews(
            "synthetic-a",cursor,1,
        ).unwrap();
        assert_eq!(after.items.len(),1);
        assert_eq!(after.items[0].mutation_id,"synthetic-m2");
        assert_eq!(after.next_after_sequence,None);
    }

    #[test]
    fn v3_sql_prevents_tampering_with_queued_fictional_payload() {
        let (_dir,_path,mut store,_) = setup();
        assert!(store.conn.execute(
            "UPDATE local_outbox SET payload_json='{\"angle\":1.5}'
             WHERE mutation_id='synthetic-m1'", [],
        ).is_err());
        assert_eq!(store.list_synthetic_v3_conflict_previews("synthetic-a",10)
            .unwrap().len(),1);
    }

    #[test]
    fn preview_survives_encrypted_reopen_without_mutating_queue() {
        let (_dir,path,mut store,hash) = setup();
        assert_eq!(store.list_synthetic_v3_conflict_previews("synthetic-a",10).unwrap().len(),1);
        drop(store);
        let mut reopened=SyntheticEncryptedStore::open_synthetic_v3(&path,&key()).unwrap();
        let items=reopened.list_synthetic_v3_conflict_previews("synthetic-a",10).unwrap();
        assert_eq!(items[0].original_fingerprint,hash);
        let state:String=reopened.conn.query_row(
            "SELECT state FROM local_outbox WHERE mutation_id='synthetic-m1'",
            [],|r|r.get(0),
        ).unwrap();
        assert_eq!(state,"conflict");
    }
}
