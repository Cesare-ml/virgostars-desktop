//! Local, **encrypted** archive of saved charts inside the app's data folder.
//!
//! Only what the user typed is stored: name, UTC instant, time zone, position and place label.
//! Positions are recalculated when a chart is opened, so the archive does not depend on any
//! ephemeris provider.
//!
//! On disk there is one sealed file (`archive_vault`): a SQLite database encrypted and
//! authenticated as a whole with a random key kept by the operating system's credential store
//! (`archive_keys`). While the app works, the database lives in memory; every change is sealed to a
//! staging file and moved over the archive atomically, so no plain page, journal or temporary copy is
//! ever written. If the key is unavailable or wrong the archive stays locked: there is no plaintext
//! fallback.
//!
//! The first prototype kept a plain SQLite file (`charts-v1.sqlite3`). It is migrated once, after
//! validation and a read-back check, and is **not** deleted automatically: removing it is an explicit
//! request (`remove_legacy`), because ordinary deletion is not secure erasure.
//!
//! The WebView never supplies a path or sees a key. A damaged or newer-format file is reported and
//! left untouched; nothing is repaired or recreated automatically.
use crate::archive_keys::{new_key, Key, KeyError, KeyStore, OsKeyStore};
use crate::archive_vault::{self, VaultError};
use crate::chart_calculation::{self, ChartRequestV1};
use crate::historical_chart::HistoricalChartRequest;
use crate::chart_photos::{self, PhotoError};
use rusqlite::serialize::OwnedData;
use rusqlite::{params, Connection, DatabaseName, ErrorCode, OpenFlags, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::ptr::NonNull;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const PROTOCOL_VERSION: u8 = 1;
const SCHEMA_VERSION: i64 = 7;
const OUTBOX_SCHEMA_VERSION: i64 = 6;
const ASSOCIATION_SCHEMA_VERSION: i64 = 5;
const CIVIL_SCHEMA_VERSION: i64 = 4;
const LEGACY_SCHEMA_VERSION: i64 = 1;
const GROUPS_SCHEMA_VERSION: i64 = 2;
const GROUP_LINKS_SCHEMA_VERSION: i64 = 3;
const LEGACY_FILE_NAME: &str = "charts-v1.sqlite3";
const SEALED_FILE_NAME: &str = "charts-v2.vsarchive";
const STAGING_FILE_NAME: &str = "charts-v2.vsarchive.tmp";
const MAX_CHARTS: i64 = 5000;
const MAX_NAME_CHARS: usize = 80;
const MAX_PLACE_CHARS: usize = 160;
const MAX_ZONE_BYTES: usize = 120;
const MAX_GROUPS: usize = 50;
const MAX_GROUP_CHARS: usize = 160;

/// One reader-writer at a time: every change is a read, a change and a rewrite of the sealed file.
static ARCHIVE_LOCK: Mutex<()> = Mutex::new(());

/// Serialize the installer handoff with archive and local-photo operations.
pub(crate) fn lock_for_update() -> std::sync::MutexGuard<'static, ()> {
    ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ArchiveRequestV1 {
    pub protocol_version: u8,
    /// `list`, `save`, `delete` or `remove_legacy`.
    pub operation: String,
    pub chart: Option<ChartRecordV1>,
    pub id: Option<String>,
    /// Only for `photo_save`: a bounded, already-resized JPEG. Never synced.
    pub photo_data: Option<Vec<u8>>,
    pub groups: Option<Vec<String>>,
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub historical: Option<HistoricalChartRequest>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub historical: Option<HistoricalChartRequest>,
    pub created_at_ms: i64,
    pub updated_at_ms: i64,
    pub groups: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveResponseV1 {
    pub protocol_version: u8,
    /// `ok`, `invalid_request`, `not_found`, `archive_full`, `archive_unavailable`,
    /// `archive_corrupt`, `archive_newer` or `archive_locked`.
    pub status: &'static str,
    /// The whole archive after the operation, present only with `ok`.
    pub charts: Option<Vec<SavedChartV1>>,
    /// The old plain-text file of the first prototype is still on disk.
    pub legacy_present: bool,
    /// Photo presence is device-local metadata, not a field on SavedChartV1.
    pub photo_ids: Vec<String>,
    /// Present only for a requested `photo_read`; never returned by `list`.
    pub photo_data: Option<Vec<u8>>,
}

type Failure = &'static str;

/// What a successful operation hands back.
#[derive(Debug, Clone, PartialEq)]
struct Outcome {
    charts: Vec<SavedChartV1>,
    legacy_present: bool,
    photo_ids: Vec<String>,
    photo_data: Option<Vec<u8>>,
}

fn failure(status: Failure) -> ArchiveResponseV1 {
    ArchiveResponseV1 { protocol_version: PROTOCOL_VERSION, status, charts: None, legacy_present: false, photo_ids: Vec::new(), photo_data: None }
}

fn photo_failure(error: PhotoError) -> Failure {
    match error {
        PhotoError::Invalid => "invalid_request",
        PhotoError::Unavailable => "archive_unavailable",
        PhotoError::Corrupt => "photo_corrupt",
    }
}

/// Lowercase canonical UUID text, e.g. from `crypto.randomUUID()`.
pub(crate) fn valid_id(id: &str) -> bool {
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
        include_solar_events: false,
        include_previous_new_moon: false,
        include_fixed_stars: false,
    };
    valid_id(&chart.id)
        && valid_text(&chart.name, MAX_NAME_CHARS)
        && valid_text(&chart.place_name, MAX_PLACE_CHARS)
        && match &chart.historical {
            None => valid_zone(&chart.time_zone) && chart_calculation::validate(&instant_and_place).is_some(),
            Some(historical) => chart.utc_iso.is_empty() && chart.time_zone.is_empty()
                && historical.valid() && historical.lat_micro == chart.lat_micro && historical.lng_micro == chart.lng_micro,
        }
}

pub(crate) fn valid_groups(groups: &[String]) -> bool {
    groups.len() <= MAX_GROUPS && groups.iter().enumerate().all(|(index, name)|
        !name.is_empty() && valid_text(name, MAX_GROUP_CHARS) && !groups[..index].contains(name))
}

/// Owner-scoped data already obtained through a verified native session.
/// It has no UTC instant: civil times are kept unchanged until independently
/// resolved, and an unknown time is never replaced by midnight.
pub(crate) struct RemoteCivilChart {
    pub sync_id: String,
    pub name: String,
    pub kind: String,
    pub civil_date: String,
    pub civil_time: Option<String>,
    pub time_unknown: bool,
    pub time_zone: Option<String>,
    pub lat_micro: Option<i32>,
    pub lng_micro: Option<i32>,
    pub place_name: String,
    pub place_mode: String,
    pub city_ref: Option<String>,
    pub sex: Option<String>,
    pub is_account_chart: bool,
    pub revision: i64,
    pub updated_at: String,
    pub groups: Vec<String>,
}

fn safe_remote_text(value: &str, max: usize, nonempty: bool) -> bool {
    value.chars().count() <= max && (!nonempty || !value.trim().is_empty())
        && !value.chars().any(|ch| ch.is_control() || matches!(ch, '\u{200B}'..='\u{200F}' | '\u{202A}'..='\u{202E}' | '\u{2066}'..='\u{2069}' | '\u{FEFF}'))
}

pub(crate) fn valid_civil_date(value: &str) -> bool {
    let b=value.as_bytes();
    if b.len()!=10 || b[4]!=b'-' || b[7]!=b'-'
        || !b.iter().enumerate().all(|(i,c)| i==4 || i==7 || c.is_ascii_digit()) { return false; }
    let number = |indices: &[usize]| -> u32 { indices.iter().fold(0,|n,&i|n*10+u32::from(b[i]-b'0')) };
    let year=number(&[0,1,2,3]); let month=number(&[5,6]); let day=number(&[8,9]);
    if year==0 || !(1..=12).contains(&month) || day==0 { return false; }
    let leap=year%4==0 && (year%100!=0 || year%400==0);
    let days=[31,if leap {29} else {28},31,30,31,30,31,31,30,31,30,31];
    day<=days[(month-1) as usize]
}

pub(crate) fn valid_civil_clock(value: &str) -> bool {
    let b=value.as_bytes();
    if b.len()!=8 || b[2]!=b':' || b[5]!=b':'
        || !b.iter().enumerate().all(|(i,c)| i==2 || i==5 || c.is_ascii_digit()) { return false; }
    let pair=|i:usize| (b[i]-b'0')*10+(b[i+1]-b'0');
    pair(0)<=23 && pair(3)<=59 && pair(6)<=59
}

pub(crate) fn valid_remote_chart(chart: &RemoteCivilChart) -> bool {
    valid_id(&chart.sync_id) && safe_remote_text(&chart.name,255,true)
        && matches!(chart.kind.as_str(),"unclassified" | "self" | "person" | "event" | "public_subject")
        && valid_civil_date(&chart.civil_date)
        && if chart.time_unknown { chart.civil_time.is_none() }
           else { chart.civil_time.as_deref().is_some_and(valid_civil_clock) }
        && chart.time_zone.as_deref().is_none_or(valid_zone)
        && matches!((chart.lat_micro,chart.lng_micro), (None,None) | (Some(-90_000_000..=90_000_000),Some(-180_000_000..=180_000_000)))
        && safe_remote_text(&chart.place_name,160,false)
        && matches!(chart.place_mode.as_str(),"city" | "manual" | "unknown")
        && chart.city_ref.as_deref().is_none_or(|s|safe_remote_text(s,80,true))
        && chart.sex.as_deref().is_none_or(|s|safe_remote_text(s,80,false))
        && chart.revision > 0 && safe_remote_text(&chart.updated_at,64,true)
        && valid_groups(&chart.groups)
}

fn classify(error: &rusqlite::Error) -> Failure {
    match error.sqlite_error_code() {
        Some(ErrorCode::NotADatabase | ErrorCode::DatabaseCorrupt) => "archive_corrupt",
        _ => "archive_unavailable",
    }
}

const SCHEMA: &str = "CREATE TABLE saved_charts (
       id TEXT PRIMARY KEY NOT NULL CHECK (length(id) = 36),
       name TEXT NOT NULL,
       utc_iso TEXT,
       time_zone TEXT,
       lat_micro INTEGER CHECK (lat_micro BETWEEN -90000000 AND 90000000),
       lng_micro INTEGER CHECK (lng_micro BETWEEN -180000000 AND 180000000),
       place_name TEXT NOT NULL,
       created_at_ms INTEGER NOT NULL,
       updated_at_ms INTEGER NOT NULL,
       historical_json TEXT,
       civil_date TEXT,
       civil_time TEXT,
       time_unknown INTEGER NOT NULL DEFAULT 0 CHECK (time_unknown IN (0,1)),
       source_kind TEXT, source_sex TEXT, source_account INTEGER CHECK (source_account IN (0,1)),
       source_place_mode TEXT, source_city_ref TEXT, source_revision INTEGER, source_updated_at TEXT,
       CHECK ((lat_micro IS NULL) = (lng_micro IS NULL)),
       CHECK ((civil_date IS NULL AND civil_time IS NULL AND time_unknown=0 AND utc_iso IS NOT NULL)
         OR (civil_date IS NOT NULL AND ((time_unknown=1 AND civil_time IS NULL AND utc_iso IS NULL)
           OR (time_unknown=0 AND civil_time IS NOT NULL))))
     ) STRICT;
     CREATE TABLE saved_chart_groups (
       chart_id TEXT NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
       position INTEGER NOT NULL CHECK (position >= 0),
       name TEXT NOT NULL,
       PRIMARY KEY (chart_id, position),
       UNIQUE (chart_id, name)
     ) STRICT;
     CREATE TABLE chart_group_sync_links (
       chart_id TEXT PRIMARY KEY NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
       profile_ref TEXT NOT NULL,
       remote_sync_id TEXT NOT NULL,
       base_groups_json TEXT NOT NULL,
       conflict_groups_json TEXT,
       pending INTEGER NOT NULL CHECK (pending IN (0, 1, 2)),
       remote_missing INTEGER NOT NULL DEFAULT 0 CHECK (remote_missing IN (0,1)),
       UNIQUE (profile_ref, remote_sync_id)
     ) STRICT;
     CREATE TABLE chart_sync_offline_profile (
       singleton INTEGER PRIMARY KEY CHECK (singleton=1), profile_ref TEXT NOT NULL
     ) STRICT;
     CREATE TABLE chart_sync_civil_sources (
       chart_id TEXT PRIMARY KEY REFERENCES saved_charts(id) ON DELETE CASCADE,
       source_id TEXT NOT NULL UNIQUE REFERENCES saved_charts(id) ON DELETE RESTRICT
     ) STRICT;
     CREATE TABLE chart_sync_create_outbox (
       chart_id TEXT PRIMARY KEY REFERENCES saved_charts(id) ON DELETE RESTRICT,
       profile_ref TEXT NOT NULL, mutation_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
       rejected_full INTEGER NOT NULL DEFAULT 0 CHECK(rejected_full IN (0,1))
     ) STRICT;
     PRAGMA user_version = 7;";

const MIGRATE_GROUPS: &str = "BEGIN IMMEDIATE;
    CREATE TABLE saved_chart_groups (
      chart_id TEXT NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK (position >= 0),
      name TEXT NOT NULL,
      PRIMARY KEY (chart_id, position),
      UNIQUE (chart_id, name)
    ) STRICT;
    PRAGMA user_version = 2;
    COMMIT;";

const MIGRATE_GROUP_LINKS: &str = "BEGIN IMMEDIATE;
    CREATE TABLE chart_group_sync_links (
      chart_id TEXT PRIMARY KEY NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
      profile_ref TEXT NOT NULL,
      remote_sync_id TEXT NOT NULL,
      base_groups_json TEXT NOT NULL,
      conflict_groups_json TEXT,
      pending INTEGER NOT NULL CHECK (pending IN (0, 1, 2)),
      UNIQUE (profile_ref, remote_sync_id)
    ) STRICT;
    PRAGMA user_version = 3;
    COMMIT;";

// Rebuild only in memory. Disabling foreign-key enforcement is necessary
// while replacing the parent table; verify every reference before commit.
const MIGRATE_CIVIL_CHARTS: &str = "BEGIN IMMEDIATE;
    CREATE TABLE saved_charts_v4 (
      id TEXT PRIMARY KEY NOT NULL CHECK (length(id)=36), name TEXT NOT NULL,
      utc_iso TEXT, time_zone TEXT,
      lat_micro INTEGER CHECK (lat_micro BETWEEN -90000000 AND 90000000),
      lng_micro INTEGER CHECK (lng_micro BETWEEN -180000000 AND 180000000),
      place_name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL,
      historical_json TEXT, civil_date TEXT, civil_time TEXT,
      time_unknown INTEGER NOT NULL DEFAULT 0 CHECK (time_unknown IN (0,1)),
      source_kind TEXT, source_sex TEXT, source_account INTEGER CHECK (source_account IN (0,1)),
      source_place_mode TEXT, source_city_ref TEXT, source_revision INTEGER, source_updated_at TEXT,
      CHECK ((lat_micro IS NULL) = (lng_micro IS NULL)),
      CHECK ((civil_date IS NULL AND civil_time IS NULL AND time_unknown=0 AND utc_iso IS NOT NULL)
        OR (civil_date IS NOT NULL AND ((time_unknown=1 AND civil_time IS NULL AND utc_iso IS NULL)
          OR (time_unknown=0 AND civil_time IS NOT NULL))))
    ) STRICT;
    INSERT INTO saved_charts_v4 (id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms,historical_json)
      SELECT id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms,historical_json FROM saved_charts;
    DROP TABLE saved_charts;
    ALTER TABLE saved_charts_v4 RENAME TO saved_charts;
    ALTER TABLE chart_group_sync_links ADD COLUMN remote_missing INTEGER NOT NULL DEFAULT 0 CHECK (remote_missing IN (0,1));
    CREATE TABLE chart_sync_offline_profile (
      singleton INTEGER PRIMARY KEY CHECK (singleton=1), profile_ref TEXT NOT NULL
    ) STRICT;
    PRAGMA user_version=4;";

const MIGRATE_ASSOCIATIONS: &str = "BEGIN IMMEDIATE;
    CREATE TABLE chart_sync_civil_sources (
      chart_id TEXT PRIMARY KEY REFERENCES saved_charts(id) ON DELETE CASCADE,
      source_id TEXT NOT NULL UNIQUE REFERENCES saved_charts(id) ON DELETE RESTRICT
    ) STRICT;
    PRAGMA user_version=5;
    COMMIT;";

const MIGRATE_CREATE_OUTBOX: &str = "BEGIN IMMEDIATE;
    CREATE TABLE chart_sync_create_outbox (
      chart_id TEXT PRIMARY KEY REFERENCES saved_charts(id) ON DELETE RESTRICT,
      profile_ref TEXT NOT NULL, mutation_id TEXT NOT NULL UNIQUE, payload_json TEXT NOT NULL,
      rejected_full INTEGER NOT NULL DEFAULT 0 CHECK(rejected_full IN (0,1))
    ) STRICT;
    PRAGMA user_version=6;
    COMMIT;";

/// An empty database at the current schema, in memory only.
fn fresh_connection() -> Result<Connection, Failure> {
    let connection = Connection::open_in_memory().map_err(|error| classify(&error))?;
    connection.execute_batch("PRAGMA foreign_keys = ON;").map_err(|error| classify(&error))?;
    connection.execute_batch(SCHEMA).map_err(|error| classify(&error))?;
    check_connection(&connection)?;
    Ok(connection)
}

/// Checks health and schema of a database opened by either path.
fn check_connection(connection: &Connection) -> Result<(), Failure> {
    let health: String =
        connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    if health != "ok" {
        return Err("archive_corrupt");
    }
    let version: i64 =
        connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    match version {
        SCHEMA_VERSION | OUTBOX_SCHEMA_VERSION | ASSOCIATION_SCHEMA_VERSION | CIVIL_SCHEMA_VERSION | GROUP_LINKS_SCHEMA_VERSION | GROUPS_SCHEMA_VERSION | LEGACY_SCHEMA_VERSION => Ok(()),
        // Written by a newer application: reading it with old rules could lose data.
        newer if newer > SCHEMA_VERSION => Err("archive_newer"),
        _ => Err("archive_corrupt"),
    }
}

/// Hands decrypted database bytes to SQLite as an in-memory database.
fn connection_from_bytes(bytes: &[u8]) -> Result<Connection, Failure> {
    if bytes.is_empty() {
        return Err("archive_corrupt");
    }
    // SQLite takes ownership of memory it allocated itself.
    let data = unsafe {
        let pointer = rusqlite::ffi::sqlite3_malloc64(bytes.len() as u64) as *mut u8;
        let pointer = NonNull::new(pointer).ok_or("archive_unavailable")?;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.as_ptr(), bytes.len());
        OwnedData::from_raw_nonnull(pointer, bytes.len())
    };
    let mut connection = Connection::open_in_memory().map_err(|error| classify(&error))?;
    connection.deserialize(DatabaseName::Main, data, false).map_err(|error| classify(&error))?;
    check_connection(&connection)?;
    connection.execute_batch("PRAGMA foreign_keys = ON;").map_err(|error| classify(&error))?;
    let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0))
        .map_err(|error| classify(&error))?;
    // v2 was independently used for history and groups on different branches.
    // Inspect the actual schema instead of assuming either meaning.
    let has_history: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM pragma_table_info('saved_charts') WHERE name='historical_json')", [], |r| r.get(0)).map_err(|e| classify(&e))?;
    if !has_history { connection.execute_batch("ALTER TABLE saved_charts ADD COLUMN historical_json TEXT;").map_err(|e| classify(&e))?; }
    let has_groups: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='saved_chart_groups')", [], |r| r.get(0)).map_err(|e| classify(&e))?;
    if version < CIVIL_SCHEMA_VERSION && !has_groups { connection.execute_batch(MIGRATE_GROUPS).map_err(|e| classify(&e))?; }
    let has_links: bool = connection.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='chart_group_sync_links')", [], |r| r.get(0)).map_err(|e| classify(&e))?;
    if version < CIVIL_SCHEMA_VERSION && !has_links { connection.execute_batch(MIGRATE_GROUP_LINKS).map_err(|e| classify(&e))?; }
    if version < CIVIL_SCHEMA_VERSION {
        connection.execute_batch("PRAGMA foreign_keys=OFF;").map_err(|error| classify(&error))?;
        let migrated = (|| -> Result<(),Failure> {
            connection.execute_batch(MIGRATE_CIVIL_CHARTS).map_err(|error| classify(&error))?;
            let violations: i64 = connection.query_row("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r.get(0))
                .map_err(|error| classify(&error))?;
            if violations != 0 { return Err("archive_corrupt"); }
            connection.execute_batch("COMMIT;").map_err(|error| classify(&error))
        })();
        if migrated.is_err() { let _ = connection.execute_batch("ROLLBACK;"); }
        connection.execute_batch("PRAGMA foreign_keys=ON;").map_err(|error| classify(&error))?;
        migrated?;
    }
    if version < ASSOCIATION_SCHEMA_VERSION {
        connection.execute_batch(MIGRATE_ASSOCIATIONS).map_err(|error| classify(&error))?;
    }
    if version < OUTBOX_SCHEMA_VERSION {
        connection.execute_batch(MIGRATE_CREATE_OUTBOX).map_err(|error| classify(&error))?;
    }
    connection.execute_batch("PRAGMA user_version=7;").map_err(|e| classify(&e))?;
    Ok(connection)
}

fn bytes_from_connection(connection: &Connection) -> Result<zeroize::Zeroizing<Vec<u8>>, Failure> {
    let data = connection.serialize(DatabaseName::Main).map_err(|error| classify(&error))?;
    Ok(zeroize::Zeroizing::new(data.to_vec()))
}

fn list(connection: &Connection, groups_supported: bool) -> Result<Vec<SavedChartV1>, Failure> {
    let sql = if groups_supported {
        "SELECT id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms,historical_json FROM saved_charts WHERE civil_date IS NULL ORDER BY name COLLATE NOCASE, created_at_ms, id LIMIT ?1"
    } else {
        "SELECT id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms,NULL FROM saved_charts ORDER BY name COLLATE NOCASE, created_at_ms, id LIMIT ?1"
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|error| classify(&error))?;
    let rows = statement
        .query_map([MAX_CHARTS], |row| {
            Ok((SavedChartV1 {
                id: row.get(0)?,
                name: row.get(1)?,
                utc_iso: row.get(2)?,
                time_zone: row.get(3)?,
                lat_micro: row.get(4)?,
                lng_micro: row.get(5)?,
                place_name: row.get(6)?,
                historical: None,
                created_at_ms: row.get(7)?,
                updated_at_ms: row.get(8)?,
                groups: Vec::new(),
            }, row.get::<_, Option<String>>(9)?))
        })
        .map_err(|error| classify(&error))?;
    let mut charts = Vec::new();
    for row in rows {
        let (mut chart, history) = row.map_err(|error| classify(&error))?;
        if let Some(history) = history {
            chart.historical = Some(serde_json::from_str(&history).map_err(|_| "archive_corrupt")?);
            let record = ChartRecordV1 {id:chart.id.clone(), name:chart.name.clone(), utc_iso:chart.utc_iso.clone(), time_zone:chart.time_zone.clone(), lat_micro:chart.lat_micro, lng_micro:chart.lng_micro, place_name:chart.place_name.clone(), historical:chart.historical.clone()};
            if !valid_record(&record) { return Err("archive_corrupt"); }
        }
        charts.push(chart);
    }
    if groups_supported {
        let mut group_query = connection.prepare(
            "SELECT name FROM saved_chart_groups WHERE chart_id = ?1 ORDER BY position"
        ).map_err(|error| classify(&error))?;
        for chart in &mut charts {
            chart.groups = group_query.query_map([&chart.id], |row| row.get::<_, String>(0))
                .map_err(|error| classify(&error))?.collect::<Result<Vec<_>, _>>()
                .map_err(|error| classify(&error))?;
            if !valid_groups(&chart.groups) { return Err("archive_corrupt"); }
        }
    }
    Ok(charts)
}

fn set_groups(connection: &mut Connection, id: &str, groups: &[String]) -> Result<(), Failure> {
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let exists: bool = transaction.query_row(
        "SELECT EXISTS(SELECT 1 FROM saved_charts WHERE id=?1)", [id], |row| row.get(0)
    ).map_err(|error| classify(&error))?;
    if !exists { return Err("not_found"); }
    transaction.execute("DELETE FROM saved_chart_groups WHERE chart_id=?1", [id])
        .map_err(|error| classify(&error))?;
    for (position, name) in groups.iter().enumerate() {
        transaction.execute("INSERT INTO saved_chart_groups (chart_id, position, name) VALUES (?1, ?2, ?3)",
            params![id, position as i64, name]).map_err(|error| classify(&error))?;
    }
    // A linked chart's edit and its pending marker commit together. A chart
    // not explicitly linked to a verified profile never enters an outbox.
    transaction.execute("UPDATE chart_group_sync_links SET pending=CASE WHEN pending=2 THEN 2 ELSE 1 END WHERE chart_id=?1", [id])
        .map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

/// Internal candidate only: a sync orchestrator must first verify the server
/// account/profile and the remote chart identity before creating this link.
/// Local-only charts are never automatically assigned to an account.
#[allow(dead_code)]
fn link_group_sync(connection: &mut Connection, chart_id: &str, profile_ref: &str,
    remote_sync_id: &str, server_groups: &[String]) -> Result<(), Failure> {
    if !valid_id(chart_id) || !valid_id(profile_ref) || !valid_id(remote_sync_id) || !valid_groups(server_groups) {
        return Err("invalid_request");
    }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let exists: bool = transaction.query_row("SELECT EXISTS(SELECT 1 FROM saved_charts WHERE id=?1)", [chart_id], |r| r.get(0))
        .map_err(|error| classify(&error))?;
    if !exists { return Err("not_found"); }
    let existing: Option<(String,String)> = transaction.query_row(
        "SELECT profile_ref,remote_sync_id FROM chart_group_sync_links WHERE chart_id=?1", [chart_id],
        |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(|error| classify(&error))?;
    if let Some((profile,remote)) = existing {
        if profile != profile_ref || remote != remote_sync_id { return Err("profile_conflict"); }
        return transaction.commit().map_err(|error| classify(&error));
    }
    let local_groups = chart_groups(&transaction, chart_id)?;
    let base_json = serde_json::to_string(server_groups).map_err(|_| "archive_unavailable")?;
    transaction.execute(
        "INSERT INTO chart_group_sync_links (chart_id,profile_ref,remote_sync_id,base_groups_json,conflict_groups_json,pending) VALUES (?1,?2,?3,?4,?5,?6)",
        // A mismatch at first link is a conflict requiring an explicit choice,
        // not permission to overwrite either pre-existing set of groups.
        params![chart_id,profile_ref,remote_sync_id,base_json,
            if local_groups != server_groups { Some(base_json.as_str()) } else { None },
            if local_groups != server_groups { 2 } else { 0 }],
    ).map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

fn chart_groups(connection: &Connection, chart_id: &str) -> Result<Vec<String>, Failure> {
    let mut statement = connection.prepare("SELECT name FROM saved_chart_groups WHERE chart_id=?1 ORDER BY position")
        .map_err(|error| classify(&error))?;
    let groups = statement.query_map([chart_id], |row| row.get::<_,String>(0))
        .map_err(|error| classify(&error))?.collect::<Result<Vec<_>,_>>().map_err(|error| classify(&error))?;
    if !valid_groups(&groups) { return Err("archive_corrupt"); }
    Ok(groups)
}

/// Apply a remote snapshot only to the previously linked account and chart.
/// `expected_base` was captured before the network request; it prevents a late
/// read from undoing an acknowledgement or another, newer reconciliation.
#[allow(dead_code)]
fn reconcile_group_snapshot(connection: &mut Connection, chart_id: &str, profile_ref: &str,
    remote_sync_id: &str, expected_base: &[String], server_groups: &[String]) -> Result<(), Failure> {
    if !valid_id(chart_id) || !valid_id(profile_ref) || !valid_id(remote_sync_id)
        || !valid_groups(expected_base) || !valid_groups(server_groups) { return Err("invalid_request"); }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let old: Option<(String,i64)> = transaction.query_row(
        "SELECT base_groups_json,pending FROM chart_group_sync_links WHERE chart_id=?1 AND profile_ref=?2 AND remote_sync_id=?3",
        params![chart_id,profile_ref,remote_sync_id], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(|error| classify(&error))?;
    let (json,pending) = old.ok_or("profile_conflict")?;
    let base: Vec<String> = serde_json::from_str(&json).map_err(|_| "archive_corrupt")?;
    if !valid_groups(&base) { return Err("archive_corrupt"); }
    if base != expected_base { return Err("stale_sync"); }
    if pending == 2 { return Err("conflict_pending"); }
    let local = chart_groups(&transaction,chart_id)?;
    if pending == 0 && local != base { return Err("archive_corrupt"); }
    if pending == 0 || local == server_groups {
        if pending == 0 && local != server_groups {
            transaction.execute("DELETE FROM saved_chart_groups WHERE chart_id=?1", [chart_id])
                .map_err(|error| classify(&error))?;
            for (position,name) in server_groups.iter().enumerate() {
                transaction.execute("INSERT INTO saved_chart_groups (chart_id,position,name) VALUES (?1,?2,?3)",
                    params![chart_id,position as i64,name]).map_err(|error| classify(&error))?;
            }
        }
        let new_base = serde_json::to_string(server_groups).map_err(|_| "archive_unavailable")?;
        transaction.execute("UPDATE chart_group_sync_links SET base_groups_json=?2,conflict_groups_json=NULL,pending=0 WHERE chart_id=?1",
            params![chart_id,new_base]).map_err(|error| classify(&error))?;
    } else if server_groups != base {
        let conflict = serde_json::to_string(server_groups).map_err(|_| "archive_unavailable")?;
        transaction.execute("UPDATE chart_group_sync_links SET conflict_groups_json=?2,pending=2 WHERE chart_id=?1",
            params![chart_id,conflict]).map_err(|error| classify(&error))?;
    }
    transaction.commit().map_err(|error| classify(&error))
}

/// Acknowledge only the base and contents actually sent. A later local edit
/// remains pending; a stale response cannot overwrite a newer server base.
#[allow(dead_code)]
fn acknowledge_group_sync(connection: &mut Connection, chart_id: &str, profile_ref: &str,
    remote_sync_id: &str, sent_base: &[String], sent_groups: &[String]) -> Result<(), Failure> {
    if !valid_id(chart_id) || !valid_id(profile_ref) || !valid_id(remote_sync_id)
        || !valid_groups(sent_base) || !valid_groups(sent_groups) { return Err("invalid_request"); }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let old: Option<(String,i64)> = transaction.query_row(
        "SELECT base_groups_json,pending FROM chart_group_sync_links WHERE chart_id=?1 AND profile_ref=?2 AND remote_sync_id=?3",
        params![chart_id,profile_ref,remote_sync_id], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(|error| classify(&error))?;
    let (old_json,pending) = old.ok_or("profile_conflict")?;
    if pending != 1 { return Err("stale_sync"); }
    let saved_base: Vec<String> = serde_json::from_str(&old_json)
        .map_err(|_| "archive_corrupt")?;
    if !valid_groups(&saved_base) { return Err("archive_corrupt"); }
    if saved_base != sent_base { return Err("stale_sync"); }
    let local = chart_groups(&transaction, chart_id)?;
    let base_json = serde_json::to_string(sent_groups).map_err(|_| "archive_unavailable")?;
    transaction.execute("UPDATE chart_group_sync_links SET base_groups_json=?2,pending=?3,conflict_groups_json=NULL WHERE chart_id=?1",
        params![chart_id,base_json,i64::from(local != sent_groups)]).map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

/// Record the server's conflicting groups without replacing local edits. A
/// later UI must ask the user which version to keep or merge explicitly.
#[allow(dead_code)]
fn record_group_conflict(connection: &mut Connection, chart_id: &str, profile_ref: &str,
    remote_sync_id: &str, sent_base: &[String], server_groups: &[String]) -> Result<(), Failure> {
    if !valid_id(chart_id) || !valid_id(profile_ref) || !valid_id(remote_sync_id)
        || !valid_groups(sent_base) || !valid_groups(server_groups) { return Err("invalid_request"); }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let old: Option<(String,i64)> = transaction.query_row(
        "SELECT base_groups_json,pending FROM chart_group_sync_links WHERE chart_id=?1 AND profile_ref=?2 AND remote_sync_id=?3",
        params![chart_id,profile_ref,remote_sync_id], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(|error| classify(&error))?;
    let (old_json,pending) = old.ok_or("profile_conflict")?;
    let base: Vec<String> = serde_json::from_str(&old_json).map_err(|_| "archive_corrupt")?;
    if !valid_groups(&base) { return Err("archive_corrupt"); }
    if pending != 1 || base != sent_base { return Err("stale_sync"); }
    let conflict = serde_json::to_string(server_groups).map_err(|_| "archive_unavailable")?;
    transaction.execute("UPDATE chart_group_sync_links SET pending=2,conflict_groups_json=?2 WHERE chart_id=?1",
        params![chart_id,conflict]).map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

/// Called only after an explicit choice in a future conflict UI. The shown
/// server and local versions must still match what the user saw; otherwise
/// nothing is changed. Choosing server clears pending, while a local/merged choice is
/// queued relative to the version the user reviewed.
#[allow(dead_code)]
fn resolve_group_conflict(connection: &mut Connection, chart_id: &str, profile_ref: &str,
    remote_sync_id: &str, shown_server: &[String], shown_local: &[String], chosen: &[String]) -> Result<(), Failure> {
    if !valid_id(chart_id) || !valid_id(profile_ref) || !valid_id(remote_sync_id)
        || !valid_groups(shown_server) || !valid_groups(shown_local) || !valid_groups(chosen) { return Err("invalid_request"); }
    let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let old: Option<(Option<String>,i64)> = transaction.query_row(
        "SELECT conflict_groups_json,pending FROM chart_group_sync_links WHERE chart_id=?1 AND profile_ref=?2 AND remote_sync_id=?3",
        params![chart_id,profile_ref,remote_sync_id], |r| Ok((r.get(0)?,r.get(1)?)),
    ).optional().map_err(|error| classify(&error))?;
    let (old_json,pending) = old.ok_or("profile_conflict")?;
    let conflict: Vec<String> = serde_json::from_str(old_json.as_deref().ok_or("stale_sync")?)
        .map_err(|_| "archive_corrupt")?;
    if !valid_groups(&conflict) { return Err("archive_corrupt"); }
    if pending != 2 || conflict != shown_server || chart_groups(&transaction,chart_id)? != shown_local {
        return Err("stale_sync");
    }
    transaction.execute("DELETE FROM saved_chart_groups WHERE chart_id=?1", [chart_id])
        .map_err(|error| classify(&error))?;
    for (position,name) in chosen.iter().enumerate() {
        transaction.execute("INSERT INTO saved_chart_groups (chart_id,position,name) VALUES (?1,?2,?3)",
            params![chart_id,position as i64,name]).map_err(|error| classify(&error))?;
    }
    let base_json = serde_json::to_string(shown_server).map_err(|_| "archive_unavailable")?;
    transaction.execute("UPDATE chart_group_sync_links SET base_groups_json=?2,conflict_groups_json=NULL,pending=?3 WHERE chart_id=?1",
        params![chart_id,base_json,i64::from(chosen != shown_server)]).map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

/// Native-only snapshot of one explicitly bound profile's pending group edit.
/// No Serialize or Debug: it contains private chart group names.
#[allow(dead_code)]
pub(crate) struct PendingGroupUpdate {
    pub chart_id: String,
    pub remote_sync_id: String,
    pub base_groups: Vec<String>,
    pub groups: Vec<String>,
}

/// A snapshot request captures these bases before network I/O. Private group
/// names stay in the native process and are never used as log fields.
#[allow(dead_code)]
pub(crate) struct LinkedGroupBaseline {
    pub chart_id: String,
    pub remote_sync_id: String,
    pub base_groups: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct CivilImportSummary { pub inserted: usize, pub updated: usize, pub already_linked: usize }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CivilChartView {
    pub id: String,
    pub name: String,
    pub civil_date: String,
    pub civil_time: Option<String>,
    pub time_unknown: bool,
    pub time_zone: Option<String>,
    pub lat_micro: Option<i32>,
    pub lng_micro: Option<i32>,
    pub place_name: String,
    pub groups: Vec<String>,
    pub sync_status: &'static str,
    pub source_updated_at_ms: i64,
}

#[allow(dead_code)]
pub(crate) fn list_civil_charts_for_profile(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str) -> Result<Vec<CivilChartView>, Failure> {
    if !valid_id(profile_ref) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let session = open_session(paths,keys)?;
    list_civil_charts(&session.connection,profile_ref)
}

fn list_civil_charts(connection: &Connection, profile_ref: &str) -> Result<Vec<CivilChartView>, Failure> {
    let mut query = connection.prepare(
        "SELECT l.chart_id,c.name,c.civil_date,c.civil_time,c.time_unknown,c.time_zone,c.lat_micro,c.lng_micro,c.place_name,l.pending,l.remote_missing,c.updated_at_ms
         FROM chart_group_sync_links l LEFT JOIN chart_sync_civil_sources a ON a.chart_id=l.chart_id
         JOIN saved_charts c ON c.id=COALESCE(a.source_id,l.chart_id)
         WHERE l.profile_ref=?1 AND c.civil_date IS NOT NULL ORDER BY c.name COLLATE NOCASE,l.chart_id LIMIT ?2"
    ).map_err(|error| classify(&error))?;
    let rows = query.query_map(params![profile_ref,MAX_CHARTS], |r| Ok((
        r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,Option<String>>(3)?,
        r.get::<_,i64>(4)?,r.get::<_,Option<String>>(5)?,r.get::<_,Option<i32>>(6)?,r.get::<_,Option<i32>>(7)?,
        r.get::<_,String>(8)?,r.get::<_,i64>(9)?,r.get::<_,i64>(10)?,r.get::<_,i64>(11)?,
    ))).map_err(|error| classify(&error))?.collect::<Result<Vec<_>,_>>().map_err(|error| classify(&error))?;
    let mut result = Vec::with_capacity(rows.len());
    for (id,name,date,time,unknown,zone,lat,lng,place,pending,missing,source_updated_at_ms) in rows {
        let status = match (pending,missing) {(0..=2,1)=>"missing",(0,0)=>"clean",(1,0)=>"pending",(2,0)=>"conflict",_=>return Err("archive_corrupt")};
        if !valid_id(&id) || !safe_remote_text(&name,255,true) || !valid_civil_date(&date)
            || !matches!(unknown,0 | 1) || (unknown==1 && time.is_some())
            || (unknown==0 && !time.as_deref().is_some_and(valid_civil_clock))
            || !zone.as_deref().is_none_or(valid_zone)
            || !matches!((lat,lng),(None,None) | (Some(-90_000_000..=90_000_000),Some(-180_000_000..=180_000_000)))
            || !safe_remote_text(&place,160,false) { return Err("archive_corrupt"); }
        let groups = chart_groups(connection,&id)?;
        result.push(CivilChartView {id,name,civil_date:date,civil_time:time,time_unknown:unknown==1,
            time_zone:zone,lat_micro:lat,lng_micro:lng,place_name:place,groups,sync_status:status,source_updated_at_ms});
    }
    Ok(result)
}

/// Transfer a verified remote identity to an explicitly selected local chart.
/// The imported civil row remains separately preserved as the remote source.
/// No association is inferred; both group sets and displayed revisions must
/// still match, and an unresolved imported edit cannot be discarded.
#[derive(Clone,Copy)]
pub(crate) struct AssociationChoice<'a> {
    pub local_id: &'a str, pub source_id: &'a str, pub local_updated: i64, pub source_updated: i64,
    pub local_groups: &'a [String], pub source_groups: &'a [String],
}
pub(crate) fn associate_civil_chart(paths: &ArchivePaths, keys: &dyn KeyStore, profile: &str,
    choice: &AssociationChoice<'_>) -> Result<(), Failure> {
    let AssociationChoice {local_id,source_id,local_updated,source_updated,local_groups,source_groups}=*choice;
    if !valid_id(profile) || !valid_id(local_id) || !valid_id(source_id) || local_id==source_id
        || local_updated<0 || source_updated<0 || !valid_groups(local_groups) || !valid_groups(source_groups) {
        return Err("invalid_request");
    }
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let mut session=open_session(paths,keys)?;
    let tx=session.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|classify(&e))?;
    let local_ok: bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM saved_charts c WHERE c.id=?1 AND c.civil_date IS NULL AND c.updated_at_ms=?2 AND NOT EXISTS (SELECT 1 FROM chart_group_sync_links l WHERE l.chart_id=c.id) AND NOT EXISTS (SELECT 1 FROM chart_sync_create_outbox o WHERE o.chart_id=c.id))",params![local_id,local_updated],|r|r.get(0)).map_err(|e|classify(&e))?;
    let source: Option<(String,String,i64,i64)>=tx.query_row("SELECT l.remote_sync_id,l.base_groups_json,l.pending,l.remote_missing FROM chart_group_sync_links l JOIN saved_charts c ON c.id=l.chart_id WHERE l.chart_id=?1 AND l.profile_ref=?2 AND c.civil_date IS NOT NULL AND c.updated_at_ms=?3 AND NOT EXISTS (SELECT 1 FROM chart_sync_civil_sources a WHERE a.chart_id=l.chart_id)",params![source_id,profile,source_updated],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(|e|classify(&e))?;
    let (_,base,pending,missing)=source.ok_or("stale_sync")?;
    let base_groups: Vec<String>=serde_json::from_str(&base).map_err(|_|"archive_corrupt")?;
    if !local_ok || pending!=0 || missing!=0 || base_groups!=source_groups
        || chart_groups(&tx,local_id)?!=local_groups || chart_groups(&tx,source_id)?!=source_groups {
        return Err("stale_sync");
    }
    let conflict=if local_groups==source_groups {None} else {Some(base.as_str())};
    tx.execute("UPDATE chart_group_sync_links SET chart_id=?1,pending=?2,conflict_groups_json=?3 WHERE chart_id=?4 AND profile_ref=?5",
        params![local_id,if conflict.is_some(){2}else{0},conflict,source_id,profile]).map_err(|e|classify(&e))?;
    tx.execute("INSERT INTO chart_sync_civil_sources(chart_id,source_id) VALUES(?1,?2)",params![local_id,source_id]).map_err(|e|classify(&e))?;
    tx.commit().map_err(|e|classify(&e))?;
    persist(paths,keys,&session.connection)
}

#[derive(serde::Serialize,serde::Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(crate) struct CreateChartPayload {
    pub mutation_id:String, pub name:String, pub local_date:String, pub local_time:String,
    pub time_unknown:bool, pub utc_iso:String, pub time_zone:String, pub lat_micro:i32, pub lng_micro:i32,
    pub place_name:String, pub groups:Vec<String>,
}
#[derive(Clone,Copy)]
pub(crate) struct CreateChartChoice<'a> {
    pub chart_id:&'a str, pub updated_at_ms:i64, pub groups:&'a [String],
    pub local_date:&'a str, pub local_time:&'a str, pub include_groups:bool,
}
pub(crate) struct PendingChartCreate {
    pub chart_id:String, pub payload:CreateChartPayload,
}

pub(crate) fn valid_create_payload(payload:&CreateChartPayload) -> bool {
    valid_id(&payload.mutation_id) && valid_text(&payload.name,80) && !payload.name.is_empty()
        && valid_civil_date(&payload.local_date) && valid_civil_clock(&payload.local_time)
        && !payload.time_unknown && chart_calculation::validate(&ChartRequestV1 {protocol_version:chart_calculation::PROTOCOL_VERSION,
            utc_iso:payload.utc_iso.clone(),lat_micro:payload.lat_micro,lng_micro:payload.lng_micro,
            include_solar_events:false,include_previous_new_moon:false,include_fixed_stars:false}).is_some()
        && (payload.utc_iso.ends_with(".000Z") || (payload.utc_iso.ends_with('Z') && !payload.utc_iso.contains('.')))
        && valid_zone(&payload.time_zone) && (-90_000_000..=90_000_000).contains(&payload.lat_micro)
        && (-180_000_000..=180_000_000).contains(&payload.lng_micro)
        && valid_text(&payload.place_name,100) && valid_groups(&payload.groups)
}

pub(crate) fn queue_chart_create(paths:&ArchivePaths,keys:&dyn KeyStore,profile:&str,
    choice:&CreateChartChoice<'_>) -> Result<(),Failure> {
    if !valid_id(profile) || !valid_id(choice.chart_id) || choice.updated_at_ms<0
        || !valid_groups(choice.groups) || !valid_civil_date(choice.local_date) || !valid_civil_clock(choice.local_time) {
        return Err("invalid_request");
    }
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let mut session=open_session(paths,keys)?;
    let tx=session.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|classify(&e))?;
    let existing:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chart_sync_create_outbox WHERE chart_id=?1)",[choice.chart_id],|r|r.get(0)).map_err(|e|classify(&e))?;
    if existing { return Err("stale_sync"); }
    let capacity:(i64,i64)=tx.query_row("SELECT (SELECT count(*) FROM saved_charts),(SELECT count(*) FROM chart_sync_create_outbox)",[],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|classify(&e))?;
    if capacity.0+capacity.1>=MAX_CHARTS {return Err("archive_full");}
    let linked:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM chart_group_sync_links WHERE chart_id=?1)",[choice.chart_id],|r|r.get(0)).map_err(|e|classify(&e))?;
    let chart=list(&tx,true)?.into_iter().find(|c|c.id==choice.chart_id).ok_or("not_found")?;
    if linked || chart.updated_at_ms!=choice.updated_at_ms || chart.groups!=choice.groups { return Err("stale_sync"); }
    let payload=CreateChartPayload {mutation_id:crate::pkce_login::random_uuid_v4().map_err(|_|"archive_unavailable")?,
        name:chart.name,local_date:choice.local_date.into(),local_time:choice.local_time.into(),time_unknown:false,
        utc_iso:chart.utc_iso,time_zone:chart.time_zone,lat_micro:chart.lat_micro,lng_micro:chart.lng_micro,
        place_name:chart.place_name,groups:if choice.include_groups {chart.groups} else {Vec::new()}};
    if !valid_create_payload(&payload) { return Err("invalid_request"); }
    let json=zeroize::Zeroizing::new(serde_json::to_string(&payload).map_err(|_|"archive_unavailable")?);
    tx.execute("INSERT INTO chart_sync_create_outbox(chart_id,profile_ref,mutation_id,payload_json) VALUES(?1,?2,?3,?4)",
        params![choice.chart_id,profile,payload.mutation_id,json.as_str()]).map_err(|e|classify(&e))?;
    tx.execute("INSERT INTO chart_sync_offline_profile(singleton,profile_ref) VALUES(1,?1) ON CONFLICT(singleton) DO UPDATE SET profile_ref=excluded.profile_ref",[profile]).map_err(|e|classify(&e))?;
    tx.commit().map_err(|e|classify(&e))?;
    persist(paths,keys,&session.connection)
}

pub(crate) fn pending_chart_creates(paths:&ArchivePaths,keys:&dyn KeyStore,profile:&str) -> Result<Vec<PendingChartCreate>,Failure> {
    if !valid_id(profile) { return Err("invalid_request"); }
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let session=open_session(paths,keys)?;
    let mut query=session.connection.prepare("SELECT chart_id,mutation_id,payload_json FROM chart_sync_create_outbox WHERE profile_ref=?1 AND rejected_full=0 ORDER BY chart_id LIMIT 20").map_err(|e|classify(&e))?;
    let rows=query.query_map([profile],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))
        .map_err(|e|classify(&e))?.collect::<Result<Vec<_>,_>>().map_err(|e|classify(&e))?;
    let mut result=Vec::with_capacity(rows.len());
    for (chart_id,mutation_id,json) in rows {
        let json=zeroize::Zeroizing::new(json);
        let payload:CreateChartPayload=serde_json::from_str(&json).map_err(|_|"archive_corrupt")?;
        if !valid_id(&chart_id) || payload.mutation_id!=mutation_id || !valid_create_payload(&payload) { return Err("archive_corrupt"); }
        result.push(PendingChartCreate {chart_id,payload});
    }
    Ok(result)
}

fn create_ids(connection:&Connection,profile:&str,rejected:bool) -> Result<Vec<String>,Failure> {
    let mut query=connection.prepare("SELECT chart_id FROM chart_sync_create_outbox WHERE profile_ref=?1 AND rejected_full=?2 ORDER BY chart_id LIMIT ?3").map_err(|e|classify(&e))?;
    let rows=query.query_map(params![profile,i64::from(rejected),MAX_CHARTS],|r|r.get::<_,String>(0)).map_err(|e|classify(&e))?
        .collect::<Result<Vec<_>,_>>().map_err(|e|classify(&e))?;
    if rows.iter().any(|id|!valid_id(id)) {return Err("archive_corrupt");}
    Ok(rows)
}
pub(crate) fn pending_chart_create_ids(paths:&ArchivePaths,keys:&dyn KeyStore,profile:&str,rejected:bool) -> Result<Vec<String>,Failure> {
    if !valid_id(profile) {return Err("invalid_request");}
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let session=open_session(paths,keys)?;
    create_ids(&session.connection,profile,rejected)
}
pub(crate) fn offline_pending_chart_create_ids(paths:&ArchivePaths,keys:&dyn KeyStore,rejected:bool) -> Result<Vec<String>,Failure> {
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let session=open_session(paths,keys)?;
    match last_offline_profile(&session.connection)? {Some(profile)=>create_ids(&session.connection,&profile,rejected),None=>Ok(Vec::new())}
}

pub(crate) fn reject_chart_create_full(paths:&ArchivePaths,keys:&dyn KeyStore,profile:&str,pending:&PendingChartCreate) -> Result<(),Failure> {
    if !valid_id(profile) || !valid_id(&pending.chart_id) || !valid_create_payload(&pending.payload) {return Err("invalid_request");}
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let session=open_session(paths,keys)?;
    let changed=session.connection.execute("UPDATE chart_sync_create_outbox SET rejected_full=1 WHERE chart_id=?1 AND profile_ref=?2 AND mutation_id=?3 AND rejected_full=0",
        params![pending.chart_id,profile,pending.payload.mutation_id]).map_err(|e|classify(&e))?;
    if changed!=1 {return Err("stale_sync");}
    persist(paths,keys,&session.connection)
}
pub(crate) fn cancel_rejected_chart_create(paths:&ArchivePaths,keys:&dyn KeyStore,profile:&str,chart_id:&str) -> Result<(),Failure> {
    if !valid_id(profile) || !valid_id(chart_id) {return Err("invalid_request");}
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let session=open_session(paths,keys)?;
    let changed=session.connection.execute("DELETE FROM chart_sync_create_outbox WHERE chart_id=?1 AND profile_ref=?2 AND rejected_full=1",params![chart_id,profile]).map_err(|e|classify(&e))?;
    if changed!=1 {return Err("stale_sync");}
    persist(paths,keys,&session.connection)
}

pub(crate) fn acknowledge_chart_create(paths:&ArchivePaths,keys:&dyn KeyStore,profile:&str,
    pending:&PendingChartCreate,remote_id:&str) -> Result<(),Failure> {
    if !valid_id(profile) || !valid_id(remote_id) || !valid_id(&pending.chart_id) || !valid_create_payload(&pending.payload) { return Err("invalid_request"); }
    let _guard=ARCHIVE_LOCK.lock().unwrap_or_else(|p|p.into_inner());
    let mut session=open_session(paths,keys)?;
    let tx=session.connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|classify(&e))?;
    let saved:Option<String>=tx.query_row("SELECT payload_json FROM chart_sync_create_outbox WHERE chart_id=?1 AND profile_ref=?2 AND mutation_id=?3 AND rejected_full=0",
        params![pending.chart_id,profile,pending.payload.mutation_id],|r|r.get(0)).optional().map_err(|e|classify(&e))?;
    let expected=zeroize::Zeroizing::new(serde_json::to_string(&pending.payload).map_err(|_|"archive_unavailable")?);
    let saved=zeroize::Zeroizing::new(saved.ok_or("stale_sync")?);
    if *saved!=*expected { return Err("stale_sync"); }
    let groups=chart_groups(&tx,&pending.chart_id)?;
    let base=serde_json::to_string(&pending.payload.groups).map_err(|_|"archive_unavailable")?;
    tx.execute("INSERT INTO chart_group_sync_links(chart_id,profile_ref,remote_sync_id,base_groups_json,conflict_groups_json,pending) VALUES(?1,?2,?3,?4,NULL,?5)",
        params![pending.chart_id,profile,remote_id,base,i64::from(groups!=pending.payload.groups)]).map_err(|e|classify(&e))?;
    tx.execute("DELETE FROM chart_sync_create_outbox WHERE chart_id=?1 AND profile_ref=?2",params![pending.chart_id,profile]).map_err(|e|classify(&e))?;
    tx.commit().map_err(|e|classify(&e))?;
    persist(paths,keys,&session.connection)
}

#[allow(dead_code)]
pub(crate) fn set_civil_groups_for_profile(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str, chart_id: &str, expected: &[String], groups: &[String]) -> Result<(), Failure> {
    if !valid_id(profile_ref) || !valid_id(chart_id) || !valid_groups(expected) || !valid_groups(groups) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    set_scoped_civil_groups(&mut session.connection,profile_ref,chart_id,expected,groups)?;
    persist(paths,keys,&session.connection)
}

fn set_scoped_civil_groups(connection: &mut Connection, profile_ref: &str,
    chart_id: &str, expected: &[String], groups: &[String]) -> Result<(), Failure> {
    let exists: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM chart_group_sync_links l LEFT JOIN chart_sync_civil_sources a ON a.chart_id=l.chart_id JOIN saved_charts c ON c.id=COALESCE(a.source_id,l.chart_id) WHERE l.chart_id=?1 AND l.profile_ref=?2 AND c.civil_date IS NOT NULL)",
        params![chart_id,profile_ref],|r|r.get(0),
    ).map_err(|error| classify(&error))?;
    if !exists { return Err("profile_conflict"); }
    if chart_groups(connection,chart_id)? != expected { return Err("stale_sync"); }
    set_groups(connection,chart_id,groups)
}

fn last_offline_profile(connection: &Connection) -> Result<Option<String>, Failure> {
    let profile: Option<String> = connection.query_row(
        "SELECT profile_ref FROM chart_sync_offline_profile WHERE singleton=1",[],|r|r.get(0),
    ).optional().map_err(|error| classify(&error))?;
    if profile.as_deref().is_some_and(|p|!valid_id(p)) { return Err("archive_corrupt"); }
    Ok(profile)
}

pub(crate) fn list_offline_civil_charts(paths: &ArchivePaths, keys: &dyn KeyStore) -> Result<Vec<CivilChartView>, Failure> {
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let session = open_session(paths,keys)?;
    match last_offline_profile(&session.connection)? {
        Some(profile) => list_civil_charts(&session.connection,&profile),
        None => Ok(Vec::new()),
    }
}

pub(crate) fn set_offline_civil_groups(paths: &ArchivePaths, keys: &dyn KeyStore,
    chart_id: &str, expected: &[String], groups: &[String]) -> Result<(), Failure> {
    if !valid_id(chart_id) || !valid_groups(expected) || !valid_groups(groups) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    let profile=last_offline_profile(&session.connection)?.ok_or("profile_conflict")?;
    set_scoped_civil_groups(&mut session.connection,&profile,chart_id,expected,groups)?;
    persist(paths,keys,&session.connection)
}

fn insert_civil_source(connection:&Connection,chart:&RemoteCivilChart,now_ms:i64) -> Result<String,Failure> {
    let mut local_id=None;
    for _ in 0..4 {
        let candidate=crate::pkce_login::random_uuid_v4().map_err(|_|"archive_unavailable")?;
        let used:bool=connection.query_row("SELECT EXISTS(SELECT 1 FROM saved_charts WHERE id=?1)",[&candidate],|r|r.get(0)).map_err(|e|classify(&e))?;
        if !used {local_id=Some(candidate);break;}
    }
    let local_id=local_id.ok_or("archive_unavailable")?;
    connection.execute("INSERT INTO saved_charts
      (id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms,civil_date,civil_time,time_unknown,
       source_kind,source_sex,source_account,source_place_mode,source_city_ref,source_revision,source_updated_at)
      VALUES (?1,?2,NULL,?3,?4,?5,?6,?7,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)",
      params![local_id,chart.name,chart.time_zone,chart.lat_micro,chart.lng_micro,chart.place_name,now_ms,
        chart.civil_date,chart.civil_time,i64::from(chart.time_unknown),chart.kind,chart.sex,
        i64::from(chart.is_account_chart),chart.place_mode,chart.city_ref,chart.revision,chart.updated_at])
        .map_err(|e|classify(&e))?;
    for (position,name) in chart.groups.iter().enumerate() {
        connection.execute("INSERT INTO saved_chart_groups (chart_id,position,name) VALUES (?1,?2,?3)",
            params![local_id,position as i64,name]).map_err(|e|classify(&e))?;
    }
    Ok(local_id)
}

/// Import a verified owner's bounded snapshot in one encrypted archive write.
/// Existing links are never overwritten or inferred from names or birth data.
#[allow(dead_code)]
pub(crate) fn import_remote_civil_charts(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str, charts: &[RemoteCivilChart], now_ms: i64) -> Result<CivilImportSummary, Failure> {
    if !valid_id(profile_ref) || now_ms < 0 || charts.len() > 500
        || charts.iter().any(|chart| !valid_remote_chart(chart)) { return Err("invalid_request"); }
    let mut ids = std::collections::HashSet::new();
    if charts.iter().any(|chart| !ids.insert(chart.sync_id.as_str())) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    let tx = session.connection.transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| classify(&error))?;
    let mut total: i64 = tx.query_row("SELECT count(*) FROM saved_charts",[],|r|r.get(0))
        .map_err(|error| classify(&error))?;
    let reserved:i64=tx.query_row("SELECT count(*) FROM chart_sync_create_outbox",[],|r|r.get(0)).map_err(|e|classify(&e))?;
    if total > MAX_CHARTS { return Err("archive_corrupt"); }
    let previous_profile: Option<String> = tx.query_row(
        "SELECT profile_ref FROM chart_sync_offline_profile WHERE singleton=1",[],|r|r.get(0),
    ).optional().map_err(|error| classify(&error))?;
    let profile_changed = previous_profile.as_deref() != Some(profile_ref);
    if profile_changed {
        tx.execute("INSERT INTO chart_sync_offline_profile(singleton,profile_ref) VALUES (1,?1)
          ON CONFLICT(singleton) DO UPDATE SET profile_ref=excluded.profile_ref",[profile_ref])
            .map_err(|error| classify(&error))?;
    }
    let mut summary = CivilImportSummary {inserted:0,updated:0,already_linked:0};
    for chart in charts {
        let existing: Option<(String,Option<String>)> = tx.query_row(
            "SELECT c.id,c.civil_date FROM chart_group_sync_links l LEFT JOIN chart_sync_civil_sources a ON a.chart_id=l.chart_id JOIN saved_charts c ON c.id=COALESCE(a.source_id,l.chart_id)
             WHERE l.profile_ref=?1 AND l.remote_sync_id=?2",
            params![profile_ref,chart.sync_id], |r|Ok((r.get(0)?,r.get(1)?)),
        ).optional().map_err(|error| classify(&error))?;
        if let Some((id,civil_date))=existing {
            summary.already_linked += 1;
            // Locally-created linked charts are never rewritten from a remote
            // record. Imported civil charts have no local birth-data editor;
            // refresh their source fields without touching local group edits.
            if civil_date.is_some() {
                let changed=tx.execute("UPDATE saved_charts SET
                    name=?2,time_zone=?3,lat_micro=?4,lng_micro=?5,place_name=?6,updated_at_ms=?7,
                    civil_date=?8,civil_time=?9,time_unknown=?10,source_kind=?11,source_sex=?12,
                    source_account=?13,source_place_mode=?14,source_city_ref=?15,source_revision=?16,source_updated_at=?17
                  WHERE id=?1 AND (name IS NOT ?2 OR time_zone IS NOT ?3 OR lat_micro IS NOT ?4 OR lng_micro IS NOT ?5
                    OR place_name IS NOT ?6 OR civil_date IS NOT ?8 OR civil_time IS NOT ?9 OR time_unknown IS NOT ?10
                    OR source_kind IS NOT ?11 OR source_sex IS NOT ?12 OR source_account IS NOT ?13
                    OR source_place_mode IS NOT ?14 OR source_city_ref IS NOT ?15 OR source_revision IS NOT ?16 OR source_updated_at IS NOT ?17)",
                  params![id,chart.name,chart.time_zone,chart.lat_micro,chart.lng_micro,chart.place_name,now_ms,
                    chart.civil_date,chart.civil_time,i64::from(chart.time_unknown),chart.kind,chart.sex,
                    i64::from(chart.is_account_chart),chart.place_mode,chart.city_ref,chart.revision,chart.updated_at])
                    .map_err(|error| classify(&error))?;
                summary.updated+=changed;
            } else {
                // A locally-created chart was just acknowledged by the
                // server. Preserve the server's civil copy independently.
                if total+reserved>=MAX_CHARTS { return Err("archive_full"); }
                let source=insert_civil_source(&tx,chart,now_ms)?;
                tx.execute("INSERT INTO chart_sync_civil_sources(chart_id,source_id) VALUES(?1,?2)",params![id,source]).map_err(|e|classify(&e))?;
                total+=1;
                summary.updated+=1;
            }
            continue;
        }
        if total+reserved >= MAX_CHARTS { return Err("archive_full"); }
        // A new local ID is never derived from a site ID or matched by name.
        let local_id=insert_civil_source(&tx,chart,now_ms)?;
        let base = serde_json::to_string(&chart.groups).map_err(|_| "archive_unavailable")?;
        tx.execute("INSERT INTO chart_group_sync_links (chart_id,profile_ref,remote_sync_id,base_groups_json,conflict_groups_json,pending)
          VALUES (?1,?2,?3,?4,NULL,0)",params![local_id,profile_ref,chart.sync_id,base])
            .map_err(|error| classify(&error))?;
        total += 1;
        summary.inserted += 1;
    }
    // A complete, verified snapshot can mark an absent linked object without
    // deleting its local data or queued edits. Failed, malformed or partial
    // HTTP responses never reach here as a valid snapshot.
    let links: Vec<(String,String,i64)> = {
        let mut query=tx.prepare("SELECT chart_id,remote_sync_id,remote_missing FROM chart_group_sync_links WHERE profile_ref=?1")
            .map_err(|error| classify(&error))?;
        let values=query.query_map([profile_ref],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
            .map_err(|error| classify(&error))?.collect::<Result<Vec<_>,_>>().map_err(|error| classify(&error))?;
        values
    };
    for (id,remote,old_missing) in links {
        if !valid_id(&id) || !valid_id(&remote) || !matches!(old_missing,0 | 1) { return Err("archive_corrupt"); }
        let missing=i64::from(!ids.contains(remote.as_str()));
        if missing!=old_missing {
            tx.execute("UPDATE chart_group_sync_links SET remote_missing=?2 WHERE chart_id=?1",params![id,missing])
                .map_err(|error| classify(&error))?;
            summary.updated+=1;
        }
    }
    tx.commit().map_err(|error| classify(&error))?;
    if summary.inserted > 0 || summary.updated > 0 || profile_changed { persist(paths,keys,&session.connection)?; }
    Ok(summary)
}

/// The browser can display only chart labels and the two versions of the
/// groups; account references and remote identifiers remain native-only.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct GroupConflictView {
    pub chart_id: String,
    pub chart_name: String,
    pub local_groups: Vec<String>,
    pub server_groups: Vec<String>,
}

#[allow(dead_code)]
pub(crate) fn group_conflicts_for_profile(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str) -> Result<Vec<GroupConflictView>, Failure> {
    if !valid_id(profile_ref) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let session = open_session(paths,keys)?;
    let mut query = session.connection.prepare(
        "SELECT l.chart_id,c.name,l.conflict_groups_json FROM chart_group_sync_links l JOIN saved_charts c ON c.id=l.chart_id WHERE l.profile_ref=?1 AND l.pending=2 ORDER BY c.name,l.chart_id LIMIT ?2"
    ).map_err(|error| classify(&error))?;
    let rows = query.query_map(params![profile_ref,MAX_CHARTS], |r|
        Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))
        .map_err(|error| classify(&error))?.collect::<Result<Vec<_>,_>>().map_err(|error| classify(&error))?;
    let mut result = Vec::with_capacity(rows.len());
    for (chart_id,chart_name,json) in rows {
        let server_groups: Vec<String> = serde_json::from_str(&json).map_err(|_| "archive_corrupt")?;
        if !valid_id(&chart_id) || !safe_remote_text(&chart_name,255,false)
            || !valid_groups(&server_groups) { return Err("archive_corrupt"); }
        let local_groups = chart_groups(&session.connection,&chart_id)?;
        result.push(GroupConflictView {chart_id,chart_name,local_groups,server_groups});
    }
    Ok(result)
}

#[allow(dead_code)]
pub(crate) fn apply_conflict_resolution(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str, chart_id: &str, shown_server: &[String], shown_local: &[String],
    chosen: &[String]) -> Result<(), Failure> {
    if !valid_id(profile_ref) || !valid_id(chart_id) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    let remote: Option<String> = session.connection.query_row(
        "SELECT remote_sync_id FROM chart_group_sync_links WHERE chart_id=?1 AND profile_ref=?2",
        params![chart_id,profile_ref], |r| r.get(0),
    ).optional().map_err(|error| classify(&error))?;
    resolve_group_conflict(&mut session.connection,chart_id,profile_ref,
        &remote.ok_or("profile_conflict")?,shown_server,shown_local,chosen)?;
    persist(paths,keys,&session.connection)
}

#[allow(dead_code)]
pub(crate) fn group_baselines_for_profile(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str) -> Result<Vec<LinkedGroupBaseline>, Failure> {
    if !valid_id(profile_ref) { return Err("invalid_request"); }
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let session = open_session(paths,keys)?;
    let mut query = session.connection.prepare(
        "SELECT chart_id,remote_sync_id,base_groups_json FROM chart_group_sync_links WHERE profile_ref=?1 ORDER BY chart_id LIMIT ?2"
    ).map_err(|error| classify(&error))?;
    let rows = query.query_map(params![profile_ref,MAX_CHARTS], |r|
        Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))
        .map_err(|error| classify(&error))?.collect::<Result<Vec<_>,_>>().map_err(|error| classify(&error))?;
    let mut result = Vec::with_capacity(rows.len());
    for (chart_id,remote_sync_id,json) in rows {
        let base_groups: Vec<String> = serde_json::from_str(&json).map_err(|_| "archive_corrupt")?;
        if !valid_id(&chart_id) || !valid_id(&remote_sync_id) || !valid_groups(&base_groups) { return Err("archive_corrupt"); }
        result.push(LinkedGroupBaseline {chart_id,remote_sync_id,base_groups});
    }
    Ok(result)
}

/// Persist an already authenticated snapshot result, after the caller has
/// revalidated that its native account session is still current.
#[allow(dead_code)]
pub(crate) fn apply_remote_group_snapshot(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str, baseline: &LinkedGroupBaseline, server_groups: &[String]) -> Result<(), Failure> {
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    reconcile_group_snapshot(&mut session.connection,&baseline.chart_id,profile_ref,
        &baseline.remote_sync_id,&baseline.base_groups,server_groups)?;
    persist(paths,keys,&session.connection)
}

/// Future sync worker entry point. The reference must come from its verified
/// native grant, not IPC. Callers must never infer or fabricate chart links.
#[allow(dead_code)]
fn pending_group_updates(connection: &Connection, profile_ref: &str) -> Result<Vec<PendingGroupUpdate>, Failure> {
    if !valid_id(profile_ref) { return Err("invalid_request"); }
    let mut query = connection.prepare(
        "SELECT chart_id,remote_sync_id,base_groups_json FROM chart_group_sync_links WHERE profile_ref=?1 AND pending=1 AND remote_missing=0 ORDER BY chart_id LIMIT ?2"
    ).map_err(|error| classify(&error))?;
    let rows = query.query_map(params![profile_ref,MAX_CHARTS], |r|
        Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?)))
        .map_err(|error| classify(&error))?.collect::<Result<Vec<_>,_>>().map_err(|error| classify(&error))?;
    let mut pending = Vec::with_capacity(rows.len());
    for (chart_id,remote_sync_id,base_json) in rows {
        if !valid_id(&chart_id) || !valid_id(&remote_sync_id) { return Err("archive_corrupt"); }
        let base_groups: Vec<String> = serde_json::from_str(&base_json).map_err(|_| "archive_corrupt")?;
        if !valid_groups(&base_groups) { return Err("archive_corrupt"); }
        let groups = chart_groups(connection,&chart_id)?;
        pending.push(PendingGroupUpdate {chart_id,remote_sync_id,base_groups,groups});
    }
    Ok(pending)
}

/// Copies pending work under the archive lock. No network operation may hold
/// this lock; a later edit is detected when the response is committed.
#[allow(dead_code)]
pub(crate) fn pending_groups_for_profile(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str) -> Result<Vec<PendingGroupUpdate>, Failure> {
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let session = open_session(paths,keys)?;
    pending_group_updates(&session.connection,profile_ref)
}

/// No IPC exposure: the future caller must validate the profile from the
/// active grant and require an explicit user-approved chart association.
#[allow(dead_code)]
pub(crate) fn link_groups_to_verified_profile(paths: &ArchivePaths, keys: &dyn KeyStore,
    chart_id: &str, profile_ref: &str, remote_sync_id: &str, server_groups: &[String]) -> Result<(), Failure> {
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    link_group_sync(&mut session.connection,chart_id,profile_ref,remote_sync_id,server_groups)?;
    persist(paths,keys,&session.connection)
}

/// Persists only a response for the exact profile, chart, server base and
/// groups that were sent. Failure leaves the previous encrypted file intact.
#[allow(dead_code)]
pub(crate) fn apply_group_sync_result(paths: &ArchivePaths, keys: &dyn KeyStore,
    profile_ref: &str, update: &PendingGroupUpdate,
    result: &crate::pkce_reqwest_https::GroupWriteResult) -> Result<(), Failure> {
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let mut session = open_session(paths,keys)?;
    match result {
        crate::pkce_reqwest_https::GroupWriteResult::Updated | crate::pkce_reqwest_https::GroupWriteResult::Unchanged =>
            acknowledge_group_sync(&mut session.connection,&update.chart_id,profile_ref,&update.remote_sync_id,&update.base_groups,&update.groups)?,
        crate::pkce_reqwest_https::GroupWriteResult::Conflict(server_groups) =>
            record_group_conflict(&mut session.connection,&update.chart_id,profile_ref,&update.remote_sync_id,&update.base_groups,server_groups)?,
    }
    persist(paths,keys,&session.connection)
}

fn save(connection: &mut Connection, chart: &ChartRecordV1, now_ms: i64, limit: i64) -> Result<(), Failure> {
    let history = chart.historical.as_ref().map(serde_json::to_string).transpose().map_err(|_| "invalid_request")?;
    let transaction =
        connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|error| classify(&error))?;
    let exists: bool = transaction
        .query_row("SELECT EXISTS(SELECT 1 FROM saved_charts WHERE id=?1)", [&chart.id], |row| row.get(0))
        .map_err(|error| classify(&error))?;
    if exists {
        let civil_record: bool = transaction.query_row(
            "SELECT civil_date IS NOT NULL FROM saved_charts WHERE id=?1", [&chart.id], |row| row.get(0),
        ).map_err(|error| classify(&error))?;
        if civil_record { return Err("invalid_request"); }
        let pending:bool=transaction.query_row("SELECT EXISTS(SELECT 1 FROM chart_sync_create_outbox WHERE chart_id=?1)",[&chart.id],|r|r.get(0)).map_err(|e|classify(&e))?;
        if pending {return Err("archive_unavailable");}
    }
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
               (id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms,historical_json)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?9)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name, utc_iso=excluded.utc_iso, time_zone=excluded.time_zone,
               lat_micro=excluded.lat_micro, lng_micro=excluded.lng_micro,
               place_name=excluded.place_name, updated_at_ms=excluded.updated_at_ms, historical_json=excluded.historical_json",
            params![chart.id, chart.name, chart.utc_iso, chart.time_zone, chart.lat_micro, chart.lng_micro, chart.place_name, now_ms, history],
        )
        .map_err(|error| classify(&error))?;
    transaction.commit().map_err(|error| classify(&error))
}

fn delete(connection: &mut Connection, id: &str) -> Result<(), Failure> {
    let tx=connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e|classify(&e))?;
    let source: Option<String>=tx.query_row("SELECT source_id FROM chart_sync_civil_sources WHERE chart_id=?1",[id],|r|r.get(0))
        .optional().map_err(|e|classify(&e))?;
    if let Some(source)=source {
        // Deleting the local copy must not discard its pending/conflicting
        // groups or the independently downloaded website record.
        let groups=chart_groups(&tx,id)?;
        tx.execute("DELETE FROM saved_chart_groups WHERE chart_id=?1",[&source]).map_err(|e|classify(&e))?;
        for (position,name) in groups.iter().enumerate() {
            tx.execute("INSERT INTO saved_chart_groups(chart_id,position,name) VALUES(?1,?2,?3)",params![source,position as i64,name]).map_err(|e|classify(&e))?;
        }
        let moved=tx.execute("UPDATE chart_group_sync_links SET chart_id=?1 WHERE chart_id=?2",params![source,id]).map_err(|e|classify(&e))?;
        if moved!=1 { return Err("archive_corrupt"); }
        tx.execute("DELETE FROM chart_sync_civil_sources WHERE chart_id=?1",[id]).map_err(|e|classify(&e))?;
    }
    if tx.execute("DELETE FROM saved_charts WHERE id=?1",[id]).map_err(|e|classify(&e))? != 1 { return Err("not_found"); }
    tx.commit().map_err(|e|classify(&e))
}

/// Where the archive files live: all inside the one folder the application owns.
#[derive(Debug, Clone)]
pub struct ArchivePaths {
    legacy: PathBuf,
    sealed: PathBuf,
    staging: PathBuf,
}

impl ArchivePaths {
    pub fn in_folder(folder: &Path) -> Self {
        Self {
            legacy: folder.join(LEGACY_FILE_NAME),
            sealed: folder.join(SEALED_FILE_NAME),
            staging: folder.join(STAGING_FILE_NAME),
        }
    }
}

fn key_failure(_: KeyError) -> Failure {
    "archive_locked"
}

fn vault_failure(error: VaultError) -> Failure {
    match error {
        VaultError::NotAnArchive => "archive_corrupt",
        VaultError::Newer => "archive_newer",
        // Wrong key and altered file look the same: the archive stays locked.
        VaultError::Authentication => "archive_locked",
    }
}

/// The key of this device's archive, created on first use. A key that was stored must read back
/// identically before anything is encrypted with it.
fn key_for_writing(keys: &dyn KeyStore) -> Result<Key, Failure> {
    match keys.load().map_err(key_failure)? {
        Some(key) => Ok(key),
        None => {
            let key = new_key().map_err(key_failure)?;
            keys.store(&key).map_err(key_failure)?;
            match keys.load().map_err(key_failure)? {
                Some(back) if *back == *key => Ok(back),
                _ => Err("archive_locked"),
            }
        }
    }
}

/// Writes ciphertext to the staging file, flushes it, and moves it over the archive. Until the move
/// the previous archive is intact; the staging file holds only ciphertext.
fn write_sealed(paths: &ArchivePaths, sealed: &[u8]) -> Result<(), Failure> {
    use std::io::Write;
    let written = (|| -> std::io::Result<()> {
        let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&paths.staging)?;
        file.write_all(sealed)?;
        file.sync_all()?;
        Ok(())
    })();
    if written.is_err() {
        let _ = fs::remove_file(&paths.staging);
        return Err("archive_unavailable");
    }
    fs::rename(&paths.staging, &paths.sealed).map_err(|_| {
        let _ = fs::remove_file(&paths.staging);
        "archive_unavailable"
    })
}

fn persist(paths: &ArchivePaths, keys: &dyn KeyStore, connection: &Connection) -> Result<(), Failure> {
    let key = key_for_writing(keys)?;
    let plain = bytes_from_connection(connection)?;
    let sealed = archive_vault::seal(&key, &plain).map_err(key_failure)?;
    write_sealed(paths, &sealed)
}

fn load_sealed(paths: &ArchivePaths, keys: &dyn KeyStore) -> Result<Connection, Failure> {
    // An existing archive needs its own key: a missing key is never replaced by a new one.
    let key = keys.load().map_err(key_failure)?.ok_or("archive_locked")?;
    let sealed = fs::read(&paths.sealed).map_err(|_| "archive_unavailable")?;
    let plain = archive_vault::open(&key, &sealed).map_err(vault_failure)?;
    connection_from_bytes(&plain)
}

/// Reads the legacy plain file without altering it, and checks every row with today's rules.
fn read_legacy(path: &Path) -> Result<Vec<SavedChartV1>, Failure> {
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX)
        .map_err(|error| classify(&error))?;
    let health: String =
        connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    if health != "ok" {
        return Err("archive_corrupt");
    }
    let version: i64 =
        connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    match version {
        // An empty file of the first prototype: nothing to bring over.
        0 => return Ok(Vec::new()),
        LEGACY_SCHEMA_VERSION => {}
        newer if newer > LEGACY_SCHEMA_VERSION => return Err("archive_newer"),
        _ => return Err("archive_corrupt"),
    }
    let rows = list(&connection, false)?;
    let count: i64 =
        connection.query_row("SELECT COUNT(*) FROM saved_charts", [], |row| row.get(0)).map_err(|error| classify(&error))?;
    if count as usize != rows.len() {
        return Err("archive_corrupt");
    }
    for row in &rows {
        let record = ChartRecordV1 {
            id: row.id.clone(),
            name: row.name.clone(),
            utc_iso: row.utc_iso.clone(),
            time_zone: row.time_zone.clone(),
            lat_micro: row.lat_micro,
            lng_micro: row.lng_micro,
            place_name: row.place_name.clone(),
            historical: row.historical.clone(),
        };
        if !valid_record(&record) {
            return Err("archive_corrupt");
        }
    }
    Ok(rows)
}

/// Brings the legacy file into a new sealed archive: validate, stage, read back, then move. The
/// legacy file is never changed, and a crash at any step leaves it readable.
fn migrate(paths: &ArchivePaths, keys: &dyn KeyStore) -> Result<(), Failure> {
    let rows = read_legacy(&paths.legacy)?;
    let key = key_for_writing(keys)?;
    let connection = fresh_connection()?;
    for row in &rows {
        connection
            .execute(
                "INSERT INTO saved_charts
                   (id,name,utc_iso,time_zone,lat_micro,lng_micro,place_name,created_at_ms,updated_at_ms)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![row.id, row.name, row.utc_iso, row.time_zone, row.lat_micro, row.lng_micro, row.place_name, row.created_at_ms, row.updated_at_ms],
            )
            .map_err(|error| classify(&error))?;
    }
    let plain = bytes_from_connection(&connection)?;
    let sealed = archive_vault::seal(&key, &plain).map_err(key_failure)?;
    // Stage only; the archive is switched after the read-back below.
    {
        use std::io::Write;
        let written = (|| -> std::io::Result<()> {
            let mut file = fs::OpenOptions::new().write(true).create(true).truncate(true).open(&paths.staging)?;
            file.write_all(&sealed)?;
            file.sync_all()?;
            Ok(())
        })();
        if written.is_err() {
            let _ = fs::remove_file(&paths.staging);
            return Err("archive_unavailable");
        }
    }
    // Reopen with the key as the credential store gives it back, and compare with what was validated.
    let verified = (|| -> Result<bool, Failure> {
        let key_again = keys.load().map_err(key_failure)?.ok_or("archive_locked")?;
        let staged = fs::read(&paths.staging).map_err(|_| "archive_unavailable")?;
        let opened = archive_vault::open(&key_again, &staged).map_err(vault_failure)?;
        let reread = list(&connection_from_bytes(&opened)?, true)?;
        Ok(reread == rows)
    })();
    match verified {
        Ok(true) => fs::rename(&paths.staging, &paths.sealed).map_err(|_| {
            let _ = fs::remove_file(&paths.staging);
            "archive_unavailable"
        }),
        Ok(false) => {
            let _ = fs::remove_file(&paths.staging);
            Err("archive_unavailable")
        }
        Err(failure) => {
            let _ = fs::remove_file(&paths.staging);
            Err(failure)
        }
    }
}

/// The archive in memory, and whether a sealed file already exists for it.
struct Session {
    connection: Connection,
}

fn open_session(paths: &ArchivePaths, keys: &dyn KeyStore) -> Result<Session, Failure> {
    if paths.sealed.parent().ok_or("archive_unavailable")?.join("restore-in-progress.json").exists() { return Err("archive_unavailable"); }
    if let Some(folder) = paths.sealed.parent() {
        fs::create_dir_all(folder).map_err(|_| "archive_unavailable")?;
    }
    // A staging file left by an interrupted write holds only ciphertext and is disposable.
    let _ = fs::remove_file(&paths.staging);
    if paths.sealed.exists() {
        return Ok(Session { connection: load_sealed(paths, keys)? });
    }
    if paths.legacy.exists() {
        migrate(paths, keys)?;
        return Ok(Session { connection: load_sealed(paths, keys)? });
    }
    // First use: nothing is written (and no key is made) until the first chart is saved.
    Ok(Session { connection: fresh_connection()? })
}

fn outcome(paths: &ArchivePaths, connection: &Connection, photo_data: Option<Vec<u8>>) -> Result<Outcome, Failure> {
    let charts = list(connection, true)?;
    let folder = paths.sealed.parent().ok_or("archive_unavailable")?;
    let ids = charts.iter().map(|chart| chart.id.clone()).collect::<Vec<_>>();
    let photo_ids = chart_photos::list_ids(folder, &ids).map_err(photo_failure)?;
    Ok(Outcome { charts, legacy_present: paths.legacy.exists(), photo_ids, photo_data })
}

fn saved_chart_exists(connection: &Connection, id: &str) -> Result<bool, Failure> {
    connection.query_row("SELECT EXISTS(SELECT 1 FROM saved_charts WHERE id=?1)", [id], |row| row.get(0))
        .map_err(|error| classify(&error))
}

/// The legacy unscoped IPC cannot modify account-bound imported charts.
fn require_legacy_chart(connection: &Connection, id: &str) -> Result<(), Failure> {
    let civil_date: Option<Option<String>> = connection.query_row(
        "SELECT civil_date FROM saved_charts WHERE id=?1",[id],|r|r.get(0),
    ).optional().map_err(|error| classify(&error))?;
    if matches!(civil_date,Some(Some(_))) { return Err("not_found"); }
    Ok(())
}

fn run(paths: &ArchivePaths, keys: &dyn KeyStore, request: &ArchiveRequestV1, now_ms: i64, limit: i64) -> Result<Outcome, Failure> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err("invalid_request");
    }
    // Validate completely before touching the disk.
    let _guard = ARCHIVE_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // A stopped recovery must be rolled back before the application can touch the archive.
    if paths.sealed.parent().ok_or("archive_unavailable")?.join("restore-in-progress.json").exists() {
        return Err("archive_unavailable");
    }
    match (request.operation.as_str(), &request.chart, &request.id, &request.photo_data, &request.groups) {
        ("list", None, None, None, None) => {
            let session = open_session(paths, keys)?;
            outcome(paths, &session.connection, None)
        }
        ("save", Some(chart), None, None, None) if valid_record(chart) => {
            let mut session = open_session(paths, keys)?;
            save(&mut session.connection, chart, now_ms, limit)?;
            persist(paths, keys, &session.connection)?;
            outcome(paths, &session.connection, None)
        }
        ("delete", None, Some(id), None, None) if valid_id(id) => {
            let mut session = open_session(paths, keys)?;
            require_legacy_chart(&session.connection,id)?;
            delete(&mut session.connection, id)?;
            persist(paths, keys, &session.connection)?;
            // Never keep an attachment visible after its chart is deleted.
            // A file deletion failure is reported (not silently treated as success).
            chart_photos::remove(paths.sealed.parent().ok_or("archive_unavailable")?, id).map_err(photo_failure)?;
            outcome(paths, &session.connection, None)
        }
        ("set_groups", None, Some(id), None, Some(groups)) if valid_id(id) && valid_groups(groups) => {
            let mut session = open_session(paths, keys)?;
            require_legacy_chart(&session.connection,id)?;
            let associated: bool=session.connection.query_row("SELECT EXISTS(SELECT 1 FROM chart_sync_civil_sources WHERE chart_id=?1)",[id],|r|r.get(0)).map_err(|e|classify(&e))?;
            // Associated groups require an account-scoped compare-and-swap;
            // the older v1 command cannot supply the version shown to the user.
            if associated { return Err("archive_unavailable"); }
            set_groups(&mut session.connection, id, groups)?;
            persist(paths, keys, &session.connection)?;
            outcome(paths, &session.connection, None)
        }
        ("remove_legacy", None, None, None, None) => {
            // Only once the sealed archive has been opened successfully (migration included).
            let session = open_session(paths, keys)?;
            if paths.legacy.exists() && paths.sealed.exists() {
                fs::remove_file(&paths.legacy).map_err(|_| "archive_unavailable")?;
            }
            outcome(paths, &session.connection, None)
        }
        ("photo_save", None, Some(id), Some(data), None) if valid_id(id) && chart_photos::valid_jpeg(data) => {
            let session = open_session(paths, keys)?;
            if !saved_chart_exists(&session.connection, id)? { return Err("not_found"); }
            let key = keys.load().map_err(key_failure)?.ok_or("archive_locked")?;
            chart_photos::save(paths.sealed.parent().ok_or("archive_unavailable")?, &key, id, data).map_err(photo_failure)?;
            outcome(paths, &session.connection, None)
        }
        ("photo_read", None, Some(id), None, None) if valid_id(id) => {
            let session = open_session(paths, keys)?;
            if !saved_chart_exists(&session.connection, id)? { return Err("not_found"); }
            let key = keys.load().map_err(key_failure)?.ok_or("archive_locked")?;
            let photo = chart_photos::read(paths.sealed.parent().ok_or("archive_unavailable")?, &key, id)
                .map_err(photo_failure)?.map(|data| data.to_vec());
            outcome(paths, &session.connection, photo)
        }
        ("photo_delete", None, Some(id), None, None) if valid_id(id) => {
            let session = open_session(paths, keys)?;
            if !saved_chart_exists(&session.connection, id)? { return Err("not_found"); }
            // A corrupted/locked archive must never allow attachment mutations.
            keys.load().map_err(key_failure)?.ok_or("archive_locked")?;
            chart_photos::remove(paths.sealed.parent().ok_or("archive_unavailable")?, id).map_err(photo_failure)?;
            outcome(paths, &session.connection, None)
        }
        _ => Err("invalid_request"),
    }
}

/// Pure entry point, separated from Tauri so it can be unit tested.
pub fn handle(paths: &ArchivePaths, keys: &dyn KeyStore, request: &ArchiveRequestV1, now_ms: i64) -> ArchiveResponseV1 {
    match run(paths, keys, request, now_ms, MAX_CHARTS) {
        Ok(outcome) => ArchiveResponseV1 {
            protocol_version: PROTOCOL_VERSION,
            status: "ok",
            charts: Some(outcome.charts),
            legacy_present: outcome.legacy_present,
            photo_ids: outcome.photo_ids,
            photo_data: outcome.photo_data,
        },
        Err(status) => failure(status),
    }
}

#[tauri::command]
pub fn chart_archive(app: AppHandle, request: ArchiveRequestV1) -> ArchiveResponseV1 {
    let Ok(folder) = app.path().app_local_data_dir() else {
        return failure("archive_unavailable");
    };
    let now_ms = SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_millis() as i64).unwrap_or(0);
    handle(&ArchivePaths::in_folder(&folder), &OsKeyStore, &request, now_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::archive_keys::fake::FakeKeyStore;

    const ID_A: &str = "11111111-1111-4111-8111-111111111111";
    const ID_B: &str = "22222222-2222-4222-8222-222222222222";
    const SENTINEL: &str = "Sentinella Fittizia Ottanta";

    /// A unique folder in the system temp directory, removed when the test ends.
    struct TempArchive {
        folder: PathBuf,
        paths: ArchivePaths,
    }
    impl TempArchive {
        fn new(label: &str) -> Self {
            let unique = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let mut folder = std::env::temp_dir();
            folder.push(format!("vs-chart-archive-{label}-{}-{unique}", std::process::id()));
            let paths = ArchivePaths::in_folder(&folder);
            Self { folder, paths }
        }
        fn files(&self) -> Vec<String> {
            let mut names: Vec<String> = match fs::read_dir(&self.folder) {
                Ok(entries) => entries.map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect(),
                Err(_) => Vec::new(),
            };
            names.sort();
            names
        }
    }
    impl Drop for TempArchive {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.folder);
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
            historical: None,
        }
    }
    fn remote_chart(id: &str, unknown: bool) -> RemoteCivilChart {
        RemoteCivilChart {sync_id:id.into(),name:"Persona fittizia".into(),kind:"person".into(),
            civil_date:"1984-03-25".into(),civil_time:if unknown {None} else {Some("12:30:00".into())},
            time_unknown:unknown,time_zone:Some("Europe/Rome".into()),lat_micro:Some(44_000_000),
            lng_micro:Some(11_000_000),place_name:"Luogo fittizio".into(),place_mode:"manual".into(),
            city_ref:None,sex:None,is_account_chart:false,revision:1,updated_at:"2026-11-18T10:00:00Z".into(),
            groups:vec!["Gruppo fittizio".into()]}
    }
    fn request(operation: &str) -> ArchiveRequestV1 {
        ArchiveRequestV1 { protocol_version: 1, operation: operation.into(), chart: None, id: None, photo_data: None, groups: None }
    }
    fn list_request() -> ArchiveRequestV1 { request("list") }
    fn save_request(chart: ChartRecordV1) -> ArchiveRequestV1 {
        ArchiveRequestV1 { chart: Some(chart), ..request("save") }
    }
    fn delete_request(id: &str) -> ArchiveRequestV1 {
        ArchiveRequestV1 { id: Some(id.into()), ..request("delete") }
    }
    fn photo_request(operation: &str, id: &str, photo_data: Option<Vec<u8>>) -> ArchiveRequestV1 {
        ArchiveRequestV1 { id: Some(id.into()), photo_data, ..request(operation) }
    }
    fn go(archive: &TempArchive, keys: &FakeKeyStore, request: &ArchiveRequestV1, now_ms: i64) -> ArchiveResponseV1 {
        handle(&archive.paths, keys, request, now_ms)
    }

    const TEST_OLD_SCHEMA: &str = "CREATE TABLE saved_charts (
      id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, utc_iso TEXT NOT NULL,
      time_zone TEXT NOT NULL, lat_micro INTEGER NOT NULL, lng_micro INTEGER NOT NULL,
      place_name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE saved_chart_groups (chart_id TEXT NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
      position INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY(chart_id,position), UNIQUE(chart_id,name)) STRICT;
    CREATE TABLE chart_group_sync_links (chart_id TEXT PRIMARY KEY NOT NULL REFERENCES saved_charts(id) ON DELETE CASCADE,
      profile_ref TEXT NOT NULL, remote_sync_id TEXT NOT NULL, base_groups_json TEXT NOT NULL,
      conflict_groups_json TEXT, pending INTEGER NOT NULL, UNIQUE(profile_ref,remote_sync_id)) STRICT;
    PRAGMA user_version=3;";

    fn old_connection() -> Connection {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(TEST_OLD_SCHEMA).unwrap();
        connection.execute("INSERT INTO saved_charts VALUES (?1,'Fittizio','2001-02-03T04:05:06.000Z','Europe/Rome',44697805,11805778,'Luogo di prova',1000,1000)",[ID_A]).unwrap();
        connection
    }

    /// A plain SQLite archive of the first prototype, as it was written then.
    fn write_legacy(archive: &TempArchive, rows: &[(&str, &str, i64, i64)], extra: &str) {
        fs::create_dir_all(&archive.folder).unwrap();
        let connection = Connection::open(&archive.paths.legacy).unwrap();
        connection.execute_batch(TEST_OLD_SCHEMA).unwrap();
        connection.execute_batch("DROP TABLE chart_group_sync_links; DROP TABLE saved_chart_groups; PRAGMA user_version = 1;").unwrap();
        for (id, name, created, updated) in rows {
            connection
                .execute(
                    "INSERT INTO saved_charts VALUES (?1,?2,'2001-02-03T04:05:06.000Z','Europe/Rome',44697805,11805778,'Luogo di prova',?3,?4)",
                    params![id, name, created, updated],
                )
                .unwrap();
        }
        if !extra.is_empty() {
            connection.execute_batch(extra).unwrap();
        }
    }

    #[test]
    fn interrupted_recovery_blocks_archive_reads_and_writes() {
        let archive = TempArchive::new("recovery-pending");
        let keys = FakeKeyStore::empty();
        assert_eq!(go(&archive, &keys, &save_request(record(ID_A, SENTINEL)), 1000).status, "ok");
        let before = fs::read(&archive.paths.sealed).unwrap();
        fs::write(archive.folder.join("restore-in-progress.json"), b"{}\n").unwrap();
        assert_eq!(go(&archive, &keys, &list_request(), 2000).status, "archive_unavailable");
        assert_eq!(go(&archive, &keys, &save_request(record(ID_B, "Other")), 2000).status, "archive_unavailable");
        assert_eq!(list_offline_civil_charts(&archive.paths, &keys).unwrap_err(), "archive_unavailable");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before);
    }

    #[test]
    fn groups_persist_encrypted_are_preserved_on_chart_edit_and_removed_with_chart() {
        let archive = TempArchive::new("groups");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, "Persona fittizia")), 1000);
        let update = ArchiveRequestV1 { id: Some(ID_A.into()),
            groups: Some(vec!["Gruppo fittizio".into(), "Secondo".into()]), ..request("set_groups") };
        assert_eq!(go(&archive, &keys, &update, 2000).charts.unwrap()[0].groups,
            ["Gruppo fittizio", "Secondo"]);
        let bytes = fs::read(&archive.paths.sealed).unwrap();
        assert!(!bytes.windows("Gruppo fittizio".len()).any(|window| window == b"Gruppo fittizio"));
        assert_eq!(go(&archive, &keys, &save_request(record(ID_A, "Modificato")), 3000)
            .charts.unwrap()[0].groups, ["Gruppo fittizio", "Secondo"]);
        assert!(go(&archive, &keys, &delete_request(ID_A), 4000).charts.unwrap().is_empty());
        let connection = load_sealed(&archive.paths, &keys).unwrap();
        let count: i64 = connection.query_row("SELECT count(*) FROM saved_chart_groups", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn invalid_groups_do_not_write_and_unknown_chart_is_not_created() {
        let archive = TempArchive::new("invalid-groups");
        let keys = FakeKeyStore::empty();
        let invalid = ArchiveRequestV1 { id: Some(ID_A.into()),
            groups: Some(vec!["uguale".into(), "uguale".into()]), ..request("set_groups") };
        assert_eq!(go(&archive, &keys, &invalid, 1000).status, "invalid_request");
        assert!(archive.files().is_empty());
        let unknown = ArchiveRequestV1 { id: Some(ID_B.into()), groups: Some(vec!["valido".into()]), ..request("set_groups") };
        assert_eq!(go(&archive, &keys, &unknown, 1000).status, "not_found");
        assert!(archive.files().is_empty());
    }

    #[test]
    fn sealed_v1_archive_upgrades_in_memory_and_persists_only_on_a_successful_write() {
        let archive = TempArchive::new("groups-upgrade");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let connection = old_connection();
        connection.execute_batch("DROP TABLE chart_group_sync_links; DROP TABLE saved_chart_groups; PRAGMA user_version=1;").unwrap();
        persist(&archive.paths, &keys, &connection).unwrap();
        let original = fs::read(&archive.paths.sealed).unwrap();
        let charts = go(&archive, &keys, &list_request(), 2000).charts.unwrap();
        assert!(charts[0].groups.is_empty());
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), original);
        let update = ArchiveRequestV1 { id: Some(ID_A.into()), groups: Some(vec!["Famiglia fittizia".into()]), ..request("set_groups") };
        assert_eq!(go(&archive, &keys, &update, 3000).charts.unwrap()[0].groups, ["Famiglia fittizia"]);
        assert_eq!(go(&archive, &keys, &list_request(), 4000).charts.unwrap()[0].groups, ["Famiglia fittizia"]);
        let upgraded = load_sealed(&archive.paths, &keys).unwrap();
        let version: i64 = upgraded.query_row("PRAGMA user_version", [], |r| r.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
    }

    #[test]
    fn version_two_keeps_groups_and_does_not_rewrite_ciphertext_on_read() {
        let archive = TempArchive::new("group-v2-upgrade");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let connection = old_connection();
        connection.execute("INSERT INTO saved_chart_groups VALUES (?1,0,'Gruppo fittizio')",[ID_A]).unwrap();
        connection.execute_batch("DROP TABLE chart_group_sync_links; PRAGMA user_version=2;").unwrap();
        persist(&archive.paths,&keys,&connection).unwrap();
        let original = fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].groups,["Gruppo fittizio"]);
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(),original);
    }

    #[test]
    fn version_three_preserves_groups_links_and_ciphertext_until_successful_write() {
        let archive = TempArchive::new("civil-v4-upgrade");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let connection = old_connection();
        connection.execute("INSERT INTO saved_chart_groups VALUES (?1,0,'Locale')",[ID_A]).unwrap();
        connection.execute("INSERT INTO chart_group_sync_links VALUES (?1,?2,?1,'[]',NULL,1)",params![ID_A,ID_B]).unwrap();
        persist(&archive.paths,&keys,&connection).unwrap();
        let original = fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].groups,["Locale"]);
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(),original);
        let pending = pending_groups_for_profile(&archive.paths,&keys,ID_B).unwrap();
        assert_eq!(pending.len(),1);
        assert_eq!(pending[0].groups,["Locale"]);
        assert_eq!(go(&archive,&keys,&save_request(record(ID_A,"Aggiornato")),3000).status,"ok");
        let reopened = load_sealed(&archive.paths,&keys).unwrap();
        let version: i64 = reopened.query_row("PRAGMA user_version",[],|r|r.get(0)).unwrap();
        assert_eq!(version,SCHEMA_VERSION);
        assert_eq!(pending_groups_for_profile(&archive.paths,&keys,ID_B).unwrap().len(),1);
    }

    #[test]
    fn version_four_upgrades_without_rewriting_ciphertext_on_read() {
        let archive=TempArchive::new("association-v5-upgrade");
        let keys=FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let mut connection=fresh_connection().unwrap();
        save(&mut connection,&record(ID_A,"Fittizio"),1000,MAX_CHARTS).unwrap();
        connection.execute_batch("DROP TABLE chart_sync_create_outbox; DROP TABLE chart_sync_civil_sources; PRAGMA user_version=4;").unwrap();
        persist(&archive.paths,&keys,&connection).unwrap();
        let original=fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].name,"Fittizio");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(),original);
        let upgraded=load_sealed(&archive.paths,&keys).unwrap();
        let version:i64=upgraded.query_row("PRAGMA user_version",[],|r|r.get(0)).unwrap();
        assert_eq!(version,SCHEMA_VERSION);
    }

    #[test]
    fn creation_outbox_is_encrypted_profile_bound_and_replay_keeps_later_edits() {
        let archive=TempArchive::new("create-outbox");
        let keys=FakeKeyStore::empty();
        let profile="44444444-4444-4444-8444-444444444444";
        let other="55555555-5555-4555-8555-555555555555";
        assert_eq!(go(&archive,&keys,&save_request(record(ID_B,"Locale fittizio")),1000).status,"ok");
        let first=ArchiveRequestV1 {id:Some(ID_B.into()),groups:Some(vec!["Primo".into()]),..request("set_groups")};
        assert_eq!(go(&archive,&keys,&first,1100).status,"ok");
        let choice=CreateChartChoice {chart_id:ID_B,updated_at_ms:1000,groups:&["Primo".into()],
            local_date:"2001-02-03",local_time:"05:05:06",include_groups:true};
        queue_chart_create(&archive.paths,&keys,profile,&choice).unwrap();
        let original=fs::read(&archive.paths.sealed).unwrap();
        assert!(!original.windows("Locale fittizio".len()).any(|w|w==b"Locale fittizio"));
        let pending=pending_chart_creates(&archive.paths,&keys,profile).unwrap();
        assert_eq!(pending.len(),1);
        let schema:serde_json::Value=serde_json::from_str(include_str!("../../contracts/chart-create.v1.schema.json")).unwrap();
        let value=serde_json::to_value(&pending[0].payload).unwrap();
        let mut actual:Vec<_>=value.as_object().unwrap().keys().cloned().collect();actual.sort();
        let mut required:Vec<_>=schema["required"].as_array().unwrap().iter().map(|v|v.as_str().unwrap().to_string()).collect();required.sort();
        assert_eq!(actual,required);
        assert!(pending_chart_creates(&archive.paths,&keys,other).unwrap().is_empty());
        assert_eq!(pending_chart_create_ids(&archive.paths,&keys,profile,false).unwrap(),[ID_B]);
        assert_eq!(offline_pending_chart_create_ids(&archive.paths,&keys,false).unwrap(),[ID_B]);
        assert_eq!(go(&archive,&keys,&delete_request(ID_B),1200).status,"archive_unavailable");
        assert_eq!(go(&archive,&keys,&save_request(record(ID_B,"Modifica tardiva")),1250).status,"archive_unavailable");
        let edited=ArchiveRequestV1 {id:Some(ID_B.into()),groups:Some(vec!["Secondo".into()]),..request("set_groups")};
        assert_eq!(go(&archive,&keys,&edited,1300).status,"ok");
        let replay=pending_chart_creates(&archive.paths,&keys,profile).unwrap();
        assert_eq!(replay[0].payload.mutation_id,pending[0].payload.mutation_id);
        assert_eq!(replay[0].payload.groups,["Primo"]);
        assert_eq!(acknowledge_chart_create(&archive.paths,&keys,other,&replay[0],ID_A),Err("stale_sync"));
        acknowledge_chart_create(&archive.paths,&keys,profile,&replay[0],ID_A).unwrap();
        assert!(pending_chart_creates(&archive.paths,&keys,profile).unwrap().is_empty());
        let queued=pending_groups_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(queued[0].base_groups,["Primo"]);
        assert_eq!(queued[0].groups,["Secondo"]);
        let mut remote=remote_chart(ID_A,false);
        remote.groups=vec!["Primo".into()];
        import_remote_civil_charts(&archive.paths,&keys,profile,&[remote],2000).unwrap();
        let imported=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(imported.len(),1);
        assert_eq!(imported[0].id,ID_B);
        assert_eq!(imported[0].groups,["Secondo"]);
        assert_eq!(imported[0].sync_status,"pending");
    }

    #[test]
    fn version_five_adds_creation_outbox_without_rewriting_ciphertext_on_read() {
        let archive=TempArchive::new("create-v6-upgrade");
        let keys=FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let mut connection=fresh_connection().unwrap();
        save(&mut connection,&record(ID_A,"Fittizio"),1000,MAX_CHARTS).unwrap();
        connection.execute_batch("DROP TABLE chart_sync_create_outbox; PRAGMA user_version=5;").unwrap();
        persist(&archive.paths,&keys,&connection).unwrap();
        let original=fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].name,"Fittizio");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(),original);
        assert!(pending_chart_creates(&archive.paths,&keys,ID_B).unwrap().is_empty());
    }

    #[test]
    fn only_definitive_full_rejections_can_be_cancelled_and_local_data_remains() {
        let archive=TempArchive::new("create-rejected");
        let keys=FakeKeyStore::empty();
        let profile="44444444-4444-4444-8444-444444444444";
        let other="55555555-5555-4555-8555-555555555555";
        assert_eq!(go(&archive,&keys,&save_request(record(ID_B,"Fittizio")),1000).status,"ok");
        let choice=CreateChartChoice {chart_id:ID_B,updated_at_ms:1000,groups:&[],local_date:"2001-02-03",local_time:"05:05:06",include_groups:false};
        queue_chart_create(&archive.paths,&keys,profile,&choice).unwrap();
        assert_eq!(cancel_rejected_chart_create(&archive.paths,&keys,profile,ID_B),Err("stale_sync"));
        let pending=pending_chart_creates(&archive.paths,&keys,profile).unwrap();
        reject_chart_create_full(&archive.paths,&keys,profile,&pending[0]).unwrap();
        assert!(pending_chart_creates(&archive.paths,&keys,profile).unwrap().is_empty());
        assert_eq!(pending_chart_create_ids(&archive.paths,&keys,profile,true).unwrap(),[ID_B]);
        assert_eq!(cancel_rejected_chart_create(&archive.paths,&keys,other,ID_B),Err("stale_sync"));
        cancel_rejected_chart_create(&archive.paths,&keys,profile,ID_B).unwrap();
        assert!(pending_chart_create_ids(&archive.paths,&keys,profile,true).unwrap().is_empty());
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].name,"Fittizio");
    }

    #[test]
    fn imports_unknown_and_known_civil_times_without_fabricating_utc_or_matching_other_profiles() {
        let archive = TempArchive::new("civil-import");
        let keys = FakeKeyStore::empty();
        let charts = [remote_chart(ID_A,true),remote_chart(ID_B,false)];
        let profile = "44444444-4444-4444-8444-444444444444";
        let other = "55555555-5555-4555-8555-555555555555";
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,profile,&charts,1000),
            Ok(CivilImportSummary {inserted:2,updated:0,already_linked:0}));
        let ciphertext = fs::read(&archive.paths.sealed).unwrap();
        assert!(!ciphertext.windows("Persona fittizia".len()).any(|w|w==b"Persona fittizia"));
        assert!(go(&archive,&keys,&list_request(),2000).charts.unwrap().is_empty());
        let connection=load_sealed(&archive.paths,&keys).unwrap();
        let rows: Vec<(Option<String>,String,Option<String>,i64)> = {
            let mut query=connection.prepare("SELECT utc_iso,civil_date,civil_time,time_unknown FROM saved_charts ORDER BY time_unknown DESC").unwrap();
            query.query_map([],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).unwrap().map(Result::unwrap).collect()
        };
        assert_eq!(rows[0],(None,"1984-03-25".into(),None,1));
        assert_eq!(rows[1],(None,"1984-03-25".into(),Some("12:30:00".into()),0));
        let links=group_baselines_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(links.len(),2);
        assert!(links.iter().all(|link|link.chart_id!=link.remote_sync_id));
        let visible=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(visible.len(),2);
        assert!(visible.iter().any(|chart|chart.time_unknown && chart.civil_time.is_none()));
        assert!(list_civil_charts_for_profile(&archive.paths,&keys,other).unwrap().is_empty());
        let target=&visible[0].id;
        let new_groups=vec!["Altro gruppo".to_string()];
        assert_eq!(set_civil_groups_for_profile(&archive.paths,&keys,other,target,&visible[0].groups,&new_groups),Err("profile_conflict"));
        let unscoped = ArchiveRequestV1 {id:Some(target.clone()),groups:Some(new_groups.clone()),..request("set_groups")};
        assert_eq!(go(&archive,&keys,&unscoped,2200).status,"not_found");
        assert_eq!(go(&archive,&keys,&delete_request(target),2300).status,"not_found");
        set_civil_groups_for_profile(&archive.paths,&keys,profile,target,&visible[0].groups,&new_groups).unwrap();
        assert_eq!(set_civil_groups_for_profile(&archive.paths,&keys,profile,target,&visible[0].groups,&[]),Err("stale_sync"));
        assert_eq!(pending_groups_for_profile(&archive.paths,&keys,profile).unwrap().len(),1);
        let after_edit=fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,profile,&charts,3000),
            Ok(CivilImportSummary {inserted:0,updated:0,already_linked:2}));
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(),after_edit);
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,other,&charts[..1],4000),
            Ok(CivilImportSummary {inserted:1,updated:0,already_linked:0}));
        assert_eq!(group_baselines_for_profile(&archive.paths,&keys,profile).unwrap().len(),2);
        assert_eq!(group_baselines_for_profile(&archive.paths,&keys,other).unwrap().len(),1);
        let offline=list_offline_civil_charts(&archive.paths,&keys).unwrap();
        assert_eq!(offline.len(),1);
        assert_eq!(set_offline_civil_groups(&archive.paths,&keys,target,&new_groups,&[]),Err("profile_conflict"));
        set_offline_civil_groups(&archive.paths,&keys,&offline[0].id,&offline[0].groups,&["Offline".into()]).unwrap();
        assert_eq!(pending_groups_for_profile(&archive.paths,&keys,other).unwrap().len(),1);
        assert_eq!(pending_groups_for_profile(&archive.paths,&keys,profile).unwrap().len(),1);
    }

    #[test]
    fn explicit_association_preserves_both_birth_records_and_detects_stale_or_foreign_choices() {
        let archive=TempArchive::new("associate");
        let keys=FakeKeyStore::empty();
        let profile="44444444-4444-4444-8444-444444444444";
        let other="55555555-5555-4555-8555-555555555555";
        assert_eq!(go(&archive,&keys,&save_request(record(ID_B,"Locale fittizio")),1000).status,"ok");
        import_remote_civil_charts(&archive.paths,&keys,profile,&[remote_chart(ID_A,true)],2000).unwrap();
        let source=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap().remove(0);
        let before=fs::read(&archive.paths.sealed).unwrap();
        let mut choice=AssociationChoice {local_id:ID_B,source_id:&source.id,local_updated:1000,source_updated:2000,local_groups:&[],source_groups:&source.groups};
        assert_eq!(associate_civil_chart(&archive.paths,&keys,other,&choice),Err("stale_sync"));
        choice.local_updated=999;
        assert_eq!(associate_civil_chart(&archive.paths,&keys,profile,&choice),Err("stale_sync"));
        choice.local_updated=1000; choice.source_updated=1999;
        assert_eq!(associate_civil_chart(&archive.paths,&keys,profile,&choice),Err("stale_sync"));
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(),before);
        choice.source_updated=2000;
        associate_civil_chart(&archive.paths,&keys,profile,&choice).unwrap();
        let visible=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(visible[0].id,ID_B);
        assert!(visible[0].time_unknown && visible[0].civil_time.is_none());
        assert_eq!(visible[0].sync_status,"conflict");
        assert_eq!(go(&archive,&keys,&list_request(),2100).charts.unwrap()[0].name,"Locale fittizio");
        assert_eq!(group_conflicts_for_profile(&archive.paths,&keys,profile).unwrap().len(),1);
        let unsafe_edit=ArchiveRequestV1 {id:Some(ID_B.into()),groups:Some(vec!["Senza controllo".into()]),..request("set_groups")};
        assert_eq!(go(&archive,&keys,&unsafe_edit,2150).status,"archive_unavailable");
        assert_eq!(set_civil_groups_for_profile(&archive.paths,&keys,other,ID_B,&[],&["Altrui".into()]),Err("profile_conflict"));
        let mut changed=remote_chart(ID_A,true);
        changed.civil_date="1984-03-26".into();
        import_remote_civil_charts(&archive.paths,&keys,profile,&[changed],3000).unwrap();
        let after=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(after[0].id,ID_B);
        assert_eq!(after[0].civil_date,"1984-03-26");
        assert_eq!(after[0].sync_status,"conflict");
        assert_eq!(go(&archive,&keys,&list_request(),3100).charts.unwrap()[0].utc_iso,"2001-02-03T04:05:06.000Z");
        assert_eq!(go(&archive,&keys,&delete_request(ID_B),3200).status,"ok");
        let retained=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(retained[0].id,source.id);
        assert_eq!(retained[0].sync_status,"conflict");
        assert_eq!(retained[0].civil_date,"1984-03-26");
        apply_conflict_resolution(&archive.paths,&keys,profile,&source.id,&source.groups,&[],&source.groups).unwrap();
        assert_eq!(list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap()[0].groups,source.groups);
    }

    #[test]
    fn rejects_invalid_or_duplicate_civil_snapshot_before_creating_archive() {
        let archive = TempArchive::new("civil-import-invalid");
        let keys = FakeKeyStore::empty();
        let profile = "44444444-4444-4444-8444-444444444444";
        let mut invalid = remote_chart(ID_A,true);
        invalid.civil_time=Some("00:00:00".into());
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,profile,&[invalid],1000),Err("invalid_request"));
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,profile,&[remote_chart(ID_A,true),remote_chart(ID_A,false)],1000),Err("invalid_request"));
        let mut invalid_date=remote_chart(ID_B,false);
        invalid_date.civil_date="1900-02-29".into();
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,profile,&[invalid_date],1000),Err("invalid_request"));
        assert!(archive.files().is_empty());
    }

    #[test]
    fn remote_birth_change_updates_import_without_erasing_pending_local_groups() {
        let archive=TempArchive::new("civil-refresh");
        let keys=FakeKeyStore::empty();
        let profile="44444444-4444-4444-8444-444444444444";
        import_remote_civil_charts(&archive.paths,&keys,profile,&[remote_chart(ID_A,true)],1000).unwrap();
        let first=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        set_civil_groups_for_profile(&archive.paths,&keys,profile,&first[0].id,&first[0].groups,&["Locale".into()]).unwrap();
        let mut changed=remote_chart(ID_A,false);
        changed.name="Nome modificato".into();
        changed.civil_date="1984-03-26".into();
        assert_eq!(import_remote_civil_charts(&archive.paths,&keys,profile,&[changed],2000),
            Ok(CivilImportSummary {inserted:0,updated:1,already_linked:1}));
        let after=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(after[0].id,first[0].id);
        assert_eq!(after[0].civil_date,"1984-03-26");
        assert_eq!(after[0].civil_time.as_deref(),Some("12:30:00"));
        assert!(!after[0].time_unknown);
        assert_eq!(after[0].groups,["Locale"]);
        assert_eq!(after[0].sync_status,"pending");
        let pending=pending_groups_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(pending[0].base_groups,["Gruppo fittizio"]);
    }

    #[test]
    fn absent_remote_chart_keeps_local_copy_and_pending_edits_until_it_returns() {
        let archive=TempArchive::new("civil-missing");
        let keys=FakeKeyStore::empty();
        let profile="44444444-4444-4444-8444-444444444444";
        import_remote_civil_charts(&archive.paths,&keys,profile,&[remote_chart(ID_A,true)],1000).unwrap();
        let first=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        set_civil_groups_for_profile(&archive.paths,&keys,profile,&first[0].id,&first[0].groups,&["Locale".into()]).unwrap();
        let summary=import_remote_civil_charts(&archive.paths,&keys,profile,&[],2000).unwrap();
        assert_eq!(summary.updated,1);
        let missing=list_offline_civil_charts(&archive.paths,&keys).unwrap();
        assert_eq!(missing[0].sync_status,"missing");
        assert_eq!(missing[0].groups,["Locale"]);
        assert!(pending_groups_for_profile(&archive.paths,&keys,profile).unwrap().is_empty());
        import_remote_civil_charts(&archive.paths,&keys,profile,&[remote_chart(ID_A,true)],3000).unwrap();
        let restored=list_civil_charts_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(restored[0].sync_status,"pending");
        let pending=pending_groups_for_profile(&archive.paths,&keys,profile).unwrap();
        assert_eq!(pending[0].base_groups,["Gruppo fittizio"]);
        assert_eq!(pending[0].groups,["Locale"]);
    }

    #[test]
    fn group_outbox_is_profile_bound_and_keeps_new_edits_after_an_old_response() {
        let archive = TempArchive::new("profile-outbox");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        let base: Vec<String> = vec![];
        link_group_sync(&mut connection,ID_A,ID_B,ID_A,&base).unwrap();
        assert_eq!(link_group_sync(&mut connection,ID_A,ID_A,ID_A,&base),Err("profile_conflict"));
        persist(&archive.paths,&keys,&connection).unwrap();
        let first = vec!["Prima modifica".to_string()];
        let second = vec!["Seconda modifica".to_string()];
        for groups in [&first,&second] {
            let update = ArchiveRequestV1 {id:Some(ID_A.into()),groups:Some(groups.clone()),..request("set_groups")};
            assert_eq!(go(&archive,&keys,&update,2000).status,"ok");
        }
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        assert_eq!(acknowledge_group_sync(&mut connection,ID_A,ID_A,ID_A,&base,&first),Err("profile_conflict"));
        acknowledge_group_sync(&mut connection,ID_A,ID_B,ID_A,&base,&first).unwrap();
        let pending: i64 = connection.query_row("SELECT pending FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|r.get(0)).unwrap();
        assert_eq!(pending,1, "an edit made during a request must remain pending");
        assert_eq!(acknowledge_group_sync(&mut connection,ID_A,ID_B,ID_A,&base,&first),Err("stale_sync"));
        acknowledge_group_sync(&mut connection,ID_A,ID_B,ID_A,&first,&second).unwrap();
        let pending: i64 = connection.query_row("SELECT pending FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|r.get(0)).unwrap();
        assert_eq!(pending,0);
        persist(&archive.paths,&keys,&connection).unwrap();
        let reopened = load_sealed(&archive.paths,&keys).unwrap();
        let pending: i64 = reopened.query_row("SELECT pending FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|r.get(0)).unwrap();
        assert_eq!(pending,0);
    }

    #[test]
    fn initial_link_with_different_groups_requires_resolution_before_any_acknowledgement() {
        let archive = TempArchive::new("initial-group-conflict");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        let remote = vec!["Remoto fittizio".to_string()];
        link_group_sync(&mut connection,ID_A,ID_B,ID_A,&remote).unwrap();
        set_groups(&mut connection,ID_A,&["Locale fittizio".into()]).unwrap();
        let pending: i64 = connection.query_row("SELECT pending FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|r.get(0)).unwrap();
        assert_eq!(pending,2);
        assert_eq!(acknowledge_group_sync(&mut connection,ID_A,ID_B,ID_A,&remote,&[]),Err("stale_sync"));
    }

    #[test]
    fn remote_snapshot_reconciles_clean_changes_and_preserves_concurrent_edits() {
        let archive = TempArchive::new("group-snapshot-reconciliation");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        let empty: Vec<String> = vec![];
        let web = vec!["Web fittizio".to_string()];
        let local = vec!["Locale fittizio".to_string()];
        let other = vec!["Altro fittizio".to_string()];
        link_group_sync(&mut connection,ID_A,ID_B,ID_A,&empty).unwrap();
        assert_eq!(reconcile_group_snapshot(&mut connection,ID_A,ID_A,ID_A,&empty,&web),Err("profile_conflict"));
        reconcile_group_snapshot(&mut connection,ID_A,ID_B,ID_A,&empty,&web).unwrap();
        assert_eq!(chart_groups(&connection,ID_A).unwrap(),web);
        assert_eq!(reconcile_group_snapshot(&mut connection,ID_A,ID_B,ID_A,&empty,&other),Err("stale_sync"));
        set_groups(&mut connection,ID_A,&local).unwrap();
        reconcile_group_snapshot(&mut connection,ID_A,ID_B,ID_A,&web,&web).unwrap();
        let pending: i64 = connection.query_row("SELECT pending FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|r.get(0)).unwrap();
        assert_eq!(pending,1);
        reconcile_group_snapshot(&mut connection,ID_A,ID_B,ID_A,&web,&other).unwrap();
        assert_eq!(chart_groups(&connection,ID_A).unwrap(),local);
        let (pending,conflict): (i64,String) = connection.query_row("SELECT pending,conflict_groups_json FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(pending,2);
        assert_eq!(serde_json::from_str::<Vec<String>>(&conflict).unwrap(),other);
        assert_eq!(reconcile_group_snapshot(&mut connection,ID_A,ID_B,ID_A,&web,&web),Err("conflict_pending"));
    }

    #[test]
    fn snapshot_equal_to_pending_local_edit_acknowledges_retry() {
        let archive = TempArchive::new("group-snapshot-replay");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        let empty: Vec<String> = vec![];
        let local = vec!["Locale fittizio".to_string()];
        link_group_sync(&mut connection,ID_A,ID_B,ID_A,&empty).unwrap();
        set_groups(&mut connection,ID_A,&local).unwrap();
        reconcile_group_snapshot(&mut connection,ID_A,ID_B,ID_A,&empty,&local).unwrap();
        let (pending,base): (i64,String) = connection.query_row("SELECT pending,base_groups_json FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(pending,0);
        assert_eq!(serde_json::from_str::<Vec<String>>(&base).unwrap(),local);
    }

    #[test]
    fn profile_bound_snapshot_persists_and_rejects_stale_response() {
        let archive = TempArchive::new("group-snapshot-persist");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        link_groups_to_verified_profile(&archive.paths,&keys,ID_A,ID_B,ID_A,&[]).unwrap();
        assert!(group_baselines_for_profile(&archive.paths,&keys,ID_A).unwrap().is_empty());
        let baseline = group_baselines_for_profile(&archive.paths,&keys,ID_B).unwrap();
        assert_eq!(baseline.len(),1);
        let remote = vec!["Web fittizio".to_string()];
        assert_eq!(apply_remote_group_snapshot(&archive.paths,&keys,ID_A,&baseline[0],&remote),Err("profile_conflict"));
        apply_remote_group_snapshot(&archive.paths,&keys,ID_B,&baseline[0],&remote).unwrap();
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].groups,remote);
        assert_eq!(apply_remote_group_snapshot(&archive.paths,&keys,ID_B,&baseline[0],&[]),Err("stale_sync"));
        assert_eq!(go(&archive,&keys,&list_request(),2000).charts.unwrap()[0].groups,remote);
    }

    #[test]
    fn conflict_view_is_profile_bound_and_resolution_rejects_stale_local_choice() {
        let archive = TempArchive::new("conflict-view");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        link_groups_to_verified_profile(&archive.paths,&keys,ID_A,ID_B,ID_A,&[]).unwrap();
        let baseline = group_baselines_for_profile(&archive.paths,&keys,ID_B).unwrap();
        let local = vec!["Locale".to_string()];
        let remote = vec!["Web".to_string()];
        let later = vec!["Modificato".to_string()];
        let request = |names: Vec<String>| ArchiveRequestV1 {protocol_version:1,operation:"set_groups".into(),
            chart:None,id:Some(ID_A.into()),groups:Some(names),photo_data:None};
        assert_eq!(go(&archive,&keys,&request(local.clone()),2000).status,"ok");
        apply_remote_group_snapshot(&archive.paths,&keys,ID_B,&baseline[0],&remote).unwrap();
        assert!(group_conflicts_for_profile(&archive.paths,&keys,ID_A).unwrap().is_empty());
        let conflicts = group_conflicts_for_profile(&archive.paths,&keys,ID_B).unwrap();
        assert_eq!(conflicts.len(),1);
        assert_eq!(conflicts[0].local_groups,local);
        assert_eq!(conflicts[0].server_groups,remote);
        assert_eq!(go(&archive,&keys,&request(later.clone()),3000).status,"ok");
        assert_eq!(apply_conflict_resolution(&archive.paths,&keys,ID_B,ID_A,&remote,&local,&remote),Err("stale_sync"));
        assert_eq!(apply_conflict_resolution(&archive.paths,&keys,ID_A,ID_A,&remote,&later,&remote),Err("profile_conflict"));
        apply_conflict_resolution(&archive.paths,&keys,ID_B,ID_A,&remote,&later,&remote).unwrap();
        assert!(group_conflicts_for_profile(&archive.paths,&keys,ID_B).unwrap().is_empty());
        assert_eq!(go(&archive,&keys,&list_request(),4000).charts.unwrap()[0].groups,remote);
    }

    #[test]
    fn remote_conflict_preserves_local_groups_and_requires_a_user_choice() {
        let archive = TempArchive::new("remote-group-conflict");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        let base: Vec<String> = vec![];
        link_group_sync(&mut connection,ID_A,ID_B,ID_A,&base).unwrap();
        let local = vec!["Locale fittizio".to_string()];
        let remote = vec!["Web fittizio".to_string()];
        set_groups(&mut connection,ID_A,&local).unwrap();
        record_group_conflict(&mut connection,ID_A,ID_B,ID_A,&base,&remote).unwrap();
        assert_eq!(chart_groups(&connection,ID_A).unwrap(),local);
        let (pending,json): (i64,String) = connection.query_row(
            "SELECT pending,conflict_groups_json FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(pending,2);
        assert_eq!(serde_json::from_str::<Vec<String>>(&json).unwrap(),remote);
        assert_eq!(acknowledge_group_sync(&mut connection,ID_A,ID_B,ID_A,&base,&local),Err("stale_sync"));
        assert_eq!(resolve_group_conflict(&mut connection,ID_A,ID_B,ID_A,&base,&local,&local),Err("stale_sync"));
        assert_eq!(resolve_group_conflict(&mut connection,ID_A,ID_B,ID_A,&remote,&base,&local),Err("stale_sync"));
        persist(&archive.paths,&keys,&connection).unwrap();
        let mut reopened = load_sealed(&archive.paths,&keys).unwrap();
        assert_eq!(chart_groups(&reopened,ID_A).unwrap(),local);
        let merged = vec!["Locale fittizio".to_string(),"Web fittizio".to_string()];
        resolve_group_conflict(&mut reopened,ID_A,ID_B,ID_A,&remote,&local,&merged).unwrap();
        assert_eq!(chart_groups(&reopened,ID_A).unwrap(),merged);
        let pending: i64 = reopened.query_row("SELECT pending FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|r.get(0)).unwrap();
        assert_eq!(pending,1);
        acknowledge_group_sync(&mut reopened,ID_A,ID_B,ID_A,&remote,&merged).unwrap();
        assert_eq!(acknowledge_group_sync(&mut reopened,ID_A,ID_B,ID_A,&remote,&merged),Err("stale_sync"));
    }

    #[test]
    fn pending_worker_reads_only_its_profile_and_never_loses_a_concurrent_edit() {
        use crate::pkce_reqwest_https::GroupWriteResult;
        let archive = TempArchive::new("pending-worker");
        let keys = FakeKeyStore::empty();
        go(&archive,&keys,&save_request(record(ID_A,"Fittizio")),1000);
        let mut connection = load_sealed(&archive.paths,&keys).unwrap();
        link_group_sync(&mut connection,ID_A,ID_B,ID_A,&[]).unwrap();
        persist(&archive.paths,&keys,&connection).unwrap();
        let first = ArchiveRequestV1 {id:Some(ID_A.into()),groups:Some(vec!["Prima".into()]),..request("set_groups")};
        go(&archive,&keys,&first,2000);
        assert!(pending_groups_for_profile(&archive.paths,&keys,ID_A).unwrap().is_empty());
        let pending = pending_groups_for_profile(&archive.paths,&keys,ID_B).unwrap();
        assert_eq!(pending.len(),1);
        assert_eq!(pending[0].groups,["Prima"]);
        let second = ArchiveRequestV1 {id:Some(ID_A.into()),groups:Some(vec!["Seconda".into()]),..request("set_groups")};
        go(&archive,&keys,&second,3000);
        assert_eq!(apply_group_sync_result(&archive.paths,&keys,ID_A,&pending[0],&GroupWriteResult::Updated),Err("profile_conflict"));
        apply_group_sync_result(&archive.paths,&keys,ID_B,&pending[0],&GroupWriteResult::Updated).unwrap();
        let next = pending_groups_for_profile(&archive.paths,&keys,ID_B).unwrap();
        assert_eq!(next.len(),1);
        assert_eq!(next[0].base_groups,["Prima"]);
        assert_eq!(next[0].groups,["Seconda"]);
        apply_group_sync_result(&archive.paths,&keys,ID_B,&next[0],&GroupWriteResult::Conflict(vec!["Web".into()])).unwrap();
        assert!(pending_groups_for_profile(&archive.paths,&keys,ID_B).unwrap().is_empty());
        let reopened = load_sealed(&archive.paths,&keys).unwrap();
        assert_eq!(chart_groups(&reopened,ID_A).unwrap(),["Seconda"]);
        let (pending,remote):(i64,String)=reopened.query_row("SELECT pending,conflict_groups_json FROM chart_group_sync_links WHERE chart_id=?1",[ID_A],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(pending,2);
        assert_eq!(serde_json::from_str::<Vec<String>>(&remote).unwrap(),["Web"]);
    }

    #[test]
    fn test_first_use_writes_nothing_and_makes_no_key() {
        let archive = TempArchive::new("first");
        let keys = FakeKeyStore::empty();
        let response = go(&archive, &keys, &list_request(), 1000);
        assert_eq!(response.status, "ok");
        assert_eq!(response.charts, Some(vec![]));
        assert!(!response.legacy_present);
        assert!(archive.files().is_empty());
        assert!(keys.key.borrow().is_none());
    }

    #[test]
    fn test_saving_creates_one_sealed_file_and_no_plain_text_anywhere() {
        let archive = TempArchive::new("sealed");
        let keys = FakeKeyStore::empty();
        assert_eq!(go(&archive, &keys, &save_request(record(ID_A, SENTINEL)), 1000).status, "ok");
        // Exactly the sealed file: no journal, no staging copy, no legacy file.
        assert_eq!(archive.files(), [SEALED_FILE_NAME]);
        let bytes = fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(&bytes[..8], archive_vault::MAGIC);
        assert!(!bytes.starts_with(b"SQLite format 3"));
        for needle in [SENTINEL, "Luogo di prova", "Europe/Rome", "saved_charts", "2001-02-03"] {
            assert!(!bytes.windows(needle.len()).any(|window| window == needle.as_bytes()), "plain text found: {needle}");
        }
        assert!(keys.key.borrow().is_some(), "the key is made when the first chart is saved");
    }

    #[test]
    fn test_saved_charts_survive_reopening_and_are_listed_by_name() {
        let archive = TempArchive::new("persist");
        let keys = FakeKeyStore::empty();
        assert_eq!(go(&archive, &keys, &save_request(record(ID_B, "Zeta di prova")), 1000).status, "ok");
        let after = go(&archive, &keys, &save_request(record(ID_A, "alfa di prova")), 2000);
        assert_eq!(after.charts.as_ref().unwrap().len(), 2);
        // A new call opens the file again, as after restarting the application.
        let listed = go(&archive, &keys, &list_request(), 3000).charts.unwrap();
        assert_eq!(listed.iter().map(|chart| chart.name.as_str()).collect::<Vec<_>>(), ["alfa di prova", "Zeta di prova"]);
        assert_eq!(listed[0].id, ID_A);
        assert_eq!(listed[0].utc_iso, "2001-02-03T04:05:06.000Z");
        assert_eq!((listed[0].lat_micro, listed[0].lng_micro), (44_697_805, 11_805_778));
        assert_eq!((listed[0].created_at_ms, listed[0].updated_at_ms), (2000, 2000));
    }

    #[test]
    fn encrypted_v1_archive_migrates_in_memory_and_preserves_historical_inputs() {
        let archive = TempArchive::new("historical-upgrade");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let old = Connection::open_in_memory().unwrap();
        old.execute_batch("CREATE TABLE saved_charts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, utc_iso TEXT NOT NULL, time_zone TEXT NOT NULL, lat_micro INTEGER NOT NULL, lng_micro INTEGER NOT NULL, place_name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL) STRICT; PRAGMA user_version=1;").unwrap();
        old.execute("INSERT INTO saved_charts VALUES (?1,'Old','2001-02-03T04:05:06.000Z','Europe/Rome',44697805,11805778,'Test',1000,1000)", [ID_A]).unwrap();
        persist(&archive.paths, &keys, &old).unwrap();
        let before = fs::read(&archive.paths.sealed).unwrap();
        let first_read = go(&archive, &keys, &list_request(), 2000);
        assert_eq!(first_read.status, "ok");
        assert_eq!(first_read.charts.unwrap()[0].utc_iso, "2001-02-03T04:05:06.000Z");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before, "reading does not rewrite the archive");

        let mut historical = record(ID_B, "Historical test");
        historical.utc_iso.clear(); historical.time_zone.clear();
        historical.historical = Some(serde_json::from_value(serde_json::json!({
            "protocolVersion":1, "latMicro":44697805, "lngMicro":11805778,
            "civil":{"year":0,"month":2,"day":29,"hour":12,"minute":0,"second":0,
                "calendar":"julian","offset":{"kind":"localMeanSolar"},"uncertaintySeconds":60},
            "deltaT":{"kind":"supplied","seconds":100,"uncertaintySeconds":5,"source":"test"}
        })).unwrap());
        assert_eq!(go(&archive, &keys, &save_request(historical.clone()), 3000).status, "ok");
        let rows = go(&archive, &keys, &list_request(), 4000).charts.unwrap();
        assert_eq!(rows.len(), 2);
        let saved = rows.iter().find(|row| row.id == ID_B).unwrap();
        assert_eq!(saved.historical, historical.historical);
        assert!(saved.utc_iso.is_empty() && saved.time_zone.is_empty());
        assert_eq!(rows.iter().find(|row| row.id == ID_A).unwrap().utc_iso, "2001-02-03T04:05:06.000Z");
        let bytes = fs::read(&archive.paths.sealed).unwrap();
        assert!(!bytes.windows(b"localMeanSolar".len()).any(|w| w == b"localMeanSolar"));
        let connection = load_sealed(&archive.paths, &keys).unwrap();
        let version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).unwrap();
        assert_eq!(version, SCHEMA_VERSION);
        let mut conflicting = historical.clone(); conflicting.utc_iso = "2000-01-01T00:00:00Z".into();
        assert_eq!(go(&archive, &keys, &save_request(conflicting), 5000).status, "invalid_request");
    }

    #[test]
    fn historical_v2_archive_is_migrated_without_losing_history_or_rewriting_on_read() {
        let archive = TempArchive::new("history-v2-account-upgrade");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let old = Connection::open_in_memory().unwrap();
        old.execute_batch("CREATE TABLE saved_charts (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, utc_iso TEXT NOT NULL, time_zone TEXT NOT NULL, lat_micro INTEGER NOT NULL, lng_micro INTEGER NOT NULL, place_name TEXT NOT NULL, created_at_ms INTEGER NOT NULL, updated_at_ms INTEGER NOT NULL, historical_json TEXT) STRICT; PRAGMA user_version=2;").unwrap();
        let historical = serde_json::json!({"protocolVersion":1,"latMicro":44697805,"lngMicro":11805778,
            "civil":{"year":0,"month":2,"day":29,"hour":12,"minute":0,"second":0,
                "calendar":"julian","offset":{"kind":"localMeanSolar"},"uncertaintySeconds":60},
            "deltaT":{"kind":"supplied","seconds":100,"uncertaintySeconds":5,"source":"test"}});
        old.execute("INSERT INTO saved_charts VALUES (?1,'Fittizio','','',44697805,11805778,'Test',1000,1000,?2)",
            params![ID_A,historical.to_string()]).unwrap();
        let expected: HistoricalChartRequest = serde_json::from_value(historical).unwrap();
        persist(&archive.paths, &keys, &old).unwrap();
        let before = fs::read(&archive.paths.sealed).unwrap();
        let response = go(&archive, &keys, &list_request(), 2000);
        assert_eq!(response.status, "ok");
        assert_eq!(response.charts.unwrap()[0].historical.as_ref(), Some(&expected));
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before);
        assert_eq!(go(&archive, &keys, &save_request(record(ID_B,"Secondo")), 3000).status, "ok");
        let reopened = load_sealed(&archive.paths, &keys).unwrap();
        assert_eq!(reopened.query_row("PRAGMA user_version", [], |r| r.get::<_,i64>(0)).unwrap(), SCHEMA_VERSION);
        assert_eq!(list(&reopened,true).unwrap().iter().find(|row| row.id == ID_A).unwrap().historical.as_ref(), Some(&expected));
    }

    #[test]
    fn newer_encrypted_schema_is_never_modified() {
        let archive = TempArchive::new("schema-newer");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(SCHEMA).unwrap();
        connection.execute_batch("PRAGMA user_version=8;").unwrap();
        persist(&archive.paths, &keys, &connection).unwrap();
        let before = fs::read(&archive.paths.sealed).unwrap();
        assert_eq!(go(&archive, &keys, &list_request(), 1000).status, "archive_newer");
        assert_eq!(go(&archive, &keys, &save_request(record(ID_A, "Test")), 1000).status, "archive_newer");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before);
    }

    #[test]
    fn test_private_photo_is_encrypted_separately_and_never_enters_chart_rows() {
        let archive = TempArchive::new("private-photo");
        let keys = FakeKeyStore::empty();
        let jpeg = vec![0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0xff, 0xd9];
        // An unsaved ID cannot accumulate photos on disk or create a key.
        assert_eq!(go(&archive, &keys, &photo_request("photo_save", ID_A, Some(jpeg.clone())), 1).status, "not_found");
        assert!(keys.key.borrow().is_none());
        go(&archive, &keys, &save_request(record(ID_A, "Soggetto immaginario")), 1000);
        let written = go(&archive, &keys, &photo_request("photo_save", ID_A, Some(jpeg.clone())), 1001);
        assert_eq!(written.status, "ok");
        assert_eq!(written.photo_ids, vec![ID_A.to_string()]);
        assert!(written.photo_data.is_none());
        let listed = go(&archive, &keys, &list_request(), 1002);
        assert_eq!(listed.charts.unwrap()[0].name, "Soggetto immaginario");
        assert!(listed.photo_data.is_none(), "list must not include image bytes");
        let read = go(&archive, &keys, &photo_request("photo_read", ID_A, None), 1003);
        assert_eq!(read.photo_data, Some(jpeg));
        go(&archive, &keys, &delete_request(ID_A), 1004);
        assert!(chart_photos::list_ids(&archive.folder, &[ID_A.into()]).unwrap().is_empty());
    }

    #[test]
    fn test_saving_the_same_id_again_updates_in_place_and_keeps_the_creation_time() {
        let archive = TempArchive::new("update");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, "Prima versione")), 1000);
        let mut edited = record(ID_A, "Seconda versione");
        edited.lat_micro = -33_868_800;
        let listed = go(&archive, &keys, &save_request(edited), 5000).charts.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "Seconda versione");
        assert_eq!(listed[0].lat_micro, -33_868_800);
        assert_eq!((listed[0].created_at_ms, listed[0].updated_at_ms), (1000, 5000));
    }

    #[test]
    fn test_delete_removes_one_chart_and_reports_an_unknown_id() {
        let archive = TempArchive::new("delete");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, "Da tenere")), 1000);
        go(&archive, &keys, &save_request(record(ID_B, "Da eliminare")), 1000);
        let listed = go(&archive, &keys, &delete_request(ID_B), 2000).charts.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, ID_A);
        assert_eq!(go(&archive, &keys, &delete_request(ID_B), 3000).status, "not_found");
        assert_eq!(go(&archive, &keys, &list_request(), 4000).charts.unwrap().len(), 1);
        // The deleted chart is gone from the sealed bytes too (a fresh file was written).
        assert_eq!(archive.files(), [SEALED_FILE_NAME]);
    }

    #[test]
    fn test_invalid_requests_are_rejected_without_touching_disk_or_key() {
        let archive = TempArchive::new("invalid");
        let keys = FakeKeyStore::empty();
        let mut bad_requests = vec![
            ArchiveRequestV1 { protocol_version: 2, ..list_request() },
            ArchiveRequestV1 { operation: "drop".into(), ..list_request() },
            ArchiveRequestV1 { id: Some(ID_A.into()), ..list_request() },
            ArchiveRequestV1 { chart: Some(record(ID_A, "x")), ..request("remove_legacy") },
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
        for (index, bad) in bad_requests.iter().enumerate() {
            assert_eq!(go(&archive, &keys, bad, 1000).status, "invalid_request", "request {index}");
        }
        assert!(archive.files().is_empty(), "validation must happen before any disk access");
        assert!(keys.key.borrow().is_none(), "and before any key is made");
        // An empty name is allowed: the interface shows "unnamed chart".
        assert_eq!(go(&archive, &keys, &save_request(record(ID_A, "")), 1000).status, "ok");
    }

    #[test]
    fn test_text_that_looks_like_sql_is_stored_as_text() {
        let archive = TempArchive::new("literal");
        let keys = FakeKeyStore::empty();
        let name = "Robert'); DROP TABLE saved_charts;--";
        go(&archive, &keys, &save_request(record(ID_A, name)), 1000);
        let listed = go(&archive, &keys, &list_request(), 2000).charts.unwrap();
        assert_eq!(listed[0].name, name);
    }

    #[test]
    fn test_a_full_archive_refuses_new_charts_but_still_updates_existing_ones() {
        let archive = TempArchive::new("full");
        let keys = FakeKeyStore::empty();
        assert!(run(&archive.paths, &keys, &save_request(record(ID_A, "Primo")), 1000, 1).is_ok());
        assert_eq!(run(&archive.paths, &keys, &save_request(record(ID_B, "Secondo")), 2000, 1), Err("archive_full"));
        let updated = run(&archive.paths, &keys, &save_request(record(ID_A, "Primo modificato")), 3000, 1).unwrap();
        assert_eq!(updated.charts.len(), 1);
        assert_eq!(updated.charts[0].name, "Primo modificato");
    }

    #[test]
    fn test_an_unavailable_key_store_locks_the_archive_and_never_falls_back_to_plain_text() {
        let archive = TempArchive::new("nokey-first");
        let keys = FakeKeyStore::empty();
        *keys.unavailable.borrow_mut() = true;
        assert_eq!(go(&archive, &keys, &save_request(record(ID_A, SENTINEL)), 1000).status, "archive_locked");
        assert!(archive.files().is_empty(), "no file of any kind is written without a key");
        // And an archive that exists stays closed, byte for byte.
        *keys.unavailable.borrow_mut() = false;
        go(&archive, &keys, &save_request(record(ID_A, SENTINEL)), 2000);
        let before = fs::read(&archive.paths.sealed).unwrap();
        *keys.unavailable.borrow_mut() = true;
        for operation in [list_request(), save_request(record(ID_B, "Altro")), delete_request(ID_A)] {
            assert_eq!(go(&archive, &keys, &operation, 3000).status, "archive_locked");
        }
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before);
        assert_eq!(archive.files(), [SEALED_FILE_NAME]);
    }

    #[test]
    fn test_a_missing_or_wrong_key_keeps_the_archive_locked_and_untouched() {
        let archive = TempArchive::new("wrongkey");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, SENTINEL)), 1000);
        let before = fs::read(&archive.paths.sealed).unwrap();
        let original = *keys.key.borrow();
        // The credential is gone: a new key must NOT be made over an existing archive.
        *keys.key.borrow_mut() = None;
        assert_eq!(go(&archive, &keys, &list_request(), 2000).status, "archive_locked");
        assert_eq!(go(&archive, &keys, &save_request(record(ID_B, "Altro")), 2000).status, "archive_locked");
        assert!(keys.key.borrow().is_none());
        // A different key opens nothing.
        *keys.key.borrow_mut() = Some(*new_key().unwrap());
        assert_eq!(go(&archive, &keys, &list_request(), 3000).status, "archive_locked");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before);
        // The right key still opens it.
        *keys.key.borrow_mut() = original;
        assert_eq!(go(&archive, &keys, &list_request(), 4000).charts.unwrap().len(), 1);
    }

    #[test]
    fn test_a_tampered_truncated_or_foreign_file_is_reported_and_left_untouched() {
        let archive = TempArchive::new("tamper");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, SENTINEL)), 1000);
        let good = fs::read(&archive.paths.sealed).unwrap();
        let mut flipped = good.clone();
        let middle = flipped.len() / 2;
        flipped[middle] ^= 0x01;
        let mut newer = good.clone();
        newer[8] = archive_vault::FORMAT_VERSION + 1;
        let cases: Vec<(&str, Vec<u8>, &str)> = vec![
            ("flipped", flipped, "archive_locked"),
            ("truncated", good[..20].to_vec(), "archive_corrupt"),
            ("foreign", b"this is not a sealed archive, it is a damaged file ".repeat(40), "archive_corrupt"),
            ("newer", newer, "archive_newer"),
        ];
        for (label, bytes, expected) in cases {
            fs::write(&archive.paths.sealed, &bytes).unwrap();
            for operation in [list_request(), save_request(record(ID_B, "Altro")), delete_request(ID_A)] {
                assert_eq!(go(&archive, &keys, &operation, 2000).status, expected, "{label}");
            }
            assert_eq!(fs::read(&archive.paths.sealed).unwrap(), bytes, "{label}: file must not change");
        }
    }

    #[test]
    fn test_an_interrupted_write_leaves_a_disposable_staging_file_and_the_archive_intact() {
        let archive = TempArchive::new("staging");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, "Prima")), 1000);
        let before = fs::read(&archive.paths.sealed).unwrap();
        // A crash after staging and before the move.
        fs::write(&archive.paths.staging, b"half-written ciphertext").unwrap();
        let listed = go(&archive, &keys, &list_request(), 2000).charts.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(archive.files(), [SEALED_FILE_NAME], "the stale staging file is removed");
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), before);
    }

    #[test]
    fn test_the_plain_prototype_archive_migrates_exactly_and_is_kept() {
        let archive = TempArchive::new("migrate");
        let keys = FakeKeyStore::empty();
        write_legacy(&archive, &[(ID_B, "Zeta di prova", 1_000, 9_000), (ID_A, SENTINEL, 2_000, 2_500)], "");
        let legacy_before = fs::read(&archive.paths.legacy).unwrap();
        let response = go(&archive, &keys, &list_request(), 5_000);
        assert_eq!(response.status, "ok");
        assert!(response.legacy_present, "the plain file is still there");
        let charts = response.charts.unwrap();
        assert_eq!(charts.iter().map(|chart| chart.id.as_str()).collect::<Vec<_>>(), [ID_A, ID_B]);
        let by_id = |id: &str| charts.iter().find(|chart| chart.id == id).unwrap();
        assert_eq!((by_id(ID_B).created_at_ms, by_id(ID_B).updated_at_ms), (1_000, 9_000));
        assert_eq!((by_id(ID_A).created_at_ms, by_id(ID_A).updated_at_ms), (2_000, 2_500));
        assert_eq!(by_id(ID_A).utc_iso, "2001-02-03T04:05:06.000Z");
        assert_eq!((by_id(ID_A).lat_micro, by_id(ID_A).lng_micro), (44_697_805, 11_805_778));
        // The sealed file exists, holds no plain text, and the legacy file is byte-identical.
        let sealed = fs::read(&archive.paths.sealed).unwrap();
        assert!(!sealed.windows(SENTINEL.len()).any(|window| window == SENTINEL.as_bytes()));
        assert_eq!(fs::read(&archive.paths.legacy).unwrap(), legacy_before);
        assert_eq!(archive.files(), [LEGACY_FILE_NAME, SEALED_FILE_NAME]);
        // A second start opens the sealed archive and does not migrate again.
        assert_eq!(go(&archive, &keys, &list_request(), 6_000).charts.unwrap(), charts);
        assert_eq!(fs::read(&archive.paths.sealed).unwrap(), sealed);
    }

    #[test]
    fn test_migration_stops_without_a_key_and_changes_nothing() {
        let archive = TempArchive::new("migrate-nokey");
        let keys = FakeKeyStore::empty();
        write_legacy(&archive, &[(ID_A, SENTINEL, 1, 1)], "");
        let legacy_before = fs::read(&archive.paths.legacy).unwrap();
        *keys.unavailable.borrow_mut() = true;
        assert_eq!(go(&archive, &keys, &list_request(), 1000).status, "archive_locked");
        assert_eq!(archive.files(), [LEGACY_FILE_NAME]);
        assert_eq!(fs::read(&archive.paths.legacy).unwrap(), legacy_before);
    }

    #[test]
    fn test_a_corrupt_newer_or_invalid_legacy_archive_is_refused_and_left_untouched() {
        let corrupt = TempArchive::new("legacy-corrupt");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&corrupt.folder).unwrap();
        let garbage = b"this is not a SQLite database, it is a damaged archive ".repeat(40);
        fs::write(&corrupt.paths.legacy, &garbage).unwrap();
        assert_eq!(go(&corrupt, &keys, &list_request(), 1000).status, "archive_corrupt");
        assert_eq!(fs::read(&corrupt.paths.legacy).unwrap(), garbage);
        assert_eq!(corrupt.files(), [LEGACY_FILE_NAME]);

        let newer = TempArchive::new("legacy-newer");
        write_legacy(&newer, &[(ID_A, SENTINEL, 1, 1)], "PRAGMA user_version = 2;");
        let newer_before = fs::read(&newer.paths.legacy).unwrap();
        assert_eq!(go(&newer, &keys, &list_request(), 1000).status, "archive_newer");
        assert_eq!(fs::read(&newer.paths.legacy).unwrap(), newer_before);
        assert_eq!(newer.files(), [LEGACY_FILE_NAME]);

        // A row that today's rules would never accept stops the whole migration.
        let invalid = TempArchive::new("legacy-invalid");
        write_legacy(&invalid, &[(ID_A, SENTINEL, 1, 1)], "UPDATE saved_charts SET time_zone='Europe/../Rome';");
        let invalid_before = fs::read(&invalid.paths.legacy).unwrap();
        assert_eq!(go(&invalid, &keys, &list_request(), 1000).status, "archive_corrupt");
        assert_eq!(fs::read(&invalid.paths.legacy).unwrap(), invalid_before);
        assert_eq!(invalid.files(), [LEGACY_FILE_NAME]);
        assert!(keys.key.borrow().is_none(), "no key is made for an archive that is refused");
    }

    #[test]
    fn test_an_empty_prototype_archive_migrates_to_an_empty_sealed_one() {
        let archive = TempArchive::new("legacy-empty");
        let keys = FakeKeyStore::empty();
        fs::create_dir_all(&archive.folder).unwrap();
        drop(Connection::open(&archive.paths.legacy).unwrap());
        let response = go(&archive, &keys, &list_request(), 1000);
        assert_eq!(response.status, "ok");
        assert_eq!(response.charts, Some(vec![]));
        assert!(archive.paths.sealed.exists());
    }

    #[test]
    fn test_when_both_exist_the_sealed_archive_wins_and_the_legacy_file_is_ignored() {
        let archive = TempArchive::new("both");
        let keys = FakeKeyStore::empty();
        go(&archive, &keys, &save_request(record(ID_A, "Nel sigillato")), 1000);
        write_legacy(&archive, &[(ID_B, "Solo nel vecchio file", 1, 1)], "");
        let response = go(&archive, &keys, &list_request(), 2000);
        assert_eq!(response.charts.unwrap().iter().map(|chart| chart.name.as_str()).collect::<Vec<_>>(), ["Nel sigillato"]);
        assert!(response.legacy_present);
    }

    #[test]
    fn test_removing_the_legacy_file_is_explicit_and_only_after_the_sealed_archive_opens() {
        let archive = TempArchive::new("remove-legacy");
        let keys = FakeKeyStore::empty();
        write_legacy(&archive, &[(ID_A, SENTINEL, 1, 1)], "");
        // Without the key the migration cannot happen, so nothing may be removed.
        *keys.unavailable.borrow_mut() = true;
        assert_eq!(go(&archive, &keys, &request("remove_legacy"), 1000).status, "archive_locked");
        assert!(archive.paths.legacy.exists());
        *keys.unavailable.borrow_mut() = false;
        let removed = go(&archive, &keys, &request("remove_legacy"), 2000);
        assert_eq!(removed.status, "ok");
        assert!(!removed.legacy_present);
        assert_eq!(removed.charts.unwrap().len(), 1, "the charts survive in the sealed archive");
        assert_eq!(archive.files(), [SEALED_FILE_NAME]);
        // Asking again is harmless.
        assert_eq!(go(&archive, &keys, &request("remove_legacy"), 3000).status, "ok");
    }

    #[test]
    fn test_wire_format_matches_the_typescript_contract() {
        let archive = TempArchive::new("wire");
        let keys = FakeKeyStore::empty();
        let raw = serde_json::to_value(go(&archive, &keys, &save_request(record(ID_A, "Soggetto")), 1234)).unwrap();
        assert_eq!(raw["protocolVersion"], 1);
        assert_eq!(raw["status"], "ok");
        assert_eq!(raw["legacyPresent"], false);
        let chart = &raw["charts"][0];
        for key in ["id", "name", "utcIso", "timeZone", "latMicro", "lngMicro", "placeName", "createdAtMs", "updatedAtMs"] {
            assert!(!chart[key].is_null(), "missing key {key}");
        }
        let extra = r#"{"protocolVersion":1,"operation":"list","chart":null,"id":null,"path":"C:/x"}"#;
        assert!(serde_json::from_str::<ArchiveRequestV1>(extra).is_err());
        let minimal = r#"{"protocolVersion":1,"operation":"list"}"#;
        assert!(serde_json::from_str::<ArchiveRequestV1>(minimal).is_ok());
        let failed = serde_json::to_value(failure("archive_locked")).unwrap();
        assert!(failed["charts"].is_null());
        assert_eq!(failed["status"], "archive_locked");
    }
}
