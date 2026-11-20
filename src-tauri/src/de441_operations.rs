//! Bounded, app-owned package operations; URLs and filesystem paths never cross IPC.
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::sync::atomic::AtomicBool;
#[cfg(feature = "virgostars-ephemeris")]
use std::sync::atomic::Ordering;
#[cfg(test)]
static TEST_DOWNLOAD_URL: std::sync::OnceLock<String> = std::sync::OnceLock::new();

#[derive(Default)]
pub struct DownloadState(Arc<Mutex<Job>>);

#[derive(Default)]
struct Job {
    busy: bool,
    cancelled: Arc<AtomicBool>,
    downloaded: u64,
    total: u64,
    current: Option<String>,
    outcome: Option<&'static str>,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case", rename_all_fields = "camelCase", deny_unknown_fields)]
pub enum PackageRequest {
    Status {},
    Plan { first_year: i32, last_year: i32 },
    Start { first_year: i32, last_year: i32, planned: Vec<String>, planned_bytes: u64 },
    Cancel {},
    Remove { id: String },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageReply {
    status: &'static str,
    busy: bool,
    current: Option<String>,
    downloaded: u64,
    total: u64,
    outcome: Option<&'static str>,
    #[cfg(feature = "virgostars-ephemeris")]
    packages: Vec<crate::de441_catalog::PackSummary>,
    #[cfg(not(feature = "virgostars-ephemeris"))]
    packages: Vec<()>,
    planned: Vec<String>,
    planned_bytes: u64,
    free_bytes: Option<u64>,
}

fn reply(state: &DownloadState, status: &'static str) -> PackageReply {
    let job = state.0.lock().unwrap_or_else(|p| p.into_inner());
    PackageReply { status, busy: job.busy, current: job.current.clone(), downloaded: job.downloaded,
        total: job.total, outcome: job.outcome,
        packages: Vec::new(), planned: Vec::new(), planned_bytes: 0, free_bytes: None }
}

#[tauri::command]
pub async fn de441_packages(app: tauri::AppHandle, request: PackageRequest) -> PackageReply {
    use tauri::Manager;
    let state = app.state::<DownloadState>();
    #[cfg(not(feature = "virgostars-ephemeris"))]
    { let _ = request; return reply(&state, "not_configured"); }
    #[cfg(feature = "virgostars-ephemeris")]
    { handle(&state, request) }
}

#[cfg(feature = "virgostars-ephemeris")]
fn handle(state: &DownloadState, request: PackageRequest) -> PackageReply {
    use crate::de441_catalog::{download_pack, year_start};
    use crate::virgostars_provider::{catalog_context, without_engine};
    if matches!(request, PackageRequest::Cancel {}) {
        let job = state.0.lock().unwrap_or_else(|p| p.into_inner());
        job.cancelled.store(true, Ordering::Relaxed);
        drop(job);
        return reply(state, "ok");
    }
    let busy = state.0.lock().unwrap_or_else(|p| p.into_inner()).busy;
    if busy {
        return reply(state, "busy");
    }
    let (catalog, directory, base) = match catalog_context() {
        Ok(value) => value,
        Err(error) => return reply(state, error),
    };
    let installed = match catalog.installed_verified(&directory, &base) {
        Ok(value) => value,
        Err(error) => return reply(state, error),
    };
    let mut result = reply(state, "ok");
    result.packages = catalog.summaries(&installed);
    let space_path = if directory.exists() { directory.as_path() } else { directory.parent().unwrap_or(&directory) };
    result.free_bytes = fs2::available_space(space_path).ok();
    match request {
        PackageRequest::Status {} => result,
        PackageRequest::Cancel {} => unreachable!(),
        PackageRequest::Remove { id } => {
            {
                let mut job = state.0.lock().unwrap_or_else(|p| p.into_inner());
                if job.busy { drop(job); return reply(state, "busy"); }
                job.busy = true;
            }
            let outcome = without_engine(|| catalog.remove_verified_edge(&directory, &base, &id));
            let mut job = state.0.lock().unwrap_or_else(|p| p.into_inner());
            job.busy = false;
            job.outcome = Some(outcome.err().unwrap_or("removed"));
            drop(job);
            reply(state, outcome.err().unwrap_or("ok"))
        }
        PackageRequest::Plan { first_year, last_year } | PackageRequest::Start { first_year, last_year, .. } => {
            if first_year > last_year || !(-20000..20000).contains(&first_year) || !(-20000..19999).contains(&last_year) {
                return reply(state, "invalid_year");
            }
            let Ok(start) = year_start(first_year) else { return reply(state, "invalid_year"); };
            let Ok(end) = year_start(last_year + 1) else { return reply(state, "invalid_year"); };
            let refs: Vec<_> = installed.iter().map(String::as_str).collect();
            let (planned, bytes) = match catalog.plan_verified(&directory, &base, &refs, start, end) {
                Ok(value) => value, Err(error) => return reply(state, error),
            };
            result.planned = planned.clone(); result.planned_bytes = bytes;
            if let PackageRequest::Start { planned: ref approved, planned_bytes, .. } = request {
                if approved.len() > 256 || *approved != planned || planned_bytes != bytes { return reply(state, "stale_plan"); }
            } else { return result; }
            if planned.is_empty() { return result; }
            let Some(queued) = planned.iter().map(|id| catalog.pack_size(id).map(|size| (id.clone(), size))).collect::<Option<Vec<_>>>() else {
                return reply(state, "invalid_catalog");
            };
            let shared = Arc::clone(&state.0);
            let cancelled = {
                let mut job = shared.lock().unwrap_or_else(|p| p.into_inner());
                if job.busy { drop(job); return reply(state, "busy"); }
                job.busy = true; job.downloaded = 0; job.total = bytes; job.current = None; job.outcome = None;
                job.cancelled = Arc::new(AtomicBool::new(false));
                Arc::clone(&job.cancelled)
            };
            tauri::async_runtime::spawn(async move {
                let mut outcome = "completed";
                let mut completed = 0u64;
                for (id, size) in queued {
                    if cancelled.load(Ordering::Relaxed) { outcome = "cancelled"; break; }
                    { let mut job = shared.lock().unwrap_or_else(|p| p.into_inner()); job.current = Some(id.clone()); job.downloaded = completed; }
                    let progress_state = Arc::clone(&shared);
                    let progress = move |n, _| {
                        let mut job = progress_state.lock().unwrap_or_else(|p| p.into_inner());
                        job.downloaded = completed.saturating_add(n).min(bytes);
                    };
                    #[cfg(test)]
                    let downloaded = if let Some(url) = TEST_DOWNLOAD_URL.get() {
                        crate::de441_catalog::ensure_tls_provider();
                        let local_url = format!("{url}/{id}");
                        crate::de441_catalog::download_from(&reqwest::Client::new(), &local_url, &catalog, &directory, &id, &cancelled, progress).await
                    } else { download_pack(&catalog, &directory, &id, &cancelled, progress).await };
                    #[cfg(not(test))]
                    let downloaded = download_pack(&catalog, &directory, &id, &cancelled, progress).await;
                    if let Err(error) = downloaded { outcome = error; break; }
                    if cancelled.load(Ordering::Relaxed) { outcome = "cancelled"; break; }
                    if let Err(error) = without_engine(|| catalog.activate_next(&directory, &base, &id)) { outcome = error; break; }
                    completed = completed.saturating_add(size);
                }
                let mut job = shared.lock().unwrap_or_else(|p| p.into_inner());
                job.busy = false; job.current = None; job.outcome = Some(outcome);
            });
            result.status = "started"; result.busy = true; result.downloaded = 0; result.total = bytes; result
        }
    }
}

#[cfg(all(test, feature = "virgostars-ephemeris"))]
mod tests {
    use super::*;

    #[test]
    fn request_rejects_unknown_fields_and_uses_camel_case() {
        let request: PackageRequest = serde_json::from_str(r#"{"action":"plan","firstYear":800,"lastYear":999}"#).unwrap();
        assert!(matches!(request, PackageRequest::Plan { first_year: 800, last_year: 999 }));
        assert!(serde_json::from_str::<PackageRequest>(r#"{"action":"status","url":"https://example.com"}"#).is_err());
    }

    #[test]
    fn cancel_signals_a_running_job_and_status_does_not_deadlock() {
        let state = DownloadState::default();
        let cancelled = {
            let mut job = state.0.lock().unwrap();
            job.busy = true;
            Arc::clone(&job.cancelled)
        };
        assert_eq!(handle(&state, PackageRequest::Status {}).status, "busy");
        assert_eq!(handle(&state, PackageRequest::Cancel {}).status, "ok");
        assert!(cancelled.load(Ordering::Relaxed));
    }

    #[cfg(feature = "virgostars-ephemeris")]
    #[test]
    #[ignore = "requires the verified local DE441 development base and build-time catalog pin"]
    fn local_development_base_reports_inventory_and_plans_adjacent_pack() {
        let resource = std::path::PathBuf::from(std::env::var_os("VIRGOSTARS_DE441_DEV_RESOURCES").expect("development resources"));
        let data = tempfile::tempdir().unwrap();
        // A pre-existing single-file selection must not hide the explicitly
        // selected development multipack base or be edited by this test.
        std::fs::write(data.path().join("ephemeris.json"), r#"{"de441":"fictional-custom.eph"}"#).unwrap();
        crate::virgostars_provider::configure(data.path().to_path_buf(), Some(resource));
        let state = DownloadState::default();
        let status = handle(&state, PackageRequest::Status {});
        assert_eq!(status.status, "ok");
        assert!(status.packages.iter().any(|p| {
            let value = serde_json::to_value(p).unwrap();
            value["required"] == true && value["installed"] == true
        }));
        let plan = handle(&state, PackageRequest::Plan {first_year: 800, last_year: 2200});
        assert_eq!(plan.status, "ok");
        assert_eq!(plan.planned, vec!["history-00800-00999"]);
        assert!(plan.planned_bytes > 0);
        assert_eq!(std::fs::read_to_string(data.path().join("ephemeris.json")).unwrap(), r#"{"de441":"fictional-custom.eph"}"#);
        let calculate = |year| {
            let value = serde_json::json!({"protocolVersion":1,"latMicro":41900000,"lngMicro":12500000,
                "civil":{"year":year,"month":6,"day":15,"hour":12,"minute":5,"second":0,
                    "calendar":"gregorian","offset":{"kind":"supplied","secondsEast":2996,"source":"IANA Europe/Rome (historical rules may be extrapolated)"},"uncertaintySeconds":0},
                "deltaT":{"kind":"espenakMeeus2006Unquantified"}});
            let request = serde_json::from_value(value).unwrap();
            serde_json::to_value(crate::historical_chart::calculate_historical_chart(request)).unwrap()
        };
        for year in [1000, 2200] {
            let result = calculate(year);
            assert_eq!(result["status"], "ok", "year {year}");
            assert!(result["time"]["deltaTUncertaintySeconds"].is_null());
            assert!(!result["chart"]["bodies"].as_array().unwrap().is_empty());
        }
        assert_eq!(calculate(800)["status"], "ephemeris_out_of_range");
        if let Some(source) = std::env::var_os("DE441_TEST_OPTIONAL_PACK") {
            let packs = data.path().join("de441-packs");
            std::fs::create_dir_all(&packs).unwrap();
            std::fs::copy(source, packs.join("de441-history-0800-0999.eph")).unwrap();
            crate::virgostars_provider::without_engine(|| ());
            let result = calculate(800);
            assert_eq!(result["status"], "ok");
            assert!(result["time"]["deltaTUncertaintySeconds"].is_null());
            if let Some(output) = std::env::var_os("DE441_TEST_RESPONSE_PATH") {
                std::fs::write(output, serde_json::to_vec(&result).unwrap()).unwrap();
            }
        }
    }

    #[test]
    #[ignore = "requires private catalog, generated packs and its build-time digest"]
    fn local_ipc_plans_and_rejects_stale_consent_then_removes_edge() {
        use std::path::PathBuf;
        let root = PathBuf::from(std::env::var_os("DE441_PRIVATE_ROOT").unwrap());
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("resources");
        let ephemeris = resources.join("ephemeris");
        let data = temp.path().join("data");
        let packs = data.join("de441-packs");
        std::fs::create_dir_all(&ephemeris).unwrap();
        std::fs::create_dir_all(&packs).unwrap();
        std::fs::copy(root.join("de441-private-catalog/de441-release-catalog-v1.json"), ephemeris.join("de441-release-catalog-v1.json")).unwrap();
        let link = |name: &str, dest: &std::path::Path| {
            let source = root.join("de441-private-complete").join(name);
            std::fs::hard_link(&source, dest).unwrap_or_else(|_| {std::fs::copy(source, dest).unwrap();});
        };
        link("de441-v2-desktop-core-1000-2200.eph", &ephemeris.join("de441-slice.eph"));
        crate::virgostars_provider::configure(data, Some(resources));
        let state = DownloadState::default();
        let plan = handle(&state, PackageRequest::Plan {first_year:600, last_year:999});
        assert_eq!(plan.status, "ok");
        assert_eq!(plan.planned, vec!["history-00800-00999", "history-00600-00799"]);
        assert!(plan.planned_bytes > 0);
        let stale = handle(&state, PackageRequest::Start {first_year:600, last_year:999, planned:Vec::new(), planned_bytes:0});
        assert_eq!(stale.status, "stale_plan");
        assert!(!stale.busy);
        use std::io::{Read, Write};
        let sources = root.join("de441-private-complete");
        let listener = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let url = format!("http://{}/pack", listener.local_addr().unwrap());
        TEST_DOWNLOAD_URL.set(url).unwrap();
        let server = std::thread::spawn(move || {
            for id in ["history-00800-00999", "history-00600-00799"] {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(60);
                let (mut stream, _) = loop {
                    match listener.accept() {
                        Ok(value) => break value,
                        Err(e) if e.kind() == std::io::ErrorKind::WouldBlock && std::time::Instant::now() < deadline =>
                            std::thread::sleep(std::time::Duration::from_millis(20)),
                        Err(e) => panic!("local listener: {e}"),
                    }
                };
                stream.set_nonblocking(false).unwrap();
                stream.set_read_timeout(Some(std::time::Duration::from_secs(5))).unwrap();
                let mut request = [0u8; 4096];
                let read = stream.read(&mut request).unwrap();
                assert!(std::str::from_utf8(&request[..read]).unwrap().starts_with(&format!("GET /pack/{id} ")));
                let mut file = std::fs::File::open(sources.join(format!("de441-v2-{id}.eph"))).unwrap();
                let bytes = file.metadata().unwrap().len();
                write!(stream, "HTTP/1.1 200 OK\r\nContent-Length: {bytes}\r\nConnection: close\r\n\r\n").unwrap();
                std::io::copy(&mut file, &mut stream).unwrap();
            }
        });
        let started = handle(&state, PackageRequest::Start {first_year:600, last_year:999, planned:plan.planned, planned_bytes:plan.planned_bytes});
        assert_eq!(started.status, "started");
        assert_eq!(started.total, plan.planned_bytes);
        for _ in 0..600 {
            if !reply(&state, "ok").busy { break; }
            std::thread::sleep(std::time::Duration::from_millis(100));
        }
        let completed = reply(&state, "ok");
        assert!(!completed.busy, "local download timed out");
        assert_eq!(completed.outcome, Some("completed"), "local download failed");
        assert_eq!(completed.downloaded, plan.planned_bytes);
        assert_eq!(completed.total, plan.planned_bytes);
        server.join().unwrap();
        assert!(packs.join("de441-v2-history-00800-00999.eph").exists());
        assert!(packs.join("de441-v2-history-00600-00799.eph").exists());
        let chart_request = |year| serde_json::from_value(serde_json::json!({
            "protocolVersion":1, "latMicro":41900000, "lngMicro":12500000,
            "civil":{"year":year,"month":3,"day":20,"hour":12,"minute":0,"second":0,
                "calendar":"gregorian","offset":{"kind":"supplied","secondsEast":0,"source":"test"},"uncertaintySeconds":0},
            "deltaT":{"kind":"supplied","seconds":69,"uncertaintySeconds":2,"source":"test"}
        })).unwrap();
        let before = serde_json::to_value(crate::historical_chart::calculate_historical_chart(chart_request(700))).unwrap();
        assert_eq!(before["status"], "ok");
        let removed = handle(&state, PackageRequest::Remove {id:"history-00600-00799".into()});
        assert_eq!(removed.status, "ok");
        assert!(!packs.join("de441-v2-history-00600-00799.eph").exists());
        assert!(packs.join("de441-v2-history-00800-00999.eph").exists());
        assert!(ephemeris.join("de441-slice.eph").exists());
        let after = serde_json::to_value(crate::historical_chart::calculate_historical_chart(chart_request(700))).unwrap();
        assert_eq!(after["status"], "ephemeris_out_of_range");
        let still_available = serde_json::to_value(crate::historical_chart::calculate_historical_chart(chart_request(900))).unwrap();
        assert_eq!(still_available["status"], "ok");
    }
}
