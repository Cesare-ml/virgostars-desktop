//! Read-only access to recorded synods in the verified bundled event archive.
//! Paths and trusted digests stay on the native side of the IPC boundary.
use serde::{Deserialize, Serialize};
#[cfg(feature = "virgostars-event-ephemeris")]
use std::{ffi::OsString, path::{Path,PathBuf}, sync::OnceLock};

#[cfg(feature = "virgostars-event-ephemeris")]
const ARCHIVE_NAME:&str = "virgostars-events-20261110.vseph-p0";
#[cfg(feature = "virgostars-event-ephemeris")]
const ARCHIVE_SHA256:&str = "c7746927f9132aea8fc338524d4bc6927010229e1589ff6f1bff5e4f8f6d8c2e";
#[cfg(feature = "virgostars-event-ephemeris")]
static RESOURCE_FOLDER:OnceLock<PathBuf> = OnceLock::new();
#[cfg(feature = "virgostars-event-ephemeris")]
static LOCAL_FOLDER:OnceLock<PathBuf> = OnceLock::new();

#[cfg(feature = "virgostars-event-ephemeris")]
pub(crate) fn configure(resource_folder:Option<PathBuf>,local_folder:Option<PathBuf>) {
    if let Some(folder)=resource_folder {let _=RESOURCE_FOLDER.set(folder);}
    if let Some(folder)=local_folder {let _=LOCAL_FOLDER.set(folder);}
}

#[cfg(feature = "virgostars-event-ephemeris")]
fn archive_source(configured:Option<(OsString,String)>, resource_folder:Option<&Path>, debug_path:Option<&Path>) -> Option<(PathBuf,String)> {
    if let Some((path,digest))=configured {return Some((PathBuf::from(path),digest));}
    if let Some(folder)=resource_folder {
        let path=folder.join("ephemeris").join("events").join(ARCHIVE_NAME);
        if path.is_file() {return Some((path,ARCHIVE_SHA256.into()));}
    }
    debug_path.filter(|path|path.is_file()).map(|path|(path.to_path_buf(),ARCHIVE_SHA256.into()))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SynodRequest { protocol_version: u8, utc_micros: i64 }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynodRecord { body: String, start_millis: Option<i64>, phase: Option<String>, phase_status: Option<String>, phase_starts_millis: Option<[i64;4]> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SynodResponse { protocol_version: u8, status: &'static str, records: Vec<SynodRecord> }

fn response(status: &'static str, records: Vec<SynodRecord>) -> SynodResponse {
    SynodResponse { protocol_version: 1, status, records }
}

#[cfg(feature = "virgostars-event-ephemeris")]
fn query(instant: i64) -> SynodResponse {
    use std::sync::{Mutex, OnceLock};
    use virgostars_events::{Event, VirgoStarsEventEphemeris};
    static READER: OnceLock<Mutex<Option<VirgoStarsEventEphemeris>>> = OnceLock::new();
    let Ok(mut reader) = READER.get_or_init(|| Mutex::new(None)).lock() else { return response("unavailable", vec![]); };
    if reader.is_none() {
        let configured = std::env::var_os("VIRGOSTARS_EVENTS_PATH").zip(std::env::var("VIRGOSTARS_EVENTS_SHA256").ok());
        #[cfg(debug_assertions)]
        let debug_path=Some(Path::new(env!("CARGO_MANIFEST_DIR")).join("../.local/event-ephemeris").join(ARCHIVE_NAME));
        #[cfg(not(debug_assertions))]
        let debug_path:Option<PathBuf>=None;
        let source=archive_source(configured,RESOURCE_FOLDER.get().map(PathBuf::as_path),None).or_else(|| {
            let fallback=LOCAL_FOLDER.get().and_then(|folder|crate::update_backup::preserved_resource(folder,&format!("ephemeris/events/{ARCHIVE_NAME}")));
            archive_source(None,None,fallback.as_deref().or(debug_path.as_deref()))
        });
        let Some((path, digest)) = source else { return response("archive_missing", vec![]); };
        match VirgoStarsEventEphemeris::open_verified(path, &digest) {
            Ok(open) => *reader = Some(open),
            Err(_) => return response("archive_invalid", vec![]),
        }
    }
    let Ok(synods) = reader.as_ref().unwrap().synods_at(instant) else { return response("unavailable", vec![]); };
    if synods.len() > 128 { return response("unavailable", vec![]); }
    let records = synods.into_iter().map(|(body, snapshot)| {
        let starts = if matches!(body.as_str(),"Mercury"|"Venus"|"Mars"|"Jupiter"|"Saturn"|"Uranus"|"Neptune"|"Pluto") {
            match (&snapshot.record, snapshot.next_recorded_start) {
                (Some(record),Some(next)) => match &record.event {
                    Event::Synod(event) => event.phases().and_then(|p| {
                        if p.len()!=3 {return None;}
                        let times=[event.start().as_i64(),p[0].at().as_i64(),p[1].at().as_i64(),p[2].at().as_i64()];
                        (times.windows(2).all(|w|w[0]<w[1]) && times[3]<next.as_i64())
                            .then(||times.map(|t|t.div_euclid(1000)))
                    }),
                    _=>None,
                },
                _=>None,
            }
        } else {None};
        SynodRecord {
            body: body.as_str().to_string(),
            start_millis: snapshot.record.map(|record| record.at().as_i64().div_euclid(1000)),
            phase: snapshot.phase.and_then(|value| value.stage.map(|stage| stage.code().to_string())),
            phase_status: snapshot.phase.map(|value| value.status.code().to_string()),
            phase_starts_millis: starts,
        }
    }).collect();
    response("ok", records)
}

#[cfg(not(feature = "virgostars-event-ephemeris"))]
fn query(_: i64) -> SynodResponse { response("archive_missing", vec![]) }

fn valid_request(request:&SynodRequest)->bool {
    request.protocol_version == 1 && (-62_135_596_800_000_000..32_535_216_000_000_000).contains(&request.utc_micros)
}

#[tauri::command]
pub async fn synod_events(request: SynodRequest) -> SynodResponse {
    // Match the date navigator's years 1–3000, not the former ΔT-table range.
    if !valid_request(&request) {
        return response("invalid_request", vec![]);
    }
    tauri::async_runtime::spawn_blocking(move || query(request.utc_micros)).await
        .unwrap_or_else(|_| response("unavailable", vec![]))
}

#[cfg(all(test, feature = "virgostars-event-ephemeris", debug_assertions))]
mod tests {
    use super::*;
    #[test]
    fn synod_request_accepts_extended_navigator_dates() {
        for time in [-36_921_657_600_000_000i64,7_258_118_400_000_000] {
            assert!(valid_request(&SynodRequest {protocol_version:1,utc_micros:time}));
        }
        for time in [-62_135_596_800_000_001i64,32_535_216_000_000_000] {
            assert!(!valid_request(&SynodRequest {protocol_version:1,utc_micros:time}));
        }
    }
    #[test]
    fn bundled_archive_is_selected_without_environment_and_verified() {
        let fixture=Path::new(env!("CARGO_MANIFEST_DIR")).join("../.local/event-ephemeris").join(ARCHIVE_NAME);
        if !fixture.is_file() {return;}
        let temp=tempfile::tempdir().unwrap();
        let folder=temp.path().join("ephemeris/events");
        std::fs::create_dir_all(&folder).unwrap();
        let installed=folder.join(ARCHIVE_NAME);
        std::fs::copy(&fixture,&installed).unwrap();
        let (path,digest)=archive_source(None,Some(temp.path()),None).unwrap();
        assert_eq!(path,installed);
        let reader=virgostars_events::VirgoStarsEventEphemeris::open_verified(&path,&digest).unwrap();
        let rows=reader.synods_at(959_817_600_000_000).unwrap();
        assert!(rows.iter().any(|(body,row)|body.as_str()=="Mars" && row.record.is_some()));
        for instant in [-36_921_657_600_000_000i64,7_258_118_400_000_000] {
            let rows=reader.synods_at(instant).unwrap();
            assert!(rows.iter().any(|(body,row)|body.as_str()=="Mercury" && row.record.is_some() && row.next_recorded_start.is_some()));
        }
        drop(reader);
        std::fs::write(&installed,b"modified").unwrap();
        assert!(virgostars_events::VirgoStarsEventEphemeris::open_verified(&path,&digest).is_err());
    }
    #[test]
    fn missing_bundled_archive_does_not_produce_a_fabricated_path() {
        let temp=tempfile::tempdir().unwrap();
        assert!(archive_source(None,Some(temp.path()),None).is_none());
        let explicit=(OsString::from("local-file"),"chosen-digest".to_string());
        assert_eq!(archive_source(Some(explicit),Some(temp.path()),None),Some((PathBuf::from("local-file"),"chosen-digest".into())));
    }
    #[test]
    #[ignore = "requires the locally staged event archive, DE441 and USNO data"]
    fn recorded_planetary_boundaries_are_checked_against_the_local_ephemeris() {
        use crate::chart_calculation::{EphemerisProvider, ValidatedRequest};
        use crate::virgostars_provider::VirgoStarsEphemeris;
        use virgostars_ephemeris_core::calendar::{Calendar, JulianDate, TimeScale};
        let response=query(959_817_600_000_000); // Synthetic reference: 2000-06-01 UTC.
        assert_eq!(response.status,"ok");
        let mut checked=0;
        for row in &response.records {
            let Some(times)=row.phase_starts_millis else {continue};
            for (phase,instant) in times.iter().enumerate() {
                let jd=2_440_587.5+(*instant as f64)/86_400_000.0;
                let civil=JulianDate::from_f64(jd,TimeScale::Ut1).unwrap().to_calendar(Calendar::ProlepticGregorian).unwrap();
                let request=ValidatedRequest {year:civil.year,month:u32::from(civil.month),day:u32::from(civil.day),
                    hour:f64::from(civil.hour)+f64::from(civil.minute)/60.0+civil.second/3600.0,
                    latitude_deg:41.9,longitude_deg:12.5};
                let chart=VirgoStarsEphemeris.chart(&request).unwrap();
                let body=chart.bodies.iter().find(|b|b.id==row.body).unwrap();
                let sun=chart.bodies.iter().find(|b|b.id=="Sun").unwrap();
                let target=if phase==2 && !matches!(row.body.as_str(),"Mercury"|"Venus") {180.0} else {0.0};
                let error=if phase==1 || phase==3 {body.longitude_speed.abs()} else {
                    ((body.longitude_deg-sun.longitude_deg-target+180.0).rem_euclid(360.0)-180.0).abs()
                };
                // Phase anchors and stationary points must agree with the
                // local ephemeris to within this intentionally broad tolerance.
                assert!(error<0.001,"{} phase {} residual {}",row.body,phase,error);
                checked+=1;
            }
        }
        assert!(checked>0,"no complete phases in local archive");
    }
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
