//! `EphemerisProvider` backed by VirgoStars-Ephemeris (`virgostars-ephemeris-core`, CPAL-1.0).
//!
//! The core is pinned to one reviewed commit in `Cargo.toml`. It calculates apparent geocentric
//! positions of date from a **classic JPL DE441 binary** that is *not* bundled with the source:
//! the host reads its location from the environment or from `ephemeris.json` in the application's
//! data folder, never from the WebView. Optional extras, the same way: the USNO ΔT files
//! (`deltat.data`, `historic_deltat.data`, `deltat.preds`), which extend the time policy past
//! June 2027, and a JPL small-body SPK for Chiron. Without the DE441 file there is no provider and
//! the interface says so; nothing is substituted.
//!
//! Time: a civil UT instant becomes TDB under the core's declared policy (leap seconds 1972–2027,
//! the Espenak–Meeus polynomial 1900–1972, or measured/predicted ΔT with the USNO tables). A date
//! outside that policy is `out_of_range` (see `EphemerisProvider::covers`), not a failure.
//!
//! Houses are not astronomy: the angles come from the core (`house_angles`) and the cusps from
//! `houses.rs`. The planets Mars to Pluto are the planetary **system barycenters**, as the core
//! documents; lunar nodes and apogees are the core's mathematical points; Chiron needs its SPK.
use crate::chart_calculation::{
    BodyPositionV1, ChartSnapshotV1, EphemerisProvider, HouseSystemV1, Luminary, ProviderError, ProviderInfoV1,
    ValidatedRequest,
};
use crate::houses::{self, HouseAngles};
use serde::Deserialize;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use virgostars_ephemeris_core::apparent_ecliptic_of_date::{
    geocentric_apparent_six_fields_many_with_options, small_body_apparent_six_fields, tdb_to_tt_jd, ApparentFrame,
    ApparentOptions,
};
use virgostars_ephemeris_core::civil_apparent::{jd_ut_to_tdb_with_policy, jd_ut_to_tdb_with_table};
use virgostars_ephemeris_core::de441::{Body, De441, JulianDateTdb};
use virgostars_ephemeris_core::delta_t_table::DeltaTTable;
use virgostars_ephemeris_core::house_angles::house_angles;
use virgostars_ephemeris_core::lunar_points::{lunar_point, LunarPoint};
use virgostars_ephemeris_core::spk_type21::SmallBodySpk;

/// The core crate version and the commit this build is pinned to (see `Cargo.toml`). The WebView contract
/// accepts only `[A-Za-z0-9._-]{1,40}` here.
const ENGINE_VERSION: &str = "core-0.1.0-ff0ad09";
/// NAIF id JPL uses for 2060 Chiron in its small-body SPK files.
const CHIRON_NAIF_ID: i32 = 20_002_060;
const CONFIG_FILE: &str = "ephemeris.json";
const MAX_CONFIG_BYTES: u64 = 16 * 1024;

const PLANETS: [(&str, Body); 10] = [
    ("Sun", Body::Sun),
    ("Moon", Body::Moon),
    ("Mercury", Body::Mercury),
    ("Venus", Body::Venus),
    ("Mars", Body::MarsBarycenter),
    ("Jupiter", Body::JupiterBarycenter),
    ("Saturn", Body::SaturnBarycenter),
    ("Uranus", Body::UranusBarycenter),
    ("Neptune", Body::NeptuneBarycenter),
    ("Pluto", Body::PlutoBarycenter),
];
const LUNAR_POINTS: [(&str, LunarPoint); 4] = [
    ("mean Node", LunarPoint::MeanNode),
    ("true Node", LunarPoint::TrueNode),
    ("mean Apogee", LunarPoint::MeanApogee),
    ("osc. Apogee", LunarPoint::OsculatingApogee),
];
const HOUSE_SYSTEMS: [&str; 5] = ["egizia", "placido", "koch", "regio-montano", "porfirio"];

/// Where the data files are. Absolute paths chosen by the user; they never cross IPC.
#[derive(Debug, Clone, PartialEq)]
struct DataPaths {
    de441: PathBuf,
    usno_directory: Option<PathBuf>,
    chiron_spk: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileConfig {
    de441: Option<String>,
    usno_directory: Option<String>,
    chiron_spk: Option<String>,
}

fn read_config(folder: &Path) -> Option<FileConfig> {
    let mut text = String::new();
    File::open(folder.join(CONFIG_FILE)).ok()?.take(MAX_CONFIG_BYTES).read_to_string(&mut text).ok()?;
    serde_json::from_str(&text).ok()
}

/// Files shipped inside the installer, under the resource folder (see `docs/EPHEMERIS_DATA_BUNDLE.md`).
const BUNDLED_FOLDER: &str = "ephemeris";
const BUNDLED_DE441: &str = "de441-slice.eph";
const BUNDLED_USNO: &str = "usno";
const BUNDLED_CHIRON: &str = "chiron.bsp";

/// Per item: environment variable, then `ephemeris.json`, then the files shipped with the installer.
/// `None` when no DE441 location is known at all.
fn data_paths(
    config_folder: Option<&Path>,
    bundled_folder: Option<&Path>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Option<DataPaths> {
    let file = config_folder.and_then(read_config).unwrap_or_default();
    let shipped = |name: &str| bundled_folder.map(|folder| folder.join(BUNDLED_FOLDER).join(name)).filter(|path| path.exists());
    let de441: PathBuf = match env("VIRGOSTARS_DE441_PATH").or(file.de441) {
        Some(path) => path.into(),
        None => shipped(BUNDLED_DE441)?,
    };
    let usno = env("VIRGOSTARS_USNO_DIR").or(file.usno_directory).map(PathBuf::from).or_else(|| shipped(BUNDLED_USNO));
    let chiron = env("VIRGOSTARS_CHIRON_SPK").or(file.chiron_spk).map(PathBuf::from).or_else(|| shipped(BUNDLED_CHIRON));
    Some(DataPaths { de441, usno_directory: usno, chiron_spk: chiron })
}

fn load_delta_t(directory: &Path) -> Option<DeltaTTable> {
    let read = |name: &str| std::fs::read_to_string(directory.join(name)).ok();
    let monthly = read("deltat.data")?;
    let historic = read("historic_deltat.data")?;
    let predictions = read("deltat.preds");
    DeltaTTable::from_usno(&monthly, &historic, predictions.as_deref()).ok()
}

fn load_chiron(path: &Path) -> Option<SmallBodySpk> {
    let spk = SmallBodySpk::from_bytes(std::fs::read(path).ok()?).ok()?;
    (spk.target_id() == CHIRON_NAIF_ID && spk.center_id() == 10).then_some(spk)
}

struct Engine {
    ephemeris: De441<File>,
    delta_t: Option<DeltaTTable>,
    chiron: Option<SmallBodySpk>,
}

impl Engine {
    fn open(paths: &DataPaths) -> Option<Self> {
        Some(Self {
            ephemeris: De441::open(&paths.de441).ok()?,
            delta_t: paths.usno_directory.as_deref().and_then(load_delta_t),
            chiron: paths.chiron_spk.as_deref().and_then(load_chiron),
        })
    }

    /// UT to TDB under the core's declared policy (a ΔT table, when loaded, extends it).
    fn to_tdb(&self, jd_ut: f64) -> Result<JulianDateTdb, ProviderError> {
        match &self.delta_t {
            Some(table) => jd_ut_to_tdb_with_table(jd_ut, table),
            None => jd_ut_to_tdb_with_policy(jd_ut),
        }
        .map(|(tdb, _source)| tdb)
        .map_err(|_| ProviderError)
    }
}

static CONFIG_FOLDER: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_FOLDER: OnceLock<PathBuf> = OnceLock::new();
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

/// Called once at startup with the application's data folder (`ephemeris.json` is read from it) and the
/// resource folder of the installed application (the shipped data files are looked for there).
pub fn configure(data_folder: PathBuf, resource_folder: Option<PathBuf>) {
    let _ = CONFIG_FOLDER.set(data_folder);
    if let Some(folder) = resource_folder {
        let _ = RESOURCE_FOLDER.set(folder);
    }
}

fn with_engine<T>(action: impl FnOnce(&mut Engine) -> T) -> Option<T> {
    let mut guard = ENGINE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        // Tried again on every call until the files are there: nothing is cached about a failure.
        let paths = data_paths(
            CONFIG_FOLDER.get().map(PathBuf::as_path),
            RESOURCE_FOLDER.get().map(PathBuf::as_path),
            &|name| std::env::var(name).ok(),
        )?;
        *guard = Engine::open(&paths);
    }
    guard.as_mut().map(action)
}

/// Whether the DE441 file could be opened: without it there is no provider.
pub fn data_available() -> bool {
    with_engine(|_| ()).is_some()
}

/// Source error is informational only; the caller supplies the uncertainty used
/// for sensitivity. Its semantics and the snapshot vintage are not verified.
pub(crate) fn historical_usno_delta_t(
    jd_ut1: f64,
    allow_predictions: bool,
) -> Result<(f64, &'static str, Option<f64>), &'static str> {
    with_engine(|engine| select_historical_usno(engine.delta_t.as_ref(), jd_ut1, allow_predictions))
        .ok_or("provider_unavailable")?
}

fn select_historical_usno(
    table: Option<&DeltaTTable>,
    jd_ut1: f64,
    allow_predictions: bool,
) -> Result<(f64, &'static str, Option<f64>), &'static str> {
    use virgostars_ephemeris_core::delta_t_table::DeltaTKind;
    let table = table.ok_or("time_source_unavailable")?;
    let value = table.delta_t(jd_ut1).map_err(|_| "time_source_out_of_range")?;
    let source = match value.kind {
        DeltaTKind::Measured => "Local USNO-format non-prediction (source unverified)",
        DeltaTKind::Predicted if allow_predictions => "Local USNO-format prediction (source unverified)",
        DeltaTKind::Predicted => return Err("time_source_out_of_range"),
    };
    Ok((value.delta_t_seconds, source, value.uncertainty_seconds))
}

/// Isolated experimental path: the input epoch is explicitly UT1, never civil UTC.
pub(crate) fn historical_planet(
    request: &crate::historical_planets::HistoricalPlanetRequest,
) -> Option<Result<crate::historical_planets::HistoricalPlanetResult, ()>> {
    with_engine(|engine| {
        let body = PLANETS.iter().find(|(name, _)| *name == request.body).map(|(_, body)| *body).ok_or(())?;
        let output = virgostars_ephemeris_core::historical_rate_candidate::historical_three_rate_candidate(
            &mut engine.ephemeris, body, request.jd_ut1, request.delta_t_seconds,
            request.uncertainty_seconds, &request.delta_t_source,
        ).map_err(|_| ())?;
        let fields = output.rates.base;
        let sensitivity = if request.include_scenarios {
            use crate::historical_planets::{HistoricalSensitivity, HistoricalSensitivitySample};
            use virgostars_ephemeris_core::historical_delta_t_scenarios::{historical_delta_t_scenarios, ScenarioFrame};
            let samples = historical_delta_t_scenarios(&mut engine.ephemeris, body, request.jd_ut1,
                request.delta_t_seconds, request.uncertainty_seconds, ScenarioFrame::DirectObliquity).map_err(|_| ())?;
            // A source/frame mismatch must never silently produce misleading samples.
            if samples.nominal.fields != fields { return Err(()); }
            let convert = |sample: virgostars_ephemeris_core::historical_delta_t_scenarios::HistoricalScenario| HistoricalSensitivitySample {
                delta_t_seconds: sample.epoch.delta_t_seconds, longitude_deg: sample.fields.longitude_deg,
                latitude_deg: sample.fields.latitude_deg,
            };
            Some(HistoricalSensitivity { lower: convert(samples.lower), upper: convert(samples.upper) })
        } else { None };
        Ok(crate::historical_planets::HistoricalPlanetResult {
            body: request.body.clone(), jd_ut1: output.epoch.jd_ut1, jd_tt: output.epoch.jd_tt,
            jd_tdb: output.epoch.jd_tdb.0, delta_t_seconds: output.epoch.delta_t_seconds,
            uncertainty_seconds: output.epoch.uncertainty_seconds, delta_t_source: output.delta_t_source,
            uncertainty_source: request.uncertainty_source.clone(),
            usno_source_error: request.usno_source_error.clone(),
            longitude_deg: fields.longitude_deg, latitude_deg: fields.latitude_deg, distance_au: fields.distance_au,
            longitude_speed_deg_per_tdb_day: output.rates.longitude_deg_per_tdb_day,
            latitude_speed_deg_per_tdb_day: output.rates.latitude_deg_per_tdb_day,
            radial_speed_au_per_tdb_day: output.rates.radial_au_per_tdb_day,
            radial_correction_applied: output.rates.radial_correction_applied,
            sensitivity,
        })
    })
}

/// Julian day (UT) of a validated proleptic-Gregorian instant (Meeus, chapter 7).
fn julian_day_ut(request: &ValidatedRequest) -> f64 {
    let (mut year, mut month) = (i64::from(request.year), i64::from(request.month));
    if month <= 2 {
        year -= 1;
        month += 12;
    }
    let century = year.div_euclid(100);
    let correction = 2 - century + century.div_euclid(4);
    (365.25 * (year + 4716) as f64).floor() + (30.6001 * (month + 1) as f64).floor() + f64::from(request.day)
        + correction as f64
        - 1524.5
        + request.hour / 24.0
}

fn position(id: &'static str, ecliptic: [f64; 6], equatorial: [f64; 2]) -> BodyPositionV1 {
    BodyPositionV1 {
        id,
        longitude_deg: ecliptic[0],
        latitude_deg: ecliptic[1],
        distance_au: ecliptic[2],
        longitude_speed: ecliptic[3],
        latitude_speed: ecliptic[4],
        distance_speed: ecliptic[5],
        right_ascension_deg: equatorial[0],
        declination_deg: equatorial[1],
        ephemeris_source: "jpl",
    }
}

/// The six fields of an apparent state (the core's field struct is not exported, so a macro).
macro_rules! six {
    ($fields:expr) => {{
        let fields = &$fields;
        [
            fields.longitude_deg,
            fields.latitude_deg,
            fields.distance_au,
            fields.longitude_speed_deg_per_tdb_day,
            fields.latitude_speed_deg_per_tdb_day,
            fields.distance_speed_au_per_tdb_day,
        ]
    }};
}

impl Engine {
    fn chart(&mut self, request: &ValidatedRequest) -> Result<ChartSnapshotV1, ProviderError> {
        let jd_ut = julian_day_ut(request);
        let tdb = self.to_tdb(jd_ut)?;
        let tt = tdb_to_tt_jd(tdb.0).map_err(|_| ProviderError)?;
        let ecliptic_options = ApparentOptions::default();
        let equatorial_options = ApparentOptions { frame: ApparentFrame::TrueEquatorOfDate, ..ApparentOptions::default() };
        let targets: Vec<Body> = PLANETS.iter().map(|(_, body)| *body).collect();
        let ecliptic = geocentric_apparent_six_fields_many_with_options(&mut self.ephemeris, &targets, tdb, ecliptic_options)
            .map_err(|_| ProviderError)?;
        let equatorial =
            geocentric_apparent_six_fields_many_with_options(&mut self.ephemeris, &targets, tdb, equatorial_options)
                .map_err(|_| ProviderError)?;
        let mut bodies = Vec::with_capacity(PLANETS.len() + LUNAR_POINTS.len() + 1);
        for (((id, _), ecl), equ) in PLANETS.iter().zip(&ecliptic).zip(&equatorial) {
            bodies.push(position(id, six!(ecl.fields), [equ.fields.longitude_deg, equ.fields.latitude_deg]));
        }
        let mut unavailable_bodies = Vec::new();
        for (id, point) in LUNAR_POINTS {
            let ecl = lunar_point(Some(&mut self.ephemeris), point, ApparentFrame::TrueEclipticOfDate, tdb.0);
            let equ = lunar_point(Some(&mut self.ephemeris), point, ApparentFrame::TrueEquatorOfDate, tdb.0);
            match (ecl, equ) {
                (Ok(ecl), Ok(equ)) => bodies.push(position(
                    id,
                    [
                        ecl.longitude_deg,
                        ecl.latitude_deg,
                        ecl.distance_au,
                        ecl.longitude_rate_deg_per_day,
                        ecl.latitude_rate_deg_per_day,
                        ecl.distance_rate_au_per_day,
                    ],
                    [equ.longitude_deg, equ.latitude_deg],
                )),
                _ => unavailable_bodies.push(id),
            }
        }
        // Chiron only with its own kernel; without it, or outside its coverage, it is reported missing.
        let chiron = self.chiron.as_ref().and_then(|spk| {
            let ecl = small_body_apparent_six_fields(&mut self.ephemeris, spk, tdb, ecliptic_options).ok()?;
            let equ = small_body_apparent_six_fields(&mut self.ephemeris, spk, tdb, equatorial_options).ok()?;
            Some(position("Chiron", six!(ecl.fields), [equ.fields.longitude_deg, equ.fields.latitude_deg]))
        });
        match chiron {
            Some(position) => bodies.push(position),
            None => unavailable_bodies.push("Chiron"),
        }
        if !bodies.iter().any(|body| body.id == "Sun") || !bodies.iter().any(|body| body.id == "Moon") {
            return Err(ProviderError);
        }
        let angles = house_angles(jd_ut, tt, request.latitude_deg, request.longitude_deg).map_err(|_| ProviderError)?;
        let basis = HouseAngles {
            armc_deg: angles.armc_deg,
            true_obliquity_deg: angles.true_obliquity_deg,
            latitude_deg: request.latitude_deg,
            ascendant_deg: angles.ascendant_deg,
            midheaven_deg: angles.midheaven_deg,
        };
        let mut systems = Vec::with_capacity(HOUSE_SYSTEMS.len());
        let mut unavailable_house_systems = Vec::new();
        for id in HOUSE_SYSTEMS {
            match houses::cusps(id, &basis) {
                Some(cusps_deg) => systems.push(HouseSystemV1 {
                    id,
                    cusps_deg,
                    ascendant_deg: angles.ascendant_deg,
                    mc_deg: angles.midheaven_deg,
                    armc_deg: angles.armc_deg,
                    vertex_deg: angles.extra.vertex_deg,
                }),
                None => unavailable_house_systems.push(id),
            }
        }
        Ok(ChartSnapshotV1 { julian_day_ut: jd_ut, bodies, houses: systems, unavailable_bodies, unavailable_house_systems })
    }

    fn luminary(&mut self, body: Luminary, jd_ut: f64) -> Result<f64, ProviderError> {
        let tdb = self.to_tdb(jd_ut)?;
        let target = match body {
            Luminary::Sun => Body::Sun,
            Luminary::Moon => Body::Moon,
        };
        let rows = geocentric_apparent_six_fields_many_with_options(&mut self.ephemeris, &[target], tdb, ApparentOptions::default())
            .map_err(|_| ProviderError)?;
        let longitude = rows.first().ok_or(ProviderError)?.fields.longitude_deg;
        longitude.is_finite().then(|| longitude.rem_euclid(360.0)).ok_or(ProviderError)
    }
}

pub struct VirgoStarsEphemeris;

impl EphemerisProvider for VirgoStarsEphemeris {
    fn info(&self) -> ProviderInfoV1 {
        ProviderInfoV1 { id: "virgostars_ephemeris", engine_version: ENGINE_VERSION.to_string() }
    }

    fn covers(&self, request: &ValidatedRequest) -> bool {
        let jd_ut = julian_day_ut(request);
        // Without the data there is nothing to say about coverage; the calculation itself reports it.
        with_engine(|engine| engine.to_tdb(jd_ut).is_ok()).unwrap_or(true)
    }

    fn chart(&self, request: &ValidatedRequest) -> Result<ChartSnapshotV1, ProviderError> {
        with_engine(|engine| engine.chart(request)).ok_or(ProviderError)?
    }

    fn luminary_longitude(&self, body: Luminary, julian_day_ut: f64) -> Result<f64, ProviderError> {
        with_engine(|engine| engine.luminary(body, julian_day_ut)).ok_or(ProviderError)?
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn historical_usno_requires_table_and_explicit_prediction_choice() {
        let historic = "1950.0 29.15 0.1\n1960.0 33.15 0.02\n1965.0 35.0 0.01\n1970.0 40.18 0.001\n1972.0 42.23 0.001\n1972.5 42.81 0.001\n";
        let monthly = "1973 2 1 43.4724\n1973 3 1 43.5648\n";
        let predictions = "41900.0\t1973.5\t44.0\t \t0.3\n42000.0\t1973.8\t45.0\t \t0.4\n";
        let table = DeltaTTable::from_usno(monthly, historic, Some(predictions)).unwrap();
        assert_eq!(select_historical_usno(None, 2441714.5, false), Err("time_source_unavailable"));
        assert_eq!(select_historical_usno(Some(&table), 2441714.5, false),
            Ok((43.4724, "Local USNO-format non-prediction (source unverified)", None)));
        let prediction = 2_400_000.5 + 41900.0;
        let between = (2441714.5 + prediction) / 2.0;
        assert_eq!(select_historical_usno(Some(&table), between, true).unwrap().2, None);
        assert_eq!(select_historical_usno(Some(&table), prediction, false), Err("time_source_out_of_range"));
        assert_eq!(select_historical_usno(Some(&table), prediction, true),
            Ok((44.0, "Local USNO-format prediction (source unverified)", Some(0.3))));
        assert_eq!(select_historical_usno(Some(&table), 1.0, true), Err("time_source_out_of_range"));
    }

    fn request(year: i32, month: u32, day: u32, hour: f64) -> ValidatedRequest {
        ValidatedRequest { year, month, day, hour, latitude_deg: 41.8928, longitude_deg: 12.4837 }
    }

    #[test]
    fn test_the_engine_version_fits_the_webview_contract() {
        // chart-calculation-contract.ts rejects anything else, and the chart would never be shown.
        let info = VirgoStarsEphemeris.info();
        assert!((1..=40).contains(&info.engine_version.len()), "{}", info.engine_version);
        assert!(info.engine_version.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'_' || b == b'-'));
        assert!(info.id.len() <= 40 && info.id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_'));
    }

    #[test]
    fn test_julian_day_of_known_instants() {
        assert_eq!(julian_day_ut(&request(2000, 1, 1, 12.0)), 2_451_545.0);
        assert_eq!(julian_day_ut(&request(1900, 1, 1, 0.0)), 2_415_020.5);
        assert_eq!(julian_day_ut(&request(1858, 11, 17, 0.0)), 2_400_000.5);
        assert!((julian_day_ut(&request(2027, 6, 28, 0.0)) - 2_461_584.5).abs() < 1e-9);
        assert!((julian_day_ut(&request(2026, 11, 17, 18.0)) - 2_461_362.25).abs() < 1e-9);
    }

    #[test]
    fn test_data_locations_come_from_the_host_and_the_environment_wins() {
        let nothing = |_: &str| None;
        assert_eq!(data_paths(None, None, &nothing), None);
        let env = |name: &str| match name {
            "VIRGOSTARS_DE441_PATH" => Some("C:/data/de441.eph".to_string()),
            "VIRGOSTARS_CHIRON_SPK" => Some("C:/data/chiron.bsp".to_string()),
            _ => None,
        };
        let paths = data_paths(None, None, &env).unwrap();
        assert_eq!(paths.de441, PathBuf::from("C:/data/de441.eph"));
        assert_eq!(paths.chiron_spk, Some(PathBuf::from("C:/data/chiron.bsp")));
        assert_eq!(paths.usno_directory, None);
    }

    #[test]
    fn test_the_files_shipped_with_the_installer_are_the_last_resort() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let resources = std::env::temp_dir().join(format!("vs-eph-bundled-{}-{unique}", std::process::id()));
        let shipped = resources.join(BUNDLED_FOLDER);
        std::fs::create_dir_all(shipped.join(BUNDLED_USNO)).unwrap();
        std::fs::write(shipped.join(BUNDLED_DE441), b"x").unwrap();
        std::fs::write(shipped.join(BUNDLED_CHIRON), b"x").unwrap();
        let nothing = |_: &str| None;
        let paths = data_paths(None, Some(&resources), &nothing).unwrap();
        assert_eq!(paths.de441, shipped.join(BUNDLED_DE441));
        assert_eq!(paths.usno_directory, Some(shipped.join(BUNDLED_USNO)));
        assert_eq!(paths.chiron_spk, Some(shipped.join(BUNDLED_CHIRON)));
        // A file the user names wins item by item; the others stay shipped.
        let env = |name: &str| (name == "VIRGOSTARS_DE441_PATH").then(|| "D:/full/de441.eph".to_string());
        let paths = data_paths(None, Some(&resources), &env).unwrap();
        assert_eq!(paths.de441, PathBuf::from("D:/full/de441.eph"));
        assert_eq!(paths.chiron_spk, Some(shipped.join(BUNDLED_CHIRON)));
        // Nothing shipped and nothing named: no provider.
        assert_eq!(data_paths(None, Some(&resources.join("missing")), &nothing), None);
        let _ = std::fs::remove_dir_all(&resources);
    }

    #[test]
    fn test_the_config_file_is_read_with_unknown_fields_and_oversized_files_rejected() {
        let unique = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let folder = std::env::temp_dir().join(format!("vs-eph-config-{}-{unique}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let nothing = |_: &str| None;
        std::fs::write(folder.join(CONFIG_FILE), r#"{"de441":"D:/x/de441.eph","usnoDirectory":"D:/x/usno"}"#).unwrap();
        let paths = data_paths(Some(&folder), None, &nothing).unwrap();
        assert_eq!(paths.de441, PathBuf::from("D:/x/de441.eph"));
        assert_eq!(paths.usno_directory, Some(PathBuf::from("D:/x/usno")));
        // A key it does not know, or a file that is not JSON, gives no configuration at all.
        std::fs::write(folder.join(CONFIG_FILE), r#"{"de441":"D:/x/de441.eph","token":"x"}"#).unwrap();
        assert_eq!(data_paths(Some(&folder), None, &nothing), None);
        std::fs::write(folder.join(CONFIG_FILE), "not json").unwrap();
        assert_eq!(data_paths(Some(&folder), None, &nothing), None);
        let _ = std::fs::remove_dir_all(&folder);
    }

    /// Tests on the real data run only where the files are named by the environment (the DE441 file is
    /// 2.8 GB and is not in the repository); elsewhere they report that they were skipped.
    fn real_data() -> bool {
        let available = std::env::var("VIRGOSTARS_DE441_PATH").is_ok() && data_available();
        if !available {
            eprintln!("skipped: VIRGOSTARS_DE441_PATH is not set to a readable classic DE441 file");
        }
        available
    }

    #[test]
    fn test_a_chart_at_j2000_is_where_the_sky_was() {
        if !real_data() {
            return;
        }
        let snapshot = VirgoStarsEphemeris.chart(&request(2000, 1, 1, 12.0)).expect("a chart at J2000");
        let longitude = |id: &str| snapshot.bodies.iter().find(|body| body.id == id).unwrap().longitude_deg;
        // Apparent geocentric longitudes of date at 2000-01-01 12:00 UT (well-known values, to 0.01 degree).
        assert!((longitude("Sun") - 280.37).abs() < 0.01, "Sun {}", longitude("Sun"));
        assert!((longitude("Moon") - 223.32).abs() < 0.02, "Moon {}", longitude("Moon"));
        assert!((longitude("Jupiter") - 25.25).abs() < 0.05, "Jupiter {}", longitude("Jupiter"));
        assert_eq!(snapshot.julian_day_ut, 2_451_545.0);
        // Ten planets and four lunar points; Chiron is reported missing without its kernel.
        assert!(snapshot.bodies.len() >= 14);
        assert!(snapshot.bodies.iter().all(|body| body.ephemeris_source == "jpl"));
        assert!(snapshot.bodies.iter().all(|body| (0.0..360.0).contains(&body.longitude_deg) && body.longitude_speed.is_finite()));
        // Five house systems at a mid latitude, each with twelve forward cusps.
        assert_eq!(snapshot.houses.len(), 5);
        assert!(snapshot.unavailable_house_systems.is_empty());
        let sun = snapshot.bodies.iter().find(|body| body.id == "Sun").unwrap();
        assert!(sun.longitude_speed > 0.9 && sun.longitude_speed < 1.1, "Sun speed {}", sun.longitude_speed);
    }

    #[test]
    fn test_polar_latitudes_report_the_unavailable_systems_instead_of_substituting() {
        if !real_data() {
            return;
        }
        let polar = ValidatedRequest { latitude_deg: 75.0, ..request(2000, 1, 1, 12.0) };
        let snapshot = VirgoStarsEphemeris.chart(&polar).expect("a chart at a polar latitude");
        assert!(snapshot.unavailable_house_systems.contains(&"placido"));
        assert!(snapshot.houses.iter().any(|system| system.id == "egizia"));
    }

    #[test]
    fn test_the_time_policy_limits_are_reported_not_hidden() {
        if !real_data() {
            return;
        }
        assert!(VirgoStarsEphemeris.covers(&request(1900, 1, 1, 0.0)));
        assert!(VirgoStarsEphemeris.covers(&request(2026, 11, 17, 12.0)));
        assert!(!VirgoStarsEphemeris.covers(&request(1899, 12, 31, 23.0)));
        let with_table = std::env::var("VIRGOSTARS_USNO_DIR").is_ok();
        // After June 2027 only a measured/predicted ΔT table can say what TT is.
        assert_eq!(VirgoStarsEphemeris.covers(&request(2027, 7, 1, 0.0)), with_table);
    }

    #[test]
    fn test_return_searches_get_the_luminary_longitude() {
        if !real_data() {
            return;
        }
        let sun = VirgoStarsEphemeris.luminary_longitude(Luminary::Sun, 2_451_545.0).unwrap();
        assert!((sun - 280.37).abs() < 0.01);
        assert!(VirgoStarsEphemeris.luminary_longitude(Luminary::Moon, 2_451_545.0).unwrap() < 360.0);
    }

    #[test]
    fn test_without_the_data_files_there_is_no_provider() {
        // A path that does not exist never opens, and a failed open is not remembered.
        let missing = DataPaths { de441: PathBuf::from("Z:/does/not/exist/de441.eph"), usno_directory: None, chiron_spk: None };
        assert!(Engine::open(&missing).is_none());
    }
}
