//! Signed, user-consented updates. Endpoints are fixed; no URL or key crosses IPC.
use serde::Serialize;
use futures_util::StreamExt;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Manager, ipc::Channel};
use tauri_plugin_updater::{Update, UpdaterExt};

const STABLE: &str = "https://github.com/Cesare-ml/virgostars-desktop/releases/download/updates-stable/latest.json";
const BETA: &str = "https://github.com/Cesare-ml/virgostars-desktop/releases/download/updates-beta/latest.json";
const TESTING: &str = "https://github.com/Cesare-ml/virgostars-desktop/releases/download/updates-testing/latest.json";
#[cfg(feature = "updater-loopback-test")]
const LOOPBACK: &str = "https://localhost:47831/latest.json";
const TEST_BUILD: &str = match option_env!("VIRGOSTARS_UPDATER_TEST_CHANNEL") { Some(value) => value, None => "" };
const KEY: &str = match option_env!("VIRGOSTARS_UPDATER_PUBLIC_KEY") { Some(k) => k, None => "" };
const MAX_PACKAGE_BYTES: usize = 512 * 1024 * 1024;

#[derive(Default)]
pub struct UpdateState(Mutex<Inner>);
#[derive(Default)]
struct Inner { busy: bool, pending: Option<(String, Update)> }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateReply { status: &'static str, current_version: String, version: Option<String>, notes: Option<String> }
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress { downloaded: u64, total: Option<u64> }
fn reply(app: &AppHandle, status: &'static str) -> UpdateReply {
    let version = app.package_info().version.to_string();
    UpdateReply { status, current_version: if TEST_BUILD == "1" { format!("{version} (test)") } else { version }, version: None, notes: None }
}
fn channel_endpoint(channel: &str, test_build: bool) -> Option<&'static str> {
    #[cfg(feature = "updater-loopback-test")]
    if channel == "stable" || channel == "beta" { return Some(LOOPBACK); }
    match channel { "stable" | "beta" if test_build => Some(TESTING), "stable" => Some(STABLE), "beta" => Some(BETA), _ => None }
}
fn configure_http(client: reqwest::ClientBuilder) -> reqwest::ClientBuilder {
    let client = client.https_only(true);
    #[cfg(feature = "updater-loopback-test")]
    let client = match option_env!("VIRGOSTARS_UPDATER_LOOPBACK_CA").and_then(|pem| reqwest::Certificate::from_pem(pem.as_bytes()).ok()) {
        Some(cert) => client.add_root_certificate(cert),
        None => client,
    };
    client
}
fn allowed_artifact(url: &tauri::Url) -> bool {
    #[cfg(feature = "updater-loopback-test")]
    if url.scheme() == "https" && url.host_str() == Some("localhost") && url.port() == Some(47831) && url.path() == "/installer.exe" { return true; }
    url.scheme() == "https" && url.host_str() == Some("github.com") && url.path().starts_with("/Cesare-ml/virgostars-desktop/releases/download/")
}
fn fits_download(current: usize, next: usize) -> bool {
    current.checked_add(next).is_some_and(|size| size <= MAX_PACKAGE_BYTES)
}

async fn download_verified(update: &Update, progress: &Channel<DownloadProgress>) -> Result<Vec<u8>, &'static str> {
    let client = configure_http(reqwest::Client::builder()).timeout(Duration::from_secs(600)).build().map_err(|_| "download_failed")?;
    let response = client.get(update.download_url.clone()).send().await.map_err(|_| "download_failed")?;
    if !response.status().is_success() { return Err("download_failed") }
    let total = response.content_length();
    if total.is_some_and(|size| size > MAX_PACKAGE_BYTES as u64) { return Err("package_too_large") }
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|_| "download_failed")?;
        if !fits_download(bytes.len(), chunk.len()) { return Err("package_too_large") }
        bytes.try_reserve(chunk.len()).map_err(|_| "download_failed")?;
        bytes.extend_from_slice(&chunk);
        let _ = progress.send(DownloadProgress {downloaded: bytes.len() as u64, total});
    }
    update.verify(&bytes).map_err(|_| "signature_invalid")?;
    Ok(bytes)
}

#[tauri::command]
pub async fn check_updates(app: AppHandle, channel: String) -> UpdateReply {
    let state = app.state::<UpdateState>();
    let Some(url) = channel_endpoint(&channel, TEST_BUILD == "1") else { return reply(&app, "invalid_channel") };
    if KEY.trim().is_empty() { return reply(&app, "not_configured") }
    {
        let Ok(mut inner) = state.0.lock() else { return reply(&app, "unavailable") };
        if inner.busy { return reply(&app, "busy") }
        inner.busy = true; inner.pending = None;
    }
    let result = async {
        let updater = app.updater_builder().endpoints(vec![url.parse().map_err(|_| ())?]).map_err(|_| ())?
            .configure_client(configure_http)
            .timeout(Duration::from_secs(20)).build().map_err(|_| ())?;
        updater.check().await.map_err(|_| ())
    }.await;
    let Ok(mut inner) = state.0.lock() else { return reply(&app, "unavailable") };
    inner.busy = false;
    match result {
        Ok(Some(update)) if (channel != "stable" || !update.version.contains('-')) && allowed_artifact(&update.download_url) => {
            let mut out = reply(&app, "available");
            out.version = Some(update.version.clone());
            out.notes = update.body.as_ref().map(|s| s.chars().take(4000).collect());
            inner.pending = Some((channel, update)); out
        }
        Ok(Some(_)) => reply(&app, "invalid_release"),
        Ok(None) => reply(&app, "current"),
        Err(()) => reply(&app, "check_failed"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine as _};
    // Public throwaway verification vector from tauri-plugin-updater 2.14.1.
    const PUBLIC: &str = "untrusted comment: minisign public key: A49EF4746FA6E6D7\nRWTX5qZvdPSepDGWg2bz8n6ArQnBMwgQK1geVosorcbLzcunD+KJ+cYe";
    const SIGNATURE: &str = "untrusted comment: signature from tauri secret key\nRUTX5qZvdPSepPF2zsjvP/L/TQtBLRnWRvaq+4omK1UEugtQp/USrGiI1v762sDy3id3aor7bRC9ETyeot6lMHHrWoZ5hjUM1Qc=\ntrusted comment: timestamp:1791649051\tfile:payload\tversion:2.0.0\nDDq2CLOEl5cQmC2eJRHlnZPVViOZsu1CjpPKQoei4A/XBfkDqGO0B+QMrcrHgEQ5qV3mne75tdFWhJpqUXh9AA==";
    #[test]
    fn channels_are_fixed_and_invalid_input_is_rejected() {
        #[cfg(not(feature = "updater-loopback-test"))]
        {
        assert_eq!(channel_endpoint("stable",false), Some(STABLE));
        assert_eq!(channel_endpoint("beta",false), Some(BETA));
        assert_eq!(channel_endpoint("stable",true), Some(TESTING));
        assert_eq!(channel_endpoint("beta",true), Some(TESTING));
        }
        #[cfg(feature = "updater-loopback-test")]
        {
        assert_eq!(channel_endpoint("stable",false), Some(LOOPBACK));
        assert_eq!(channel_endpoint("beta",true), Some(LOOPBACK));
        }
        assert_eq!(channel_endpoint("https://example.test",true), None);
        assert_eq!(channel_endpoint("Stable",false), None);
        assert!(fits_download(MAX_PACKAGE_BYTES - 1, 1));
        assert!(!fits_download(MAX_PACKAGE_BYTES, 1));
        assert!(!fits_download(usize::MAX, 1));
    }
    #[test]
    fn minisign_rejects_altered_payload_and_signed_comment() {
        let key = minisign_verify::PublicKey::decode(PUBLIC).unwrap();
        let signature = minisign_verify::Signature::decode(SIGNATURE).unwrap();
        assert!(key.verify(b"test", &signature, true).is_ok());
        assert!(key.verify(b"altered", &signature, true).is_err());
        let changed = minisign_verify::Signature::decode(&SIGNATURE.replace("version:2.0.0", "version:2.0.1")).unwrap();
        assert!(key.verify(b"test", &changed, true).is_err());
    }
    fn verified_release(data: &[u8], public: &str, signature: &str, version: &str) -> bool {
        let decode = |input: &str| STANDARD.decode(input.trim()).ok().and_then(|bytes| String::from_utf8(bytes).ok());
        let Some(public) = decode(public) else { return false };
        let Some(signature) = decode(signature) else { return false };
        let Ok(key) = minisign_verify::PublicKey::decode(&public) else { return false };
        let Ok(sig) = minisign_verify::Signature::decode(&signature) else { return false };
        key.verify(data, &sig, true).is_ok() && sig.trusted_comment().split_whitespace()
            .any(|entry| entry == format!("version:{version}"))
    }
    #[test]
    fn release_artifact_verification_requires_valid_signature_and_matching_version() {
        let public = STANDARD.encode(PUBLIC);
        let signature = STANDARD.encode(SIGNATURE);
        assert!(verified_release(b"test", &public, &signature, "2.0.0"));
        assert!(!verified_release(b"altered", &public, &signature, "2.0.0"));
        assert!(!verified_release(b"test", &public, &signature, "2.0.1"));
        assert!(!verified_release(b"test", "invalid", &signature, "2.0.0"));
    }
    #[test]
    #[ignore = "requires a locally built updater artifact and its public key"]
    fn verify_built_release_artifact() {
        use std::{fs, path::PathBuf};
        let path = |name| PathBuf::from(std::env::var_os(name).expect("missing verification path"));
        let installer = path("VIRGOSTARS_VERIFY_INSTALLER");
        let signature = fs::read_to_string(path("VIRGOSTARS_VERIFY_SIGNATURE")).unwrap();
        let public = fs::read_to_string(path("VIRGOSTARS_VERIFY_PUBLIC_KEY")).unwrap();
        assert!(fs::metadata(&installer).unwrap().len() <= MAX_PACKAGE_BYTES as u64);
        assert!(verified_release(&fs::read(installer).unwrap(), &public, &signature,
            env!("CARGO_PKG_VERSION")), "Invalid updater signature or signed version");
    }
}

#[tauri::command]
pub async fn install_update(app: AppHandle, channel: String, version: String,
    progress: Channel<DownloadProgress>) -> UpdateReply {
    let state = app.state::<UpdateState>();
    let update = {
        let Ok(mut inner) = state.0.lock() else { return reply(&app, "unavailable") };
        if inner.busy { return reply(&app, "busy") }
        match inner.pending.take() {
            Some((c, update)) if c == channel && update.version == version => { inner.busy = true; update },
            _ => return reply(&app, "stale"),
        }
    };
    let result = download_verified(&update, &progress).await;
    let status = match result {
        Ok(bytes) => {
            // Wait until any active encrypted archive/photo operation has finished before NSIS closes us.
            let _archive_guard = crate::chart_archive::lock_for_update();
            let snapshot = app.path().app_local_data_dir().ok().zip(app.path().resource_dir().ok())
                .and_then(|(data, resources)| crate::update_backup::snapshot(&data, Some(&resources)).ok());
            match snapshot {
                Some(_) => match update.install(bytes) { Ok(()) => "install_started", Err(_) => "install_failed" },
                None => "backup_failed",
            }
        }
        Err(error) => error,
    };
    if let Ok(mut inner) = state.0.lock() { inner.busy = false; }
    reply(&app, status)
}
