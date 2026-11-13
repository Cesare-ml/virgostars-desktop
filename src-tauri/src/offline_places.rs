//! Offline city search over a packaged, read-only SQLite/FTS5 resource.
//!
//! Only query and max-results travel from Angular to Rust. No PostgreSQL server,
//! account, network calls, private file paths, or bulk city arrays reach the UI.
use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{path::BaseDirectory, AppHandle, Manager, State};

const MAX_RESULTS: u8 = 30;
const MAX_ACTIVE_QUERIES: usize = 2;
const MAX_QUERY_CHARS: usize = 80;
const MAX_TOKENS: usize = 5;
const CANDIDATE_LIMIT: i64 = 500;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceMatch {
    id: i64,
    name: String,
    italian_name: Option<String>,
    lat_micro: i32,
    lng_micro: i32,
    population: Option<i64>,
    state_id: Option<i64>,
    region: Option<String>,
    time_zone: Option<String>,
    country_name: Option<String>,
    country_code: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceSearchV1 {
    protocol_version: u8,
    items: Vec<PlaceMatch>,
}

#[derive(Default)]
pub struct PlaceSearchGate {
    active: Arc<AtomicUsize>,
}

struct QueryPermit(Arc<AtomicUsize>);

impl Drop for QueryPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl PlaceSearchGate {
    fn try_reserve(&self) -> Option<QueryPermit> {
        // Keep the Rust 1.90 MSRV: try_update() requires a newer toolchain,
        // while fetch_update() is deprecated on recent compilers.
        let mut active = self.active.load(Ordering::Acquire);
        while active < MAX_ACTIVE_QUERIES {
            match self.active.compare_exchange_weak(
                active,
                active + 1,
                Ordering::AcqRel,
                Ordering::Acquire,
            ) {
                Ok(_) => return Some(QueryPermit(Arc::clone(&self.active))),
                Err(observed) => active = observed,
            }
        }
        None
    }
}

/// Reject excessive input and turn human text into safe FTS5 quoted prefixes.
/// This is not arbitrary FTS syntax supplied by the frontend.
fn fts_query(input: &str) -> Option<String> {
    if input.chars().count() > MAX_QUERY_CHARS {
        return None;
    }
    let words: Vec<String> = input
        .split(|c: char| !c.is_alphanumeric() && c != '_')
        .filter(|word| !word.is_empty())
        .take(MAX_TOKENS)
        .map(|word| format!("\"{}\"*", word))
        .collect();
    // One-letter prefixes over two million localities can produce very large posting lists.
    if words.is_empty() || input.chars().filter(|c| c.is_alphanumeric()).count() < 2 {
        return None;
    }
    Some(words.join(" "))
}

fn search_database(path: &Path, query: &str, limit: u8) -> Result<PlaceSearchV1, &'static str> {
    let fts = fts_query(query).ok_or("PLACE_QUERY_INVALID")?;
    if !(1..=MAX_RESULTS).contains(&limit) {
        return Err("PLACE_LIMIT_INVALID");
    }
    // The path is a Tauri-bundled resource, never supplied by the frontend.
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|_| "PLACE_CATALOG_UNAVAILABLE")?;
    connection.pragma_update(None, "query_only", true).map_err(|_| "PLACE_CATALOG_INVALID")?;
    let version: String = connection
        .query_row("SELECT value FROM catalog_meta WHERE key='schemaVersion'", [], |row| row.get(0))
        .map_err(|_| "PLACE_CATALOG_INVALID")?;
    let sql = match version.as_str() {
        // Existing local packs remain readable without a guessed country mapping.
        "1" => "WITH candidate AS (
                    SELECT rowid FROM places_fts WHERE places_fts MATCH ?1 LIMIT ?2
                 )
                 SELECT p.id, p.nome, p.nome_it, p.lat_micro, p.lng_micro,
                        p.pop, p.stato_id, p.regione, p.tz,
                        NULL AS country_name, NULL AS country_code
                 FROM candidate c JOIN places p ON p.id=c.rowid
                 ORDER BY COALESCE(p.pop,0) DESC, p.nome COLLATE NOCASE, p.id
                 LIMIT ?3",
        // A v2 pack contains an explicitly mapped local lookup for stato_id.
        "2" => "WITH candidate AS (
                    SELECT rowid FROM places_fts WHERE places_fts MATCH ?1 LIMIT ?2
                 )
                 SELECT p.id, p.nome, p.nome_it, p.lat_micro, p.lng_micro,
                        p.pop, p.stato_id, p.regione, p.tz,
                        co.country_name, co.iso2
                 FROM candidate c JOIN places p ON p.id=c.rowid
                 LEFT JOIN country_lookup co ON co.stato_id=p.stato_id
                 ORDER BY COALESCE(p.pop,0) DESC, p.nome COLLATE NOCASE, p.id
                 LIMIT ?3",
        _ => return Err("PLACE_CATALOG_VERSION"),
    };
    let mut statement = connection
        .prepare(sql)
        .map_err(|_| "PLACE_CATALOG_INVALID")?;
    let rows = statement
        .query_map(params![fts, CANDIDATE_LIMIT, i64::from(limit)], |row| {
            Ok(PlaceMatch {
                id: row.get(0)?,
                name: row.get(1)?,
                italian_name: row.get(2)?,
                lat_micro: row.get(3)?,
                lng_micro: row.get(4)?,
                population: row.get(5)?,
                state_id: row.get(6)?,
                region: row.get(7)?,
                time_zone: row.get(8)?,
                country_name: row.get(9)?,
                country_code: row.get(10)?,
            })
        })
        .map_err(|_| "PLACE_QUERY_FAILED")?;
    let items = rows
        .collect::<rusqlite::Result<Vec<_>>>()
        .map_err(|_| "PLACE_QUERY_FAILED")?;
    Ok(PlaceSearchV1 {
        protocol_version: 1,
        items,
    })
}

/// CPU/database work runs on a blocking worker. At most two such queries can
/// be active at any time; additional requests fail fast instead of queuing.
#[tauri::command]
pub async fn search_offline_places(
    app: AppHandle,
    gate: State<'_, PlaceSearchGate>,
    query: String,
    limit: Option<u8>,
) -> Result<PlaceSearchV1, String> {
    let count = limit.unwrap_or(12);
    if fts_query(&query).is_none() {
        return Err("PLACE_QUERY_INVALID".into());
    }
    if !(1..=MAX_RESULTS).contains(&count) {
        return Err("PLACE_LIMIT_INVALID".into());
    }
    let permit = gate.try_reserve().ok_or("PLACE_SEARCH_BUSY")?;
    let path = app
        .path()
        .resolve("places/world-cities.sqlite", BaseDirectory::Resource)
        .map_err(|_| "PLACE_CATALOG_UNAVAILABLE")?;

    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        search_database(&path, &query, count).map_err(str::to_string)
    })
    .await
    .map_err(|_| "PLACE_QUERY_FAILED".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;

    #[test]
    fn input_is_bounded_and_fts_syntax_is_never_untrusted() {
        assert_eq!(fts_query("San José"), Some("\"San\"* \"José\"*".into()));
        assert_eq!(fts_query("Firenze"), Some("\"Firenze\"*".into()));
        assert!(fts_query(" ").is_none());
        assert!(fts_query("x").is_none());
        assert!(fts_query(&"x".repeat(81)).is_none());
        assert_eq!(fts_query("a\" OR 1=1"), Some("\"a\"* \"OR\"* \"1\"* \"1\"*".into()));
    }

    #[test]
    fn concurrent_reservations_are_capped_and_released() {
        let gate = PlaceSearchGate::default();
        let first = gate.try_reserve().unwrap();
        let second = gate.try_reserve().unwrap();
        assert!(gate.try_reserve().is_none());
        drop(first);
        assert!(gate.try_reserve().is_some());
        drop(second);
    }

    #[test]
    fn concurrent_threads_never_exceed_active_query_limit() {
        const THREADS: usize = 16;
        let gate = Arc::new(PlaceSearchGate::default());
        let start = Arc::new(std::sync::Barrier::new(THREADS + 1));
        let release = Arc::new(std::sync::Barrier::new(THREADS + 1));
        let accepted = Arc::new(AtomicUsize::new(0));
        let mut workers = Vec::new();

        for _ in 0..THREADS {
            let gate = Arc::clone(&gate);
            let start = Arc::clone(&start);
            let release = Arc::clone(&release);
            let accepted = Arc::clone(&accepted);
            workers.push(std::thread::spawn(move || {
                start.wait();
                let permit = gate.try_reserve();
                if permit.is_some() {
                    accepted.fetch_add(1, Ordering::Relaxed);
                }
                release.wait();
                drop(permit);
            }));
        }
        start.wait();
        release.wait();
        for worker in workers {
            worker.join().expect("query worker should not panic");
        }
        assert_eq!(accepted.load(Ordering::Relaxed), MAX_ACTIVE_QUERIES);
        assert_eq!(gate.active.load(Ordering::Acquire), 0);
    }

    #[test]
    fn synthetic_fts_catalog_produces_bounded_responses() {
        let mut path = std::env::temp_dir();
        path.push(format!("vs-place-search-test-{}-{}.sqlite", std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let _ = std::fs::remove_file(&path);
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE places (id INTEGER PRIMARY KEY, nome TEXT NOT NULL,
               nome_it TEXT, lat_micro INTEGER, lng_micro INTEGER, pop INTEGER,
               stato_id INTEGER, regione TEXT, tz TEXT, tz_offs TEXT);
             CREATE TABLE catalog_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
             INSERT INTO catalog_meta VALUES ('schemaVersion','1');
             INSERT INTO places VALUES
               (1,'Firenze','Florence',43769560,11255810,350000,1,'Toscana','Europe/Rome','+0100'),
               (2,'Firenze Piccola',NULL,42000000,11000000,NULL,1,'Lazio','Europe/Rome','+0100');
             CREATE VIRTUAL TABLE places_fts USING fts5(
               nome,nome_it,content='places',content_rowid='id',
               tokenize='unicode61 remove_diacritics 2',prefix='2 3');
             INSERT INTO places_fts(places_fts) VALUES ('rebuild');",
        )
        .unwrap();
        drop(db);
        let result = search_database(&path, "Firenze", 1).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].name, "Firenze");
        assert_eq!(result.items[0].lat_micro, 43_769_560);
        assert_eq!(search_database(&path, "Flor", 2).unwrap().items[0].id, 1);
        assert!(search_database(&path, "Flor", 2).unwrap().items[0].country_name.is_none());
        assert_eq!(search_database(&path, "Flor", 0).err(), Some("PLACE_LIMIT_INVALID"));
        std::fs::remove_file(&path).unwrap();
    }

    #[test]
    fn country_mapping_is_loaded_from_explicit_v2_lookup_not_state_id_guess() {
        let path = std::env::temp_dir().join(format!(
            "vs-city-country-{}-{}.sqlite",
            std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let db = Connection::open(&path).unwrap();
        db.execute_batch(
            "CREATE TABLE places (id INTEGER PRIMARY KEY, nome TEXT NOT NULL,
                nome_it TEXT, lat_micro INTEGER, lng_micro INTEGER, pop INTEGER,
                stato_id INTEGER, regione TEXT, tz TEXT, tz_offs TEXT);
             CREATE TABLE catalog_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
             CREATE TABLE country_lookup (stato_id INTEGER PRIMARY KEY,
                country_name TEXT NOT NULL, iso2 TEXT);
             INSERT INTO catalog_meta VALUES ('schemaVersion','2');
             INSERT INTO country_lookup VALUES (100,'Italia','IT');
             INSERT INTO places VALUES
               (1,'Firenze',NULL,43769560,11255810,350000,100,'Toscana','Europe/Rome','+0100');
             CREATE VIRTUAL TABLE places_fts USING fts5(
               nome,nome_it,content='places',content_rowid='id',
               tokenize='unicode61 remove_diacritics 2',prefix='2 3');
             INSERT INTO places_fts(places_fts) VALUES ('rebuild');",
        ).unwrap();
        drop(db);
        let result = search_database(&path, "Firenze", 12).unwrap();
        assert_eq!(result.items.len(), 1);
        assert_eq!(result.items[0].country_name.as_deref(), Some("Italia"));
        assert_eq!(result.items[0].country_code.as_deref(), Some("IT"));
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_catalog_fails_closed() {
        let path = std::env::temp_dir().join("vs-city-does-not-exist.sqlite");
        assert_eq!(search_database(&path, "Firenze", 10).err(), Some("PLACE_CATALOG_UNAVAILABLE"));
    }
}
