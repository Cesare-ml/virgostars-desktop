//! Read-only observer-sky geometry for the VirgoStars 3D renderer.
//! All astronomical coordinates come from the canonical EphemerisProvider. This
//! host transforms apparent geocentric equatorial vectors into unrefracted
//! topocentric horizontal vectors; the WebView never computes ephemerides.
use serde::Serialize;
use crate::chart_calculation::{self, ChartRequestV1};

const AU_KM: f64 = 149_597_870.7;
const EARTH_EQUATORIAL_RADIUS_KM: f64 = 6_378.137;
const WGS84_FLATTENING: f64 = 1.0 / 298.257_223_563;
const PHYSICAL_BODIES: [&str; 11] = [
    "Sun", "Moon", "Mercury", "Venus", "Mars", "Jupiter", "Saturn",
    "Uranus", "Neptune", "Pluto", "Chiron",
];

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HorizontalObject {
    pub id: String,
    pub altitude_deg: f64,
    /// Zero is true North, increasing clockwise through East.
    pub azimuth_north_east_deg: f64,
    pub magnitude: Option<f64>,
    pub approximate: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkyDomeV1 {
    pub protocol_version: u8,
    pub status: &'static str,
    /// Only computed from the named ephemeris provider. No synthetic fallback.
    pub provider_id: Option<String>,
    pub planets: Vec<HorizontalObject>,
    pub stars: Vec<HorizontalObject>,
}

/// Vector conversion with an oblate Earth and observer at sea level. RA and
/// declination must be apparent true-equator-of-date coordinates, and ARMC
/// the true local sidereal angle of the same instant.
/// The local frame is East, North, Up; altitude is geometric (no refraction).
fn topocentric_horizontal(
    ra_deg: f64, dec_deg: f64, distance_au: f64,
    armc_deg: f64, latitude_deg: f64,
) -> Option<(f64, f64)> {
    if ![ra_deg,dec_deg,distance_au,armc_deg,latitude_deg].iter().all(|v| v.is_finite())
        || distance_au <= 0.0 || latitude_deg.abs() > 90.0 || dec_deg.abs() > 90.0 {
        return None;
    }
    let lat = latitude_deg.to_radians();
    let dec = dec_deg.to_radians();
    let hour_angle = (armc_deg - ra_deg).to_radians();
    let geocentric_lat = ((1.0 - WGS84_FLATTENING) * lat.tan()).atan();
    // At the poles avoid tan(+/-90 deg) becoming a source of NaN.
    let u = if latitude_deg == 90.0 {std::f64::consts::FRAC_PI_2}
        else if latitude_deg == -90.0 {-std::f64::consts::FRAC_PI_2}
        else {geocentric_lat};
    let rho_cos = u.cos();
    let rho_sin = (1.0 - WGS84_FLATTENING) * u.sin();
    let r = EARTH_EQUATORIAL_RADIUS_KM / AU_KM;
    // H measures westward from the observer's true meridian.
    let x = distance_au * dec.cos() * hour_angle.cos() - r * rho_cos;
    let y = distance_au * dec.cos() * hour_angle.sin();
    let z = distance_au * dec.sin() - r * rho_sin;
    let east = -y;
    let north = z * lat.cos() - x * lat.sin();
    let up = z * lat.sin() + x * lat.cos();
    let altitude = up.atan2(east.hypot(north)).to_degrees();
    let azimuth = east.atan2(north).to_degrees().rem_euclid(360.0);
    (altitude.is_finite() && azimuth.is_finite()).then_some((altitude,azimuth))
}

fn failure(status: &'static str) -> SkyDomeV1 {
    SkyDomeV1 { protocol_version:1, status, provider_id:None, planets:vec![], stars:vec![] }
}

pub fn respond(
    provider:Option<&dyn chart_calculation::EphemerisProvider>,
    mut request:ChartRequestV1
) -> SkyDomeV1 {
    // The same validated chart command is the single source of planet and
    // fixed-star positions. Expensive stars are loaded only for an open dome.
    request.include_fixed_stars = true;
    request.include_previous_new_moon = false;
    request.include_solar_events = false;
    let calculated = chart_calculation::respond(provider,&request);
    if calculated.status != "ok" { return failure(calculated.status); }
    let Some(chart) = calculated.chart else { return failure("calculation_failed"); };
    let Some(armc) = chart.houses.first().map(|h|h.armc_deg) else {
        // No longitude of the local meridian was provided; never invent one.
        return failure("calculation_failed");
    };
    let latitude = f64::from(request.lat_micro) / 1e6;
    let mut planets = Vec::new();
    for body in chart.bodies {
        if !PHYSICAL_BODIES.contains(&body.id) { continue; }
        if let Some((alt,az))=topocentric_horizontal(
            body.right_ascension_deg,body.declination_deg,body.distance_au,armc,latitude
        ) {
            planets.push(HorizontalObject {
                id:body.id.to_string(),altitude_deg:alt,azimuth_north_east_deg:az,
                magnitude:None,approximate:false,
            });
        }
    }
    if !planets.iter().any(|p|p.id=="Sun") || !planets.iter().any(|p|p.id=="Moon") {
        return failure("calculation_failed");
    }
    let stars = calculated.fixed_stars.unwrap_or_default().into_iter().map(|s|
        HorizontalObject {
            id:s.name,altitude_deg:s.true_altitude_deg,
            azimuth_north_east_deg:(s.azimuth_south_west_deg+180.0).rem_euclid(360.0),
            magnitude:s.magnitude,approximate:s.approximate
        }
    ).collect();
    SkyDomeV1 {
        protocol_version:1,status:"ok",
        provider_id:calculated.provider.map(|p|p.id.to_string()),
        planets,stars,
    }
}

#[tauri::command]
pub fn calculate_sky_dome(request:ChartRequestV1) -> SkyDomeV1 {
    respond(chart_calculation::active_provider(),request)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn horizontal(ra:f64,dec:f64,distance:f64,armc:f64,lat:f64)->(f64,f64) {
        topocentric_horizontal(ra,dec,distance,armc,lat).unwrap()
    }
    #[test]
    fn observer_azimuth_is_zero_north_ninety_east_and_zenith_above() {
        let (alt,_) = horizontal(0.0,0.0,1.0,0.0,0.0);
        assert!(alt > 89.0);
        let (_,east)=horizontal(90.0,0.0,1.0,0.0,0.0);
        assert!((east-90.0).abs() < 0.01);
        let (_,west)=horizontal(270.0,0.0,1.0,0.0,0.0);
        assert!((west-270.0).abs() < 0.01);
        let (_,north)=horizontal(0.0,90.0,1.0,0.0,0.0);
        assert!((north-0.0).abs() < 0.01);
    }
    #[test]
    fn lunar_horizon_parallax_is_real_and_is_not_clamped_to_horizon() {
        let (near,_) = horizontal(90.0,0.0,0.00257,0.0,0.0);
        let (far,_) = horizontal(90.0,0.0,1000.0,0.0,0.0);
        assert!(near < -0.8 && near > -1.1);
        assert!(far.abs() < 0.001);
    }
    #[test]
    fn missing_provider_does_not_produce_a_synthetic_sky() {
        let reply = respond(None, ChartRequestV1 {
            protocol_version:1, utc_iso:"2026-11-20T13:00:00Z".to_string(),
            lat_micro:45_000_000, lng_micro:9_000_000,
            include_solar_events:false,include_previous_new_moon:false,
            include_fixed_stars:false,
        });
        assert_eq!(reply.status,"provider_unavailable");
        assert!(reply.planets.is_empty() && reply.stars.is_empty());
    }
    #[test]
    fn invalid_vectors_do_not_produce_rendered_points() {
        assert!(topocentric_horizontal(0.0,0.0,0.0,0.0,0.0).is_none());
        assert!(topocentric_horizontal(f64::NAN,0.0,1.0,0.0,0.0).is_none());
        assert!(topocentric_horizontal(0.0,0.0,1.0,0.0,91.0).is_none());
    }
}
