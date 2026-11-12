//! Explicit opt-in DE441 JSON export experiment. Not wired into Tauri or Angular.
//! Requires a locally obtained classic DE441 file and the original Rust core.
//! Results are EXPERIMENTAL GEOMETRIC, not validated apparent positions.
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::env;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};
use virgostars_ephemeris_core::de441::{Body, De441};
use virgostars_ephemeris_core::first_sky::{
    calculate, CivilTimestamp, Observer, PlanetPosition, SkyApproximation, SkyPositions,
};

const MAX_SHA256_CHUNK: usize = 64 * 1024;
const BODIES: usize = 10;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PositionDto {
    body_id: &'static str,
    center_kind: &'static str,
    longitude_deg: f64,
    latitude_deg: f64,
    right_ascension_deg: f64,
    declination_deg: f64,
    altitude_deg: f64,
    azimuth_deg: Option<f64>,
    distance_km: f64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SkyDto<'a> {
    schema_version: u8,
    scientific_status: &'static str,
    provider: &'static str,
    source_format: &'static str,
    kernel_sha256: String,
    utc_iso: &'a str,
    lat_micro: i32,
    lng_micro: i32,
    height_meters: f64,
    observer_datum: &'static str,
    frame: &'static str,
    geometry: &'static str,
    tt_julian_day: f64,
    tdb_julian_day: f64,
    tai_minus_utc_seconds: i32,
    approximations: Vec<&'static str>,
    positions: Vec<PositionDto>,
}

fn body_id(body: Body) -> Option<(&'static str, &'static str)> {
    Some(match body {
        Body::Sun => ("sun", "body_center"),
        Body::Moon => ("moon", "body_center"),
        Body::Mercury => ("mercury", "body_center"),
        Body::Venus => ("venus", "body_center"),
        Body::MarsBarycenter => ("mars_barycenter", "system_barycenter"),
        Body::JupiterBarycenter => ("jupiter_barycenter", "system_barycenter"),
        Body::SaturnBarycenter => ("saturn_barycenter", "system_barycenter"),
        Body::UranusBarycenter => ("uranus_barycenter", "system_barycenter"),
        Body::NeptuneBarycenter => ("neptune_barycenter", "system_barycenter"),
        Body::PlutoBarycenter => ("pluto_barycenter", "system_barycenter"),
        _ => return None,
    })
}

fn approximation_id(approximation: SkyApproximation) -> &'static str {
    match approximation {
        SkyApproximation::Ut1EqualsUtc => "ut1_equals_utc",
        SkyApproximation::TruncatedTdbMinusTt => "truncated_tdb_minus_tt",
        SkyApproximation::NoNutation => "no_nutation",
        SkyApproximation::NoLightTime => "no_light_time",
        SkyApproximation::NoAberration => "no_aberration",
        SkyApproximation::NoGravitationalDeflection => "no_gravitational_deflection",
        SkyApproximation::NoPolarMotion => "no_polar_motion",
        SkyApproximation::NoAtmosphericRefraction => "no_atmospheric_refraction",
        SkyApproximation::OuterPlanetSystemBarycenters => "outer_planet_system_barycenters",
    }
}

fn map_position(p: PlanetPosition) -> Option<PositionDto> {
    let (body_id, center_kind) = body_id(p.body)?;
    Some(PositionDto {
        body_id,
        center_kind,
        longitude_deg: p.mean_ecliptic_longitude_deg,
        latitude_deg: p.mean_ecliptic_latitude_deg,
        right_ascension_deg: p.mean_right_ascension_deg,
        declination_deg: p.mean_declination_deg,
        altitude_deg: p.altitude_deg,
        azimuth_deg: p.azimuth_deg,
        distance_km: p.distance_km,
    })
}

fn sha256(file: &mut File) -> Result<String, &'static str> {
    let mut digest = Sha256::new();
    let mut buffer = [0u8; MAX_SHA256_CHUNK];
    loop {
        let count = file.read(&mut buffer).map_err(|_| "KERNEL_UNAVAILABLE")?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    let raw = digest.finalize();
    let mut out = String::with_capacity(64);
    for byte in raw {
        use std::fmt::Write as _;
        write!(out, "{byte:02x}").map_err(|_| "HASH_FAILED")?;
    }
    Ok(out)
}

// The input contract intentionally allows only canonical millisecond UTC.
// Calendar correctness and the IERS validity window are checked by the Rust core.
fn is_canonical_utc(s: &str) -> bool {
    if s.len() != 24 || !s.is_ascii() {
        return false;
    }
    s.bytes().enumerate().all(|(i, c)| match i {
        4 | 7 => c == b'-',
        10 => c == b'T',
        13 | 16 => c == b':',
        19 => c == b'.',
        23 => c == b'Z',
        _ => c.is_ascii_digit(),
    })
}

fn supported_utc_window(utc: &str) -> bool {
    is_canonical_utc(utc)
        && utc >= "1972-01-01T00:00:00.000Z"
        && utc < "2027-06-28T00:00:00.000Z"
}

fn dto_from_sky<'a>(
    sky: SkyPositions,
    utc_iso: &'a str,
    lat_micro: i32,
    lng_micro: i32,
    height_meters: f64,
    kernel_sha256: String,
) -> Result<SkyDto<'a>, &'static str> {
    if sky.positions.len() != BODIES {
        return Err("UNSUPPORTED_BODIES");
    }
    let positions: Vec<PositionDto> = sky
        .positions
        .into_iter()
        .map(map_position)
        .collect::<Option<_>>()
        .ok_or("UNSUPPORTED_BODIES")?;
    let approximations = sky
        .approximations
        .iter()
        .copied()
        .map(approximation_id)
        .collect();
    Ok(SkyDto {
        schema_version: 1,
        scientific_status: "experimental_unverified",
        provider: "VirgoStars-Ephemeris",
        source_format: "DE441_classic_binary",
        kernel_sha256,
        utc_iso,
        lat_micro,
        lng_micro,
        height_meters,
        observer_datum: "WGS84",
        frame: "mean_ecliptic_and_equatorial_of_date",
        geometry: "topocentric_geometric",
        tt_julian_day: sky.tt_julian_day,
        tdb_julian_day: sky.tdb_julian_day,
        tai_minus_utc_seconds: sky.tai_minus_utc_seconds,
        approximations,
        positions,
    })
}

fn run() -> Result<(), &'static str> {
    let args: Vec<String> = env::args().skip(1).collect();
    if args.len() != 5 {
        return Err("USAGE: <external-DE441-file> <UTC-ISO-ms> <latMicro> <lngMicro> <heightMeters>");
    }
    let [path, utc, latitude, longitude, height] = &args[..] else {
        return Err("INVALID_ARGUMENTS");
    };
    if !is_canonical_utc(utc) {
        return Err("UTC_INVALID");
    }
    if !supported_utc_window(utc) {
        return Err("UTC_UNSUPPORTED");
    }
    let lat_micro: i32 = latitude.parse().map_err(|_| "LATITUDE_INVALID")?;
    let lng_micro: i32 = longitude.parse().map_err(|_| "LONGITUDE_INVALID")?;
    let height_meters: f64 = height.parse().map_err(|_| "HEIGHT_INVALID")?;
    if i64::from(lat_micro).abs() > 90_000_000
        || i64::from(lng_micro).abs() > 180_000_000
        || !height_meters.is_finite()
        || !(-12_000.0..=100_000.0).contains(&height_meters)
    {
        return Err("OBSERVER_INVALID");
    }
    // Check the modeled UTC date before touching the large external kernel.
    let civil = CivilTimestamp::parse(utc).map_err(|_| "UTC_UNSUPPORTED")?;
    let observer = Observer {
        latitude_deg: f64::from(lat_micro) / 1_000_000.0,
        longitude_deg_east: f64::from(lng_micro) / 1_000_000.0,
        height_m: height_meters,
    };
    // Open a SINGLE file handle, hash exactly that handle, seek and decode it.
    // Production Desktop must cache integrity metadata, not hash gigabytes per tick.
    let mut file = File::open(path).map_err(|_| "KERNEL_UNAVAILABLE")?;
    let digest = sha256(&mut file)?;
    file.seek(SeekFrom::Start(0)).map_err(|_| "KERNEL_UNAVAILABLE")?;
    let mut kernel = De441::new(&mut file).map_err(|_| "KERNEL_INVALID_OR_UNAVAILABLE")?;
    let sky = calculate(&mut kernel, civil, observer).map_err(|_| "SKY_UNAVAILABLE")?;
    let out = dto_from_sky(sky, utc, lat_micro, lng_micro, height_meters, digest)?;
    serde_json::to_writer(std::io::stdout().lock(), &out).map_err(|_| "JSON_FAILED")?;
    std::io::stdout().write_all(b"\n").map_err(|_| "JSON_FAILED")?;
    Ok(())
}

fn main() {
    if let Err(code) = run() {
        // Never log a private file path, kernel metadata, or birth information.
        eprintln!("DE441_BRIDGE_ERROR:{code}");
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_utc_is_strict() {
        assert!(is_canonical_utc("2026-11-12T17:01:02.000Z"));
        assert!(!is_canonical_utc("2026-11-12T17:01:02+01:00"));
        assert!(!is_canonical_utc("2026-11-12T17:01:02Z"));
        assert!(!is_canonical_utc("2026-11-12T17:01:02.000Z\n"));
    }

    #[test]
    fn supported_utc_window_excludes_expired_iers_data() {
        assert!(supported_utc_window("1972-01-01T00:00:00.000Z"));
        assert!(supported_utc_window("2027-06-27T23:59:59.999Z"));
        assert!(!supported_utc_window("1971-12-31T23:59:59.999Z"));
        assert!(!supported_utc_window("2027-06-28T00:00:00.000Z"));
    }

    #[test]
    fn all_supported_bodies_have_explicit_center_types() {
        for body in [Body::Sun, Body::Moon, Body::Mercury, Body::Venus] {
            assert_eq!(body_id(body).unwrap().1, "body_center");
        }
        for body in [
            Body::MarsBarycenter, Body::JupiterBarycenter, Body::SaturnBarycenter,
            Body::UranusBarycenter, Body::NeptuneBarycenter, Body::PlutoBarycenter,
        ] {
            assert_eq!(body_id(body).unwrap().1, "system_barycenter");
        }
        assert_eq!(body_id(Body::Earth), None);
    }

    #[test]
    fn mapping_discloses_the_full_approximation_inventory() {
        let descriptions: Vec<_> = virgostars_ephemeris_core::first_sky::MODEL_APPROXIMATIONS
            .iter().copied().map(approximation_id).collect();
        assert_eq!(descriptions.len(), 9);
        assert!(descriptions.contains(&"no_light_time"));
        assert!(descriptions.contains(&"outer_planet_system_barycenters"));
    }
}
