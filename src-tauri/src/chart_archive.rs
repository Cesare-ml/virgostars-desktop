//! Local archive of saved charts in a SQLite file inside the app's data folder.
//!
//! Only what the user typed is stored: name, UTC instant, time zone, position
//! and place label. Positions are recalculated when a chart is opened, so the
//! archive does not depend on any ephemeris provider.
//!
//! The file is **plain SQLite, not encrypted**. It is protected only by the
//! operating-system account that owns the folder. Encryption at rest, account
//! profiles and synchronisation are separate, still open work.
//!
//! The WebView never supplies a path. A damaged or newer-format file is
//! reported and left untouched; nothing is deleted or recreated automatically.
use crate::chart_calculation::{self, ChartRequestV1};
use rusqlite::{params, Connection, ErrorCode, OpenFlags, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PROTOCOL_VERSION: u8 = 1;
const SCHEMA_VERSION: i64 = 1;
const FILE_NAME: &str = "charts-v1.sqlite3";
const MAX_CHARTS: i64 = 5000;
const MAX_NAME_CHARS: usize = 80;
const MAX_PLACE_CHARS: usize = 160;
const MAX_ZONE_BYTES: usize = 120;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveRequestV1 {
    pub protocol_version: u8,
    /// `list`, `save` or `delete`.
    pub operation: String,
    pub chart: Option<ChartRecordV1>,
    pub id: Option<String>,
}

/// What the user entered. The id is generated once by the client and never
/// changes, so repeating a save is idempotent.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartRecordV1 {
    pub id: String,
    pub name: String,
    pub utc_iso: String,
    pub time_zone: String,
    pub lat_micro: i32,
    pub lng_micro: i32,
    pub place_name: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SavedChartV1 {
    pub id: String,
    pub name: String,
    pub utc_iso: String,
    pub time_zone: String,
    pub lat_micro: i32,
    pub lng_micro: i32,
    pub place_name: String,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveResponseV1 {
    pub protocol_version: u8,
    /// `ok`, `invalid_request`, `not_found`, `archive_full`,
    /// `archive_unavailable`, `archive_corrupt` or `archive_newer`.
    pub status: &'static str,
    /// The whole archive after the operation, present only with `ok`.
    pub charts: Option<Vec<SavedChartV1>>,
}

type Failure = &'static str;

fn failure(status: Failure) -> ArchiveResponseV1 {
    ArchiveResponseV1 { protocol_version: PROTOCOL_VERSION, status, charts: None }
}

/// Lowercase canonical UUID text, e.g. from `crypto.randomUUID()`.
fn valid_id(id: &str) -> bool {
    id.len() == 36
        && id.bytes().enumerate().all(|(index, byte)| match index {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => matches!(byte, b'0'..=b'9' | b'a'..=b'f'),
        })
}

/// Display text: bounded, already trimmed, no control or invisible format characters.
fn valid_text(text: &str, max_chars: usize) -> bool {
    text.chars().count() <= max_chars
        && text.trim() == text
        && !text.chars().any(|ch| ch.is_control() || matches!(ch, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}'))
}

fn valid_zone(zone: &str) -> bool {
    !zone.is_empty()
        && zone.len() <= MAX_ZONE_BYTES
        && zone.split('/').enumerate().all(|(index, part)| {
            let mut bytes = part.bytes();
            match bytes.next() {
                Some(first) if index > 0 || first.is_ascii_alphabetic() => {
                    (first.is_ascii_alphanumeric() || matches!(first, b'_' | b'+' | b'-'))
                        && bytes.all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'+' | b'-'))
                }
                _ => false,
            }
        })
}

fn valid_record(chart: &ChartRecordV1) -> bool {
    let instant_and_place = ChartRequestV1 {
        protocol_version: chart_calculation::PROTOCOL_VERSION,
        utc_iso: chart.utc_iso.clone(),
        lat_micro: chart.lat_micro,
        lng_micro: chart.lng_micro,
    };
    valid_id(&chart.id)
        && !chart.name.is_empty()
        && valid_text(&chart.name, MAX_NAME_CHARS)
        && valid_text(&chart.place_name, MAX_PLACE_CHARS)
        && valid_zone(&chart.time_zone)
        && chart_calculation::validate(&instant_and_place).is_some()
}

fn classify(error: &rusqlite::Error) -> Failure {
    match error.sqlite_error_code() {
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt) => "archive_corrupt",
        _ => "archive_unavailable",
    }
}

/// Opens the archive and brings an empty file to the current schema.
fn open(path: &Path) -> Result<Connection, Failure> {
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(|_| "archive_unavailable")?;
    }
    let mut connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|error| classify(&error))?;
    connection.busy_timeout(Duration::from_secs(2)).map_err(|error| classify(&error))?;
    let health: String =
        connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    if health != "ok" {
        return Err("archive_corrupt");
    }
    let version: i64 =
        connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    match version {
        SCHEMA_VERSION => {}
        0 => {
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(|error| classify(&error))?;
            transaction
                .execute_batch(
                    "CREATE TABLE saved_charts (
                       id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
                       name TEXT NOT NULL,
                       utc_iso TEXT NOT NULL,
                       time_zone TEXT NOT NULL,
                       lat_micro INTEGER NOT NULL CHECK (lat_micro BETWEEN -90000000 AND 90000000),
                       lng_micro INTEGER NOT NULL CHECK (lng_micro BETWEEN -180000000 AND 180000000),
                       place_name TEXT NOT NULL,
                       created_at_ms INTEGER NOT NULL,
                       updated_at_ms INTEGER NOT NULL
                     ) STRICT;
                     PRAGMA user_version = 1;",
                )
                .map_err(|error| classify(&error))?;
            transaction.commit().map_err(|error| classify(&error))?;
        }
        // Written by a newer application: reading it with old rules could lose data.
        _ => return Err("archive_newer"),
    }
    Ok(connection)
}

fn list(connection: &Connection) -> Result<Vec<SavedChartV1>, Failure> {
    let mut statement = connection
        .prepare(
            "SELECT id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms
             FROM saved_charts ORDER BY name COLLATE NOCASE, created_at_ms, id LIMIT ?1",
        )
        .map_err(|error| classify(&error))?;
    let rows = statement
        .query_map([MAX_CHARTS], |row| {
            Ok(SavedChartV1 {
                id: row.get(0)?,
                name: row.get(1)?,
                utc_iso: row.get(2)?,
                time_zone: row.get(3)?,
                lat_micro: row.get(4)?,
                lng_micro: row.get(5)?,
                place_name: row.get(6)?,
                created_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
            })
        })
        .map_err(|error| classify(&error))?;
    rows.collect::<Result<Vec<_>, _>>().map_err(|error| classify(&error))
}

fn save(connection: &mut Connection, chart: &ChartRecordV1, now_ms: i64, limit: i64) -> Result<(), Failure> {
    let transaction =
        connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error| classify(&error))?;
    let exists: bool = transaction
        .query_row("SELECT EXISTS(SELECT 1 FROM saved_charts WHERE id=?1)", [&chart.id], |row| row.get(0))
        .map_err(|error| classify(&error))?;
    if !exists {
        let count: i64 = transaction
            .query_row("SELECT COUNT(*) FROM saved_charts", [], |row| row.get(0))
            .map_err(|error| classify(&error))?;
        if count >= limit {
            return Err("archive_full");
        }
    }
    transaction
        .execute(
            "INSERT INTO saved_charts
               (id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, utc_iso=excluded.utc_iso, time_zone=excluded.time_zone,
               lat_micro=excluded.lat_micro, lng_micro=excluded.lng_micro,
               place_name=excluded.place_name, updated_at_ms=excluded.updated_at_ms",
            params![chart.id, chart.name, chart.utc_iso, chart.time_zone, chart.lat_micro, chart.lng_micro, chart.place_name, now_ms],
        )
        .map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

fn delete(connection: &Connection, id: &str) -> Result<(), Failure> {
    match connection.execute("DELETE FROM saved_charts WHERE id=?1", [id]) {
        Ok(0) => Err("not_found"),
        Ok(_) => Ok(()),
        Err(error) => Err(classify(&error)),
    }
}

fn run(path: &Path, request: &ArchiveRequestV1, now_ms: i64, limit: i64) -> Result<Vec<SavedChartV1>, Failure> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err("invalid_request");
    }
    // Validate completely before touching the disk.
    match (request.operation.as_str(), &request.chart, &request.id) {
        ("list", None, None) => list(&open(path)?),
        ("save", Some(chart), None) if valid_record(chart) => {
            let mut connection = open(path)?;
            save(&mut connection, chart, now_ms, limit)?;
            list(&connection)
        }
        ("delete", None, Some(id)) if valid_id(id) => {
            let connection = open(path)?;
            delete(&connection, id)?;
            list(&connection)
        }
        _ => Err("invalid_request"),
    }
}

/// Pure entry point, separated from Tauri so it can be unit tested.
pub fn handle(path: &Path, request: &ArchiveRequestV1, now_ms: i64) -> ArchiveResponseV1 {
    match run(path, request, now_ms, MAX_CHARTS) {
        Ok(charts) => ArchiveResponseV1 { protocol_version: PROTOCOL_VERSION, status: "ok", charts: Some(charts) },
        Err(status) => failure(status),
    }
}

#[tauri::command]
pub fn chart_archive(app: AppHandle, request: ArchiveRequestV1) -> ArchiveResponseV1 {
    let Ok(folder) = app.path().app_local_data_dir() else {
        return failure("archive_unavailable");
    };
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0);
    handle(&folder.join(FILE_NAME), &request, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const ID_A: &str = "11111111-1111-4111-8111-111111111111";
    const ID_B: &str = "22222222-2222-4222-8222-222222222222";

    /// A unique file in the system temp folder, removed when the test ends.
    struct TempArchive(PathBuf);
    impl TempArchive {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let mut path = std::env::temp_dir();
            path.push(format!("vs-chart-archive-{label}-{}-{unique}", std::process::id()));
            path.push(FILE_NAME);
            Self(path)
        }
    }
    impl Drop for TempArchive {
        fn drop(&mut self) {
            if let Some(folder) = self.0.parent() {
                let _ = std::fs::remove_dir_all(folder);
            }
        }
    }

    // Visibly fictional subjects.
    fn record(id: &str, name: &str) -> ChartRecordV1 {
        ChartRecordV1 {
            id: id.to_string(),
            name: name.to_string(),
            utc_iso: "2001-02-03T04:05:06.000Z".to_string(),
            time_zone: "Europe/Rome".to_string(),
            lat_micro: 44_697_805,
            lng_micro: 11_805_778,
            place_name: "Luogo di prova".to_string(),
        }
    }
    fn list_request() -> ArchiveRequestV1 {
        ArchiveRequestV1 { protocol_version: 1, operation: "list".into(), chart: None, id: None }
    }
    fn save_request(chart: ChartRecordV1) -> ArchiveRequestV1 {
        ArchiveRequestV1 { protocol_version: 1, operation: "save".into(), chart: Some(chart), id: None }
    }
    fn delete_request(id: &str) -> ArchiveRequestV1 {
        ArchiveRequestV1 { protocol_version: 1, operation: "delete".into(), chart: None, id: Some(id.into()) }
    }

    #[test]
    fn test_empty_chart_name_is_rejected_without_touching_disk() {
        let archive = TempArchive::new("empty-name");
        for name in ["", " ", "\\t"] {
            let response = handle(&archive.0, &save_request(record(ID_A, name)), 1000);
            assert_eq!(response.status, "invalid_request");
            assert!(!archive.0.exists());
        }
    }

    #[test]
    fn test_first_use_creates_an_empty_archive_at_schema_version_one() {
        let archive = TempArchive::new("create");
        let response = handle(&archive.0, &list_request(), 1000);
        assert_eq!(response.status, "ok");
        assert_eq!(response.charts, Some(vec![]));
        let connection = Connection::open(&archive.0).unwrap();
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, 1);
    }

    #[test]
    fn test_saved_charts_survive_reopening_and_are_listed_by_name() {
        let archive = TempArchive::new("persist");
        assert_eq!(handle(&archive.0, &save_request(record(ID_B, "Zeta di prova")), 1000).status, "ok");
        let after = handle(&archive.0, &save_request(record(ID_A, "alfa di prova")), 2000);
        assert_eq!(after.charts.as_ref().unwrap().len(), 2);
        // A fresh connection, as after restarting the application.
        let listed = handle(&archive.0, &list_request(), 3000).charts.unwrap();
        assert_eq!(listed.iter().map(|chart| chart.name.as_str()).collect::<Vec<_>>(), ["alfa di prova", "Zeta di prova"]);
        assert_eq!(listed[0].id, ID_A);
        assert_eq!(listed[0].utc_iso, "2001-02-03T04:05:06.000Z");
        assert_eq!((listed[0].lat_micro, listed[0].lng_micro), (44_697_805, 11_805_778));
        assert_eq!((listed[0].created_at_ms, listed[0].updated_at_ms), (2000, 2000));
    }

    #[test]
    fn test_saving_the_same_id_again_updates_in_place_and_keeps_the_creation_time() {
        let archive = TempArchive::new("update");
        handle(&archive.0, &save_request(record(ID_A, "Prima versione")), 1000);
        let mut edited = record(ID_A, "Seconda versione");
        edited.lat_micro = -33_868_800;
        let listed = handle(&archive.0, &save_request(edited), 5000).charts.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Seconda versione");
        assert_eq!(listed[0].lat_micro, -33_868_800);
        assert_eq!((listed[0].created_at_ms, listed[0].updated_at_ms), (1000, 5000));
    }

    #[test]
    fn test_delete_removes_one_chart_and_reports_an_unknown_id() {
        let archive = TempArchive::new("delete");
        handle(&archive.0, &save_request(record(ID_A, "Da tenere")), 1000);
        handle(&archive.0, &save_request(record(ID_B, "Da eliminare")), 1000);
        let listed = handle(&archive.0, &delete_request(ID_B), 2000).charts.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, ID_A);
        assert_eq!(handle(&archive.0, &delete_request(ID_B), 3000).status, "not_found");
        assert_eq!(handle(&archive.0, &list_request(), 4000).charts.unwrap().len(), 1);
    }

    #[test]
    fn test_invalid_requests_are_rejected_without_creating_a_file() {
        let archive = TempArchive::new("invalid");
        let mut bad_requests = vec![
            ArchiveRequestV1 { protocol_version: 2, ..list_request() },
            ArchiveRequestV1 { operation: "drop".into(), ..list_request() },
            ArchiveRequestV1 { id: Some(ID_A.into()), ..list_request() },
            ArchiveRequestV1 { chart: None, ..save_request(record(ID_A, "x")) },
            delete_request("not-an-id"),
            delete_request("11111111-1111-4111-8111-11111111111G"),
            delete_request("11111111-1111-4111-8111-1111111111111"),
            delete_request(&ID_A.to_uppercase().replace('1', "A")),
        ];
        let mutate = |change: fn(&mut ChartRecordV1)| {
            let mut chart = record(ID_A, "Soggetto di prova");
            change(&mut chart);
            save_request(chart)
        };
        bad_requests.extend([
            mutate(|chart| chart.id = "../../etc".into()),
            mutate(|chart| chart.name = "x".repeat(81)),
            mutate(|chart| chart.name = " spazio iniziale".into()),
            mutate(|chart| chart.name = "riga\nnuova".into()),
            mutate(|chart| chart.name = "nascosto\u{202E}".into()),
            mutate(|chart| chart.place_name = "p".repeat(161)),
            mutate(|chart| chart.utc_iso = "2001-02-03T04:05:06+01:00".into()),
            mutate(|chart| chart.utc_iso = "2001-02-30T04:05:06Z".into()),
            mutate(|chart| chart.time_zone = "+01:00".into()),
            mutate(|chart| chart.time_zone = "Europe/../Rome".into()),
            mutate(|chart| chart.time_zone = "Europe/Rome; DROP".into()),
            mutate(|chart| chart.time_zone = String::new()),
            mutate(|chart| chart.lat_micro = 90_000_001),
            mutate(|chart| chart.lng_micro = -180_000_001),
        ]);
        for (index, request) in bad_requests.iter().enumerate() {
            assert_eq!(handle(&archive.0, request, 1000).status, "invalid_request", "request {index}");
        }
        assert!(!archive.0.exists(), "validation must happen before any disk access");
        // An empty name is allowed: the interface shows "unnamed chart".
        assert_eq!(handle(&archive.0, &save_request(record(ID_A, "")), 1000).status, "ok");
    }

    #[test]
    fn test_text_that_looks_like_sql_is_stored_as_text() {
        let archive = TempArchive::new("literal");
        let name = "Robert'); DROP TABLE saved_charts;--";
        handle(&archive.0, &save_request(record(ID_A, name)), 1000);
        let listed = handle(&archive.0, &list_request(), 2000).charts.unwrap();
        assert_eq!(listed[0].name, name);
    }

    #[test]
    fn test_a_damaged_file_is_reported_and_left_untouched() {
        let archive = TempArchive::new("corrupt");
        std::fs::create_dir_all(archive.0.parent().unwrap()).unwrap();
        let garbage = b"this is not a SQLite database, it is a damaged archive ".repeat(40);
        std::fs::write(&archive.0, &garbage).unwrap();
        for request in [list_request(), save_request(record(ID_A, "Soggetto")), delete_request(ID_A)] {
            assert_eq!(handle(&archive.0, &request, 1000).status, "archive_corrupt");
        }
        assert_eq!(std::fs::read(&archive.0).unwrap(), garbage);
    }

    #[test]
    fn test_an_archive_from_a_newer_application_is_not_opened() {
        let archive = TempArchive::new("newer");
        handle(&archive.0, &save_request(record(ID_A, "Soggetto")), 1000);
        Connection::open(&archive.0).unwrap().execute_batch("PRAGMA user_version = 2;").unwrap();
        assert_eq!(handle(&archive.0, &list_request(), 2000).status, "archive_newer");
        assert_eq!(handle(&archive.0, &delete_request(ID_A), 2000).status, "archive_newer");
        let connection = Connection::open(&archive.0).unwrap();
        let count: i64 = connection.query_row("SELECT COUNT(*) FROM saved_charts", [], |row| row.get(0)).unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn test_a_full_archive_refuses_new_charts_but_still_updates_existing_ones() {
        let archive = TempArchive::new("full");
        assert!(run(&archive.0, &save_request(record(ID_A, "Primo")), 1000, 1).is_ok());
        assert_eq!(run(&archive.0, &save_request(record(ID_B, "Secondo")), 2000, 1), Err("archive_full"));
        let updated = run(&archive.0, &save_request(record(ID_A, "Primo modificato")), 3000, 1).unwrap();
        assert_eq!(updated.len(), 1);
        assert_eq!(updated[0].name, "Primo modificato");
    }

    #[test]
    fn test_wire_format_matches_the_typescript_contract() {
        let archive = TempArchive::new("wire");
        let raw = serde_json::to_value(handle(&archive.0, &save_request(record(ID_A, "Soggetto")), 1234)).unwrap();
        assert_eq!(raw["protocolVersion"], 1);
        assert_eq!(raw["status"], "ok");
        let chart = &raw["charts"][0];
        for key in ["id", "name", "utcIso", "timeZone", "latMicro", "lngMicro", "placeName", "createdAtMs", "updatedAtMs"] {
            assert!(!chart[key].is_null(), "missing key {key}");
        }
        let extra = r#"{"protocolVersion":1,"operation":"list","chart":null,"id":null,"path":"C:/x"}"#;
        assert!(serde_json::from_str::<ArchiveRequestV1>(extra).is_err());
        let minimal = r#"{"protocolVersion":1,"operation":"list"}"#;
        assert!(serde_json::from_str::<ArchiveRequestV1>(minimal).is_ok());
        let failed = serde_json::to_value(failure("archive_corrupt")).unwrap();
        assert!(failed["charts"].is_null());
    }
}
