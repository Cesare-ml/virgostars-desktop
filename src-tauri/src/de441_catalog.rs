//! Candidate trust boundary for a pinned DE441 release catalog.
//! No file activation or IPC is enabled by this module.
#![allow(dead_code)]

use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;
use virgostars_ephemeris_core::calendar::{Calendar, CalendarDateTime, TimeScale};
use virgostars_ephemeris_core::de441::{De441, JulianDateTdb};
use virgostars_ephemeris_core::de441_pack_manager::{De441PackManager, De441PackSpec};

const MAX_BYTES: usize = 512 * 1024;
const MAX_ASSET: u64 = 2 * 1024 * 1024 * 1024;
const DISK_MARGIN: u64 = 8 * 1024 * 1024;

struct DirectoryLock {
    _file: File,
}

impl DirectoryLock {
    fn acquire(directory: &Path) -> Result<Self, &'static str> {
        fs::create_dir_all(directory).map_err(|_| "storage_unavailable")?;
        if !fs::symlink_metadata(directory)
            .map_err(|_| "storage_unavailable")?
            .file_type()
            .is_dir()
        {
            return Err("storage_unavailable");
        }
        let path = directory.join(".de441.lock");
        let file = match OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                if !fs::symlink_metadata(&path)
                    .map_err(|_| "storage_unavailable")?
                    .file_type()
                    .is_file()
                {
                    return Err("storage_unavailable");
                }
                OpenOptions::new()
                    .read(true)
                    .write(true)
                    .open(path)
                    .map_err(|_| "storage_unavailable")?
            }
            Err(_) => return Err("storage_unavailable"),
        };
        file.try_lock().map_err(|_| "operation_in_progress")?;
        Ok(Self { _file: file })
    }
}

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

fn safe_filename(s: &str) -> bool {
    if !safe_component(s, 128) || !s.ends_with(".eph") {
        return false;
    }
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL") {
        return false;
    }
    !["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix)
            .is_some_and(|suffix| suffix.len() == 1 && matches!(suffix.as_bytes()[0], b'1'..=b'9'))
    })
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
            || !safe_filename(&pack.filename)
            || !ids.insert(&pack.id)
            || !filenames.insert(pack.filename.to_ascii_lowercase())
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

    pub(crate) fn manager(
        &self,
        directory: &Path,
        bundled_base: &Path,
    ) -> Result<De441PackManager, &'static str> {
        let specs = self
            .packs
            .iter()
            .map(|pack| {
                De441PackSpec::new(
                    pack.id.clone(),
                    if pack.required {
                        bundled_base.to_path_buf()
                    } else {
                        directory.join(&pack.filename)
                    },
                    JulianDateTdb(pack.start_jd_tdb),
                    JulianDateTdb(pack.end_jd_tdb),
                    pack.required,
                )
            })
            .collect();
        De441PackManager::from_specs(specs).map_err(|_| "invalid_catalog")
    }

    /// IDs must refer exclusively to already hash-verified activated files.
    /// The core determines all intervening packages and their download order.
    pub(crate) fn plan_verified(
        &self,
        directory: &Path,
        bundled_base: &Path,
        installed: &[&str],
        start: f64,
        end_exclusive: f64,
    ) -> Result<(Vec<String>, u64), &'static str> {
        let manager = self.manager(directory, bundled_base)?;
        let pending = manager
            .plan_contiguous_extension(
                installed,
                JulianDateTdb(start),
                JulianDateTdb(end_exclusive),
            )
            .map_err(|_| "invalid_coverage")?;
        let mut bytes = 0u64;
        let mut ids = Vec::with_capacity(pending.len());
        for spec in pending {
            let pack = self.pack(&spec.id).ok_or("invalid_catalog")?;
            bytes = bytes.checked_add(pack.bytes).ok_or("invalid_catalog")?;
            ids.push(spec.id);
        }
        Ok((ids, bytes))
    }

    fn verify_file(&self, path: &Path, pack: &Pack) -> Result<(), &'static str> {
        let meta = fs::symlink_metadata(path).map_err(|_| "missing_pack")?;
        if !meta.file_type().is_file() || meta.len() != pack.bytes {
            return Err("invalid_pack");
        }
        let mut file = File::open(path).map_err(|_| "invalid_pack")?;
        let mut hasher = Sha256::new();
        let mut total = 0u64;
        let mut chunk = [0u8; 64 * 1024];
        loop {
            let n = file.read(&mut chunk).map_err(|_| "invalid_pack")?;
            if n == 0 {
                break;
            }
            total = total.checked_add(n as u64).ok_or("invalid_pack")?;
            if total > pack.bytes {
                return Err("invalid_pack");
            }
            hasher.update(&chunk[..n]);
        }
        if total != pack.bytes || format!("{:x}", hasher.finalize()) != pack.sha256 {
            return Err("invalid_pack");
        }
        let reader = De441::open(path).map_err(|_| "invalid_pack")?;
        let (start, end) = reader.coverage();
        if start.0 > pack.start_jd_tdb || end.0 < pack.end_jd_tdb {
            return Err("invalid_pack");
        }
        Ok(())
    }

    /// Verify every present file before using its ID for planning. A present
    /// but damaged optional pack fails closed rather than being skipped.
    pub(crate) fn installed_verified(
        &self,
        directory: &Path,
        base_path: &Path,
    ) -> Result<Vec<String>, &'static str> {
        let mut installed = Vec::new();
        for pack in &self.packs {
            let path = if pack.required {
                base_path.to_path_buf()
            } else {
                directory.join(&pack.filename)
            };
            match fs::symlink_metadata(&path) {
                Err(e) if e.kind() == std::io::ErrorKind::NotFound && !pack.required => continue,
                Err(_) => return Err("missing_pack"),
                Ok(_) => self.verify_file(&path, pack)?,
            }
            installed.push(pack.id.clone());
        }
        let refs: Vec<_> = installed.iter().map(String::as_str).collect();
        let base = self
            .packs
            .iter()
            .find(|p| p.required)
            .ok_or("invalid_catalog")?;
        self.plan_verified(
            directory,
            base_path,
            &refs,
            base.start_jd_tdb,
            base.end_jd_tdb,
        )?;
        Ok(installed)
    }

    /// Activate only a verified next-edge staging file. Hard-link creation
    /// does not overwrite an existing target and is atomic on the same volume.
    /// The lock serializes cooperating installation/removal operations.
    pub(crate) fn activate_next(
        &self,
        directory: &Path,
        base_path: &Path,
        id: &str,
    ) -> Result<(), &'static str> {
        let pack = self.pack(id).ok_or("unknown_pack")?;
        if pack.required {
            return Err("base_required");
        }
        let _guard = DirectoryLock::acquire(directory)?;
        let meta = fs::symlink_metadata(directory).map_err(|_| "storage_unavailable")?;
        if !meta.file_type().is_dir() {
            return Err("storage_unavailable");
        }
        let installed = self.installed_verified(directory, base_path)?;
        if installed.iter().any(|present| present == id) {
            return Err("already_installed");
        }
        let refs: Vec<_> = installed.iter().map(String::as_str).collect();
        let (needed, _) = self.plan_verified(
            directory,
            base_path,
            &refs,
            pack.start_jd_tdb,
            pack.end_jd_tdb,
        )?;
        if needed.len() != 1 || needed[0] != id {
            return Err("intermediate_required");
        }
        let staging = directory.join(format!(".{}.part", pack.filename));
        self.verify_file(&staging, pack)?;
        let destination = directory.join(&pack.filename);
        fs::hard_link(&staging, &destination).map_err(|_| "activation_failed")?;
        // The destination is already valid; a leftover staging link is safe
        // to recover on a later run if cleanup fails.
        let _ = fs::remove_file(staging);
        Ok(())
    }

    /// The host must first release any reader holding the file, particularly
    /// on Windows. Only an explicitly selected, verified optional edge goes.
    pub(crate) fn remove_verified_edge(
        &self,
        directory: &Path,
        base_path: &Path,
        id: &str,
    ) -> Result<(), &'static str> {
        let pack = self.pack(id).ok_or("unknown_pack")?;
        if pack.required {
            return Err("base_required");
        }
        let _guard = DirectoryLock::acquire(directory)?;
        let installed = self.installed_verified(directory, base_path)?;
        let refs: Vec<_> = installed.iter().map(String::as_str).collect();
        let manager = self.manager(directory, base_path)?;
        if !manager
            .can_remove_contiguous_pack(&refs, id)
            .map_err(|_| "invalid_coverage")?
        {
            return Err("not_installed_edge");
        }
        fs::remove_file(directory.join(&pack.filename)).map_err(|_| "remove_failed")
    }
}

/// A bounded persistent staging file; it is not an installed pack.
/// Callers hold the directory lock and provide an app-owned directory.
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

fn response_headers_valid(response: &reqwest::Response, offset: u64, size: u64) -> bool {
    use reqwest::header::{CONTENT_ENCODING, CONTENT_LENGTH, CONTENT_RANGE};
    if response
        .headers()
        .get(CONTENT_ENCODING)
        .is_some_and(|value| value.as_bytes() != b"identity")
    {
        return false;
    }
    let expected = size - offset;
    if response
        .headers()
        .get(CONTENT_LENGTH)
        .is_some_and(|v| v.to_str().ok().and_then(|s| s.parse::<u64>().ok()) != Some(expected))
    {
        return false;
    }
    if offset == 0 && response.status() == reqwest::StatusCode::OK {
        return !response.headers().contains_key(CONTENT_RANGE);
    }
    response.status() == reqwest::StatusCode::PARTIAL_CONTENT
        && response
            .headers()
            .get(CONTENT_RANGE)
            .and_then(|v| v.to_str().ok())
            == Some(format!("bytes {}-{}/{}", offset, size - 1, size).as_str())
}

fn release_client() -> Result<reqwest::Client, &'static str> {
    ensure_tls_provider();
    let redirect = reqwest::redirect::Policy::custom(|attempt| {
        let url = attempt.url();
        let host = url.host_str().unwrap_or("");
        let github_asset = host == "github.com"
            && url
                .path()
                .starts_with("/Cesare-ml/VirgoStars-Ephemeris/releases/download/");
        if attempt.previous().len() < 5
            && url.scheme() == "https"
            && url.port_or_known_default() == Some(443)
            && url.username().is_empty()
            && url.password().is_none()
            && (github_asset || host == "release-assets.githubusercontent.com")
        {
            attempt.follow()
        } else {
            attempt.stop()
        }
    });
    reqwest::Client::builder()
        .redirect(redirect)
        .timeout(Duration::from_secs(120))
        .read_timeout(Duration::from_secs(30))
        .build()
        .map_err(|_| "network_unavailable")
}

fn ensure_tls_provider() {
    // A provider previously initialized by the host remains authoritative.
    // Otherwise select the ring provider explicitly for reqwest's
    // rustls-no-provider build.
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
}

/// Downloads only the catalog-constructed release URL. The caller must
/// check disk space and gate activation independently.
pub(crate) async fn download_pack(
    catalog: &Catalog,
    directory: &Path,
    id: &str,
    cancelled: &AtomicBool,
    progress: impl Fn(u64, u64),
) -> Result<PathBuf, &'static str> {
    let pack = catalog.pack(id).ok_or("unknown_pack")?;
    let _guard = DirectoryLock::acquire(directory)?;
    let url = catalog.asset_url(pack);
    let client = release_client()?;
    download_from(&client, &url, catalog, directory, id, cancelled, progress).await
}

async fn download_from(
    client: &reqwest::Client,
    url: &str,
    catalog: &Catalog,
    directory: &Path,
    id: &str,
    cancelled: &AtomicBool,
    progress: impl Fn(u64, u64),
) -> Result<PathBuf, &'static str> {
    use reqwest::header::{ACCEPT_ENCODING, RANGE};
    let pack = catalog.pack(id).ok_or("unknown_pack")?;
    let mut pending = PendingPack::open(directory, catalog, id)?;
    let remaining = pack
        .bytes
        .checked_sub(pending.offset())
        .ok_or("invalid_partial")?;
    let free = fs2::available_space(directory).map_err(|_| "space_check_failed")?;
    check_free_space(free, remaining)?;
    progress(pending.offset(), pack.bytes);
    for attempt in 0..3 {
        if cancelled.load(Ordering::Relaxed) {
            return Err("cancelled");
        }
        if pending.offset() == pack.bytes {
            return pending.verify();
        }
        let offset = pending.offset();
        let mut request = client.get(url).header(ACCEPT_ENCODING, "identity");
        if offset > 0 {
            request = request.header(RANGE, format!("bytes={offset}-"));
        }
        let response = request.send().await;
        if let Ok(mut response) = response {
            if response.status().is_server_error()
                || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
            {
                // Retry transient service failures without consuming their body.
            } else if !response_headers_valid(&response, offset, pack.bytes) {
                return Err("invalid_response");
            } else {
                loop {
                    if cancelled.load(Ordering::Relaxed) {
                        return Err("cancelled");
                    }
                    match response.chunk().await {
                        Ok(Some(bytes)) => {
                            for chunk in bytes.chunks(1024 * 1024) {
                                if cancelled.load(Ordering::Relaxed) {
                                    return Err("cancelled");
                                }
                                pending.append(pending.offset(), chunk)?;
                                progress(pending.offset(), pack.bytes);
                            }
                        }
                        Ok(None) | Err(_) => break,
                    }
                }
            }
            if cancelled.load(Ordering::Relaxed) {
                return Err("cancelled");
            }
            if pending.offset() == pack.bytes {
                return pending.verify();
            }
        }
        if attempt < 2 {
            let delay = Duration::from_millis(250u64 << attempt);
            tauri::async_runtime::spawn_blocking(move || std::thread::sleep(delay))
                .await
                .map_err(|_| "network_unavailable")?;
        }
    }
    Err("download_interrupted")
}

fn check_free_space(available: u64, remaining: u64) -> Result<(), &'static str> {
    if remaining == 0 {
        return Ok(());
    }
    let required = remaining
        .checked_add(DISK_MARGIN)
        .ok_or("insufficient_space")?;
    if available < required {
        Err("insufficient_space")
    } else {
        Ok(())
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
        value["packs"][0]["filename"] = "CON.eph".into();
        assert!(parse(&value).is_err());
        value = catalog();
        value["packs"][0]["filename"] = "BASE.eph".into();
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
    fn directory_lock_serializes_and_recovers_after_drop() {
        let dir = tempfile::tempdir().unwrap();
        let first = DirectoryLock::acquire(dir.path()).unwrap();
        assert!(matches!(
            DirectoryLock::acquire(dir.path()),
            Err("operation_in_progress")
        ));
        drop(first);
        assert!(DirectoryLock::acquire(dir.path()).is_ok());
    }

    #[test]
    fn rejects_insufficient_disk_and_size_overflow() {
        assert_eq!(check_free_space(0, 0), Ok(()));
        assert_eq!(
            check_free_space(DISK_MARGIN + 99, 100),
            Err("insufficient_space")
        );
        assert_eq!(check_free_space(DISK_MARGIN + 100, 100), Ok(()));
        assert_eq!(
            check_free_space(u64::MAX, u64::MAX),
            Err("insufficient_space")
        );
    }

    #[test]
    fn core_planner_requires_contiguous_verified_installation() {
        let cat = parse(&catalog()).unwrap();
        let path = Path::new("unused");
        let (ids, bytes) = cat
            .plan_verified(path, path, &["base"], 2013253.5, 2598007.5)
            .unwrap();
        assert_eq!(ids, ["past", "future"]);
        assert_eq!(bytes, 84);
        assert_eq!(
            cat.plan_verified(path, path, &["future"], 2013253.5, 2598007.5)
                .unwrap_err(),
            "invalid_coverage"
        );
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

    fn local_response(response: Vec<u8>) -> (String, std::thread::JoinHandle<String>) {
        use std::net::TcpListener;
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let address = listener.local_addr().unwrap();
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut one = [0u8; 1];
            while !bytes.ends_with(b"\r\n\r\n") && bytes.len() < 8192 {
                stream.read_exact(&mut one).unwrap();
                bytes.push(one[0]);
            }
            stream.write_all(&response).unwrap();
            String::from_utf8(bytes).unwrap()
        });
        (format!("http://{address}/fixture"), worker)
    }

    #[test]
    fn http_resume_checks_range_and_verifies_complete_content() {
        ensure_tls_provider();
        let bytes = b"synthetic ephemeris";
        let mut value = catalog();
        value["packs"][0]["bytes"] = bytes.len().into();
        value["packs"][0]["sha256"] = format!("{:x}", Sha256::digest(bytes)).into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut pending = PendingPack::open(dir.path(), &cat, "past").unwrap();
        pending.append(0, &bytes[..7]).unwrap();
        drop(pending);
        let mut response = format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes 7-{}/{}\r\nConnection: close\r\n\r\n",
            bytes.len() - 7, bytes.len() - 1, bytes.len()).into_bytes();
        response.extend_from_slice(&bytes[7..]);
        let (url, worker) = local_response(response);
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(download_from(
            &client,
            &url,
            &cat,
            dir.path(),
            "past",
            &cancelled,
            |_, _| {},
        ))
        .unwrap();
        assert_eq!(fs::read(result).unwrap(), bytes);
        assert!(worker
            .join()
            .unwrap()
            .to_ascii_lowercase()
            .contains("range: bytes=7-"));
    }

    #[test]
    fn http_resume_rejects_server_that_ignores_range() {
        ensure_tls_provider();
        let mut value = catalog();
        value["packs"][0]["bytes"] = 4.into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut pending = PendingPack::open(dir.path(), &cat, "past").unwrap();
        pending.append(0, b"a").unwrap();
        drop(pending);
        let (url, worker) = local_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\nabcd".to_vec(),
        );
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        let error = tauri::async_runtime::block_on(download_from(
            &client,
            &url,
            &cat,
            dir.path(),
            "past",
            &cancelled,
            |_, _| {},
        ))
        .unwrap_err();
        assert_eq!(error, "invalid_response");
        worker.join().unwrap();
        assert_eq!(fs::read(dir.path().join(".past.eph.part")).unwrap(), b"a");
    }

    #[test]
    fn cancelled_transfer_does_not_contact_server() {
        ensure_tls_provider();
        let cat = parse(&catalog()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let client = reqwest::Client::new();
        let cancelled = AtomicBool::new(true);
        let error = tauri::async_runtime::block_on(download_from(
            &client,
            "http://127.0.0.1:1/unused",
            &cat,
            dir.path(),
            "past",
            &cancelled,
            |_, _| {},
        ))
        .unwrap_err();
        assert_eq!(error, "cancelled");
    }

    #[test]
    fn http_retry_resumes_after_interrupted_connection() {
        use std::net::TcpListener;
        ensure_tls_provider();
        let bytes = b"synthetic ephemeris".to_vec();
        let mut value = catalog();
        value["packs"][0]["bytes"] = bytes.len().into();
        value["packs"][0]["sha256"] = format!("{:x}", Sha256::digest(&bytes)).into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let fixture = bytes.clone();
        let worker = std::thread::spawn(move || {
            let mut requests = Vec::new();
            for attempt in 0..2 {
                let (mut stream, _) = listener.accept().unwrap();
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut byte = [0u8; 1];
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                requests.push(String::from_utf8(request).unwrap());
                if attempt == 0 {
                    let head = format!(
                        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                        fixture.len()
                    );
                    stream.write_all(head.as_bytes()).unwrap();
                    stream.write_all(&fixture[..7]).unwrap();
                } else {
                    let head = format!("HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes 7-{}/{}\r\nConnection: close\r\n\r\n",
                        fixture.len()-7, fixture.len()-1, fixture.len());
                    stream.write_all(head.as_bytes()).unwrap();
                    stream.write_all(&fixture[7..]).unwrap();
                }
            }
            requests
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(download_from(
            &client,
            &url,
            &cat,
            dir.path(),
            "past",
            &cancelled,
            |_, _| {},
        ))
        .unwrap();
        assert_eq!(fs::read(result).unwrap(), bytes);
        let requests = worker.join().unwrap();
        assert!(requests[1].to_ascii_lowercase().contains("range: bytes=7-"));
    }

    #[test]
    fn http_retries_transient_service_error() {
        use std::net::TcpListener;
        ensure_tls_provider();
        let body = b"good";
        let mut value = catalog();
        value["packs"][0]["bytes"] = body.len().into();
        value["packs"][0]["sha256"] = format!("{:x}", Sha256::digest(body)).into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            for response in [
                b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".as_slice(),
                b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\nConnection: close\r\n\r\ngood".as_slice(),
            ] {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut byte = [0u8; 1];
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                stream.write_all(response).unwrap();
            }
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(download_from(
            &client,
            &url,
            &cat,
            dir.path(),
            "past",
            &cancelled,
            |_, _| {},
        ))
        .unwrap();
        assert_eq!(fs::read(result).unwrap(), body);
        worker.join().unwrap();
    }

    #[test]
    fn cancellation_during_transfer_keeps_only_a_partial_file() {
        use std::net::TcpListener;
        ensure_tls_provider();
        let body = vec![5u8; 2 * 1024 * 1024];
        let mut value = catalog();
        value["packs"][0]["bytes"] = body.len().into();
        value["packs"][0]["sha256"] = format!("{:x}", Sha256::digest(&body)).into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let head = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                body.len()
            );
            stream.write_all(head.as_bytes()).unwrap();
            let _ = stream.write_all(&body);
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(download_from(
            &client,
            &url,
            &cat,
            dir.path(),
            "past",
            &cancelled,
            |current, _| {
                if current > 0 {
                    cancelled.store(true, Ordering::Relaxed);
                }
            },
        ));
        assert_eq!(result.unwrap_err(), "cancelled");
        let partial = fs::metadata(dir.path().join(".past.eph.part"))
            .unwrap()
            .len();
        assert!(partial > 0 && partial < 2 * 1024 * 1024);
        assert!(!dir.path().join("past.eph").exists());
        worker.join().unwrap();
    }

    #[test]
    #[ignore = "requires the owner's separately held DE441 base slice"]
    fn local_http_resumes_and_verifies_real_base() {
        use std::net::TcpListener;
        ensure_tls_provider();
        let source = PathBuf::from(std::env::var_os("DE441_DESKTOP_BASE_PACK").expect("base path"));
        let mut value = catalog();
        let mut base = value["packs"][1].clone();
        base["bytes"] = 111662384u64.into();
        base["sha256"] = "72ee04b5ee048320ae3198f9f70d02e03aef2229260ade0bc2404efe7a744f32".into();
        value["packs"] = vec![base].into();
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let mut input = File::open(&source).unwrap();
        let mut first = vec![0u8; 1024 * 1024];
        input.read_exact(&mut first).unwrap();
        let mut pending = PendingPack::open(dir.path(), &cat, "base").unwrap();
        pending.append(0, &first).unwrap();
        drop(pending);
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let url = format!("http://{}/fixture", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = Vec::new();
            let mut byte = [0u8; 1];
            while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                stream.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            assert!(String::from_utf8(request)
                .unwrap()
                .to_ascii_lowercase()
                .contains("range: bytes=1048576-"));
            let size = 111662384u64;
            write!(stream, "HTTP/1.1 206 Partial Content\r\nContent-Length: {}\r\nContent-Range: bytes 1048576-{}/{}\r\nConnection: close\r\n\r\n",
                size - 1048576, size - 1, size).unwrap();
            input.seek(SeekFrom::Start(1048576)).unwrap();
            std::io::copy(&mut input, &mut stream).unwrap();
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        let result = tauri::async_runtime::block_on(download_from(
            &client,
            &url,
            &cat,
            dir.path(),
            "base",
            &cancelled,
            |_, _| {},
        ))
        .unwrap();
        assert_eq!(fs::metadata(result).unwrap().len(), 111662384);
        worker.join().unwrap();
    }

    #[test]
    #[ignore = "requires the owner's separately held Desktop slices"]
    fn activates_only_a_verified_edge_pack() {
        let source =
            PathBuf::from(std::env::var_os("DE441_DESKTOP_TEST_PACKS").expect("pack directory"));
        let mut value = catalog();
        value["packs"][0]["bytes"] = 18617184u64.into();
        value["packs"][0]["sha256"] =
            "a031fe60d9da5427bdaa3b00eaa6fc577fd8578b7c855f7ba8b603edc9ab8561".into();
        value["packs"][1]["bytes"] = 111662384u64.into();
        value["packs"][1]["sha256"] =
            "72ee04b5ee048320ae3198f9f70d02e03aef2229260ade0bc2404efe7a744f32".into();
        let earlier = serde_json::json!({
            "id":"earlier", "filename":"earlier.eph", "firstYear":600, "lastYear":799,
            "startJdTdb":year_start(600).unwrap(), "endJdTdb":year_start(800).unwrap(),
            "required":false, "bytes":42, "sha256":"e".repeat(64)
        });
        value["packs"].as_array_mut().unwrap().insert(0, earlier);
        let cat = parse(&value).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let staged = dir.path().join(".past.eph.part");
        fs::copy(source.join("de441-v2-history-00800-00999.eph"), &staged).unwrap();
        assert_eq!(
            cat.activate_next(dir.path(), &dir.path().join("missing.eph"), "past")
                .unwrap_err(),
            "missing_pack"
        );
        assert!(!dir.path().join("past.eph").exists());
        let base = source.join("de441-v2-desktop-core-1000-2200.eph");
        assert_eq!(
            cat.activate_next(dir.path(), &base, "earlier").unwrap_err(),
            "intermediate_required"
        );
        assert!(!dir.path().join("earlier.eph").exists());
        let mut damaged = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&staged)
            .unwrap();
        damaged.seek(SeekFrom::End(-1)).unwrap();
        let mut byte = [0u8; 1];
        damaged.read_exact(&mut byte).unwrap();
        damaged.seek(SeekFrom::End(-1)).unwrap();
        damaged.write_all(&[byte[0] ^ 1]).unwrap();
        drop(damaged);
        assert_eq!(
            cat.activate_next(dir.path(), &base, "past").unwrap_err(),
            "invalid_pack"
        );
        assert!(!dir.path().join("past.eph").exists());
        fs::copy(source.join("de441-v2-history-00800-00999.eph"), &staged).unwrap();
        cat.activate_next(dir.path(), &base, "past").unwrap();
        assert!(!staged.exists());
        assert_eq!(
            cat.installed_verified(dir.path(), &base).unwrap(),
            ["past", "base"]
        );
        assert_eq!(
            cat.activate_next(dir.path(), &base, "past").unwrap_err(),
            "already_installed"
        );
        assert_eq!(
            cat.remove_verified_edge(dir.path(), &base, "base")
                .unwrap_err(),
            "base_required"
        );
        assert_eq!(
            cat.remove_verified_edge(dir.path(), &base, "earlier")
                .unwrap_err(),
            "not_installed_edge"
        );
        cat.remove_verified_edge(dir.path(), &base, "past").unwrap();
        assert_eq!(cat.installed_verified(dir.path(), &base).unwrap(), ["base"]);
    }

    #[test]
    #[ignore = "requires the separately generated local release-shaped catalog"]
    fn generated_catalog_matches_desktop_contract() {
        let path = std::env::var_os("DE441_DESKTOP_TEST_CATALOG").expect("catalog path");
        let bytes = fs::read(path).unwrap();
        let actual = Sha256::digest(&bytes);
        assert_eq!(
            format!("{:x}", actual),
            "381f203035d62538c1418ce816ebebb082a5e7e0562994800badcc64d0b50eae"
        );
        let cat = parse_pinned(&bytes, &actual.into()).unwrap();
        assert_eq!(cat.packs.len(), 145);
        let (ids, bytes) = cat
            .plan_verified(
                Path::new("unused"),
                Path::new("unused"),
                &["desktop-core-1000-2200"],
                year_start(0).unwrap(),
                year_start(2201).unwrap(),
            )
            .unwrap();
        assert_eq!(ids.len(), 5);
        assert_eq!(ids.first().unwrap(), "history-00800-00999");
        assert_eq!(ids.last().unwrap(), "history-00000-00199");
        assert!(bytes > 90_000_000);
    }

    #[test]
    #[ignore = "requires the local full catalog and separately held DE441 slices"]
    fn local_http_installs_a_contiguous_extension_to_year_zero() {
        use std::net::TcpListener;
        ensure_tls_provider();
        let catalog_path = std::env::var_os("DE441_DESKTOP_TEST_CATALOG").expect("catalog path");
        let source =
            PathBuf::from(std::env::var_os("DE441_DESKTOP_TEST_PACKS").expect("pack directory"));
        let raw = fs::read(catalog_path).unwrap();
        let hash = Sha256::digest(&raw);
        assert_eq!(
            format!("{:x}", hash),
            "381f203035d62538c1418ce816ebebb082a5e7e0562994800badcc64d0b50eae"
        );
        let cat = parse_pinned(&raw, &hash.into()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let base = source.join("de441-v2-desktop-core-1000-2200.eph");
        let (plan, _) = cat
            .plan_verified(
                dir.path(),
                &base,
                &["desktop-core-1000-2200"],
                year_start(0).unwrap(),
                year_start(2201).unwrap(),
            )
            .unwrap();
        assert_eq!(plan.len(), 5);
        let files: Vec<_> = plan
            .iter()
            .map(|id| cat.pack(id).unwrap().filename.clone())
            .collect();
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let root = format!("http://{}", listener.local_addr().unwrap());
        let worker = std::thread::spawn(move || {
            for expected in files {
                let (mut stream, _) = listener.accept().unwrap();
                let mut request = Vec::new();
                let mut byte = [0u8; 1];
                while !request.ends_with(b"\r\n\r\n") && request.len() < 8192 {
                    stream.read_exact(&mut byte).unwrap();
                    request.push(byte[0]);
                }
                let text = String::from_utf8(request).unwrap();
                assert!(text.starts_with(&format!("GET /{} ", expected)));
                let mut file = File::open(source.join(&expected)).unwrap();
                let size = file.metadata().unwrap().len();
                write!(
                    stream,
                    "HTTP/1.1 200 OK\r\nContent-Length: {size}\r\nConnection: close\r\n\r\n"
                )
                .unwrap();
                std::io::copy(&mut file, &mut stream).unwrap();
            }
        });
        let client = reqwest::Client::builder().no_proxy().build().unwrap();
        let cancelled = AtomicBool::new(false);
        for id in &plan {
            let pack = cat.pack(id).unwrap();
            let url = format!("{root}/{}", pack.filename);
            tauri::async_runtime::block_on(download_from(
                &client,
                &url,
                &cat,
                dir.path(),
                id,
                &cancelled,
                |_, _| {},
            ))
            .unwrap();
            cat.activate_next(dir.path(), &base, id).unwrap();
        }
        worker.join().unwrap();
        let installed = cat.installed_verified(dir.path(), &base).unwrap();
        assert_eq!(installed.len(), 6);
        assert_eq!(
            cat.remove_verified_edge(dir.path(), &base, "history-00400-00599")
                .unwrap_err(),
            "not_installed_edge"
        );
        cat.remove_verified_edge(dir.path(), &base, "history-00000-00199")
            .unwrap();
        assert_eq!(cat.installed_verified(dir.path(), &base).unwrap().len(), 5);
    }

    #[test]
    #[ignore = "requires the full DE441 source and all privately generated slices"]
    fn all_package_boundaries_match_full_source_geometric_states() {
        use virgostars_ephemeris_core::de441::Body;
        let catalog_path = std::env::var_os("DE441_DESKTOP_TEST_CATALOG").expect("catalog path");
        let directory =
            PathBuf::from(std::env::var_os("DE441_DESKTOP_TEST_PACKS").expect("pack directory"));
        let original_path = std::env::var_os("DE441_SOURCE_PATH").expect("source path");
        let raw = fs::read(catalog_path).unwrap();
        let hash = Sha256::digest(&raw);
        assert_eq!(
            format!("{:x}", hash),
            "381f203035d62538c1418ce816ebebb082a5e7e0562994800badcc64d0b50eae"
        );
        let cat = parse_pinned(&raw, &hash.into()).unwrap();
        let base = directory.join("de441-v2-desktop-core-1000-2200.eph");
        let mut manager = cat.manager(&directory, &base).unwrap();
        let mut original = De441::open(original_path).unwrap();
        let bodies = [
            Body::Sun,
            Body::Moon,
            Body::Mercury,
            Body::Venus,
            Body::MarsBarycenter,
            Body::JupiterBarycenter,
            Body::SaturnBarycenter,
            Body::UranusBarycenter,
            Body::NeptuneBarycenter,
            Body::PlutoBarycenter,
        ];
        let mut count = 0;
        for pack in cat.packs.iter().skip(1) {
            for offset in [-1.0 / 86400.0, 0.0, 1.0 / 86400.0] {
                let epoch = JulianDateTdb(pack.start_jd_tdb + offset);
                for body in bodies {
                    let actual = manager.state(body, Body::Earth, epoch).unwrap();
                    let expected = original.state(body, Body::Earth, epoch).unwrap();
                    assert_eq!(
                        actual.position_km, expected.position_km,
                        "epoch={} body={body:?}",
                        epoch.0
                    );
                    assert_eq!(
                        actual.velocity_km_per_day, expected.velocity_km_per_day,
                        "epoch={} body={body:?}",
                        epoch.0
                    );
                    count += 1;
                }
            }
        }
        assert_eq!(count, 144 * 3 * 10);
    }
}
