//! VirgoStars Desktop SQLCipher storage spike.
//!
//! ISOLATED / SYNTHETIC ONLY: not linked into the Tauri application, not a
//! production storage library. OS keychain, authentication, migrations,
//! schema auditing and release tests must be added before real data.
//! This module has no network access, privileged Tauri commands or login.
//!
//! SQLite is NEVER used as a plaintext alternative. A missing SQLCipher
//! codec, incorrect key, unknown schema or plaintext file fails closed.

pub mod ack_fingerprint;
mod ack_v2;
mod ack_v2_stage;
pub use ack_v2::AckV2Disposition;
pub use ack_v2_stage::V2StageDisposition;

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, TransactionBehavior};
use std::fmt::Write as _;
use std::path::Path;
use zeroize::Zeroizing;

const SCHEMA_V1: &str = include_str!("../../../contracts/sqlite/0001_local_outbox.sql");
const SCHEMA_V2: &str = include_str!("../../../contracts/sqlite/0002_ack_ledger.sql");
const FIXTURE_TIME: &str = "2026-11-10T19:00:00Z";
const MAX_JSON_BYTES: usize = 262_144;

#[derive(Debug, PartialEq, Eq)]
pub enum StoreError {
    InvalidSyntheticInput,
    CipherMissingOrInvalidKey,
    UnsupportedSchema,
    StorageFailure,
}

impl std::fmt::Display for StoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // Never include keys, SQL statements, filesystem paths or personal data.
        f.write_str(match self {
            Self::InvalidSyntheticInput => "Invalid synthetic fixture input",
            Self::CipherMissingOrInvalidKey => "Encrypted store cannot be unlocked",
            Self::UnsupportedSchema => "Encrypted store schema is unsupported",
            Self::StorageFailure => "Encrypted store operation failed",
        })
    }
}
impl std::error::Error for StoreError {}

type Result<T> = std::result::Result<T, StoreError>;
fn storage_error(_: rusqlite::Error) -> StoreError { StoreError::StorageFailure }

/// Caller is responsible for obtaining 32 cryptographically random bytes from
/// reviewed, OS-protected key management. This spike never generates or stores
/// encryption keys. Never use deterministic test keys outside the tests.
pub struct StoreKey(Zeroizing<[u8; 32]>);

impl StoreKey {
    pub fn from_external_key_material(bytes: [u8; 32]) -> Result<Self> {
        if bytes.iter().all(|byte| *byte == 0) {
            return Err(StoreError::InvalidSyntheticInput);
        }
        Ok(Self(Zeroizing::new(bytes)))
    }
}

/// Owns its private encrypted connection. No arbitrary SQL or path is exposed
/// through IPC; no Tauri integration exists in this spike.
pub struct SyntheticEncryptedStore {
    conn: Connection,
}

fn synthetic_id(value: &str) -> bool {
    value.starts_with("synthetic-")
        && value.len() > "synthetic-".len()
        && value.len() <= 128
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

/** SQLCipher schema gate for the *exact* v1 metadata.
 *
 * The template connection contains only static public DDL and exists in memory;
 * no user records, encryption keys or plaintext database files are created.
 * SQLite itself normalizes both catalogues using the SAME linked engine, so
 * table, index, CHECK/foreign-key definitions, and unexpected objects are
 * compared rather than trusting user_version or table names alone.
 * Upgrading the reference DDL must be an explicit, reviewed migration.
 */
fn schema_catalog(conn: &Connection) -> Result<Vec<(String, String, String)>> {
    let mut stmt = conn.prepare(
        "SELECT type, name, sql FROM sqlite_master
         WHERE type IN ('table','index','trigger','view')
           AND name NOT GLOB 'sqlite_*'
         ORDER BY type, name"
    ).map_err(storage_error)?;
    let mapped = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(storage_error)?;
    let catalog = mapped
        .collect::<rusqlite::Result<Vec<(String, String, String)>>>()
        .map_err(storage_error)?;
    Ok(catalog)
}

fn validate_schema_v1(conn: &Connection) -> Result<()> {
    let template = Connection::open_in_memory().map_err(storage_error)?;
    template.execute_batch(SCHEMA_V1).map_err(storage_error)?;
    if schema_catalog(conn)? != schema_catalog(&template)? {
        return Err(StoreError::UnsupportedSchema);
    }
    // Detect referential corruption created while foreign_keys was disabled.
    // PRAGMA quick_check cannot detect all foreign-key violations.
    let violation: Option<String> = conn.query_row(
        "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1",
        [], |row| row.get(0)
    ).optional().map_err(storage_error)?;
    if violation.is_some() {
        return Err(StoreError::UnsupportedSchema);
    }
    Ok(())
}

/// Validate the full v2 catalogue inside the same SQLCipher engine used by
/// the encrypted connection. This is ONLY the reference migration gate:
/// v2 account writes and ACK receipts are intentionally NOT enabled.
fn validate_schema_v2(conn: &Connection) -> Result<()> {
    let template = Connection::open_in_memory().map_err(storage_error)?;
    template.execute_batch(SCHEMA_V1).map_err(storage_error)?;
    template.execute_batch(SCHEMA_V2).map_err(storage_error)?;
    if schema_catalog(conn)? != schema_catalog(&template)? {
        return Err(StoreError::UnsupportedSchema);
    }
    let version: i64 = conn.pragma_query_value(
        None, "user_version", |row| row.get(0),
    ).map_err(storage_error)?;
    if version != 2 {
        return Err(StoreError::UnsupportedSchema);
    }
    let violation: Option<String> = conn.query_row(
        "SELECT \"table\" FROM pragma_foreign_key_check LIMIT 1",
        [], |row| row.get(0),
    ).optional().map_err(storage_error)?;
    if violation.is_some() {
        return Err(StoreError::UnsupportedSchema);
    }
    Ok(())
}

/// Prevent this test-only migration from touching a non-fictional profile,
/// even if an external encrypted file happens to have the expected v1 DDL.
/// Run the check inside BEGIN IMMEDIATE so identifiers cannot change between
/// verification and the migration transaction.
fn validate_synthetic_fixture_rows(conn: &Connection) -> Result<()> {
    let mut stmt = conn.prepare(
        "SELECT profile_id, NULL AS entity_id, NULL AS mutation_id FROM local_profiles
         UNION ALL SELECT profile_id, entity_id, NULL FROM local_entities
         UNION ALL SELECT profile_id, entity_id, mutation_id FROM local_outbox
         UNION ALL SELECT profile_id, NULL, NULL FROM local_sync_cursors"
    ).map_err(storage_error)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?,
            row.get::<_, Option<String>>(1)?,
            row.get::<_, Option<String>>(2)?))
    }).map_err(storage_error)?;
    for row in rows {
        let (profile, entity, mutation) = row.map_err(storage_error)?;
        if !synthetic_id(&profile)
            || entity.as_ref().is_some_and(|id| !synthetic_id(id))
            || mutation.as_ref().is_some_and(|id| !synthetic_id(id))
        {
            return Err(StoreError::InvalidSyntheticInput);
        }
    }
    Ok(())
}

impl SyntheticEncryptedStore {
    /// Standard v1 constructor intentionally does not auto-upgrade or read v2.
    pub fn open(path: &Path, key: &StoreKey) -> Result<Self> {
        Self::open_expected_synthetic_schema(path, key, 1)
    }

    /// EXPLICIT test-only v2 open. Enforces the SAME SQLCipher/HMAC gate as
    /// the v1 constructor, then checks the exact v2 schema and synthetic IDs.
    /// No user account, backup migration, login or real data is supported.
    pub fn open_synthetic_v2(path: &Path, key: &StoreKey) -> Result<Self> {
        Self::open_expected_synthetic_schema(path, key, 2)
    }

    fn open_expected_synthetic_schema(path: &Path, key: &StoreKey, expected: i64) -> Result<Self> {
        // Best-effort symlink guard for a test-only path. Production must use
        // an application-owned directory and race-safe path verification.
        let existed = match std::fs::symlink_metadata(path) {
            Ok(meta) if meta.file_type().is_symlink() || !meta.is_file() =>
                return Err(StoreError::InvalidSyntheticInput),
            Ok(_) => true,
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => false,
            Err(_) => return Err(StoreError::StorageFailure),
        };

        let mut conn = Connection::open_with_flags(
            path,
            OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE,
        ).map_err(storage_error)?;

        // SQLCipher raw 256-bit key syntax. Zeroize the intermediate text;
        // never log this PRAGMA or forward database error details to the UI.
        // PRAGMA key is the FIRST operation on the opened connection.
        let mut raw = Zeroizing::new(String::with_capacity(67));
        raw.push_str("x'");
        for byte in key.0.iter() {
            write!(&mut *raw, "{byte:02x}").map_err(|_| StoreError::StorageFailure)?;
        }
        raw.push('\'');
        conn.pragma_update(None, "key", raw.as_str())
            .map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        drop(raw);

        // Plain SQLite silently ignores/does not implement cipher_version;
        // a successful open alone must NEVER be interpreted as encryption.
        let cipher_version: String = conn.pragma_query_value(
            None, "cipher_version", |row| row.get(0)
        ).map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        // cipher_integrity_check requires SQLCipher >= 4.2 and page HMACs.
        // Versions predating that feature must NOT silently skip the check.
        let version: Vec<u32> = cipher_version
            .split('.')
            .take(2)
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect();
        let supported = version.len() == 2
            && (version[0] > 4 || (version[0] == 4 && version[1] >= 2));
        if !supported {
            return Err(StoreError::CipherMissingOrInvalidKey);
        }
        // This forces the codec to actually read/decrypt database pages,
        // detecting incorrect keys and previously unencrypted SQLite files.
        conn.query_row("SELECT count(*) FROM sqlite_master", [], |row| row.get::<_, i64>(0))
            .map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        let quick_check: String = conn.query_row(
            "PRAGMA quick_check", [], |row| row.get(0),
        ).map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        if quick_check != "ok" {
            return Err(StoreError::CipherMissingOrInvalidKey);
        }
        // A valid SQLite B-tree is not sufficient: SQLCipher authenticates the
        // encrypted envelope via per-page HMAC. Any reported page error blocks
        // opening, and disabling HMAC is not supported by this spike.
        let hmac: i64 = conn.pragma_query_value(
            None, "cipher_use_hmac", |row| row.get(0),
        ).map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        if hmac != 1 { return Err(StoreError::CipherMissingOrInvalidKey); }
        let mut cipher_stmt = conn.prepare("PRAGMA cipher_integrity_check")
            .map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        let mut cipher_rows = cipher_stmt.query([])
            .map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
        if cipher_rows.next().map_err(|_| StoreError::CipherMissingOrInvalidKey)?.is_some() {
            return Err(StoreError::CipherMissingOrInvalidKey);
        }
        drop(cipher_rows);
        drop(cipher_stmt);

        // Keep this spike in DELETE journal mode; SQLite WAL + backup/rekey
        // behavior must receive a separate SQLCipher-specific security review.
        conn.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA journal_mode=DELETE;"
        ).map_err(storage_error)?;
        let foreign_keys: i64 = conn.pragma_query_value(
            None, "foreign_keys", |row| row.get(0)
        ).map_err(storage_error)?;
        if foreign_keys != 1 { return Err(StoreError::StorageFailure); }

        let version: i64 = conn.pragma_query_value(
            None, "user_version", |row| row.get(0)
        ).map_err(storage_error)?;
        match version {
            0 if !existed && expected == 1 => {
                let count: i64 = conn.query_row(
                    "SELECT count(*) FROM sqlite_master WHERE type='table'",
                    [], |row| row.get(0)
                ).map_err(storage_error)?;
                if count != 0 { return Err(StoreError::UnsupportedSchema); }
                // The schema has PRAGMA user_version=1 and is transactional.
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)
                    .map_err(storage_error)?;
                tx.execute_batch(SCHEMA_V1).map_err(storage_error)?;
                tx.commit().map_err(storage_error)?;
            }
            1 if expected == 1 => {}
            2 if expected == 2 => {}
            _ => return Err(StoreError::UnsupportedSchema),
        }
        // Never accept a v2 file via v1 or silently migrate. Both explicit
        // constructors share the SQLCipher page and HMAC integrity checks.
        match expected {
            1 => validate_schema_v1(&conn)?,
            2 => {
                validate_schema_v2(&conn)?;
                validate_synthetic_fixture_rows(&conn)?;
            }
            _ => return Err(StoreError::UnsupportedSchema),
        }
        Ok(Self { conn })
    }

    /// A v1 handle MUST become read-only in effect after test-only migration.
    /// The normal constructor still rejects v2, and all state-changing methods
    /// must reject a migrated in-memory handle until an authenticated v2 ACK
    /// writer with durable deduplication has been implemented and reviewed.
    fn require_v1(&self) -> Result<()> {
        let version: i64 = self.conn.pragma_query_value(
            None, "user_version", |row| row.get(0),
        ).map_err(storage_error)?;
        if version != 1 {
            return Err(StoreError::UnsupportedSchema);
        }
        Ok(())
    }

    /// EXPLICIT synthetic-only v1→v2 migration proof. No automatic migrations,
    /// Tauri commands or use with actual user data. The current normal open
    /// intentionally rejects v2 even after a successful reference migration.
    pub fn migrate_synthetic_v1_to_v2(&mut self) -> Result<()> {
        self.migrate_synthetic_v1_to_v2_inner(false)
    }

    fn migrate_synthetic_v1_to_v2_inner(&mut self, abort_before_commit: bool) -> Result<()> {
        self.require_v1()?;
        validate_schema_v1(&self.conn)?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        validate_synthetic_fixture_rows(&tx)?;
        tx.execute_batch(SCHEMA_V2).map_err(storage_error)?;
        // Every mutation, cursor and profile must survive; DDL, indexes and
        // FK integrity are validated before committing the migration.
        validate_schema_v2(&tx)?;
        if abort_before_commit {
            return Err(StoreError::StorageFailure);
        }
        tx.commit().map_err(storage_error)
    }

    pub fn create_synthetic_profile(&self, profile: &str) -> Result<()> {
        self.require_v1()?;
        if !synthetic_id(profile) { return Err(StoreError::InvalidSyntheticInput); }
        self.conn.execute(
            "INSERT OR IGNORE INTO local_profiles(profile_id) VALUES (?1)", [profile],
        ).map_err(storage_error)?;
        Ok(())
    }

    fn check_json(&self, payload: &str) -> Result<()> {
        if payload.as_bytes().len() > MAX_JSON_BYTES {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let valid: i64 = self.conn.query_row(
            "SELECT json_valid(?1)", [payload], |row| row.get(0),
        ).map_err(storage_error)?;
        if valid != 1 { return Err(StoreError::InvalidSyntheticInput); }
        Ok(())
    }

    /// Edit and matching sync intent are committed as one transaction.
    /// Fixture supports subjects only until typed domain DTOs are approved.
    pub fn stage_synthetic_subject(
        &mut self, profile: &str, entity: &str, mutation: &str, payload: &str,
    ) -> Result<()> {
        self.require_v1()?;
        if !synthetic_id(profile) || !synthetic_id(entity) || !synthetic_id(mutation) {
            return Err(StoreError::InvalidSyntheticInput);
        }
        self.check_json(payload)?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        tx.execute(
            "INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision)
             VALUES (?1,'subject',?2,?3,1)
             ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET
             payload_json=excluded.payload_json, locally_deleted=0,
             local_revision=local_entities.local_revision+1",
            params![profile, entity, payload],
        ).map_err(storage_error)?;
        // Pin the server revision AT THE TIME of the local edit. A later
        // ACK must never implicitly rebase a second offline edit.
        let base_revision: Option<String> = tx.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity], |row| row.get(0),
        ).map_err(storage_error)?;
        tx.execute(
            "INSERT INTO local_outbox(
                 profile_id,mutation_id,entity_type,entity_id,operation,payload_json,
                 base_server_revision,created_at_utc)
             VALUES (?1,?2,'subject',?3,'upsert',?4,?5,?6)",
            params![profile, mutation, entity, payload, base_revision, FIXTURE_TIME],
        ).map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }

    /// Tombstone and pending delete intent commit together. The tombstone
    /// remains after acknowledgment until a separately approved retention rule.
    pub fn stage_synthetic_delete(
        &mut self, profile: &str, entity: &str, mutation: &str,
    ) -> Result<()> {
        self.require_v1()?;
        if !synthetic_id(profile) || !synthetic_id(entity) || !synthetic_id(mutation) {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        tx.execute(
            "INSERT INTO local_entities(
                 profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision)
             VALUES (?1,'subject',?2,NULL,1,1)
             ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET
                 payload_json=NULL, locally_deleted=1,
                 local_revision=local_entities.local_revision+1",
            params![profile, entity],
        ).map_err(storage_error)?;
        let base_revision: Option<String> = tx.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity], |row| row.get(0),
        ).map_err(storage_error)?;
        tx.execute(
            "INSERT INTO local_outbox(
                 profile_id,mutation_id,entity_type,entity_id,operation,payload_json,
                 base_server_revision,created_at_utc)
             VALUES (?1,?2,'subject',?3,'delete',NULL,?4,?5)",
            params![profile, mutation, entity, base_revision, FIXTURE_TIME],
        ).map_err(storage_error)?;
        tx.commit().map_err(storage_error)
    }

    pub fn pending_synthetic_ids(&self, profile: &str, limit: usize) -> Result<Vec<String>> {
        self.require_v1()?;
        if !synthetic_id(profile) || !(1..=500).contains(&limit) {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let mut stmt = self.conn.prepare(
            "SELECT o.mutation_id FROM local_outbox o
             INNER JOIN local_entities e
               ON e.profile_id=o.profile_id
               AND e.entity_type=o.entity_type AND e.entity_id=o.entity_id
             WHERE o.profile_id=?1 AND o.state='pending'
               AND o.base_server_revision IS e.server_revision
             AND NOT EXISTS (
               SELECT 1 FROM local_outbox earlier
               WHERE earlier.profile_id=o.profile_id
               AND earlier.entity_type=o.entity_type AND earlier.entity_id=o.entity_id
               AND earlier.sequence<o.sequence
             )
             ORDER BY o.sequence LIMIT ?2"
        ).map_err(storage_error)?;
        let mapped = stmt.query_map(params![profile, limit as i64], |row| row.get::<_, String>(0))
            .map_err(storage_error)?;
        let ids = mapped.collect::<rusqlite::Result<Vec<String>>>()
            .map_err(storage_error)?;
        Ok(ids)
    }

    /// Accepted and conflict server receipts are committed atomically. No
    /// cloud API or authenticated server currently supplies these receipts.
    pub fn apply_synthetic_receipt(
        &mut self, profile: &str, mutation: &str, revision: &str, conflict: bool,
    ) -> Result<()> {
        self.require_v1()?;
        if !synthetic_id(profile) || !synthetic_id(mutation) || revision.is_empty() ||
            revision.len() > 128 || !revision.is_ascii() {
            return Err(StoreError::InvalidSyntheticInput);
        }
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let row: Option<(i64, String, Option<String>)> = tx.query_row(
            "SELECT sequence,entity_id,base_server_revision FROM local_outbox
             WHERE profile_id=?1 AND mutation_id=?2 AND entity_type='subject' AND state='pending'",
            params![profile, mutation], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional().map_err(storage_error)?;
        let Some((sequence, entity, recorded_base)) = row else {
            return Err(StoreError::InvalidSyntheticInput);
        };
        let current_server_revision: Option<String> = tx.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity], |row| row.get(0),
        ).map_err(storage_error)?;
        if recorded_base != current_server_revision {
            // This mutation was staged before a previous local change was ACKed
            // with a newer server revision. Hold it pending for an explicit
            // future rebase/conflict workflow; never silently send or accept.
            return Err(StoreError::InvalidSyntheticInput);
        }
        let first: i64 = tx.query_row(
            "SELECT min(sequence) FROM local_outbox
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity], |row| row.get(0),
        ).map_err(storage_error)?;
        if sequence != first { return Err(StoreError::InvalidSyntheticInput); }
        if conflict {
            tx.execute(
                "UPDATE local_outbox SET state='conflict', conflict_server_revision=?1
                 WHERE profile_id=?2 AND mutation_id=?3",
                params![revision, profile, mutation],
            ).map_err(storage_error)?;
        } else {
            tx.execute(
                "UPDATE local_entities SET server_revision=?1
                 WHERE profile_id=?2 AND entity_type='subject' AND entity_id=?3",
                params![revision, profile, entity],
            ).map_err(storage_error)?;
            tx.execute(
                "DELETE FROM local_outbox WHERE profile_id=?1 AND mutation_id=?2",
                params![profile, mutation],
            ).map_err(storage_error)?;
        }
        tx.commit().map_err(storage_error)
    }

    /// Page contents and cursor commit together. Refuse to overwrite a local
    /// edit that is pending/conflicted. The fail_before_commit flag is ONLY
    /// a deterministic crash/failure fixture for synthetic tests.
    pub fn apply_synthetic_remote_page(
        &mut self, profile: &str, entity: &str, payload: &str,
        cursor: &str, fail_before_commit: bool,
    ) -> Result<()> {
        self.require_v1()?;
        if !synthetic_id(profile) || !synthetic_id(entity) ||
            cursor.is_empty() || cursor.len() > 256 {
            return Err(StoreError::InvalidSyntheticInput);
        }
        self.check_json(payload)?;
        let tx = self.conn.transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage_error)?;
        let local: i64 = tx.query_row(
            "SELECT count(*) FROM local_outbox
             WHERE profile_id=?1 AND entity_type='subject' AND entity_id=?2",
            params![profile, entity], |row| row.get(0),
        ).map_err(storage_error)?;
        if local != 0 { return Err(StoreError::InvalidSyntheticInput); }
        tx.execute(
            "INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,server_revision)
             VALUES (?1,'subject',?2,?3,'synthetic-remote-rev')
             ON CONFLICT(profile_id,entity_type,entity_id)
             DO UPDATE SET payload_json=excluded.payload_json,
                           locally_deleted=0,
                           server_revision=excluded.server_revision",
            params![profile, entity, payload],
        ).map_err(storage_error)?;
        tx.execute(
            "INSERT INTO local_sync_cursors(profile_id,cursor_token) VALUES (?1,?2)
             ON CONFLICT(profile_id) DO UPDATE SET cursor_token=excluded.cursor_token",
            params![profile, cursor],
        ).map_err(storage_error)?;
        if fail_before_commit { return Err(StoreError::StorageFailure); }
        tx.commit().map_err(storage_error)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn test_key(byte: u8) -> StoreKey {
        StoreKey::from_external_key_material([byte; 32]).expect("test key")
    }

    #[test]
    fn explicit_v2_migration_is_atomic_preserves_pending_and_blocks_v1_writes() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-encrypted-v2.db");
        let key = test_key(31);
        {
            let mut store = SyntheticEncryptedStore::open(&path, &key).unwrap();
            store.create_synthetic_profile("synthetic-a").unwrap();
            store.stage_synthetic_subject(
                "synthetic-a", "synthetic-1", "synthetic-m1", r#"{"label":"Fictional"}"#,
            ).unwrap();
            store.migrate_synthetic_v1_to_v2().unwrap();
            validate_schema_v2(&store.conn).unwrap();
            assert_eq!(store.conn.pragma_query_value(
                None, "user_version", |row| row.get::<_, i64>(0),
            ).unwrap(), 2);
            let acknowledged: i64 = store.conn.query_row(
                "SELECT count(*) FROM local_ack_ledger", [], |row| row.get(0),
            ).unwrap();
            let pending: i64 = store.conn.query_row(
                "SELECT count(*) FROM local_outbox", [], |row| row.get(0),
            ).unwrap();
            assert_eq!(acknowledged, 0);
            assert_eq!(pending, 1);
            assert!(matches!(
                store.stage_synthetic_delete("synthetic-a", "synthetic-1", "synthetic-m2"),
                Err(StoreError::UnsupportedSchema)
            ));
            assert!(matches!(
                store.pending_synthetic_ids("synthetic-a", 10),
                Err(StoreError::UnsupportedSchema)
            ));
            assert!(matches!(
                store.migrate_synthetic_v1_to_v2(),
                Err(StoreError::UnsupportedSchema)
            ));
        }
        let header = std::fs::read(&path).unwrap();
        assert_ne!(&header[..16], b"SQLite format 3\0");
        // A v2 archive must never be interpreted as a fresh v1 or silently
        // rewritten without the separately reviewed v2 runtime.
        assert!(matches!(
            SyntheticEncryptedStore::open(&path, &key),
            Err(StoreError::UnsupportedSchema)
        ));
    }

    #[test]
    fn aborting_v2_migration_rolls_back_schema_version_and_ledger() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-aborted-v2.db");
        let key = test_key(32);
        {
            let mut store = SyntheticEncryptedStore::open(&path, &key).unwrap();
            store.create_synthetic_profile("synthetic-a").unwrap();
            store.stage_synthetic_subject(
                "synthetic-a", "synthetic-1", "synthetic-m1", r#"{"label":"Fictional"}"#,
            ).unwrap();
            assert!(matches!(
                store.migrate_synthetic_v1_to_v2_inner(true),
                Err(StoreError::StorageFailure)
            ));
            validate_schema_v1(&store.conn).unwrap();
            let ledger: Option<String> = store.conn.query_row(
                "SELECT name FROM sqlite_master WHERE name='local_ack_ledger'",
                [], |row| row.get(0),
            ).optional().unwrap();
            assert!(ledger.is_none());
            assert_eq!(store.pending_synthetic_ids("synthetic-a", 10).unwrap(),
                ["synthetic-m1"]);
        }
        let reopened = SyntheticEncryptedStore::open(&path, &key).unwrap();
        validate_schema_v1(&reopened.conn).unwrap();
        assert_eq!(reopened.pending_synthetic_ids("synthetic-a", 10).unwrap(),
            ["synthetic-m1"]);
    }

    #[test]
    fn synthetic_migration_rejects_any_nonfictional_profile_rows() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-safety-gate.db");
        let key = test_key(34);
        let mut store = SyntheticEncryptedStore::open(&path, &key).unwrap();
        // Bypass the fixture-only public methods to simulate a foreign file
        // with otherwise valid encrypted SQLCipher v1 tables.
        store.conn.execute(
            "INSERT INTO local_profiles(profile_id) VALUES ('actual-account-id')", [],
        ).unwrap();
        assert!(matches!(
            store.migrate_synthetic_v1_to_v2(),
            Err(StoreError::InvalidSyntheticInput)
        ));
        validate_schema_v1(&store.conn).unwrap();
        let ledger: Option<String> = store.conn.query_row(
            "SELECT name FROM sqlite_master WHERE name='local_ack_ledger'",
            [], |row| row.get(0),
        ).optional().unwrap();
        assert!(ledger.is_none());
    }

    #[test]
    fn migrate_requires_original_v1_catalog_not_just_version_number() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("fictional-tampered-v1.db");
        let key = test_key(33);
        let mut store = SyntheticEncryptedStore::open(&path, &key).unwrap();
        store.conn.execute_batch(
            "DROP INDEX local_outbox_profile_fifo;
             CREATE INDEX local_outbox_profile_fifo ON local_outbox(mutation_id);"
        ).unwrap();
        assert!(matches!(
            store.migrate_synthetic_v1_to_v2(),
            Err(StoreError::UnsupportedSchema)
        ));
        let version: i64 = store.conn.pragma_query_value(
            None, "user_version", |row| row.get(0),
        ).unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn encrypted_round_trip_wrong_key_and_no_plaintext_header() {
        let dir = tempdir().expect("temp directory");
        let path = dir.path().join("only-synthetic.db");
        let key = test_key(7);
        {
            let mut store = SyntheticEncryptedStore::open(&path, &key).expect("new encrypted store");
            store.create_synthetic_profile("synthetic-a").unwrap();
            store.stage_synthetic_subject(
                "synthetic-a", "synthetic-1", "synthetic-m1", r#"{"label":"Fictional"}"#,
            ).unwrap();
        }
        let file = std::fs::read(&path).expect("ciphertext DB");
        assert!(file.len() > 16);
        assert_ne!(&file[..16], b"SQLite format 3\0");
        assert!(SyntheticEncryptedStore::open(&path, &test_key(8)).is_err());
        let store = SyntheticEncryptedStore::open(&path, &key).expect("correct key");
        assert_eq!(store.pending_synthetic_ids("synthetic-a", 10).unwrap(), ["synthetic-m1"]);
    }

    #[test]
    fn rejects_replaced_index_and_unexpected_schema_objects() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let key = test_key(18);
        {
            let store = SyntheticEncryptedStore::open(&path, &key).unwrap();
            store.conn.execute_batch(
                "DROP INDEX local_outbox_profile_fifo;
                 CREATE INDEX local_outbox_profile_fifo ON local_outbox(mutation_id);"
            ).unwrap();
        }
        // The DB still has all four required table names and user_version=1:
        // accepting it would silently weaken FIFO/sync query assumptions.
        assert!(matches!(
            SyntheticEncryptedStore::open(&path, &key),
            Err(StoreError::UnsupportedSchema)
        ));

        let extra_path = dir.path().join("synthetic-extra.db");
        {
            let store = SyntheticEncryptedStore::open(&extra_path, &key).unwrap();
            store.conn.execute_batch("CREATE TABLE surprise(value TEXT) STRICT;").unwrap();
        }
        assert!(matches!(
            SyntheticEncryptedStore::open(&extra_path, &key),
            Err(StoreError::UnsupportedSchema)
        ));
    }

    #[test]
    fn rejects_profile_foreign_key_violations_even_with_valid_schema() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let key = test_key(19);
        {
            let store = SyntheticEncryptedStore::open(&path, &key).unwrap();
            store.create_synthetic_profile("synthetic-a").unwrap();
            store.conn.execute_batch(
                "PRAGMA foreign_keys=OFF;
                 INSERT INTO local_outbox(
                    profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
                 VALUES ('synthetic-a','synthetic-m1','subject','synthetic-missing-entity',
                         'upsert','{}','2026-11-10T19:00:00Z');"
            ).unwrap();
        }
        assert!(matches!(
            SyntheticEncryptedStore::open(&path, &key),
            Err(StoreError::UnsupportedSchema)
        ));
    }

    #[test]
    fn rejects_plaintext_db_and_unsupported_key() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("plaintext-not-permitted.db");
        let db = Connection::open(&path).unwrap();
        db.execute_batch("CREATE TABLE not_encrypted(value TEXT);").unwrap();
        drop(db);
        assert!(SyntheticEncryptedStore::open(&path, &test_key(5)).is_err());
        assert!(StoreKey::from_external_key_material([0u8; 32]).is_err());
    }

    #[test]
    fn altered_synthetic_ciphertext_is_rejected_before_schema_use() {
        use std::io::{Read, Seek, SeekFrom, Write};
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic-ciphertext.db");
        let key = test_key(23);
        {
            let mut store = SyntheticEncryptedStore::open(&path, &key).unwrap();
            store.create_synthetic_profile("synthetic-a").unwrap();
            store.stage_synthetic_subject("synthetic-a", "synthetic-1",
                "synthetic-m1", r#"{"label":"Fictional"}"#).unwrap();
        }
        // Corrupt one byte in an encrypted *temporary synthetic* page.
        // No real account data, production database or credential is involved.
        let mut file = std::fs::OpenOptions::new().read(true).write(true).open(&path).unwrap();
        assert!(file.metadata().unwrap().len() > 512);
        file.seek(SeekFrom::Start(256)).unwrap();
        let mut before = [0_u8; 1];
        file.read_exact(&mut before).unwrap();
        file.seek(SeekFrom::Start(256)).unwrap();
        file.write_all(&[before[0] ^ 0xFF]).unwrap();
        file.sync_all().unwrap();
        drop(file);
        assert!(SyntheticEncryptedStore::open(&path, &key).is_err());
    }

    #[test]
    fn duplicate_mutation_cannot_commit_a_second_entity_edit() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(9)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject(
            "synthetic-a", "synthetic-1", "synthetic-m1", r#"{"label":"Original"}"#,
        ).unwrap();
        assert!(store.stage_synthetic_subject(
            "synthetic-a", "synthetic-1", "synthetic-m1", r#"{"label":"Overwritten"}"#,
        ).is_err());
        let value: String = store.conn.query_row(
            "SELECT payload_json FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-1'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(value, r#"{"label":"Original"}"#);
    }

    #[test]
    fn conflicts_block_same_entity_but_not_other_entities() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(10)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        for (entity, mutation) in [
            ("synthetic-1", "synthetic-m1"),
            ("synthetic-1", "synthetic-m2"),
            ("synthetic-2", "synthetic-m3"),
        ] {
            store.stage_synthetic_subject(
                "synthetic-a", entity, mutation, r#"{"label":"Fictional"}"#,
            ).unwrap();
        }
        assert_eq!(store.pending_synthetic_ids("synthetic-a", 50).unwrap(), ["synthetic-m1", "synthetic-m3"]);
        store.apply_synthetic_receipt("synthetic-a", "synthetic-m1", "rev-1", true).unwrap();
        assert_eq!(store.pending_synthetic_ids("synthetic-a", 50).unwrap(), ["synthetic-m3"]);
        assert!(store.apply_synthetic_receipt("synthetic-a", "synthetic-m2", "rev-2", false).is_err());
    }

    #[test]
    fn deletion_keeps_tombstone_before_and_after_ack() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(12)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_delete("synthetic-a", "synthetic-1", "synthetic-del").unwrap();
        assert_eq!(store.pending_synthetic_ids("synthetic-a", 10).unwrap(), ["synthetic-del"]);
        store.apply_synthetic_receipt("synthetic-a", "synthetic-del", "rev-10", false).unwrap();
        let locally_deleted: i64 = store.conn.query_row(
            "SELECT locally_deleted FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-1'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(locally_deleted, 1);
        assert!(store.pending_synthetic_ids("synthetic-a", 10).unwrap().is_empty());
    }

    #[test]
    fn new_edit_can_clear_an_existing_synthetic_tombstone() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(14)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_delete("synthetic-a", "synthetic-1", "synthetic-del").unwrap();
        store.stage_synthetic_subject("synthetic-a", "synthetic-1", "synthetic-upsert",
            r#"{"label":"Back"}"#).unwrap();
        let locally_deleted: i64 = store.conn.query_row(
            "SELECT locally_deleted FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-1'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(locally_deleted, 0);
        assert_eq!(store.pending_synthetic_ids("synthetic-a", 10).unwrap(), ["synthetic-del"]);
        store.apply_synthetic_receipt("synthetic-a", "synthetic-del", "rev-del", true).unwrap();
        assert!(store.pending_synthetic_ids("synthetic-a", 10).unwrap().is_empty());
    }

    #[test]
    fn identical_mutation_ids_are_isolated_between_profiles() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(13)).unwrap();
        for profile in ["synthetic-a", "synthetic-b"] {
            store.create_synthetic_profile(profile).unwrap();
            store.stage_synthetic_subject(profile, "synthetic-1",
                "synthetic-m1", r#"{"label":"Fictional"}"#).unwrap();
        }
        store.apply_synthetic_receipt("synthetic-b", "synthetic-m1", "rev-b", false).unwrap();
        assert_eq!(store.pending_synthetic_ids("synthetic-a", 10).unwrap(), ["synthetic-m1"]);
        assert!(store.pending_synthetic_ids("synthetic-b", 10).unwrap().is_empty());
        let a_revision: Option<String> = store.conn.query_row(
            "SELECT server_revision FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-1'",
            [], |row| row.get(0),
        ).unwrap();
        assert!(a_revision.is_none());
    }

    #[test]
    fn later_offline_edit_waits_for_explicit_rebase_after_first_ack() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(25)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject("synthetic-a","synthetic-1","synthetic-m1",
            r#"{"label":"first"}"#).unwrap();
        store.stage_synthetic_subject("synthetic-a","synthetic-1","synthetic-m2",
            r#"{"label":"second"}"#).unwrap();
        store.stage_synthetic_subject("synthetic-a","synthetic-2","synthetic-m3",
            r#"{"label":"unrelated"}"#).unwrap();
        assert_eq!(store.pending_synthetic_ids("synthetic-a",50).unwrap(),
                   ["synthetic-m1","synthetic-m3"]);
        store.apply_synthetic_receipt("synthetic-a","synthetic-m1","rev-new",false).unwrap();
        // The second edit was based on the old (null) revision and is still
        // durable locally, but MUST NOT be sent without an approved rebasing step.
        assert_eq!(store.pending_synthetic_ids("synthetic-a",50).unwrap(),["synthetic-m3"]);
        assert!(store.apply_synthetic_receipt("synthetic-a","synthetic-m2","rev-newer",false).is_err());
        let stale: (Option<String>, String) = store.conn.query_row(
            "SELECT base_server_revision,state FROM local_outbox
             WHERE mutation_id='synthetic-m2'",[],|row|Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(stale,(None,"pending".to_owned()));
        drop(store);
        let reopened = SyntheticEncryptedStore::open(&path,&test_key(25)).unwrap();
        assert_eq!(reopened.pending_synthetic_ids("synthetic-a",50).unwrap(),["synthetic-m3"]);
    }

    #[test]
    fn fresh_edit_after_ack_captures_new_server_base_revision() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(26)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject("synthetic-a","synthetic-1","synthetic-m1",r#"{"a":1}"#).unwrap();
        store.apply_synthetic_receipt("synthetic-a","synthetic-m1","rev-1",false).unwrap();
        store.stage_synthetic_subject("synthetic-a","synthetic-1","synthetic-m2",r#"{"a":2}"#).unwrap();
        assert_eq!(store.pending_synthetic_ids("synthetic-a",50).unwrap(),["synthetic-m2"]);
        let recorded: String = store.conn.query_row(
            "SELECT base_server_revision FROM local_outbox WHERE mutation_id='synthetic-m2'",
            [],|row|row.get(0),
        ).unwrap();
        assert_eq!(recorded,"rev-1");
    }

    #[test]
    fn remote_upsert_clears_acknowledged_local_deletion_tombstone() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path,&test_key(27)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_delete("synthetic-a","synthetic-1","synthetic-del").unwrap();
        store.apply_synthetic_receipt("synthetic-a","synthetic-del","rev-del",false).unwrap();
        store.apply_synthetic_remote_page("synthetic-a","synthetic-1",r#"{"a":3}"#,
            "cursor-after-delete",false).unwrap();
        let row: (i64,String) = store.conn.query_row(
            "SELECT locally_deleted,payload_json FROM local_entities
             WHERE profile_id='synthetic-a' AND entity_id='synthetic-1'",
            [],|row|Ok((row.get(0)?,row.get(1)?)),
        ).unwrap();
        assert_eq!(row,(0,r#"{"a":3}"#.to_owned()));
    }

    #[test]
    fn failed_pull_does_not_advance_cursor_or_overwrite_local_change() {
        let dir = tempdir().unwrap();
        let path = dir.path().join("synthetic.db");
        let mut store = SyntheticEncryptedStore::open(&path, &test_key(11)).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.stage_synthetic_subject("synthetic-a", "synthetic-1", "synthetic-m1", r#"{"a":1}"#).unwrap();
        assert!(store.apply_synthetic_remote_page(
            "synthetic-a", "synthetic-1", r#"{"a":2}"#, "cursor1", false,
        ).is_err());
        assert!(store.apply_synthetic_remote_page(
            "synthetic-a", "synthetic-2", r#"{"a":2}"#, "cursor2", true,
        ).is_err());
        let cursor: Option<String> = store.conn.query_row(
            "SELECT cursor_token FROM local_sync_cursors WHERE profile_id='synthetic-a'",
            [], |r| r.get(0),
        ).optional().unwrap();
        assert!(cursor.is_none());
        store.apply_synthetic_remote_page(
            "synthetic-a", "synthetic-2", r#"{"a":2}"#, "cursor2", false,
        ).unwrap();
        let cursor: String = store.conn.query_row(
            "SELECT cursor_token FROM local_sync_cursors WHERE profile_id='synthetic-a'",
            [], |r| r.get(0),
        ).unwrap();
        assert_eq!(cursor, "cursor2");
    }
}
