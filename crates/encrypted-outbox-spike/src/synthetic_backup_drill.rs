//! TEST-ONLY v3 SQLCipher closed-file copy/restore validation.
//!
//! This module has NO production API, auth, Tauri command or actual user data.
//! A valid SQLite schema alone cannot prove ciphertext or a restorable backup.
//! These tests require a real SQLCipher native toolchain and MUST NOT report
//! pass until the crate was compiled and tests executed on Windows/MSVC.
//!
//! Source must be CLOSED and quiescent before copying. Never copy a live WAL,
//! handle a real user profile, or infer that this is a production backup plan.

use crate::ack_fingerprint::{fingerprint, AckRequest};
use crate::{StoreError, StoreKey, SyntheticEncryptedStore, FIXTURE_TIME};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use tempfile::{tempdir, NamedTempFile};

const MAX_SYNTHETIC_BACKUP_BYTES: u64 = 16 * 1024 * 1024;
const SQLITE_PLAINTEXT_HEADER: &[u8; 16] = b"SQLite format 3\0";
const DECISION_TIME: &str = "2026-11-11T21:30:00Z";

fn key() -> StoreKey {
    StoreKey::from_external_key_material([113_u8; 32]).unwrap()
}
fn other_key() -> StoreKey {
    StoreKey::from_external_key_material([114_u8; 32]).unwrap()
}
fn sample() -> AckRequest {
    AckRequest {
        profile: "synthetic-a".into(),
        mutation: "synthetic-old".into(),
        entity_type: "subject".into(),
        entity: "synthetic-e1".into(),
        operation: "upsert".into(),
        base_revision: None,
        created_at: FIXTURE_TIME.into(),
        payload: Some(serde_json::json!({"label":"Fictional"})),
    }
}
fn seed_closed_v3(path: &Path, key: &StoreKey) {
    {
        let mut store = SyntheticEncryptedStore::open(path, key).unwrap();
        store.create_synthetic_profile("synthetic-a").unwrap();
        store.migrate_synthetic_v1_to_v2().unwrap();
        let request = sample();
        let hash = fingerprint(&request).unwrap();
        store.stage_synthetic_v2_mutation(&request, false).unwrap();
        store.record_synthetic_v2_conflict(
            "synthetic-a", "synthetic-old", &hash, "rev-remote", false,
        ).unwrap();
        store.migrate_synthetic_v2_to_v3().unwrap();
        store.keep_synthetic_v3_local_conflict(
            "synthetic-a", "synthetic-old", "synthetic-new",
            &hash, DECISION_TIME, false,
        ).unwrap();
        assert_eq!(
            store.audit_synthetic_v3_readonly().unwrap().decision_rows,
            1
        );
    } // All SQLCipher connection handles dropped here before file copy.
}
fn sidecar(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_os_string();
    name.push(suffix);
    PathBuf::from(name)
}
fn verify_ciphertext_prefix(path: &Path) -> io::Result<()> {
    let mut file = File::open(path)?;
    let mut prefix = [0u8; 16];
    file.read_exact(&mut prefix)?;
    if &prefix == SQLITE_PLAINTEXT_HEADER {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData, "synthetic source is plaintext SQLite",
        ));
    }
    Ok(())
}

/// Internal test helper, not public backup code: staged copy, verify a
/// synthetic snapshot with the REAL SQLCipher v3 reader, atomic no-clobber
/// publish. Do not call with an open source connection or any real account.
/// No backup key is exported. It copies encrypted pages, never SQL payloads.
fn copy_closed_synthetic_v3(
    source: &Path,
    destination: &Path,
    key: &StoreKey,
    inject_failure_before_publish: bool,
) -> Result<(), StoreError> {
    if source == destination {
        return Err(StoreError::InvalidSyntheticInput);
    }
    let meta = fs::symlink_metadata(source)
        .map_err(|_| StoreError::StorageFailure)?;
    if !meta.is_file() || meta.file_type().is_symlink()
        || meta.len() < 16 || meta.len() > MAX_SYNTHETIC_BACKUP_BYTES
    {
        return Err(StoreError::InvalidSyntheticInput);
    }
    // The spike explicitly uses DELETE journaling. No sidecar can be safely
    // ignored if left behind after a failed/in-progress write.
    if ["-wal", "-shm", "-journal"]
        .iter()
        .any(|suffix| sidecar(source, suffix).exists())
    {
        return Err(StoreError::InvalidSyntheticInput);
    }
    verify_ciphertext_prefix(source)
        .map_err(|_| StoreError::CipherMissingOrInvalidKey)?;
    {
        let mut current = SyntheticEncryptedStore::open_synthetic_v3(source, key)?;
        current.audit_synthetic_v3_readonly()?;
    }
    // No production race-free lock implementation exists. All tests are
    // single-process and explicitly close every writer before this point.
    let parent = destination.parent().ok_or(StoreError::InvalidSyntheticInput)?;
    if !parent.is_dir() {
        return Err(StoreError::InvalidSyntheticInput);
    }
    let mut stage = NamedTempFile::new_in(parent)
        .map_err(|_| StoreError::StorageFailure)?;
    {
        let mut input = File::open(source).map_err(|_| StoreError::StorageFailure)?;
        let copied = io::copy(&mut input, stage.as_file_mut())
            .map_err(|_| StoreError::StorageFailure)?;
        if copied != meta.len() {
            return Err(StoreError::StorageFailure);
        }
    }
    stage.as_file_mut().flush().map_err(|_| StoreError::StorageFailure)?;
    stage.as_file_mut().sync_all().map_err(|_| StoreError::StorageFailure)?;
    let staged_path = stage.into_temp_path(); // closes handle (Windows).
    if inject_failure_before_publish {
        // TempPath removes the staged file when it drops.
        return Err(StoreError::StorageFailure);
    }
    {
        let mut verified = SyntheticEncryptedStore::open_synthetic_v3(
            staged_path.as_ref(), key,
        )?;
        verified.audit_synthetic_v3_readonly()?;
    }
    // Atomic, no-clobber placement from SAME destination directory.
    // An existing user-selected path is never overwritten.
    staged_path.persist_noclobber(destination)
        .map_err(|_| StoreError::StorageFailure)?;
    Ok(())
}

#[test]
fn offline_encrypted_copy_preserves_decision_and_reopens_with_same_key() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("fictional-source.db");
    let destination = dir.path().join("fictional-copy.db");
    let key = key();
    seed_closed_v3(&source, &key);
    verify_ciphertext_prefix(&source).unwrap();
    let original_bytes = fs::read(&source).unwrap();
    assert_ne!(&original_bytes[..16], SQLITE_PLAINTEXT_HEADER);
    copy_closed_synthetic_v3(&source, &destination, &key, false).unwrap();
    assert_eq!(fs::read(&destination).unwrap(), original_bytes);
    let mut restored = SyntheticEncryptedStore::open_synthetic_v3(&destination, &key).unwrap();
    let summary = restored.audit_synthetic_v3_readonly().unwrap();
    assert_eq!(summary.outbox_rows, 1);
    assert_eq!(summary.acknowledgements, 0);
    assert_eq!(summary.decision_rows, 1);
}

#[test]
fn restored_copy_rejects_wrong_key_and_wrong_schema_version() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("fictional-source.db");
    let destination = dir.path().join("fictional-copy.db");
    let key = key();
    seed_closed_v3(&source, &key);
    copy_closed_synthetic_v3(&source, &destination, &key, false).unwrap();
    assert!(SyntheticEncryptedStore::open_synthetic_v3(&destination, &other_key()).is_err());
    assert!(SyntheticEncryptedStore::open_synthetic_v2(&destination, &key).is_err());
    assert!(SyntheticEncryptedStore::open(&destination, &key).is_err());
    assert!(SyntheticEncryptedStore::open_synthetic_v3(&source, &key).is_ok());
}

#[test]
fn backup_never_overwrites_existing_destination_or_mutates_source() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("fictional-source.db");
    let destination = dir.path().join("existing-sentinel.db");
    let key = key();
    seed_closed_v3(&source, &key);
    let before = fs::read(&source).unwrap();
    fs::write(&destination, b"existing fictional destination must survive").unwrap();
    assert!(copy_closed_synthetic_v3(&source, &destination, &key, false).is_err());
    assert_eq!(fs::read(&destination).unwrap(), b"existing fictional destination must survive");
    let mut existing = SyntheticEncryptedStore::open_synthetic_v3(&source, &key).unwrap();
    assert_eq!(existing.audit_synthetic_v3_readonly().unwrap().decision_rows, 1);
    drop(existing);
    assert_eq!(fs::read(&source).unwrap(), before);
}

#[test]
fn interrupted_staged_copy_removes_partial_and_preserves_source() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("fictional-source.db");
    let destination = dir.path().join("interrupted-copy.db");
    let key = key();
    seed_closed_v3(&source, &key);
    let original = fs::read(&source).unwrap();
    assert!(copy_closed_synthetic_v3(&source, &destination, &key, true).is_err());
    assert!(!destination.exists());
    // The staged tempfile should be removed when the failure returned.
    assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
    assert_eq!(fs::read(&source).unwrap(), original);
    let mut still_valid = SyntheticEncryptedStore::open_synthetic_v3(&source, &key).unwrap();
    assert_eq!(still_valid.audit_synthetic_v3_readonly().unwrap().outbox_rows, 1);
}

#[test]
fn truncated_or_modified_copy_never_opens_as_valid_sqlcipher_v3() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("fictional-source.db");
    let truncated = dir.path().join("truncated.db");
    let damaged = dir.path().join("tampered.db");
    let key = key();
    seed_closed_v3(&source, &key);
    let full = fs::read(&source).unwrap();
    assert!(full.len() > 512);
    fs::write(&truncated, &full[..full.len()/2]).unwrap();
    let mut bad = full.clone();
    bad[256] ^= 0x55;
    fs::write(&damaged, bad).unwrap();
    assert!(SyntheticEncryptedStore::open_synthetic_v3(&truncated, &key).is_err());
    assert!(SyntheticEncryptedStore::open_synthetic_v3(&damaged, &key).is_err());
    assert!(SyntheticEncryptedStore::open_synthetic_v3(&source, &key).is_ok());
}

#[test]
fn hot_journal_sidecar_and_symlinked_source_are_refused() {
    let dir = tempdir().unwrap();
    let source = dir.path().join("fictional-source.db");
    let destination = dir.path().join("fictional-copy.db");
    let key = key();
    seed_closed_v3(&source, &key);
    let journal = sidecar(&source, "-journal");
    fs::write(&journal, b"fictional abandoned journal").unwrap();
    assert!(copy_closed_synthetic_v3(&source, &destination, &key, false).is_err());
    assert!(!destination.exists());
    fs::remove_file(journal).unwrap();
    // Symlink rejection is tested where supported without introducing
    // Windows-only dependencies in the shared Rust crate.
    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;
        let alias = dir.path().join("fictional-alias.db");
        symlink(&source, &alias).unwrap();
        assert!(copy_closed_synthetic_v3(&alias, &destination, &key, false).is_err());
        assert!(!destination.exists());
    }
}
