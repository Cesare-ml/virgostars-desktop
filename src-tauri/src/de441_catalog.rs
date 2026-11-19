//! Candidate trust boundary for a pinned DE441 release catalog.
//! No networking, file installation, or IPC is enabled by this module.
#![allow(dead_code)]

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use virgostars_ephemeris_core::calendar::{Calendar, CalendarDateTime, TimeScale};

const MAX_BYTES: usize = 512 * 1024;
const MAX_ASSET: u64 = 2 * 1024 * 1024 * 1024;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Catalog {
    schema: String,
    release_tag: String,
    source_sha256: String,
    packs: Vec<Pack>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Pack {
    id: String,
    filename: String,
    first_year: i32,
    last_year: i32,
    start_jd_tdb: f64,
    end_jd_tdb: f64,
    required: bool,
    bytes: u64,
    sha256: String,
}

fn safe_component(s: &str, max: usize) -> bool {
    !s.is_empty()
        && s.len() <= max
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_' || b == b'.')
        && !s.contains("..")
        && !s.starts_with('.')
}

fn digest(s: &str) -> bool {
    s.len() == 64
        && s.bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn year_start(year: i32) -> Result<f64, &'static str> {
    CalendarDateTime {
        year,
        month: 1,
        day: 1,
        hour: 0,
        minute: 0,
        second: 0.0,
        scale: TimeScale::Tdb,
    }
    .to_julian_date(Calendar::ProlepticGregorian)
    .and_then(|d| d.to_de441_epoch())
    .map(|d| d.0)
    .map_err(|_| "invalid_year")
}

/// The expected digest must be embedded in a separately authenticated app
/// update, never taken from this catalog or its HTTP response.
pub(crate) fn parse_pinned(
    bytes: &[u8],
    trusted_sha256: &[u8; 32],
) -> Result<Catalog, &'static str> {
    if bytes.is_empty() || bytes.len() > MAX_BYTES || trusted_sha256.iter().all(|b| *b == 0) {
        return Err("invalid_catalog");
    }
    if Sha256::digest(bytes).as_slice() != trusted_sha256 {
        return Err("unauthenticated_catalog");
    }
    let catalog: Catalog = serde_json::from_slice(bytes).map_err(|_| "invalid_catalog")?;
    if catalog.schema != "virgostars.de441.release-catalog.v1"
        || !safe_component(&catalog.release_tag, 100)
        || !digest(&catalog.source_sha256)
        || catalog.packs.is_empty()
        || catalog.packs.len() > 256
    {
        return Err("invalid_catalog");
    }
    let mut ids = HashSet::new();
    let mut filenames = HashSet::new();
    let mut previous_end = None;
    let mut required = 0;
    for pack in &catalog.packs {
        if !safe_component(&pack.id, 80)
            || !safe_component(&pack.filename, 128)
            || !pack.filename.ends_with(".eph")
            || !ids.insert(&pack.id)
            || !filenames.insert(&pack.filename)
            || !digest(&pack.sha256)
            || pack.bytes == 0
            || pack.bytes >= MAX_ASSET
            || pack.first_year > pack.last_year
            || pack.last_year >= 20000
        {
            return Err("invalid_pack");
        }
        if pack.start_jd_tdb != year_start(pack.first_year)?
            || pack.end_jd_tdb != year_start(pack.last_year + 1)?
            || previous_end.is_some_and(|end| end != pack.start_jd_tdb)
        {
            return Err("invalid_boundaries");
        }
        if pack.required {
            required += 1;
            if (pack.first_year, pack.last_year) != (1000, 2200) {
                return Err("invalid_base");
            }
        }
        previous_end = Some(pack.end_jd_tdb);
    }
    if required != 1 {
        return Err("invalid_base");
    }
    Ok(catalog)
}

impl Catalog {
    /// The catalog cannot supply a host, scheme, path or query component.
    pub(crate) fn asset_url(&self, pack: &Pack) -> String {
        format!(
            "https://github.com/Cesare-ml/VirgoStars-Ephemeris/releases/download/{}/{}",
            self.release_tag, pack.filename
        )
    }

    pub(crate) fn pack(&self, id: &str) -> Option<&Pack> {
        self.packs.iter().find(|pack| pack.id == id)
    }
}

/// A bounded persistent staging file; it is not an installed pack.
/// The caller must serialize transfers for this directory and provide an
/// app-owned directory. Activation requires a separate contiguity gate.
pub(crate) struct PendingPack {
    file: File,
    path: PathBuf,
    expected_size: u64,
    expected_sha256: String,
    offset: u64,
}

impl PendingPack {
    pub(crate) fn open(
        directory: &Path,
        catalog: &Catalog,
        id: &str,
    ) -> Result<Self, &'static str> {
        let pack = catalog.pack(id).ok_or("unknown_pack")?;
        fs::create_dir_all(directory).map_err(|_| "storage_unavailable")?;
        let path = directory.join(format!(".{}.part", pack.filename));
        let file = match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                let meta = fs::symlink_metadata(&path).map_err(|_| "storage_unavailable")?;
                if !meta.file_type().is_file() {
                    return Err("invalid_partial");
                }
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(&path)
                    .map_err(|_| "storage_unavailable")?
            }
            Err(_) => return Err("storage_unavailable"),
        };
        let offset = file.metadata().map_err(|_| "storage_unavailable")?.len();
        if offset > pack.bytes {
            return Err("invalid_partial");
        }
        Ok(Self {
            file,
            path,
            expected_size: pack.bytes,
            expected_sha256: pack.sha256.clone(),
            offset,
        })
    }

    pub(crate) fn offset(&self) -> u64 {
        self.offset
    }

    pub(crate) fn append(&mut self, offset: u64, chunk: &[u8]) -> Result<u64, &'static str> {
        if chunk.is_empty()
            || chunk.len() > 1024 * 1024
            || offset != self.offset
            || self
                .offset
                .checked_add(chunk.len() as u64)
                .is_none_or(|n| n > self.expected_size)
        {
            return Err("invalid_chunk");
        }
        self.file
            .seek(SeekFrom::Start(self.offset))
            .map_err(|_| "storage_write_failed")?;
        self.file
            .write_all(chunk)
            .map_err(|_| "storage_write_failed")?;
        self.offset += chunk.len() as u64;
        Ok(self.offset)
    }

    /// Flush and hash the entire staging file, including previously saved
    /// bytes. A mismatch never marks a pack installed.
    pub(crate) fn verify(mut self) -> Result<PathBuf, &'static str> {
        if self.offset != self.expected_size {
            return Err("incomplete");
        }
        self.file
            .flush()
            .and_then(|_| self.file.sync_all())
            .map_err(|_| "storage_write_failed")?;
        self.file
            .seek(SeekFrom::Start(0))
            .map_err(|_| "storage_read_failed")?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let count = self
                .file
                .read(&mut buffer)
                .map_err(|_| "storage_read_failed")?;
            if count == 0 {
                break;
            }
            total = total.checked_add(count as u64).ok_or("invalid_partial")?;
            if total > self.expected_size {
                return Err("invalid_partial");
            }
            hasher.update(&buffer[..count]);
        }
        if total != self.expected_size
            || self
                .file
                .metadata()
                .map_err(|_| "storage_read_failed")?
                .len()
                != total
        {
            return Err("invalid_partial");
        }
        if format!("{:x}", hasher.finalize()) != self.expected_sha256 {
            return Err("checksum_mismatch");
        }
        Ok(self.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn catalog() -> serde_json::Value {
        serde_json::json!({
          "schema":"virgostars.de441.release-catalog.v1", "releaseTag":"data-v1",
          "sourceSha256":"a".repeat(64),
          "packs":[
            {"id":"past", "filename":"past.eph", "firstYear":800, "lastYear":999,
             "startJdTdb":2013253.5, "endJdTdb":2086302.5, "required":false, "bytes":42, "sha256":"b".repeat(64)},
            {"id":"base", "filename":"base.eph", "firstYear":1000, "lastYear":2200,
             "startJdTdb":2086302.5, "endJdTdb":2524958.5, "required":true, "bytes":42, "sha256":"c".repeat(64)},
            {"id":"future", "filename":"future.eph", "firstYear":2201, "lastYear":2400,
             "startJdTdb":2524958.5, "endJdTdb":2598007.5, "required":false, "bytes":42, "sha256":"d".repeat(64)}
          ]
        })
    }

    fn parse(value: &serde_json::Value) -> Result<Catalog, &'static str> {
        let bytes = serde_json::to_vec(value).unwrap();
        parse_pinned(&bytes, &Sha256::digest(&bytes).into())
    }

    #[test]
    fn exact_pin_and_restricted_asset_url() {
        let data = serde_json::to_vec(&catalog()).unwrap();
        let pin: [u8; 32] = Sha256::digest(&data).into();
        let cat = parse_pinned(&data, &pin).unwrap();
        assert_eq!(
            cat.asset_url(&cat.packs[0]),
            "https://github.com/Cesare-ml/VirgoStars-Ephemeris/releases/download/data-v1/past.eph"
        );
        let mut altered = data.clone();
        altered.push(b' ');
        assert_eq!(
            parse_pinned(&altered, &pin).unwrap_err(),
            "unauthenticated_catalog"
        );
        assert!(parse_pinned(&data, &[0; 32]).is_err());
    }

    #[test]
    fn authenticated_but_invalid_catalog_is_rejected() {
        let mut value = catalog();
        value["packs"][0]["filename"] = "../base.eph".into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["releaseTag"] = "v1?redirect=evil".into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][0]["endJdTdb"] = 2086301.5.into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][1]["required"] = false.into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][2]["sha256"] = "bad".into();
        assert!(parse(&value).is_err());
    }

    #[test]
    fn interrupted_staging_resumes_and_checks_all_bytes() {
        let bytes = b"synthetic ephemeris";
        let mut value = catalog();
        value["packs"][0]["bytes"] = bytes.len().into();
        value["packs"][0]["sha256"] = format!("{:x}", Sha256::digest(bytes)).into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut first = PendingPack::open(dir.path(), &cat, "past").unwrap();
        assert_eq!(first.append(0, &bytes[..7]).unwrap(), 7);
        assert!(first.append(0, b"x").is_err());
        drop(first);
        let mut resumed = PendingPack::open(dir.path(), &cat, "past").unwrap();
        assert_eq!(resumed.offset(), 7);
        resumed.append(7, &bytes[7..]).unwrap();
        let path = resumed.verify().unwrap();
        assert_eq!(fs::read(path).unwrap(), bytes);
    }

    #[test]
    fn wrong_bytes_and_incomplete_files_are_never_verified() {
        let mut value = catalog();
        value["packs"][0]["bytes"] = 4.into();
        value["packs"][0]["sha256"] = format!("{:x}", Sha256::digest(b"good")).into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut pending = PendingPack::open(dir.path(), &cat, "past").unwrap();
        pending.append(0, b"ba").unwrap();
        assert_eq!(pending.verify().unwrap_err(), "incomplete");
        let mut pending = PendingPack::open(dir.path(), &cat, "past").unwrap();
        pending.append(2, b"dd").unwrap();
        assert_eq!(pending.verify().unwrap_err(), "checksum_mismatch");
        assert!(!dir.path().join("past.eph").exists());
    }

    #[test]
    #[ignore = "requires the owner's separately held DE441 base slice"]
    fn local_real_base_can_be_staged_and_verified() {
        let source = std::env::var_os("DE441_DESKTOP_BASE_PACK").expect("local base path");
        let mut value = catalog();
        let mut base = value["packs"][1].clone();
        base["bytes"] = 111662384u64.into();
        base["sha256"] = "72ee04b5ee048320ae3198f9f70d02e03aef2229260ade0bc2404efe7a744f32".into();
        value["packs"] = vec![base].into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut input = File::open(source).unwrap();
        let mut pending = PendingPack::open(dir.path(), &cat, "base").unwrap();
        let mut chunk = [0u8; 128 * 1024];
        loop {
            let count = input.read(&mut chunk).unwrap();
            if count == 0 {
                break;
            }
            pending.append(pending.offset(), &chunk[..count]).unwrap();
        }
        let path = pending.verify().unwrap();
        assert_eq!(fs::metadata(path).unwrap().len(), 111662384);
    }
}
