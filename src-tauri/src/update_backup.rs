//! Completed, integrity-checked local snapshots. Never copies credential-store keys.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{fs, io::{self, Read, Write}, path::{Path, PathBuf}, time::{SystemTime, UNIX_EPOCH}};

#[derive(Serialize, Deserialize)]
struct Entry { path: String, size: u64, sha256: String }
#[derive(Serialize, Deserialize)]
struct Manifest { format: u8, files: Vec<Entry> }

fn safe_metadata(path: &Path) -> io::Result<Option<fs::Metadata>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            #[cfg(windows)]
            { use std::os::windows::fs::MetadataExt;
              if metadata.file_attributes() & 0x400 != 0 { return Err(io::ErrorKind::InvalidData.into()); } }
            if metadata.file_type().is_symlink() { return Err(io::ErrorKind::InvalidData.into()); }
            Ok(Some(metadata))
        },
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e),
    }
}
fn hash(path: &Path) -> io::Result<(u64, String)> {
    let mut file = fs::File::open(path)?;
    let mut digest = Sha256::new();
    let mut size = 0u64;
    let mut buf = [0u8; 65536];
    loop { let n = file.read(&mut buf)?; if n == 0 { break; } digest.update(&buf[..n]); size += n as u64; }
    Ok((size, format!("{:x}", digest.finalize())))
}
fn copy_tree(source: &Path, dest: &Path, relative: &str, entries: &mut Vec<Entry>) -> io::Result<()> {
    let Some(meta) = safe_metadata(source)? else { return Ok(()) };
    if meta.is_dir() {
        fs::create_dir_all(dest)?;
        for item in fs::read_dir(source)? {
            let item = item?;
            let name = item.file_name().into_string().map_err(|_| io::ErrorKind::InvalidData)?;
            if name.is_empty() || name == "." || name == ".." || name.contains(['/', '\\', ':', '\n', '\r']) { return Err(io::ErrorKind::InvalidData.into()); }
            copy_tree(&item.path(), &dest.join(&name), &format!("{relative}/{name}"), entries)?;
        }
    } else if meta.is_file() {
        if entries.len() >= 100_000 { return Err(io::ErrorKind::InvalidData.into()); }
        let mut input = fs::File::open(source)?;
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(dest)?;
        io::copy(&mut input, &mut output)?;
        output.sync_all()?;
        drop(output);
        let original = hash(source)?;
        let copied = hash(dest)?;
        if original != copied { return Err(io::ErrorKind::InvalidData.into()); }
        entries.push(Entry { path: relative.to_string(), size: copied.0, sha256: copied.1 });
    } else { return Err(io::ErrorKind::InvalidData.into()); }
    Ok(())
}

/// Incomplete snapshots retain the .pending prefix and are never eligible for restoration.
pub fn snapshot(folder: &Path, resources: Option<&Path>) -> io::Result<PathBuf> {
    if safe_metadata(folder)?.is_none() { fs::create_dir_all(folder)?; }
    let backups = folder.join("update-backups");
    if safe_metadata(&backups)?.is_none() { fs::create_dir(&backups)?; }
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).map_err(|_| io::ErrorKind::InvalidData)?.as_nanos();
    let id = format!("{stamp}-{}", std::process::id());
    let pending = backups.join(format!(".pending-{id}"));
    let complete = backups.join(format!("before-{id}"));
    fs::create_dir(&pending)?;
    let mut files = Vec::new();
    for name in ["charts-v2.vsarchive", "private-chart-photos-v1", "ephemeris.json"] {
        copy_tree(&folder.join(name), &pending.join(name), name, &mut files)?;
    }
    if let Some(root) = resources {
        if !safe_metadata(root)?.is_some_and(|metadata| metadata.is_dir()) { return Err(io::ErrorKind::InvalidData.into()); }
        // Installer-owned datasets can be replaced by NSIS; keep the original bytes locally.
        fs::create_dir(pending.join("resources"))?;
        for name in ["places", "ephemeris"] {
            copy_tree(&root.join(name), &pending.join("resources").join(name), &format!("resources/{name}"), &mut files)?;
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    let mut manifest = fs::OpenOptions::new().write(true).create_new(true).open(pending.join("manifest.json"))?;
    serde_json::to_writer(&mut manifest, &Manifest { format: 1, files }).map_err(io::Error::other)?;
    manifest.write_all(b"\n")?;
    manifest.sync_all()?;
    drop(manifest);
    fs::rename(&pending, &complete)?;
    Ok(complete)
}

/// When an installer no longer contains a dataset, reuse only a verified complete snapshot.
pub fn preserved_resource(folder: &Path, relative: &str) -> Option<PathBuf> {
    use std::path::Component;
    let rel = Path::new(relative);
    if !rel.components().all(|c| matches!(c, Component::Normal(_))) { return None; }
    let backups = folder.join("update-backups");
    if !safe_metadata(&backups).ok()??.is_dir() { return None; }
    let mut candidates: Vec<_> = fs::read_dir(backups).ok()?.filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().starts_with("before-"))
        .map(|entry| entry.path()).collect();
    candidates.sort(); candidates.reverse();
    let prefix = format!("resources/{}", relative.replace('\\', "/"));
    for candidate in candidates {
        if !safe_metadata(&candidate).ok().flatten().is_some_and(|m| m.is_dir()) { continue; }
        let manifest_path = candidate.join("manifest.json");
        if !safe_metadata(&manifest_path).ok().flatten().is_some_and(|m| m.is_file() && m.len() <= 16 * 1024 * 1024) { continue; }
        let Ok(manifest) = fs::read(&manifest_path).and_then(|data| serde_json::from_slice::<Manifest>(&data).map_err(io::Error::other)) else { continue };
        if manifest.format != 1 { continue; }
        let wanted: Vec<_> = manifest.files.iter().filter(|entry| entry.path == prefix || entry.path.starts_with(&(prefix.clone() + "/"))).collect();
        if wanted.is_empty() { continue; }
        let valid = wanted.iter().all(|entry| {
            let path = Path::new(&entry.path);
            if !path.components().all(|c| matches!(c, Component::Normal(_))) { return false; }
            let mut current = candidate.clone();
            for component in path.components() {
                current.push(component.as_os_str());
                if safe_metadata(&current).ok().flatten().is_none() { return false; }
            }
            hash(&current).is_ok_and(|actual| actual == (entry.size, entry.sha256.clone()))
        });
        if valid { return Some(candidate.join("resources").join(rel)); }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn snapshots_archive_photos_and_installer_resources_with_manifest() {
        let temp = tempfile::tempdir().unwrap();
        let data = temp.path().join("data"); let resources = temp.path().join("resources");
        fs::create_dir_all(data.join("private-chart-photos-v1")).unwrap();
        fs::create_dir_all(resources.join("ephemeris")).unwrap();
        fs::write(data.join("charts-v2.vsarchive"), b"encrypted").unwrap();
        fs::write(data.join("private-chart-photos-v1/a.vphoto"), b"photo").unwrap();
        fs::write(resources.join("ephemeris/de441-slice.eph"), b"dataset").unwrap();
        let backup = snapshot(&data, Some(&resources)).unwrap();
        let manifest: serde_json::Value = serde_json::from_slice(&fs::read(backup.join("manifest.json")).unwrap()).unwrap();
        assert_eq!(manifest["files"].as_array().unwrap().len(), 3);
        assert_eq!(fs::read(backup.join("resources/ephemeris/de441-slice.eph")).unwrap(), b"dataset");
        assert_eq!(preserved_resource(&data, "ephemeris/de441-slice.eph"), Some(backup.join("resources/ephemeris/de441-slice.eph")));
        fs::write(backup.join("resources/ephemeris/de441-slice.eph"), b"tampered").unwrap();
        assert_eq!(preserved_resource(&data, "ephemeris/de441-slice.eph"), None);
        assert_eq!(fs::read(data.join("charts-v2.vsarchive")).unwrap(), b"encrypted");
    }
    #[test]
    fn failed_backup_does_not_change_original() {
        let temp = tempfile::tempdir().unwrap();
        fs::write(temp.path().join("charts-v2.vsarchive"), b"encrypted").unwrap();
        fs::write(temp.path().join("update-backups"), b"not a directory").unwrap();
        assert!(snapshot(temp.path(), None).is_err());
        assert_eq!(fs::read(temp.path().join("charts-v2.vsarchive")).unwrap(), b"encrypted");
    }
}
