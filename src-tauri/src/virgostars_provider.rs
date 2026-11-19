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
    BodyPositionV1, ChartSnapshotV1, EphemerisProvider, FixedStarV1, HouseSystemV1, HouseAngleContextV1, Luminary, ProviderError, ProviderInfoV1, SolarDayV1,
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
    ApparentOptions, experimental_geocentric_apparent_with_provider, experimental_small_body_apparent_with_provider,
};
use virgostars_ephemeris_core::civil_apparent::{jd_ut_to_tdb_with_policy, jd_ut_to_tdb_with_table};
use virgostars_ephemeris_core::de441::{Body, De441, JulianDateTdb};
use virgostars_ephemeris_core::de441_pack_manager::De441PackManager;
use virgostars_ephemeris_core::delta_t_table::DeltaTTable;
use virgostars_ephemeris_core::house_angles::house_angles;
use virgostars_ephemeris_core::fixed_star::{calculate_star_with_provider, calculate_star_with_solar_deflection, FixedStarCatalogEntry, StellarSolarDeflection};
use virgostars_ephemeris_core::horizon::{ecliptic_to_equatorial, equatorial_to_horizontal};
use virgostars_ephemeris_core::rise_transit::{find_event, Atmosphere, Disc, Event, Limb, Request, Site, SkyPosition};
use virgostars_ephemeris_core::lunar_points::{lunar_point, lunar_point_with_provider, LunarPoint};
use virgostars_ephemeris_core::spk_type21::SmallBodySpk;
use virgostars_ephemeris_core::historical_civil_time::{HistoricalCivilEpoch, HistoricalCivilInput};
use virgostars_ephemeris_core::explicit_delta_t::ExplicitDeltaTEpoch;
use virgostars_ephemeris_core::mvp_snapshot::{experimental_snapshot_from_civil, experimental_snapshot_from_civil_with_provider, SolarSearch};

/// The core crate version and the commit this build is pinned to (see `Cargo.toml`). The WebView contract
/// accepts only `[A-Za-z0-9._-]{1,40}` here.
pub(crate) const ENGINE_VERSION: &str = "core-0.1.0-38befb2";
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

macro_rules! six {
    ($fields:expr) => {{
        let fields = &$fields;
        [fields.longitude_deg, fields.latitude_deg, fields.distance_au,
            fields.longitude_speed_deg_per_tdb_day, fields.latitude_speed_deg_per_tdb_day,
            fields.distance_speed_au_per_tdb_day]
    }};
}

/// Where the data files are. Absolute paths chosen by the user; they never cross IPC.
#[derive(Debug, Clone, PartialEq)]
struct DataPaths {
    de441: PathBuf,
    usno_directory: Option<PathBuf>,
    chiron_spk: Option<PathBuf>,
    fixed_star_catalog: Option<PathBuf>,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileConfig {
    de441: Option<String>,
    usno_directory: Option<String>,
    chiron_spk: Option<String>,
    fixed_star_catalog: Option<String>,
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
const BUNDLED_STARS: &str = "fixed-stars.json";

/// Per item: environment variable, then `ephemeris.json`, then the files shipped with the installer.
/// `None` when no DE441 location is known at all.
fn data_paths(
    config_folder: Option<&Path>,
    bundled_folder: Option<&Path>,
    env: &dyn Fn(&str) -> Option<String>,
) -> Option<DataPaths> {
    let file = config_folder.and_then(read_config).unwrap_or_default();
    let shipped = |name: &str| bundled_folder.map(|folder| folder.join(BUNDLED_FOLDER).join(name)).filter(|path| path.exists())
        .or_else(|| config_folder.and_then(|folder| crate::update_backup::preserved_resource(folder, &format!("{BUNDLED_FOLDER}/{name}"))));
    let de441: PathBuf = match env("VIRGOSTARS_DE441_PATH").or(file.de441) {
        Some(path) => path.into(),
        None => shipped(BUNDLED_DE441)?,
    };
    let usno = env("VIRGOSTARS_USNO_DIR").or(file.usno_directory).map(PathBuf::from).or_else(|| shipped(BUNDLED_USNO));
    let chiron = env("VIRGOSTARS_CHIRON_SPK").or(file.chiron_spk).map(PathBuf::from).or_else(|| shipped(BUNDLED_CHIRON));
    let stars = env("VIRGOSTARS_FIXED_STARS").or(file.fixed_star_catalog).map(PathBuf::from).or_else(|| shipped(BUNDLED_STARS));
    Some(DataPaths { de441, usno_directory: usno, chiron_spk: chiron, fixed_star_catalog:stars })
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixedStarRecord {
    id:u32, name:String, magnitude:Option<f64>, epoch_tdb_jd:f64, ra_deg:Option<f64>, dec_deg:Option<f64>,
    pm_ra_mas_year:Option<f64>, pm_dec_mas_year:Option<f64>, parallax_mas:Option<f64>, radial_velocity_km_s:Option<f64>,
    approximate_ecliptic:Option<ApproximateEcliptic>,
    constellation:Option<String>,
    #[serde(default)] interpretations:std::collections::BTreeMap<String,String>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct ApproximateEcliptic {longitude_deg:f64, latitude_deg:f64}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixedStarCatalog { schema:String, provenance:String, stars:Vec<FixedStarRecord> }

fn load_star_catalog(path:&Path) -> Option<Vec<FixedStarRecord>> {
    const MAX: u64 = 8 * 1024 * 1024;
    let file = File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX { return None; }
    let mut text=String::new(); file.take(MAX + 1).read_to_string(&mut text).ok()?;
    if text.len() as u64 > MAX { return None; }
    parse_star_catalog(&text)
}

fn parse_star_catalog(text:&str) -> Option<Vec<FixedStarRecord>> {
    let catalog:FixedStarCatalog=serde_json::from_str(text).ok()?;
    if catalog.schema != "virgostars-desktop-stars/1" || catalog.provenance.trim().is_empty() ||
        catalog.provenance.len() > 500 || catalog.stars.is_empty() || catalog.stars.len() > 2048 { return None; }
    let mut ids=std::collections::HashSet::new();
    for s in &catalog.stars {
        if s.id == 0 || s.id > 1_000_000 || !ids.insert(s.id) || s.name.is_empty() || s.name.len() > 80 ||
            !s.name.chars().all(|c| c.is_alphanumeric() || " .'-".contains(c)) ||
            s.constellation.as_ref().is_some_and(|name| name.len() > 160 || name.chars().any(char::is_control)) ||
            !s.epoch_tdb_jd.is_finite() || s.magnitude.is_some_and(|v| !v.is_finite() || !(-10.0..=20.0).contains(&v)) ||
            !valid_star_coordinates(s) ||
            s.interpretations.len() > 32 || s.interpretations.iter().any(|(k,v)| k.is_empty() || k.len()>80 || v.len()>8192 || v.chars().any(|c| c == '\0')) { return None; }
    }
    Some(catalog.stars)
}

fn valid_star_coordinates(s:&FixedStarRecord) -> bool {
    if let Some(p) = &s.approximate_ecliptic {
        return (p.longitude_deg.is_finite() && (0.0..360.0).contains(&p.longitude_deg) &&
            p.latitude_deg.is_finite() && p.latitude_deg.abs() < 90.0) &&
            [s.ra_deg,s.dec_deg,s.pm_ra_mas_year,s.pm_dec_mas_year,s.parallax_mas,s.radial_velocity_km_s].iter().all(Option::is_none);
    }
    match (s.ra_deg,s.dec_deg,s.pm_ra_mas_year,s.pm_dec_mas_year,s.parallax_mas,s.radial_velocity_km_s) {
        (Some(ra),Some(dec),Some(pmra),Some(pmdec),Some(parallax),Some(rv)) =>
            [ra,dec,pmra,pmdec,parallax,rv].iter().all(|x| x.is_finite()) && (0.0..360.0).contains(&ra) &&
            dec.abs() < 90.0 && (0.001..=10000.0).contains(&parallax) && rv.abs() < 299_792.458,
        _ => false,
    }
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
    multipack: Option<De441PackManager>,
    logical_multipack: Option<De441PackManager>,
    delta_t: Option<DeltaTTable>,
    chiron: Option<SmallBodySpk>,
    stars:Option<Vec<FixedStarRecord>>,
}

impl Engine {
    fn open(paths: &DataPaths) -> Option<Self> {
        Some(Self {
            ephemeris: De441::open(&paths.de441).ok()?,
            multipack: None,
            logical_multipack: None,
            delta_t: paths.usno_directory.as_deref().and_then(load_delta_t),
            chiron: paths.chiron_spk.as_deref().and_then(load_chiron),
            stars: match paths.fixed_star_catalog.as_deref() {
                Some(path) => Some(load_star_catalog(path).unwrap_or_default()),
                None => {
                    let embedded = include_bytes!(concat!(env!("OUT_DIR"), "/vs-star-catalog.json"));
                    if embedded.is_empty() { None } else {
                        Some(std::str::from_utf8(embedded).ok().and_then(parse_star_catalog).unwrap_or_default())
                    }
                }
            },
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

    fn apparent(&mut self, target: Body, tdb: JulianDateTdb, frame: ApparentFrame) -> Result<[f64; 6], ProviderError> {
        self.require_logical_coverage(tdb)?;
        if let Some(manager) = self.multipack.as_mut() {
            let fields = experimental_geocentric_apparent_with_provider(manager, target, tdb, frame).map_err(|_| ProviderError)?;
            Ok(six!(fields.fields))
        } else {
            let options = ApparentOptions { frame, ..ApparentOptions::default() };
            let rows = geocentric_apparent_six_fields_many_with_options(&mut self.ephemeris, &[target], tdb, options).map_err(|_| ProviderError)?;
            Ok(six!(rows.first().ok_or(ProviderError)?.fields))
        }
    }

    fn require_logical_coverage(&self, tdb: JulianDateTdb) -> Result<(), ProviderError> {
        if let Some(manager) = &self.logical_multipack {
            let spec = manager.select_pack(tdb).map_err(|_| ProviderError)?;
            if !spec.file_path.is_file() { return Err(ProviderError); }
        }
        Ok(())
    }

    fn covers_tdb(&self, tdb: JulianDateTdb) -> bool {
        if let Some(manager) = &self.logical_multipack {
            manager.select_pack(tdb).is_ok_and(|spec| spec.file_path.is_file())
        } else {
            let (start, end) = self.ephemeris.coverage();
            start.0 <= tdb.0 && tdb.0 <= end.0
        }
    }

    /// Sunrise, sunset and following sunrise bracketing the instant. Sea-level,
    /// standard atmosphere, apparent solar upper limb, topocentric; UT1≈UTC.
    fn solar_day(&mut self, input: &ValidatedRequest) -> Result<Option<SolarDayV1>, ProviderError> {
        let target = julian_day_ut(input);
        let site = Site { latitude_deg: input.latitude_deg, longitude_deg_east: input.longitude_deg, height_m: 0.0 };
        let atmosphere = Atmosphere { pressure_hpa: 1013.25, temperature_c: 15.0 };
        let mut find = |start: f64, event: Event| -> Result<Option<f64>, ProviderError> {
            let request = Request { event, disc: Disc::Radius { km: 695_700.0, limb: Limb::Upper },
                refraction: true, topocentric: true, fixed_centre_altitude_deg: None, search_days: 2.1 };
            find_event(|ut| -> Result<SkyPosition, ProviderError> {
                let tdb = self.to_tdb(ut)?;
                let tt = tdb_to_tt_jd(tdb.0).map_err(|_| ProviderError)?;
                let fields = self.apparent(Body::Sun, tdb, ApparentFrame::TrueEquatorOfDate)?;
                Ok(SkyPosition { tt_jd:tt, right_ascension_deg:fields[0],
                    declination_deg:fields[1], distance_au:fields[2] })
            }, &site, &atmosphere, &request, start).map_err(|_| ProviderError)
        };
        let Some(mut rise) = find(target - 2.0, Event::Rise)? else { return Ok(None); };
        if rise > target { return Ok(None); }
        let Some(mut next) = find(rise + 1e-7, Event::Rise)? else { return Ok(None); };
        while next <= target {
            rise = next;
            let Some(later) = find(rise + 1e-7, Event::Rise)? else { return Ok(None); };
            if later <= rise { return Ok(None); }
            next = later;
        }
        let Some(set) = find(rise + 1e-7, Event::Set)? else { return Ok(None); };
        if !(rise <= target && target < next && rise < set && set < next) { return Ok(None); }
        Ok(Some(SolarDayV1 { sunrise_jd_ut:rise, sunset_jd_ut:set, next_sunrise_jd_ut:next }))
    }
}

/// Provider entry point awaiting the historical chart IPC and UI contract.
#[allow(dead_code)]
pub(crate) fn historical_chart(
    civil: HistoricalCivilInput<'_>,
    delta_t_seconds: f64,
    delta_t_uncertainty_seconds: f64,
    delta_t_source: &str,
    site: &Site,
    solar: Option<SolarSearch>,
) -> Option<Result<HistoricalChart, ProviderError>> {
    with_engine(|engine| engine.historical_chart(civil, delta_t_seconds,
        delta_t_uncertainty_seconds, delta_t_source, site, solar))
}

pub(crate) fn historical_epoch_covered(jd_ut1:f64, delta:f64, uncertainty:f64) -> Option<Result<bool, ()>> {
    with_engine(|engine| {
        let epoch = virgostars_ephemeris_core::explicit_delta_t::ut1_to_tdb_with_explicit_delta_t(jd_ut1, delta, uncertainty).map_err(|_| ())?;
        Ok(engine.covers_tdb(epoch.jd_tdb))
    })
}

static CONFIG_FOLDER: OnceLock<PathBuf> = OnceLock::new();
static RESOURCE_FOLDER: OnceLock<PathBuf> = OnceLock::new();
static ENGINE: Mutex<Option<Engine>> = Mutex::new(None);

pub(crate) fn catalog_context() -> Result<(crate::de441_catalog::Catalog, PathBuf, PathBuf), &'static str> {
    let digest = option_env!("VIRGOSTARS_DE441_CATALOG_SHA256").ok_or("not_configured")?;
    let resource = RESOURCE_FOLDER.get().ok_or("not_configured")?;
    let data = CONFIG_FOLDER.get().ok_or("not_configured")?;
    let paths = data_paths(Some(data), Some(resource), &|name| std::env::var(name).ok()).ok_or("not_configured")?;
    let base = resource.join(BUNDLED_FOLDER).join(BUNDLED_DE441);
    if paths.de441 != base { return Err("custom_source"); }
    let catalog = read_pinned_catalog(resource, digest).ok_or("invalid_catalog")?;
    Ok((catalog, data.join("de441-packs"), base))
}

/// Serialize file mutation with calculations and discard cached readers.
pub(crate) fn without_engine<T>(action: impl FnOnce() -> T) -> T {
    let mut guard = ENGINE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = None;
    action()
}

/// Only an app-build-time digest can authorize the catalog. The catalog itself
/// supplies neither its trust anchor nor a filesystem location from the UI.
fn read_pinned_catalog(resource_folder: &Path, digest: &str) -> Option<crate::de441_catalog::Catalog> {
    if digest.len() != 64 || !digest.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) { return None; }
    let mut pin = [0u8; 32];
    for (i, byte) in pin.iter_mut().enumerate() { *byte = u8::from_str_radix(&digest[i * 2..i * 2 + 2], 16).ok()?; }
    let catalog_path = resource_folder.join(BUNDLED_FOLDER).join("de441-release-catalog-v1.json");
    let metadata = std::fs::symlink_metadata(&catalog_path).ok()?;
    if !metadata.file_type().is_file() || metadata.len() > 512 * 1024 { return None; }
    let bytes = std::fs::read(catalog_path).ok()?;
    crate::de441_catalog::parse_pinned(&bytes, &pin).ok()
}

fn pinned_manager(paths: &DataPaths, resource_folder: &Path, data_folder: &Path, digest: &str) -> Option<(De441PackManager, De441PackManager)> {
    let bundled_base = resource_folder.join(BUNDLED_FOLDER).join(BUNDLED_DE441);
    // Explicit user-selected full files keep their existing single-file semantics.
    if paths.de441 != bundled_base { return None; }
    let catalog = read_pinned_catalog(resource_folder, digest)?;
    let directory = data_folder.join("de441-packs");
    let installed = catalog.installed_verified(&directory, &bundled_base).ok()?;
    let logical = catalog.manager(&directory, &bundled_base).ok()?;
    let sampling = catalog.sampling_manager(&directory, &bundled_base, &installed).ok()?;
    Some((logical, sampling))
}

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
        let mut engine = Engine::open(&paths)?;
        if let Some(digest) = option_env!("VIRGOSTARS_DE441_CATALOG_SHA256") {
            let resource = RESOURCE_FOLDER.get()?;
            // Only the bundled base is subject to this catalog. A configured
            // replacement file remains a separate, user-selected provider.
            if paths.de441 == resource.join(BUNDLED_FOLDER).join(BUNDLED_DE441) {
                let (logical, sampling) = pinned_manager(&paths, resource, CONFIG_FOLDER.get()?, digest)?;
                engine.logical_multipack = Some(logical);
                engine.multipack = Some(sampling);
            }
        }
        *guard = Some(engine);
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
    with_engine(|engine| engine.historical_planet(request))
}

impl Engine {
    fn historical_planet(&mut self, request: &crate::historical_planets::HistoricalPlanetRequest)
        -> Result<crate::historical_planets::HistoricalPlanetResult, ()> {
        let body = PLANETS.iter().find(|(name, _)| *name == request.body).map(|(_, body)| *body).ok_or(())?;
        let output = if self.multipack.is_some() {
            use virgostars_ephemeris_core::explicit_delta_t::ut1_to_tdb_with_explicit_delta_t;
            use virgostars_ephemeris_core::historical_rate_candidate::HistoricalThreeRateCandidate;
            let source = request.delta_t_source.trim();
            if source.is_empty() || request.delta_t_source.len() > 200 { return Err(()); }
            let epoch = ut1_to_tdb_with_explicit_delta_t(request.jd_ut1, request.delta_t_seconds, request.uncertainty_seconds).map_err(|_| ())?;
            self.require_logical_coverage(epoch.jd_tdb).map_err(|_| ())?;
            let rates = virgostars_ephemeris_core::apparent_ecliptic_of_date::experimental_three_rate_with_provider(
                self.multipack.as_mut().ok_or(())?, body, epoch.jd_tdb).map_err(|_| ())?;
            HistoricalThreeRateCandidate {epoch, rates, delta_t_source: source.to_owned()}
        } else {
            virgostars_ephemeris_core::historical_rate_candidate::historical_three_rate_candidate(
                &mut self.ephemeris, body, request.jd_ut1, request.delta_t_seconds,
                request.uncertainty_seconds, &request.delta_t_source).map_err(|_| ())?
        };
        let fields = output.rates.base;
        let sensitivity = if request.include_scenarios {
            use crate::historical_planets::{HistoricalSensitivity, HistoricalSensitivitySample};
            use virgostars_ephemeris_core::historical_delta_t_scenarios::{historical_delta_t_scenarios, ScenarioFrame};
            if self.multipack.is_some() {
                use virgostars_ephemeris_core::explicit_delta_t::ut1_to_tdb_delta_t_scenarios;
                let epochs = ut1_to_tdb_delta_t_scenarios(request.jd_ut1, request.delta_t_seconds, request.uncertainty_seconds).map_err(|_| ())?;
                for epoch in [epochs.lower, epochs.nominal, epochs.upper] { self.require_logical_coverage(epoch.jd_tdb).map_err(|_| ())?; }
                let manager = self.multipack.as_mut().ok_or(())?;
                let mut sample = |epoch| virgostars_ephemeris_core::apparent_ecliptic_of_date::experimental_three_rate_with_provider(manager, body, epoch)
                    .map(|candidate| candidate.base).map_err(|_| ());
                let lower = sample(epochs.lower.jd_tdb)?;
                let nominal = sample(epochs.nominal.jd_tdb)?;
                let upper = sample(epochs.upper.jd_tdb)?;
                if nominal != fields { return Err(()); }
                Some(HistoricalSensitivity {
                    lower: HistoricalSensitivitySample {delta_t_seconds:epochs.lower.delta_t_seconds, longitude_deg:lower.longitude_deg, latitude_deg:lower.latitude_deg},
                    upper: HistoricalSensitivitySample {delta_t_seconds:epochs.upper.delta_t_seconds, longitude_deg:upper.longitude_deg, latitude_deg:upper.latitude_deg},
                })
            } else {
                let samples = historical_delta_t_scenarios(&mut self.ephemeris, body, request.jd_ut1,
                    request.delta_t_seconds, request.uncertainty_seconds, ScenarioFrame::DirectObliquity).map_err(|_| ())?;
                if samples.nominal.fields != fields { return Err(()); }
                let convert = |sample: virgostars_ephemeris_core::historical_delta_t_scenarios::HistoricalScenario| HistoricalSensitivitySample {
                    delta_t_seconds: sample.epoch.delta_t_seconds, longitude_deg: sample.fields.longitude_deg,
                    latitude_deg: sample.fields.latitude_deg,
                };
                Some(HistoricalSensitivity { lower: convert(samples.lower), upper: convert(samples.upper) })
            }
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
    }
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

/// Intermediate provider result for the future historical chart IPC. The
/// local-clock and ΔT uncertainties are kept distinct; no UTC is invented.
#[allow(dead_code)]
pub(crate) struct HistoricalChart {
    pub chart: ChartSnapshotV1,
    pub civil: HistoricalCivilEpoch,
    pub epoch: ExplicitDeltaTEpoch,
    pub delta_t_source: String,
    pub sunrise: HistoricalSolarEvent,
    pub sunset: HistoricalSolarEvent,
}

#[allow(dead_code)]
pub(crate) enum HistoricalSolarEvent {
    NotRequested,
    /// `None` means no crossing in the search window (e.g. polar day).
    Computed(Option<f64>),
    Unavailable,
}

fn historical_solar_event(event: Option<Result<virgostars_ephemeris_core::mvp_site::SolarEvent,
    virgostars_ephemeris_core::mvp_site::SiteError>>) -> HistoricalSolarEvent {
    match event {
        None => HistoricalSolarEvent::NotRequested,
        Some(Ok(event)) => HistoricalSolarEvent::Computed(event.jd_ut1),
        Some(Err(_)) => HistoricalSolarEvent::Unavailable,
    }
}

impl Engine {
    /// Reuses the merged astronomical snapshot and Desktop's existing house
    /// geometries. This provider adapter is not yet a registered Tauri command.
    #[allow(dead_code)]
    fn historical_chart(
        &mut self,
        civil: HistoricalCivilInput<'_>,
        delta_t_seconds: f64,
        delta_t_uncertainty_seconds: f64,
        delta_t_source: &str,
        site: &Site,
        solar: Option<SolarSearch>,
    ) -> Result<HistoricalChart, ProviderError> {
        if self.logical_multipack.is_some() {
            let civil_epoch = virgostars_ephemeris_core::historical_civil_time::local_to_ut1(civil).map_err(|_| ProviderError)?;
            let epoch = virgostars_ephemeris_core::explicit_delta_t::ut1_to_tdb_with_explicit_delta_t(
                civil_epoch.jd_ut1, delta_t_seconds, delta_t_uncertainty_seconds).map_err(|_| ProviderError)?;
            self.require_logical_coverage(epoch.jd_tdb)?;
        }
        let result = if let Some(manager) = self.multipack.as_mut() {
            if solar.is_some() { return Err(ProviderError); }
            experimental_snapshot_from_civil_with_provider(manager, civil, delta_t_seconds,
                delta_t_uncertainty_seconds, delta_t_source, site).map_err(|_| ProviderError)?
        } else {
            experimental_snapshot_from_civil(&mut self.ephemeris, civil,
                delta_t_seconds, delta_t_uncertainty_seconds, delta_t_source, site, solar).map_err(|_| ProviderError)?
        };
        let snapshot = result.snapshot;
        let mut bodies = Vec::with_capacity(PLANETS.len() + LUNAR_POINTS.len());
        for planet in &snapshot.planets.positions {
            let id = PLANETS.iter().find(|(_, body)| *body == planet.body).map(|(id, _)| *id).ok_or(ProviderError)?;
            let f = &planet.rates.base;
            bodies.push(position(id, [f.longitude_deg, f.latitude_deg, f.distance_au,
                planet.rates.longitude_deg_per_tdb_day, planet.rates.latitude_deg_per_tdb_day,
                planet.rates.radial_au_per_tdb_day],
                [planet.equatorial.right_ascension_deg, planet.equatorial.declination_deg]));
        }
        for lunar in &snapshot.lunar.positions {
            let id = LUNAR_POINTS.iter().find(|(_, point)| *point == lunar.point).map(|(id, _)| *id).ok_or(ProviderError)?;
            let e = &lunar.ecliptic;
            let mut body = position(id, [e.longitude_deg, e.latitude_deg, e.distance_au,
                e.longitude_rate_deg_per_day, e.latitude_rate_deg_per_day, e.distance_rate_au_per_day],
                [lunar.equatorial.longitude_deg, lunar.equatorial.latitude_deg]);
            // These are modelled points, including an empirical compatibility fit;
            // do not label them as direct JPL planetary positions.
            body.ephemeris_source = "lunar_model";
            bodies.push(body);
        }
        let mut systems = Vec::new();
        let mut unavailable_house_systems = Vec::new();
        if let Ok(angles) = snapshot.house_angles {
            let angles = angles.angles;
            let basis = HouseAngles {armc_deg: angles.armc_deg, true_obliquity_deg: angles.true_obliquity_deg,
                latitude_deg: site.latitude_deg, ascendant_deg: angles.ascendant_deg, midheaven_deg: angles.midheaven_deg};
            for id in HOUSE_SYSTEMS {
                match houses::cusps(id, &basis) {
                    Some(cusps_deg) => systems.push(HouseSystemV1 {id, cusps_deg, ascendant_deg: angles.ascendant_deg,
                        mc_deg: angles.midheaven_deg, armc_deg: angles.armc_deg, vertex_deg: angles.extra.vertex_deg}),
                    None => unavailable_house_systems.push(id),
                }
            }
        } else {
            unavailable_house_systems.extend(HOUSE_SYSTEMS);
        }
        let epoch = snapshot.planets.epoch;
        Ok(HistoricalChart {
            chart: ChartSnapshotV1 {julian_day_ut: epoch.jd_ut1, house_angle_context: None, bodies, houses: systems,
                unavailable_bodies: vec!["Chiron"], unavailable_house_systems},
            civil: result.civil, epoch, delta_t_source: snapshot.planets.delta_t_source,
            sunrise: historical_solar_event(snapshot.sunrise), sunset: historical_solar_event(snapshot.sunset),
        })
    }
}

impl Engine {
    fn chart(&mut self, request: &ValidatedRequest) -> Result<ChartSnapshotV1, ProviderError> {
        let jd_ut = julian_day_ut(request);
        let tdb = self.to_tdb(jd_ut)?;
        let tt = tdb_to_tt_jd(tdb.0).map_err(|_| ProviderError)?;
        let ecliptic_options = ApparentOptions::default();
        let equatorial_options = ApparentOptions { frame: ApparentFrame::TrueEquatorOfDate, ..ApparentOptions::default() };
        let mut bodies = Vec::with_capacity(PLANETS.len() + LUNAR_POINTS.len() + 1);
        for (id, target) in PLANETS {
            let ecl = self.apparent(target, tdb, ApparentFrame::TrueEclipticOfDate)?;
            let equ = self.apparent(target, tdb, ApparentFrame::TrueEquatorOfDate)?;
            bodies.push(position(id, ecl, [equ[0], equ[1]]));
        }
        let mut unavailable_bodies = Vec::new();
        for (id, point) in LUNAR_POINTS {
            let ecl = if let Some(manager) = self.multipack.as_mut() { lunar_point_with_provider(manager, point, ApparentFrame::TrueEclipticOfDate, tdb.0) } else { lunar_point(Some(&mut self.ephemeris), point, ApparentFrame::TrueEclipticOfDate, tdb.0) };
            let equ = if let Some(manager) = self.multipack.as_mut() { lunar_point_with_provider(manager, point, ApparentFrame::TrueEquatorOfDate, tdb.0) } else { lunar_point(Some(&mut self.ephemeris), point, ApparentFrame::TrueEquatorOfDate, tdb.0) };
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
            if let Some(manager) = self.multipack.as_mut() {
                let ecl = experimental_small_body_apparent_with_provider(manager, spk, tdb, ecliptic_options).ok()?;
                let equ = experimental_small_body_apparent_with_provider(manager, spk, tdb, equatorial_options).ok()?;
                Some(position("Chiron", six!(ecl.fields), [equ.fields.longitude_deg, equ.fields.latitude_deg]))
            } else {
                let ecl = small_body_apparent_six_fields(&mut self.ephemeris, spk, tdb, ecliptic_options).ok()?;
                let equ = small_body_apparent_six_fields(&mut self.ephemeris, spk, tdb, equatorial_options).ok()?;
                Some(position("Chiron", six!(ecl.fields), [equ.fields.longitude_deg, equ.fields.latitude_deg]))
            }
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
        Ok(ChartSnapshotV1 { julian_day_ut: jd_ut,
            house_angle_context: Some(HouseAngleContextV1 {tt_julian_day:tt, true_obliquity_deg:angles.true_obliquity_deg}),
            bodies, houses: systems, unavailable_bodies, unavailable_house_systems })
    }

    fn luminary(&mut self, body: Luminary, jd_ut: f64) -> Result<f64, ProviderError> {
        let tdb = self.to_tdb(jd_ut)?;
        let target = match body {
            Luminary::Sun => Body::Sun,
            Luminary::Moon => Body::Moon,
        };
        let longitude = self.apparent(target, tdb, ApparentFrame::TrueEclipticOfDate)?[0];
        longitude.is_finite().then(|| longitude.rem_euclid(360.0)).ok_or(ProviderError)
    }
}

pub struct VirgoStarsEphemeris;

impl EphemerisProvider for VirgoStarsEphemeris {
    fn info(&self) -> ProviderInfoV1 {
        ProviderInfoV1 { id: "virgostars_ephemeris", engine_version: ENGINE_VERSION.to_string() }
    }

    fn solar_day(&self, request: &ValidatedRequest) -> Result<Option<SolarDayV1>, ProviderError> {
        with_engine(|engine| engine.solar_day(request)).ok_or(ProviderError)?
    }

    fn previous_new_moon_longitude(&self, request: &ValidatedRequest) -> Result<Option<f64>, ProviderError> {
        with_engine(|engine| {
            let instant = crate::return_search::previous_conjunction(|t| {
                let moon = engine.luminary(Luminary::Moon, t)?;
                let sun = engine.luminary(Luminary::Sun, t)?;
                Ok(moon - sun)
            }, julian_day_ut(request))?;
            instant.map(|t| engine.luminary(Luminary::Moon, t)).transpose()
        }).ok_or(ProviderError)?
    }

    fn fixed_stars(&self, request: &ValidatedRequest) -> Result<Option<Vec<FixedStarV1>>, ProviderError> {
        with_engine(|engine| {
            let jd = julian_day_ut(request);
            let tdb = engine.to_tdb(jd)?;
            engine.require_logical_coverage(tdb)?;
            let tt = tdb_to_tt_jd(tdb.0).map_err(|_| ProviderError)?;
            let angles = house_angles(jd, tt, request.latitude_deg, request.longitude_deg).map_err(|_| ProviderError)?;
            // Hipparcos I/239 HIP 32349, ICRS J1991.25; radial velocity zero is assumed.
            let sirius = FixedStarRecord {id:102, name:"Sirius".into(), magnitude:Some(-1.44), epoch_tdb_jd:2_448_349.0625,
                ra_deg:Some(101.28854105), dec_deg:Some(-16.71314306), pm_ra_mas_year:Some(-546.01), pm_dec_mas_year:Some(-1223.08),
                parallax_mas:Some(379.21), radial_velocity_km_s:Some(0.0), approximate_ecliptic:None, constellation:Some("Canis Major".into()), interpretations:Default::default()};
            let catalog = engine.stars.clone().unwrap_or_else(|| vec![sirius]);
            if catalog.is_empty() { return Ok(None); }
            let mut output = Vec::with_capacity(catalog.len());
            for entry in catalog {
                let approximate = entry.approximate_ecliptic.is_some();
                let (ra,dec,pmra,pmdec,parallax,rv) = if let Some(p) = &entry.approximate_ecliptic {
                    let Ok((ra,dec)) = ecliptic_to_equatorial(entry.epoch_tdb_jd,p.longitude_deg,p.latitude_deg) else {continue;};
                    // Distance and motion unavailable in the source: an explicitly approximate distant fixed direction.
                    (ra,dec,0.0,0.0,0.001,0.0)
                } else { (entry.ra_deg.unwrap(),entry.dec_deg.unwrap(),entry.pm_ra_mas_year.unwrap(),entry.pm_dec_mas_year.unwrap(),
                    entry.parallax_mas.unwrap(),entry.radial_velocity_km_s.unwrap()) };
                let source = FixedStarCatalogEntry { epoch_tdb:JulianDateTdb(entry.epoch_tdb_jd), right_ascension_deg:ra,
                    declination_deg:dec, proper_motion_ra_cos_dec_mas_per_year:pmra,
                    proper_motion_dec_mas_per_year:pmdec, parallax_mas:parallax, radial_velocity_km_per_second:rv };
                let star = if let Some(manager) = engine.multipack.as_mut() {
                    calculate_star_with_provider(manager, source, tt, tdb, StellarSolarDeflection::PointMass)
                } else {
                    calculate_star_with_solar_deflection(&mut engine.ephemeris, source, tt, tdb, StellarSolarDeflection::PointMass)
                };
                let Ok(star) = star else { continue; };
                let Ok((ra, dec)) = ecliptic_to_equatorial(tt, star.longitude_deg, star.latitude_deg) else { continue; };
                let Ok(horizontal) = equatorial_to_horizontal(ra, dec, angles.armc_deg, request.latitude_deg) else { continue; };
                output.push(FixedStarV1 {id:entry.id, name:entry.name, longitude_deg:star.longitude_deg,
                    latitude_deg:star.latitude_deg, magnitude:entry.magnitude, true_altitude_deg:horizontal.true_altitude_deg, approximate,
                    azimuth_south_west_deg:(horizontal.azimuth_north_east_deg + 180.0).rem_euclid(360.0), constellation:entry.constellation, interpretations:entry.interpretations});
            }
            Ok(Some(output))
        }).ok_or(ProviderError)?
    }

    fn covers(&self, request: &ValidatedRequest) -> bool {
        let jd_ut = julian_day_ut(request);
        // Without the data there is nothing to say about coverage; the calculation itself reports it.
        with_engine(|engine| {
            let Ok(tdb) = engine.to_tdb(jd_ut) else { return false; };
            engine.covers_tdb(tdb)
        }).unwrap_or(true)
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
    #[ignore = "requires private DE441 source, release catalog and generated slices"]
    fn authenticated_local_multipack_matches_full_source_in_desktop_provider() {
        use sha2::{Digest, Sha256};
        use virgostars_ephemeris_core::calendar::{Calendar, CalendarDateTime, TimeScale};
        use virgostars_ephemeris_core::historical_civil_time::HistoricalOffset;
        let root = PathBuf::from(std::env::var_os("DE441_PRIVATE_ROOT").expect("private local root"));
        let full = PathBuf::from(std::env::var_os("VIRGOSTARS_DE441_PATH").expect("full source"));
        let temp = tempfile::tempdir().unwrap();
        let resources = temp.path().join("resources");
        let ephemeris = resources.join("ephemeris");
        let data = temp.path().join("data");
        let packs = data.join("de441-packs");
        std::fs::create_dir_all(&ephemeris).unwrap();
        std::fs::create_dir_all(&packs).unwrap();
        let catalog = std::fs::read(root.join("de441-private-catalog/de441-release-catalog-v1.json")).unwrap();
        std::fs::write(ephemeris.join("de441-release-catalog-v1.json"), &catalog).unwrap();
        let pin = format!("{:x}", Sha256::digest(&catalog));
        let link = |source: &str, dest: &Path| {
            let source = root.join("de441-private-complete").join(source);
            std::fs::hard_link(&source, dest).unwrap_or_else(|_| { std::fs::copy(source, dest).unwrap(); });
        };
        link("de441-v2-desktop-core-1000-2200.eph", &ephemeris.join(BUNDLED_DE441));
        for name in ["de441-v2-history-00800-00999.eph", "de441-v2-future-02201-02400.eph"] {
            link(name, &packs.join(name));
        }
        let paths = DataPaths { de441: ephemeris.join(BUNDLED_DE441), usno_directory: None, chiron_spk: None, fixed_star_catalog: None };
        assert!(pinned_manager(&paths, &resources, &data, &"0".repeat(64)).is_none());
        let mut actual = Engine::open(&paths).unwrap();
        let (logical, sampling) = pinned_manager(&paths, &resources, &data, &pin).unwrap();
        actual.logical_multipack = Some(logical);
        actual.multipack = Some(sampling);
        let mut expected = Engine::open(&DataPaths {de441: full, ..paths.clone()}).unwrap();
        for body in [Body::Sun, Body::Moon, Body::Mercury, Body::PlutoBarycenter] {
            for frame in [ApparentFrame::TrueEclipticOfDate, ApparentFrame::TrueEquatorOfDate] {
                let tdb = JulianDateTdb(2_451_545.0);
                assert_eq!(actual.apparent(body, tdb, frame).unwrap(), expected.apparent(body, tdb, frame).unwrap());
            }
        }
        let site = Site {latitude_deg: 41.9, longitude_deg_east: 12.5, height_m: 0.0};
        for year in [900, 1000, 2000, 2201] {
            let civil = HistoricalCivilInput {
                local: CalendarDateTime {year, month: 3, day: 20, hour: 1, minute: 0, second: 0.0, scale: TimeScale::Ut1},
                calendar: Calendar::ProlepticGregorian,
                offset: HistoricalOffset::Supplied {seconds_east: 0.0, source: "test"}, uncertainty_seconds: 0.0,
            };
            let a = actual.historical_chart(civil, 69.0, 2.0, "synthetic", &site, None).unwrap();
            let b = expected.historical_chart(civil, 69.0, 2.0, "synthetic", &site, None).unwrap();
            assert_eq!(a.chart.bodies.len(), 14);
            for (a, b) in a.chart.bodies.iter().zip(&b.chart.bodies) {
                assert_eq!(a.id, b.id);
                assert_eq!(a.longitude_deg, b.longitude_deg);
                assert_eq!(a.longitude_speed, b.longitude_speed);
            }
            let request: crate::historical_planets::HistoricalPlanetRequest = serde_json::from_value(serde_json::json!({
                "protocolVersion":1, "body":"Mars", "jdUt1":a.chart.julian_day_ut,
                "deltaTSeconds":69.0, "uncertaintySeconds":2.0, "deltaTSource":"synthetic", "includeScenarios":true
            })).unwrap();
            let a = actual.historical_planet(&request).unwrap();
            let b = expected.historical_planet(&request).unwrap();
            assert_eq!(a.longitude_deg,b.longitude_deg);
            assert_eq!(a.latitude_deg,b.latitude_deg);
            assert_eq!(a.longitude_speed_deg_per_tdb_day,b.longitude_speed_deg_per_tdb_day);
            assert_eq!(a.radial_speed_au_per_tdb_day,b.radial_speed_au_per_tdb_day);
            let a=a.sensitivity.unwrap();let b=b.sensitivity.unwrap();
            assert_eq!(a.lower.longitude_deg,b.lower.longitude_deg);
            assert_eq!(a.upper.latitude_deg,b.upper.latitude_deg);
        }
        // Sub-samples can cross the boundary even when reception is inside
        // the base. Use its verified physical overlap, not a missing pack.
        drop(actual);
        std::fs::remove_file(packs.join("de441-v2-history-00800-00999.eph")).unwrap();
        let mut base_only = Engine::open(&paths).unwrap();
        let (logical, sampling) = pinned_manager(&paths, &resources, &data, &pin).unwrap();
        base_only.logical_multipack = Some(logical);
        base_only.multipack = Some(sampling);
        let boundary = HistoricalCivilInput {
            local: CalendarDateTime {year: 1000, month: 1, day: 1, hour: 0, minute: 0, second: 0.0, scale: TimeScale::Ut1},
            calendar: Calendar::ProlepticGregorian,
            offset: HistoricalOffset::Supplied {seconds_east: 0.0, source: "test"}, uncertainty_seconds: 0.0,
        };
        let a = base_only.historical_chart(boundary, 69.0, 2.0, "synthetic", &site, None).unwrap();
        let b = expected.historical_chart(boundary, 69.0, 2.0, "synthetic", &site, None).unwrap();
        for (a, b) in a.chart.bodies.iter().zip(&b.chart.bodies) {
            assert_eq!(a.id, b.id);
            assert_eq!(a.longitude_deg, b.longitude_deg);
            assert_eq!(a.longitude_speed, b.longitude_speed);
        }
        let outside = HistoricalCivilInput { local: CalendarDateTime {year: 999, month: 12, day: 31,
            hour: 12, minute: 0, second: 0.0, scale: TimeScale::Ut1}, ..boundary };
        assert!(base_only.historical_chart(outside, 69.0, 2.0, "synthetic", &site, None).is_err());
    }

    #[test]
    fn stellar_catalog_rejects_duplicate_and_invalid_sources() {
        let star = r#"{"id":1,"name":"Test Star","magnitude":2.0,"epochTdbJd":2451545.0,"approximateEcliptic":{"longitudeDeg":40,"latitudeDeg":20}}"#;
        let valid = format!(r#"{{"schema":"virgostars-desktop-stars/1","provenance":"synthetic","stars":[{star}]}}"#);
        assert_eq!(parse_star_catalog(&valid).unwrap().len(), 1);
        assert!(parse_star_catalog(&valid.replace("synthetic", "")).is_none());
        assert!(parse_star_catalog(&format!(r#"{{"schema":"virgostars-desktop-stars/1","provenance":"synthetic","stars":[{star},{star}]}}"#)).is_none());
        assert!(parse_star_catalog(&valid.replace("\"longitudeDeg\":40", "\"longitudeDeg\":400")).is_none());
    }

    #[test]
    fn configured_stellar_catalog_produces_positions_when_real_data_are_available() {
        if std::env::var_os("VIRGOSTARS_DE441_PATH").is_none() || std::env::var_os("VIRGOSTARS_FIXED_STARS").is_none() { return; }
        let stars = VirgoStarsEphemeris.fixed_stars(&request(2000, 1, 1, 12.0)).unwrap().unwrap();
        assert!(stars.len() > 700);
        let sirius = stars.iter().find(|star| star.name == "Sirius").expect("Sirius");
        assert!((103.0..106.0).contains(&sirius.longitude_deg));
        assert!(stars.iter().any(|star| star.approximate));
    }

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

    #[test]
    fn star_catalog_checks_provenance_identity_and_bounded_text() {
        let path = std::env::temp_dir().join(format!("vs-star-test-{}-{}.json", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        let valid = r#"{"schema":"virgostars-desktop-stars/1","provenance":"synthetic test only","stars":[{"id":1,"name":"Test Star","magnitude":2.0,"epochTdbJd":2451545.0,"raDeg":40.0,"decDeg":20.0,"pmRaMasYear":1.0,"pmDecMasYear":1.0,"parallaxMas":10.0,"radialVelocityKmS":0.0,"interpretations":{"Sun":"Synthetic"}}]}"#;
        std::fs::write(&path, valid).unwrap();
        assert_eq!(load_star_catalog(&path).unwrap().len(), 1);
        std::fs::write(&path, valid.replace("synthetic test only", "")).unwrap();
        assert!(load_star_catalog(&path).is_none());
        std::fs::write(&path, valid.replace("\"parallaxMas\":10.0", "\"parallaxMas\":-1.0")).unwrap();
        assert!(load_star_catalog(&path).is_none());
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn local_private_star_catalog_if_present_meets_provider_contract() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../.local/ephemeris/fixed-stars.json");
        if !path.exists() { return; }
        let stars = load_star_catalog(&path).expect("the owner-supplied catalogue must validate");
        assert!(!stars.is_empty());
    }

    #[test]
    fn local_catalog_with_real_ephemeris_calculates_star_positions_when_available() {
        if std::env::var_os("VIRGOSTARS_DE441_PATH").is_none() || std::env::var_os("VIRGOSTARS_FIXED_STARS").is_none() { return; }
        let results = VirgoStarsEphemeris.fixed_stars(&request(2000,1,1,12.0)).unwrap().unwrap();
        assert!(results.len() > 700, "most input stars should be calculable");
        let sirius = results.iter().find(|star| star.id == 102).expect("Sirius");
        assert!((103.0..106.0).contains(&sirius.longitude_deg));
        assert!(!sirius.approximate && !sirius.interpretations.is_empty());
        assert!(results.iter().any(|star| star.approximate));
        assert!(results.iter().all(|star| star.longitude_deg.is_finite() && star.true_altitude_deg.abs() <= 90.0));
    }

    #[test]
    fn previous_new_moon_uses_real_luminaries_when_available() {
        if std::env::var_os("VIRGOSTARS_DE441_PATH").is_none() { return; }
        let longitude = VirgoStarsEphemeris.previous_new_moon_longitude(&request(2000,2,1,12.0)).unwrap().unwrap();
        // The January 2000 conjunction is in Capricorn; this broad range is a
        // smoke check rather than an independent precision reference.
        assert!((270.0..300.0).contains(&longitude));
    }

    #[test]
    fn solar_day_brackets_rome_equinox_and_handles_polar_day_when_available() {
        if std::env::var_os("VIRGOSTARS_DE441_PATH").is_none() { return; }
        let noon = request(2000, 3, 20, 12.0);
        let midnight = julian_day_ut(&request(2000, 3, 20, 0.0));
        let events = VirgoStarsEphemeris.solar_day(&noon).unwrap().expect("Rome has sunrise and sunset");
        let hours = |jd: f64| (jd - midnight) * 24.0;
        // Broad plausibility windows, not independent precision references.
        assert!((4.0..7.0).contains(&hours(events.sunrise_jd_ut)));
        assert!((16.0..19.0).contains(&hours(events.sunset_jd_ut)));
        assert!((27.0..31.0).contains(&hours(events.next_sunrise_jd_ut)));
        let polar = ValidatedRequest { year: 2000, month: 6, day: 21, hour: 12.0,
            latitude_deg: 80.0, longitude_deg: 0.0 };
        assert!(VirgoStarsEphemeris.solar_day(&polar).unwrap().is_none());
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
        let missing = DataPaths { de441: PathBuf::from("Z:/does/not/exist/de441.eph"), usno_directory: None, chiron_spk: None, fixed_star_catalog:None };
        assert!(Engine::open(&missing).is_none());
    }

    #[test]
    fn test_historical_chart_uses_one_civil_epoch_for_planets_nodes_houses_and_sun() {
        use virgostars_ephemeris_core::calendar::{Calendar, CalendarDateTime, TimeScale};
        use virgostars_ephemeris_core::historical_civil_time::HistoricalOffset;
        use virgostars_ephemeris_core::rise_transit::Atmosphere;
        let Some(path) = std::env::var_os("VIRGOSTARS_DE441_PATH") else {
            eprintln!("skipped: VIRGOSTARS_DE441_PATH is not set");
            return;
        };
        let mut engine = Engine::open(&DataPaths {de441: path.into(), usno_directory: None, chiron_spk: None, fixed_star_catalog: None})
            .expect("a readable DE441 file");
        let site = Site {latitude_deg: 41.9, longitude_deg_east: 12.5, height_m: 0.0};
        for year in [-12999, 0, 2000, 3999] {
            let civil = HistoricalCivilInput {
                local: CalendarDateTime {year, month: 3, day: 20, hour: 1, minute: 0, second: 0.0, scale: TimeScale::Ut1},
                calendar: Calendar::ProlepticGregorian,
                offset: HistoricalOffset::LocalMeanSolar {longitude_deg_east: 15.0},
                uncertainty_seconds: 60.0,
            };
            let solar = SolarSearch {atmosphere: Atmosphere {pressure_hpa: 1013.25, temperature_c: 15.0}, search_days: 1.0};
            let result = engine.historical_chart(civil, 69.0, 2.0, "synthetic", &site, Some(solar)).unwrap();
            assert_eq!(result.chart.bodies.len(), 14);
            assert_eq!(result.chart.houses.len(), 5);
            assert_eq!(result.chart.unavailable_bodies, vec!["Chiron"]);
            assert_eq!(result.chart.julian_day_ut, result.civil.jd_ut1);
            assert_eq!(result.chart.julian_day_ut, result.epoch.jd_ut1);
            assert_eq!(result.civil.uncertainty_seconds, 60.0);
            assert_eq!(result.epoch.uncertainty_seconds, 2.0);
            assert_eq!(result.delta_t_source, "synthetic");
            assert_eq!(result.chart.bodies.iter().filter(|b| b.ephemeris_source == "lunar_model").count(), 4);
            assert!(result.chart.bodies.iter().all(|b| b.longitude_deg.is_finite() && b.right_ascension_deg.is_finite()));
            assert!(matches!(result.sunrise, HistoricalSolarEvent::Computed(Some(_))));
            assert!(matches!(result.sunset, HistoricalSolarEvent::Computed(Some(_))));
        }
        let polar = Site {latitude_deg: 80.0, ..site};
        let civil = HistoricalCivilInput {
            local: CalendarDateTime {year: 2000, month: 3, day: 20, hour: 0, minute: 0, second: 0.0, scale: TimeScale::Ut1},
            calendar: Calendar::ProlepticGregorian,
            offset: HistoricalOffset::Supplied {seconds_east: 0.0, source: "test"},
            uncertainty_seconds: 0.0,
        };
        let result = engine.historical_chart(civil, 69.0, 2.0, "synthetic", &polar, None).unwrap();
        assert!(result.chart.unavailable_house_systems.contains(&"placido"));
        assert!(matches!(result.sunrise, HistoricalSolarEvent::NotRequested));
        assert!(engine.historical_chart(civil, 69.0, -1.0, "synthetic", &site, None).is_err());
    }
}
