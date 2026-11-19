//! The five house systems of the desktop, from explicit angles.
//!
//! The geometry is a port of the validated routines in `astrological-functions`
//! (`vehlow-houses`, `porphyry-houses`, `regiomontanus-houses`, `koch-houses`,
//! `placidus-houses`), which take the Ascendant, the Midheaven, the ARMC, the true
//! obliquity and the latitude from the ephemeris. They are astrological methods and
//! belong in that library; they live here only because the desktop has no Rust
//! binding to it yet, and they should move there. Nothing here is astronomy: the
//! angles come from `virgostars-ephemeris-core::house_angles`.
//!
//! A system that is undefined for the place (Placidus and Koch at and beyond the
//! polar circle, degenerate quadrants) answers `None`: it is reported as unavailable,
//! never replaced by another system.
use std::f64::consts::PI;

const RAD: f64 = PI / 180.0;

fn normalize(degrees: f64) -> f64 {
    let wrapped = degrees.rem_euclid(360.0);
    if wrapped >= 360.0 { 0.0 } else { wrapped }
}

/// The angles every system starts from, in degrees of the true ecliptic of date.
#[derive(Debug, Clone, Copy)]
pub struct HouseAngles {
    pub armc_deg: f64,
    pub true_obliquity_deg: f64,
    pub latitude_deg: f64,
    pub ascendant_deg: f64,
    pub midheaven_deg: f64,
}

/// The twelve cusps of `system` (`egizia`, `placido`, `koch`, `regio-montano`, `porfirio`).
pub fn cusps(system: &str, angles: &HouseAngles) -> Option<[f64; 12]> {
    let all_finite = [angles.armc_deg, angles.true_obliquity_deg, angles.latitude_deg, angles.ascendant_deg, angles.midheaven_deg]
        .iter()
        .all(|value| value.is_finite());
    if !all_finite || angles.true_obliquity_deg <= 0.0 || angles.true_obliquity_deg >= 90.0 || angles.latitude_deg.abs() >= 90.0 {
        return None;
    }
    let result = match system {
        "egizia" => Some(vehlow(angles)),
        "porfirio" => porphyry(angles),
        "regio-montano" => regiomontanus(angles),
        "koch" => koch(angles),
        "placido" => placidus(angles),
        _ => None,
    }?;
    result.iter().all(|value| value.is_finite()).then_some(result)
}

/// Equal houses of 30 degrees with the Ascendant in the middle of house 1.
fn vehlow(angles: &HouseAngles) -> [f64; 12] {
    core::array::from_fn(|index| normalize(angles.ascendant_deg - 15.0 + 30.0 * index as f64))
}

/// Each quadrant between two angles is divided into three equal ecliptic arcs.
fn porphyry(angles: &HouseAngles) -> Option<[f64; 12]> {
    let asc = normalize(angles.ascendant_deg);
    let mc = normalize(angles.midheaven_deg);
    let axes = [asc, normalize(mc + 180.0), normalize(asc + 180.0), mc];
    let arcs: [f64; 4] = core::array::from_fn(|quadrant| normalize(axes[(quadrant + 1) % 4] - axes[quadrant]));
    // Polar or inverted geometry: the quadrants must be four forward arcs.
    if arcs.iter().any(|arc| *arc <= 1e-9 || *arc >= 180.0 - 1e-9) {
        return None;
    }
    Some(core::array::from_fn(|index| {
        let (quadrant, step) = (index / 3, index % 3);
        normalize(axes[quadrant] + arcs[quadrant] * step as f64 / 3.0)
    }))
}

/// The twelve cusps from the four angles and the four intermediate cusps of one quadrant.
fn assemble(angles: &HouseAngles, c11: f64, c12: f64, c2: f64, c3: f64) -> [f64; 12] {
    let asc = normalize(angles.ascendant_deg);
    let mc = normalize(angles.midheaven_deg);
    let opposite = |value: f64| normalize(value + 180.0);
    [asc, c2, c3, opposite(mc), opposite(c11), opposite(c12), opposite(asc), opposite(c2), opposite(c3), mc, c11, c12]
}

/// Intersection of a house circle through the horizon poles with the ecliptic.
fn intersection(sidereal_deg: f64, pole: f64, obliquity: f64) -> Option<f64> {
    let angle = sidereal_deg * RAD;
    let x = obliquity.sin() * pole.tan() + obliquity.cos() * angle.sin();
    let y = -angle.cos();
    (x.hypot(y) >= 1e-14).then(|| normalize(y.atan2(x) / RAD + 180.0))
}

fn regiomontanus(angles: &HouseAngles) -> Option<[f64; 12]> {
    let theta = normalize(angles.armc_deg);
    let latitude = angles.latitude_deg * RAD;
    let obliquity = angles.true_obliquity_deg * RAD;
    let pole11 = (latitude.tan() / 2.0).atan();
    let pole12 = (latitude.tan() * 3.0_f64.sqrt() / 2.0).atan();
    let c11 = intersection(theta - 60.0, pole11, obliquity)?;
    let c12 = intersection(theta - 30.0, pole12, obliquity)?;
    let c2 = intersection(theta + 30.0, pole12, obliquity)?;
    let c3 = intersection(theta + 60.0, pole11, obliquity)?;
    Some(assemble(angles, c11, c12, c2, c3))
}

/// The arc the Midheaven describes between rising and culminating is divided into thirds.
fn koch(angles: &HouseAngles) -> Option<[f64; 12]> {
    let theta = normalize(angles.armc_deg);
    let latitude = angles.latitude_deg * RAD;
    let obliquity = angles.true_obliquity_deg * RAD;
    let declination = (obliquity.sin() * (normalize(angles.midheaven_deg) * RAD).sin()).asin();
    let cos_hour = -latitude.tan() * declination.tan();
    if cos_hour <= -1.0 || cos_hour >= 1.0 {
        return None;
    }
    let semi_arc = cos_hour.acos() / RAD;
    let ascendant_at = |angle: f64| -> Option<f64> {
        let t = angle * RAD;
        let x = obliquity.sin() * latitude.tan() + obliquity.cos() * t.sin();
        let y = -t.cos();
        (x.hypot(y) >= 1e-14).then(|| normalize(y.atan2(x) / RAD + 180.0))
    };
    let c11 = ascendant_at(theta - 2.0 * semi_arc / 3.0)?;
    let c12 = ascendant_at(theta - semi_arc / 3.0)?;
    let c2 = ascendant_at(theta + semi_arc / 3.0)?;
    let c3 = ascendant_at(theta + 2.0 * semi_arc / 3.0)?;
    Some(assemble(angles, c11, c12, c2, c3))
}

/// Semi-arc division: the diurnal and nocturnal arcs of each point of the ecliptic in thirds.
fn placidus(angles: &HouseAngles) -> Option<[f64; 12]> {
    let latitude = angles.latitude_deg * RAD;
    let obliquity = angles.true_obliquity_deg * RAD;
    if (latitude.tan() * obliquity.tan()).abs() >= 1.0 {
        return None;
    }
    let theta = normalize(angles.armc_deg);
    // Right-ascension offset from the meridian and the semi-arc of an ecliptic longitude.
    let sample = |longitude: f64| -> Option<(f64, f64)> {
        let lambda = longitude * RAD;
        let alpha = normalize((lambda.sin() * obliquity.cos()).atan2(lambda.cos()) / RAD);
        let mut offset = normalize(alpha - theta);
        if offset > 360.0 - 1e-9 {
            offset = 0.0;
        }
        let declination = (obliquity.sin() * lambda.sin()).asin();
        let value = -latitude.tan() * declination.tan();
        (-1.0..=1.0).contains(&value).then(|| (offset, value.acos() / RAD))
    };
    let asc = normalize(angles.ascendant_deg);
    let mc = normalize(angles.midheaven_deg);
    let ic = normalize(mc + 180.0);
    let solve = |start: f64, end: f64, target: &dyn Fn(f64) -> f64| -> Option<f64> {
        let residual = |longitude: f64| sample(longitude).map(|(offset, semi_arc)| offset - target(semi_arc));
        let (mut lo, mut hi) = (start, start + normalize(end - start));
        let (mut left, mut right) = (residual(lo)?, residual(hi)?);
        if left > 1e-8 || right < -1e-8 {
            return None;
        }
        for _ in 0..64 {
            let mid = (lo + hi) / 2.0;
            let value = residual(mid)?;
            if value < 0.0 {
                lo = mid;
                left = value;
            } else {
                hi = mid;
                right = value;
            }
            if hi - lo < 1e-11 {
                break;
            }
        }
        (left.is_finite() && right.is_finite() && hi - lo < 1e-8).then(|| normalize((lo + hi) / 2.0))
    };
    let c11 = solve(mc, asc, &|h| h / 3.0)?;
    let c12 = solve(mc, asc, &|h| 2.0 * h / 3.0)?;
    let c2 = solve(asc, ic, &|h| 60.0 + 2.0 * h / 3.0)?;
    let c3 = solve(asc, ic, &|h| 120.0 + h / 3.0)?;
    Some(assemble(angles, c11, c12, c2, c3))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Ascendant and Midheaven for an ARMC, true obliquity and latitude (the standard formulas),
    /// so a test can build consistent inputs without an ephemeris.
    fn angles(armc: f64, obliquity: f64, latitude: f64) -> HouseAngles {
        let (theta, eps, phi) = (armc * RAD, obliquity * RAD, latitude * RAD);
        let mc = normalize((theta.sin()).atan2(theta.cos() * eps.cos()) / RAD);
        let x = eps.sin() * phi.tan() + eps.cos() * theta.sin();
        let y = -theta.cos();
        HouseAngles {
            armc_deg: armc,
            true_obliquity_deg: obliquity,
            latitude_deg: latitude,
            ascendant_deg: normalize(y.atan2(x) / RAD + 180.0),
            midheaven_deg: mc,
        }
    }

    const SYSTEMS: [&str; 5] = ["egizia", "placido", "koch", "regio-montano", "porfirio"];

    fn forward_revolution(cusps: &[f64; 12]) -> bool {
        let steps: f64 = (0..12).map(|index| normalize(cusps[(index + 1) % 12] - cusps[index])).sum();
        (steps - 360.0).abs() < 1e-9 && (0..12).all(|index| normalize(cusps[(index + 1) % 12] - cusps[index]) > 0.0)
    }

    #[test]
    fn test_every_system_gives_twelve_forward_cusps_with_the_angles_on_the_right_ones() {
        for (armc, latitude) in [(100.0, 45.0), (10.0, 41.9), (250.0, -33.9), (0.0, 0.5), (359.0, 60.0), (180.0, 66.0)] {
            let a = angles(armc, 23.4392911, latitude);
            for system in SYSTEMS {
                let cusps = cusps(system, &a).unwrap_or_else(|| panic!("{system} at {latitude} unavailable"));
                assert!(forward_revolution(&cusps), "{system} armc {armc} lat {latitude}: {cusps:?}");
                if system == "egizia" {
                    // The Ascendant is the middle of house 1.
                    assert!((normalize(cusps[0] + 15.0 - a.ascendant_deg)).min(normalize(a.ascendant_deg - cusps[0] - 15.0)) < 1e-9);
                } else {
                    assert!((cusps[0] - a.ascendant_deg).abs() < 1e-9, "{system}: cusp 1 is the Ascendant");
                    assert!((cusps[9] - a.midheaven_deg).abs() < 1e-9, "{system}: cusp 10 is the Midheaven");
                    assert!((normalize(cusps[6] - cusps[0]) - 180.0).abs() < 1e-9, "{system}: cusp 7 opposes cusp 1");
                    assert!((normalize(cusps[3] - cusps[9]) - 180.0).abs() < 1e-9, "{system}: cusp 4 opposes cusp 10");
                }
                for index in 0..6 {
                    // Houses come in opposite pairs, except Vehlow's which are plain 30 degree steps.
                    assert!((normalize(cusps[index + 6] - cusps[index]) - 180.0).abs() < 1e-8, "{system}: cusp {} opposes {}", index + 7, index + 1);
                }
            }
        }
    }

    #[test]
    fn test_values_match_the_javascript_reference_implementation() {
        // Computed with astrological-functions' calculate{Porphyry,Regiomontanus,Koch,Placidus}HouseCusps
        // for the same angles (ARMC, obliquity 23.4392911, latitude), printed to 10 decimals.
        // The Vehlow rule is a plain 30 degree step from the Ascendant minus 15 degrees.
        type ReferenceCase<'a> = (f64, f64, [(&'a str, [f64; 12]); 4]);
        let cases: [ReferenceCase<'_>; 2] = [
            (100.0, 45.0, [
                ("porfirio", [187.6006461919, 218.1302686898, 248.6598911876, 279.1895136855, 308.6598911876, 338.1302686898, 7.6006461919, 38.1302686898, 68.6598911876, 99.1895136855, 128.6598911876, 158.1302686898]),
                ("regio-montano", [187.6006461919, 211.5393905619, 241.3836049912, 279.1895136855, 315.8324766861, 344.1746580512, 7.6006461919, 31.5393905619, 61.3836049912, 99.1895136855, 135.8324766861, 164.1746580512]),
                ("koch", [187.6006461919, 216.61864798, 245.8261652329, 279.1895136855, 309.5190388199, 338.4388613602, 7.6006461919, 36.61864798, 65.8261652329, 99.1895136855, 129.5190388199, 158.4388613602]),
                ("placido", [187.6006461919, 213.5504229882, 244.4358687626, 279.1895136855, 313.3918604435, 343.127543672, 7.6006461919, 33.5504229882, 64.4358687626, 99.1895136855, 133.3918604435, 163.127543672]),
            ]),
            (250.0, -33.9, [
                ("porfirio", [343.1525812015, 12.6130445554, 42.0735079092, 71.533971263, 102.0735079092, 132.6130445554, 163.1525812015, 192.6130445554, 222.0735079092, 251.533971263, 282.0735079092, 312.6130445554]),
                ("regio-montano", [343.1525812015, 8.6982495168, 37.5402549202, 71.533971263, 106.5670125695, 136.9912459827, 163.1525812015, 188.6982495168, 217.5402549202, 251.533971263, 286.5670125695, 316.9912459827]),
                ("koch", [343.1525812015, 12.8953743711, 42.2793713844, 71.533971263, 104.4573844416, 133.846372103, 163.1525812015, 192.8953743711, 222.2793713844, 251.533971263, 284.4573844416, 313.846372103]),
                ("placido", [343.1525812015, 9.1194517911, 39.0509364212, 71.533971263, 104.2165153581, 135.0950914539, 163.1525812015, 189.1194517911, 219.0509364212, 251.533971263, 284.2165153581, 315.0950914539]),
            ]),
        ];
        for (armc, latitude, systems) in cases {
            let a = angles(armc, 23.4392911, latitude);
            for (system, reference) in systems {
                let got = cusps(system, &a).unwrap_or_else(|| panic!("{system} unavailable"));
                for (index, (g, r)) in got.iter().zip(reference.iter()).enumerate() {
                    let difference = ((g - r + 540.0).rem_euclid(360.0) - 180.0).abs();
                    assert!(difference < 1e-8, "{system} armc {armc} lat {latitude} cusp {}: {g} vs {r}", index + 1);
                }
            }
            let vehlow = cusps("egizia", &a).unwrap();
            for (index, cusp) in vehlow.iter().enumerate() {
                let expected = normalize(a.ascendant_deg - 15.0 + 30.0 * index as f64);
                assert!((cusp - expected).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn test_placidus_and_koch_are_unavailable_at_and_beyond_the_polar_circle_and_the_others_are_not_substituted() {
        for latitude in [66.6, 70.0, 80.0, -75.0] {
            let a = angles(30.0, 23.4392911, latitude);
            assert!(cusps("placido", &a).is_none(), "Placidus at {latitude}");
            assert!(cusps("koch", &a).is_none() || latitude.abs() < 90.0, "Koch at {latitude} answers or fails, never substitutes");
        }
        // Equal-house systems never need the semi-arc.
        let polar = angles(30.0, 23.4392911, 75.0);
        assert!(cusps("egizia", &polar).is_some());
    }

    #[test]
    fn test_bad_input_and_unknown_systems_are_unavailable() {
        let a = angles(100.0, 23.4392911, 45.0);
        assert!(cusps("campano", &a).is_none());
        assert!(cusps("placido", &HouseAngles { armc_deg: f64::NAN, ..a }).is_none());
        assert!(cusps("placido", &HouseAngles { true_obliquity_deg: 0.0, ..a }).is_none());
        assert!(cusps("placido", &HouseAngles { latitude_deg: 90.0, ..a }).is_none());
        assert!(cusps("porfirio", &HouseAngles { midheaven_deg: a.ascendant_deg, ..a }).is_none(), "degenerate quadrants");
    }
}
