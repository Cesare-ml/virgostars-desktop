//! Read-only access to recorded synods in a locally provisioned event archive.
//! Paths and trusted digests stay on the native side of the IPC boundary.
use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynodRequest { protocol_version: u8, utc_micros: i64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynodRecord { body: String, start_millis: Option<i64>, phase: Option<String>, phase_status: Option<String> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynodResponse { protocol_version: u8, status: &'static str, records: Vec<SynodRecord> }

fn response(status: &'static str, records: Vec<SynodRecord>) -> SynodResponse {
    SynodResponse { protocol_version: 1, status, records }
}

#[cfg(feature = "virgostars-event-ephemeris")]
fn query(instant: i64) -> SynodResponse {
    use std::sync::{Mutex, OnceLock};
    use virgostars_events::VirgoStarsEventEphemeris;
    static READER: OnceLock<Mutex<Option<VirgoStarsEventEphemeris>>> = OnceLock::new();
    let Ok(mut reader) = READER.get_or_init(|| Mutex::new(None)).lock() else { return response("unavailable", vec![]); };
    if reader.is_none() {
        let configured = std::env::var_os("VIRGOSTARS_EVENTS_PATH").zip(std::env::var("VIRGOSTARS_EVENTS_SHA256").ok());
        // This snapshot is only staged for local development; never bundled into releases.
        #[cfg(debug_assertions)]
        let configured = configured.or_else(|| {
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.local/event-ephemeris/virgostars-events-20261110.vseph-p0");
            path.is_file().then(|| (path.into_os_string(), "c7746927f9132aea8fc338524d4bc6927010229e1589ff6f1bff5e4f8f6d8c2e".into()))
        });
        let Some((path, digest)) = configured else { return response("archive_missing", vec![]); };
        match VirgoStarsEventEphemeris::open_verified(path, &digest) {
            Ok(open) => *reader = Some(open),
            Err(_) => return response("archive_invalid", vec![]),
        }
    }
    let Ok(synods) = reader.as_ref().unwrap().synods_at(instant) else { return response("unavailable", vec![]); };
    if synods.len() > 128 { return response("unavailable", vec![]); }
    let records = synods.into_iter().map(|(body, snapshot)| SynodRecord {
        body: body.as_str().to_string(),
        start_millis: snapshot.record.map(|record| record.at().as_i64().div_euclid(1000)),
        phase: snapshot.phase.and_then(|value| value.stage.map(|stage| stage.code().to_string())),
        phase_status: snapshot.phase.map(|value| value.status.code().to_string()),
    }).collect();
    response("ok", records)
}

#[cfg(not(feature = "virgostars-event-ephemeris"))]
fn query(_: i64) -> SynodResponse { response("archive_missing", vec![]) }

#[tauri::command]
pub async fn synod_events(request: SynodRequest) -> SynodResponse {
    // The desktop date navigator is intentionally limited to 1900–2033 UTC.
    if request.protocol_version != 1 || !(-2_208_988_800_000_000..2_019_686_400_000_000).contains(&request.utc_micros) {
        return response("invalid_request", vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || query(request.utc_micros)).await
        .unwrap_or_else(|_| response("unavailable", vec![]))
}

#[cfg(all(test, feature = "virgostars-event-ephemeris", debug_assertions))]
mod tests {
    use super::*;
    #[test]
    fn local_owner_archive_yields_recorded_synods_when_staged() {
        let archive = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.local/event-ephemeris/virgostars-events-20261110.vseph-p0");
        if !archive.is_file() { return; }
        let instant = 1_795_000_000_000_000i64;
        let found = query(instant);
        assert_eq!(found.status, "ok");
        assert!(found.records.iter().any(|row| row.body == "Moon" && row.start_millis.is_some()));
        assert!(found.records.iter().all(|row| row.start_millis.is_none_or(|start| start <= instant.div_euclid(1000))));
    }
}
