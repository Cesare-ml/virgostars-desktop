//! Read-only observer-sky geometry for the VirgoStars 3D renderer.
//! All astronomical coordinates come from the canonical EphemerisProvider. This
//! host transforms apparent geocentric equatorial vectors into unrefracted
//! topocentric horizontal vectors; the WebView never computes ephemerides.
use serde::Serialize;
use crate::chart_calculation::{self, ChartRequestV1};

const AU_KM: f64 = 149_597_870.7;
const EARTH_EQUATORIAL_RADIUS_KM: f64 = 6_378.137;
const WGS84_FLATTENING: f64 = 1.0 / 298.257_223_563;
fn circle_degrees(value:f64)->f64 {
    let result=value.rem_euclid(360.0);
    if result >= 360.0 {0.0} else {result}
}
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

/// A geometric direction on the observer's sphere, not a physical body.
#[derive(Debug, Clone, Copy, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkyDirectionV1 {
    pub altitude_deg: f64,
    pub azimuth_north_east_deg: f64,
}

/// A 30-degree tropical zodiac arc projected using the true obliquity of date.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkyZodiacSegmentV1 {
    pub sign_index: u8,
    pub points: Vec<SkyDirectionV1>,
    pub label: SkyDirectionV1,
}

/// The calculated ecliptic intersection directions at the four chart angles.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkyAngleV1 {
    pub id: &'static str,
    pub zodiac_longitude_deg: f64,
    pub position: SkyDirectionV1,
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
    pub zodiac_segments: Vec<SkyZodiacSegmentV1>,
    pub angles: Vec<SkyAngleV1>,
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
    let azimuth = circle_degrees(east.atan2(north).to_degrees());
    (altitude.is_finite() && azimuth.is_finite()).then_some((altitude,azimuth))
}

/// An infinitely distant direction, expressed in true-equator-of-date
/// coordinates, transformed into the observer's geometric horizon.
fn celestial_horizontal(
    ra_deg: f64, dec_deg: f64, armc_deg: f64, latitude_deg: f64,
) -> Option<SkyDirectionV1> {
    if ![ra_deg, dec_deg, armc_deg, latitude_deg].iter().all(|x| x.is_finite())
        || dec_deg.abs() > 90.0 || latitude_deg.abs() > 90.0 { return None; }
    let h = (armc_deg - ra_deg).to_radians();
    let dec = dec_deg.to_radians();
    let lat = latitude_deg.to_radians();
    let east = -dec.cos() * h.sin();
    let north = dec.sin() * lat.cos() - dec.cos() * h.cos() * lat.sin();
    let up = dec.sin() * lat.sin() + dec.cos() * h.cos() * lat.cos();
    let altitude = up.atan2(east.hypot(north)).to_degrees();
    let azimuth = circle_degrees(east.atan2(north).to_degrees());
    (altitude.is_finite() && azimuth.is_finite()).then_some(SkyDirectionV1 {
        altitude_deg:altitude, azimuth_north_east_deg:azimuth,
    })
}

/// Tropical 0° is the true equinox of date. Zodiac intervals are measured
/// along the true ecliptic, never by dividing the horizon into twelve.
fn zodiac_direction(
    ecliptic_longitude_deg:f64, true_obliquity_deg:f64,
    armc_deg:f64, latitude_deg:f64,
) -> Option<SkyDirectionV1> {
    if !ecliptic_longitude_deg.is_finite() || !true_obliquity_deg.is_finite()
        || !(0.0..90.0).contains(&true_obliquity_deg) { return None; }
    let longitude = ecliptic_longitude_deg.to_radians();
    let obliquity = true_obliquity_deg.to_radians();
    let x = longitude.cos();
    let y = longitude.sin() * obliquity.cos();
    let z = longitude.sin() * obliquity.sin();
    let ra = circle_degrees(y.atan2(x).to_degrees());
    let dec = z.atan2(x.hypot(y)).to_degrees();
    celestial_horizontal(ra,dec,armc_deg,latitude_deg)
}

fn zodiac_segments(
    true_obliquity_deg:f64, armc_deg:f64, latitude_deg:f64,
) -> Option<Vec<SkyZodiacSegmentV1>> {
    let mut output = Vec::with_capacity(12);
    for sign_index in 0_u8..12 {
        let start = f64::from(sign_index) * 30.0;
        let mut points = Vec::with_capacity(31);
        for degree in 0..=30 {
            points.push(zodiac_direction(
                start + f64::from(degree),true_obliquity_deg,armc_deg,latitude_deg
            )?);
        }
        let label = zodiac_direction(start+15.0,true_obliquity_deg,armc_deg,latitude_deg)?;
        output.push(SkyZodiacSegmentV1 {sign_index,points,label});
    }
    Some(output)
}

fn failure(status: &'static str) -> SkyDomeV1 {
    SkyDomeV1 { protocol_version:1, status, provider_id:None, planets:vec![], stars:vec![], zodiac_segments:vec![], angles:vec![] }
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
    let Some(house) = chart.houses.first() else {
        // No local meridian or chart axes: never invent one.
        return failure("calculation_failed");
    };
    let armc = house.armc_deg;
    let latitude = f64::from(request.lat_micro) / 1e6;
    let Some(ref context) = chart.house_angle_context else {
        return failure("calculation_failed");
    };
    let Some(zodiac_segments) = zodiac_segments(
        context.true_obliquity_deg, armc, latitude
    ) else { return failure("calculation_failed"); };
    let mut angles = Vec::with_capacity(4);
    for (id,longitude) in [
        ("ASC",house.ascendant_deg),
        ("DSC",(house.ascendant_deg+180.0).rem_euclid(360.0)),
        ("MC",house.mc_deg),
        ("IC",(house.mc_deg+180.0).rem_euclid(360.0)),
    ] {
        if !longitude.is_finite() { return failure("calculation_failed"); }
        let longitude = circle_degrees(longitude);
        let Some(position)=zodiac_direction(
            longitude,context.true_obliquity_deg,armc,latitude
        ) else {return failure("calculation_failed");};
        angles.push(SkyAngleV1 {id,zodiac_longitude_deg:longitude,position});
    }
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
        planets,stars,zodiac_segments,angles,
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
        assert!(reply.planets.is_empty() && reply.stars.is_empty() && reply.zodiac_segments.is_empty() && reply.angles.is_empty());
    }
    #[test]
    fn zodiac_is_twelve_contiguous_real_ecliptic_arcs() {
        let zodiac = zodiac_segments(23.4392911, 0.0, 0.0).unwrap();
        assert_eq!(zodiac.len(), 12);
        assert!(zodiac.iter().enumerate().all(|(i,sign)|
            usize::from(sign.sign_index) == i && sign.points.len() == 31
        ));
        // Aries 0° is the zenith at the equator, at sidereal angle zero.
        assert!((zodiac[0].points[0].altitude_deg-90.0).abs() < 1e-9);
        // Cancer 0° has declination +obliquity and lies on this horizon.
        let northern_solstice = zodiac[3].points[0];
        assert!(northern_solstice.altitude_deg.abs() < 1e-8);
        assert!((northern_solstice.azimuth_north_east_deg - (90.0-23.4392911)).abs() < 1e-8);
        // At the zenith azimuth itself is undefined: compare 3D unit vectors.
        let vec = |p:SkyDirectionV1| {
            let a=p.altitude_deg.to_radians();
            let z=p.azimuth_north_east_deg.to_radians();
            [a.cos()*z.sin(),a.cos()*z.cos(),a.sin()]
        };
        for i in 0..12 {
            let end = vec(zodiac[i].points[30]);
            let next = vec(zodiac[(i+1)%12].points[0]);
            for j in 0..3 {assert!((end[j]-next[j]).abs() < 1e-8);}
        }
    }
    #[test]
    fn zodiac_accounts_for_hemisphere_and_rejects_untrusted_angles() {
        let north = zodiac_direction(90.0,23.4392911,0.0,45.0).unwrap();
        let south = zodiac_direction(90.0,23.4392911,0.0,-45.0).unwrap();
        assert!((north.altitude_deg-south.altitude_deg).abs() > 30.0);
        assert!(zodiac_direction(10.0,f64::NAN,0.0,0.0).is_none());
        assert!(zodiac_segments(23.439,f64::NAN,0.0).is_none());
        assert!(zodiac_segments(23.439,0.0,91.0).is_none());
    }
    #[test]
    fn invalid_vectors_do_not_produce_rendered_points() {
        assert!(topocentric_horizontal(0.0,0.0,0.0,0.0,0.0).is_none());
        assert!(topocentric_horizontal(f64::NAN,0.0,1.0,0.0,0.0).is_none());
        assert!(topocentric_horizontal(0.0,0.0,1.0,0.0,91.0).is_none());
    }
}
