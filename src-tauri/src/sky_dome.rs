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
    /// Estimated illuminated fraction from provider Sun/body geocentric vectors.
    /// Null for the Sun and for stars; not a photometric or eclipse model.
    pub illuminated_fraction: Option<f64>,
    /// Direction *from this physical body toward the Sun*, expressed in the
    /// observer's local horizontal basis for correct lighting in the 3D viewer.
    pub sunlight_direction: Option<SkyDirectionV1>,
    pub ecliptic_longitude_deg: Option<f64>,
    pub ecliptic_latitude_deg: Option<f64>,
    pub right_ascension_deg: Option<f64>,
    pub declination_deg: Option<f64>,
    /// Geocentric distance, not heliocentric orbital radius.
    pub distance_au: Option<f64>,
    pub longitude_speed_deg_per_day: Option<f64>,
    pub constellation: Option<String>,
    pub catalog_id: Option<u32>,
    pub ephemeris_source: Option<String>,
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

/// A didactic +/-8 degree ecliptic-latitude band, computed in the host
/// using the true obliquity of the observed instant. The band width is an
/// explicit UI convention, NOT an astronomical boundary or a house system.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all="camelCase")]
pub struct SkyZodiacGridV1 {
    pub north_edge: Vec<SkyDirectionV1>,
    pub south_edge: Vec<SkyDirectionV1>,
    pub sign_dividers: Vec<Vec<SkyDirectionV1>>,
    pub decade_ticks: Vec<Vec<SkyDirectionV1>>,
}

/// Ecliptic cusp intersections for ONE computed house system.
#[derive(Debug,Clone,Serialize,PartialEq)]
#[serde(rename_all="camelCase")]
pub struct SkyHouseGridV1 {
    pub id: &'static str,
    pub cusp_longitudes_deg: Vec<f64>,
    pub separators: Vec<Vec<SkyDirectionV1>>,
    pub labels: Vec<SkyDirectionV1>,
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
    pub zodiac_grid: Option<SkyZodiacGridV1>,
    pub angles: Vec<SkyAngleV1>,
    pub house_grids: Vec<SkyHouseGridV1>,
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

/// Convert apparent ecliptic-of-date coordinates to the matching apparent
/// equatorial frame. This only transforms the provider's existing direction:
/// it does not correct an approximate star catalogue or invent missing data.
fn ecliptic_to_equatorial(
    longitude_deg:f64,latitude_deg:f64,true_obliquity_deg:f64
)->Option<(f64,f64)> {
    if ![longitude_deg,latitude_deg,true_obliquity_deg].iter().all(|v|v.is_finite())
        || latitude_deg.abs()>90.0 || true_obliquity_deg <= 0.0 || true_obliquity_deg >= 90.0 {
        return None;
    }
    let longitude=longitude_deg.to_radians();
    let latitude=latitude_deg.to_radians();
    let obliquity=true_obliquity_deg.to_radians();
    let x=latitude.cos()*longitude.cos();
    let y=latitude.cos()*longitude.sin()*obliquity.cos()-latitude.sin()*obliquity.sin();
    let z=latitude.cos()*longitude.sin()*obliquity.sin()+latitude.sin()*obliquity.cos();
    let ra=circle_degrees(y.atan2(x).to_degrees());
    let dec=z.atan2(x.hypot(y)).to_degrees();
    (ra.is_finite()&&dec.is_finite()).then_some((ra,dec))
}

/// Tropical 0° is the true equinox of date. Zodiac intervals are measured
/// along the true ecliptic, never by dividing the horizon into twelve.
fn zodiac_latitude_direction(
    ecliptic_longitude_deg:f64, ecliptic_latitude_deg:f64,
    true_obliquity_deg:f64, armc_deg:f64, latitude_deg:f64,
) -> Option<SkyDirectionV1> {
    let (ra,dec)=ecliptic_to_equatorial(
        ecliptic_longitude_deg,ecliptic_latitude_deg,true_obliquity_deg
    )?;
    celestial_horizontal(ra,dec,armc_deg,latitude_deg)
}
fn zodiac_direction(
    ecliptic_longitude_deg:f64, true_obliquity_deg:f64,
    armc_deg:f64, latitude_deg:f64,
) -> Option<SkyDirectionV1> {
    zodiac_latitude_direction(ecliptic_longitude_deg,0.0,true_obliquity_deg,armc_deg,latitude_deg)
}

/// A wide, faint zodiac reference grid, not the physical boundaries of signs.
fn zodiac_grid(
    true_obliquity_deg:f64,armc_deg:f64,latitude_deg:f64,
) -> Option<SkyZodiacGridV1> {
    let mut north_edge=Vec::with_capacity(361);
    let mut south_edge=Vec::with_capacity(361);
    for degree in 0..=360 {
        north_edge.push(zodiac_latitude_direction(
            f64::from(degree),8.0,true_obliquity_deg,armc_deg,latitude_deg
        )?);
        south_edge.push(zodiac_latitude_direction(
            f64::from(degree),-8.0,true_obliquity_deg,armc_deg,latitude_deg
        )?);
    }
    let mut sign_dividers=Vec::with_capacity(12);
    for sign in 0..12 {
        let longitude=f64::from(sign*30);
        let mut line=Vec::with_capacity(9);
        for step in 0..=8 {
            line.push(zodiac_latitude_direction(
                longitude,f64::from(step*2)-8.0,true_obliquity_deg,armc_deg,latitude_deg
            )?);
        }
        sign_dividers.push(line);
    }
    let mut decade_ticks=Vec::with_capacity(24);
    for degree in (0..360).step_by(10) {
        if degree % 30 == 0 {continue;}
        let mut line=Vec::with_capacity(5);
        for beta in [-4.0_f64,-2.0,0.0,2.0,4.0] {
            line.push(zodiac_latitude_direction(
                f64::from(degree),beta,true_obliquity_deg,armc_deg,latitude_deg
            )?);
        }
        decade_ticks.push(line);
    }
    Some(SkyZodiacGridV1 {north_edge,south_edge,sign_dividers,decade_ticks})
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

/// Only the ecliptic intersections are represented. These lines MUST NOT be
/// described as full mundane house planes, which differ by house method.
fn house_grid(
    house:&chart_calculation::HouseSystemV1,
    true_obliquity_deg:f64,armc_deg:f64,latitude_deg:f64,
)-> Option<SkyHouseGridV1> {
    let mut separators=Vec::with_capacity(12);
    let mut labels=Vec::with_capacity(12);
    for index in 0..12 {
        let longitude=house.cusps_deg[index];
        if !longitude.is_finite() {return None;}
        let mut line=Vec::with_capacity(9);
        for step in 0..=8 {
            line.push(zodiac_latitude_direction(
                longitude,f64::from(step)*2.0-8.0,
                true_obliquity_deg,armc_deg,latitude_deg
            )?);
        }
        separators.push(line);
        let next=house.cusps_deg[(index+1)%12];
        if !next.is_finite(){return None;}
        let arc=(next-longitude).rem_euclid(360.0);
        if arc<0.001 || arc>=180.0{return None;}
        labels.push(zodiac_direction(longitude+arc/2.0,
            true_obliquity_deg,armc_deg,latitude_deg)?);
    }
    Some(SkyHouseGridV1 {
        id:house.id,cusp_longitudes_deg:house.cusps_deg.to_vec(),
        separators,labels
    })
}

/// Solar illumination from the actual apparent geocentric Sun/body vectors
/// and distances provided by the ephemeris. Never derived from chart labels.
fn geocentric_vector(body:&chart_calculation::BodyPositionV1)->Option<[f64;3]> {
    let [ra,dec,distance]=[
        body.right_ascension_deg,body.declination_deg,body.distance_au
    ];
    if ![ra,dec,distance].iter().all(|v|v.is_finite())
        || dec.abs()>90.0 || distance<=0.0 {return None;}
    let ra=ra.to_radians();
    let dec=dec.to_radians();
    Some([
        distance*dec.cos()*ra.cos(),
        distance*dec.cos()*ra.sin(),
        distance*dec.sin(),
    ])
}
/// Compute the fraction seen from Earth and the *body-to-Sun* direction in
/// equatorial xyz. A nonzero apparent Sun/body separation and distances are
/// required; this intentionally excludes eclipse/occultation photometry.
fn geometric_illumination(
    sun:&chart_calculation::BodyPositionV1,
    body:&chart_calculation::BodyPositionV1,
)->Option<(f64,[f64;3])> {
    let sun_xyz=geocentric_vector(sun)?;
    let body_xyz=geocentric_vector(body)?;
    let sunlight=[
        sun_xyz[0]-body_xyz[0],
        sun_xyz[1]-body_xyz[1],
        sun_xyz[2]-body_xyz[2],
    ];
    let earthward=[-body_xyz[0],-body_xyz[1],-body_xyz[2]];
    let sun_distance=sunlight.iter().map(|x|x*x).sum::<f64>().sqrt();
    let earth_distance=earthward.iter().map(|x|x*x).sum::<f64>().sqrt();
    if sun_distance<=0.0||earth_distance<=0.0||
        !sun_distance.is_finite()||!earth_distance.is_finite(){return None;}
    let dot=(0..3).map(|i|sunlight[i]*earthward[i]).sum::<f64>();
    let cosine=(dot/(sun_distance*earth_distance)).clamp(-1.0,1.0);
    let fraction=(1.0+cosine)*0.5;
    fraction.is_finite().then_some((fraction,sunlight))
}
fn body_sunlight(
    sun:&chart_calculation::BodyPositionV1,
    body:&chart_calculation::BodyPositionV1,
    armc_deg:f64,latitude_deg:f64,
)->Option<(f64,SkyDirectionV1)> {
    if body.id=="Sun" {return None;}
    let (fraction,v)=geometric_illumination(sun,body)?;
    let right_ascension=circle_degrees(v[1].atan2(v[0]).to_degrees());
    let declination=v[2].atan2(v[0].hypot(v[1])).to_degrees();
    let direction=celestial_horizontal(right_ascension,declination,armc_deg,latitude_deg)?;
    Some((fraction,direction))
}
#[cfg(test)]
fn lunar_illumination_fraction(
    sun:&chart_calculation::BodyPositionV1,
    moon:&chart_calculation::BodyPositionV1,
)->Option<f64> {
    geometric_illumination(sun,moon).map(|(fraction,_)|fraction)
}

fn failure(status: &'static str) -> SkyDomeV1 {
    SkyDomeV1 { protocol_version:1, status, provider_id:None, planets:vec![], stars:vec![], zodiac_segments:vec![], zodiac_grid:None, angles:vec![], house_grids:vec![] }
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
    let Some(zodiac_grid) = zodiac_grid(
        context.true_obliquity_deg,armc,latitude
    ) else {return failure("calculation_failed");};
    let house_grids=chart.houses.iter().filter_map(|system|
        house_grid(system,context.true_obliquity_deg,armc,latitude)
    ).collect();
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
    // Clone the provider's actual Sun position before consuming chart.bodies:
    // each globe uses its own body→Sun vector, not a single fixed light.
    let sun_body=chart.bodies.iter().find(|body|body.id=="Sun").cloned();
    let mut planets = Vec::new();
    for body in chart.bodies {
        if !PHYSICAL_BODIES.contains(&body.id) { continue; }
        if let Some((alt,az))=topocentric_horizontal(
            body.right_ascension_deg,body.declination_deg,body.distance_au,armc,latitude
        ) {
            let sunlight=sun_body.as_ref()
                .and_then(|sun|body_sunlight(sun,&body,armc,latitude));
            planets.push(HorizontalObject {
                id:body.id.to_string(),altitude_deg:alt,azimuth_north_east_deg:az,
                magnitude:None,approximate:false,
                illuminated_fraction:sunlight.map(|(fraction,_)|fraction),
                sunlight_direction:sunlight.map(|(_,direction)|direction),
                ecliptic_longitude_deg:Some(body.longitude_deg),
                ecliptic_latitude_deg:Some(body.latitude_deg),
                right_ascension_deg:Some(body.right_ascension_deg),
                declination_deg:Some(body.declination_deg),
                distance_au:Some(body.distance_au),
                longitude_speed_deg_per_day:Some(body.longitude_speed),
                constellation:None,catalog_id:None,
                ephemeris_source:Some(body.ephemeris_source.to_owned()),
            });
        }
    }
    if !planets.iter().any(|p|p.id=="Sun") || !planets.iter().any(|p|p.id=="Moon") {
        return failure("calculation_failed");
    }
    let stars = calculated.fixed_stars.unwrap_or_default().into_iter().map(|s| {
        let (star_ra,star_dec)=ecliptic_to_equatorial(
            s.longitude_deg,s.latitude_deg,context.true_obliquity_deg
        ).map_or((None,None),|(ra,dec)|(Some(ra),Some(dec)));
        HorizontalObject {
            id:s.name,altitude_deg:s.true_altitude_deg,
            azimuth_north_east_deg:(s.azimuth_south_west_deg+180.0).rem_euclid(360.0),
            magnitude:s.magnitude,approximate:s.approximate,
            illuminated_fraction:None,sunlight_direction:None,
            ecliptic_longitude_deg:Some(s.longitude_deg),
            ecliptic_latitude_deg:Some(s.latitude_deg),
            right_ascension_deg:star_ra,declination_deg:star_dec,
            distance_au:None,longitude_speed_deg_per_day:None,
            constellation:s.constellation,catalog_id:Some(s.id),
            ephemeris_source:None,
        }
    }).collect();
    SkyDomeV1 {
        protocol_version:1,status:"ok",
        provider_id:calculated.provider.map(|p|p.id.to_string()),
        planets,stars,zodiac_segments,zodiac_grid:Some(zodiac_grid),angles,house_grids,
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
    fn phase_body(
        id:&'static str,ra:f64,declination:f64,distance:f64
    )->chart_calculation::BodyPositionV1 {
        chart_calculation::BodyPositionV1 {
            id,
            longitude_deg:ra,
            latitude_deg:0.0,
            distance_au:distance,
            longitude_speed:0.0,
            latitude_speed:0.0,
            distance_speed:0.0,
            right_ascension_deg:ra,
            declination_deg:declination,
            ephemeris_source:"fixture",
        }
    }
    #[test]
    fn lunar_fraction_matches_new_full_and_quarter_geometry() {
        let sun=phase_body("Sun",0.0,0.0,1.0);
        let new_moon=phase_body("Moon",0.0,0.0,0.00257);
        let full_moon=phase_body("Moon",180.0,0.0,0.00257);
        let quarter=phase_body("Moon",90.0,0.0,0.00257);
        let first=lunar_illumination_fraction(&sun,&new_moon).unwrap();
        let full=lunar_illumination_fraction(&sun,&full_moon).unwrap();
        let quarter_fraction=lunar_illumination_fraction(&sun,&quarter).unwrap();
        assert!(first<1e-8);
        assert!(full>1.0-1e-8);
        assert!(quarter_fraction>0.49 && quarter_fraction<0.51);
        assert!(first<quarter_fraction && quarter_fraction<full);
    }
    #[test]
    fn venus_phases_depend_on_observer_relative_position_to_sun() {
        let sun=phase_body("Sun",0.0,0.0,1.0);
        // Inferior conjunction: Venus between Earth and Sun, dark facing us.
        let inferior=phase_body("Venus",0.0,0.0,0.4);
        let (dark,direction)=body_sunlight(&sun,&inferior,0.0,0.0).unwrap();
        assert!(dark<1e-10);
        assert!(direction.altitude_deg>89.999);
        // Superior conjunction: Venus behind Sun, bright facing us.
        let superior=phase_body("Venus",0.0,0.0,1.6);
        let (bright,direction)=body_sunlight(&sun,&superior,0.0,0.0).unwrap();
        assert!(bright>1.0-1e-10);
        assert!(direction.altitude_deg< -89.999);
        // Mercury at quadrature with plausible geocentric distance.
        let mercury=phase_body("Mercury",90.0,0.0,0.55);
        let (partial,_) = body_sunlight(&sun,&mercury,0.0,45.0).unwrap();
        assert!(partial>0.5&&partial<1.0);
        assert!(body_sunlight(&sun,&sun,0.0,0.0).is_none());
    }
    #[test]
    fn solar_light_direction_is_a_real_bounded_horizontal_direction() {
        let sun=phase_body("Sun",0.0,0.0,1.0);
        let mut mercury=phase_body("Mercury",60.0,10.0,0.5);
        for latitude in [-60.0,0.0,47.0,75.0] {
            let (fraction,direction)=body_sunlight(&sun,&mercury,130.0,latitude).unwrap();
            assert!((0.0..=1.0).contains(&fraction));
            assert!((-90.0..=90.0).contains(&direction.altitude_deg));
            assert!((0.0..360.0).contains(&direction.azimuth_north_east_deg));
        }
        mercury.distance_au=0.0;
        assert!(body_sunlight(&sun,&mercury,0.0,0.0).is_none());
        mercury.distance_au=0.5;
        assert!(body_sunlight(&sun,&mercury,0.0,f64::NAN).is_none());
    }
    #[test]
    fn lunar_fraction_rejects_invalid_distance_and_non_finite_angles() {
        let sun=phase_body("Sun",0.0,0.0,1.0);
        let moon=phase_body("Moon",30.0,0.0,0.00257);
        assert!(lunar_illumination_fraction(&sun,&moon).is_some());
        assert!(lunar_illumination_fraction(
            &phase_body("Sun",0.0,0.0,0.0),&moon
        ).is_none());
        assert!(lunar_illumination_fraction(
            &sun,&phase_body("Moon",f64::NAN,0.0,0.00257)
        ).is_none());
        assert!(lunar_illumination_fraction(
            &sun,&phase_body("Moon",45.0,91.0,0.00257)
        ).is_none());
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
        assert!(reply.planets.is_empty() && reply.stars.is_empty()
            && reply.zodiac_segments.is_empty() && reply.zodiac_grid.is_none()
            && reply.angles.is_empty() && reply.house_grids.is_empty());
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
    fn asc_desc_and_mc_ic_ecliptic_directions_are_antipodal() {
        let vec = |point:SkyDirectionV1| {
            let alt=point.altitude_deg.to_radians();
            let az=point.azimuth_north_east_deg.to_radians();
            [alt.cos()*az.sin(),alt.cos()*az.cos(),alt.sin()]
        };
        for longitude in [5.0_f64,42.0,160.0,299.0] {
            let a=vec(zodiac_direction(longitude,23.4392911,135.0,44.0).unwrap());
            let b=vec(zodiac_direction(longitude+180.0,23.4392911,135.0,44.0).unwrap());
            for i in 0..3 {assert!((a[i]+b[i]).abs() < 1e-9);}
        }
    }
    #[test]
    fn computed_house_cusps_are_projected_without_inventing_spatial_house_planes() {
        let system=chart_calculation::HouseSystemV1 {
            id:"egizia",
            cusps_deg:core::array::from_fn(|i| f64::from(i as u32)*30.0),
            ascendant_deg:15.0,mc_deg:285.0,armc_deg:275.0,vertex_deg:0.0,
        };
        let grid=house_grid(&system,23.4392911,155.0,44.0).unwrap();
        assert_eq!(grid.id,"egizia");
        assert_eq!(grid.cusp_longitudes_deg.len(),12);
        assert!(grid.separators.iter().all(|line|line.len()==9));
        assert_eq!(grid.labels.len(),12);
        let center=grid.separators[0][4];
        let expected=zodiac_direction(0.0,23.4392911,155.0,44.0).unwrap();
        assert!((center.altitude_deg-expected.altitude_deg).abs()<1e-9);
        let mut modified=system.clone();
        modified.id="porfirio";
        modified.cusps_deg[1]=35.0;
        let new_grid=house_grid(&modified,23.4392911,155.0,44.0).unwrap();
        assert_eq!(new_grid.id,"porfirio");
        assert_eq!(new_grid.cusp_longitudes_deg[1],35.0);
        assert_ne!(grid.separators[1][4].altitude_deg,new_grid.separators[1][4].altitude_deg);
        modified.cusps_deg[2]=f64::NAN;
        assert!(house_grid(&modified,23.4392911,155.0,44.0).is_none());
    }

    #[test]
    fn stellar_ecliptic_coordinates_yield_consistent_equatorial_coordinates() {
        // Equinox is RA 0°, dec 0° at zero longitude/latitude.
        let (ra,dec)=ecliptic_to_equatorial(0.0,0.0,23.4392911).unwrap();
        assert!(ra.abs()<1e-10 && dec.abs()<1e-10);
        // North solstitial point: RA 90°, declination equals obliquity.
        let (ra,dec)=ecliptic_to_equatorial(90.0,0.0,23.4392911).unwrap();
        assert!((ra-90.0).abs()<1e-10);
        assert!((dec-23.4392911).abs()<1e-10);
        assert!(ecliptic_to_equatorial(12.0,f64::NAN,23.4).is_none());
        assert!(ecliptic_to_equatorial(12.0,91.0,23.4).is_none());
        assert!(ecliptic_to_equatorial(12.0,45.0,0.0).is_none());
        assert!(ecliptic_to_equatorial(12.0,45.0,90.0).is_none());
    }
    #[test]
    fn zodiac_grid_is_twelve_signs_with_a_didactic_ecliptic_latitude_band() {
        let grid=zodiac_grid(23.4392911,125.0,45.0).unwrap();
        assert_eq!(grid.north_edge.len(),361);
        assert_eq!(grid.south_edge.len(),361);
        assert_eq!(grid.sign_dividers.len(),12);
        assert!(grid.sign_dividers.iter().all(|line|line.len()==9));
        assert_eq!(grid.decade_ticks.len(),24);
        assert!(grid.decade_ticks.iter().all(|line|line.len()==5));
        let equal_vec=|a:SkyDirectionV1,b:SkyDirectionV1|{
            let v=|p:SkyDirectionV1|{
                let alt=p.altitude_deg.to_radians();
                let az=p.azimuth_north_east_deg.to_radians();
                [alt.cos()*az.sin(),alt.cos()*az.cos(),alt.sin()]
            };
            let x=v(a);let y=v(b);
            (0..3).all(|i|(x[i]-y[i]).abs()<1e-10)
        };
        assert!(equal_vec(grid.north_edge[0],grid.north_edge[360]));
        assert!(equal_vec(grid.south_edge[0],grid.south_edge[360]));
        assert!(!equal_vec(grid.north_edge[90],grid.south_edge[90]));
        assert!(equal_vec(grid.sign_dividers[0][4],zodiac_direction(0.0,23.4392911,125.0,45.0).unwrap()));
        assert!(zodiac_grid(23.4,0.0,91.0).is_none());
        assert!(zodiac_grid(f64::NAN,0.0,45.0).is_none());
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
