//! Solar and lunar returns: the instants of one UTC calendar year at which the
//! Sun or the Moon is back at a given ecliptic longitude.
//!
//! The search only asks the active `EphemerisProvider` for longitudes; the
//! bracketing and bisection below are plain numerics and contain no astronomy.
//! The request carries a longitude and a year, never a name or a birth date.
use crate::chart_calculation::{self, EphemerisProvider, Luminary, ProviderError, ProviderInfoV1};
use serde::{Deserialize, Serialize};

const PROTOCOL_VERSION: u8 = 1;
const MIN_YEAR: i32 = 1600;
const MAX_YEAR: i32 = 2400;
const UNIX_EPOCH_JULIAN_DAY: f64 = 2_440_587.5;
const MILLIS_PER_DAY: f64 = 86_400_000.0;
/// Stop bisecting below a tenth of a millisecond.
const TIME_TOLERANCE_DAYS: f64 = 1e-9;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReturnRequestV1 {
    pub protocol_version: u8,
    /// `Sun` or `Moon`.
    pub body: String,
    pub target_longitude_deg: f64,
    /// UTC calendar year searched, from 1 January 00:00 inclusive to the next 1 January exclusive.
    pub year: i32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReturnInstantV1 {
    /// Rounded to the millisecond.
    pub utc_iso: String,
    pub julian_day_ut: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ReturnResponseV1 {
    pub protocol_version: u8,
    /// `ok`, `provider_unavailable`, `invalid_request` or `calculation_failed`.
    pub status: &'static str,
    pub provider: Option<ProviderInfoV1>,
    /// Chronological. A solar year normally holds one return, a lunar year 13 or 14.
    pub instants: Option<Vec<ReturnInstantV1>>,
}

fn failure(status: &'static str) -> ReturnResponseV1 {
    ReturnResponseV1 { protocol_version: PROTOCOL_VERSION, status, provider: None, instants: None }
}

/// Days since 1970-01-01 of a proleptic Gregorian date.
fn days_from_civil(year: i32, month: u32, day: u32) -> i64 {
    let y = i64::from(year) - i64::from(month <= 2);
    let era = y.div_euclid(400);
    let year_of_era = y.rem_euclid(400);
    let shifted_month = (i64::from(month) + 9) % 12;
    let day_of_year = (153 * shifted_month + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

/// Julian day (UT) of 1 January 00:00 of a year.
fn year_start_julian_day(year: i32) -> f64 {
    UNIX_EPOCH_JULIAN_DAY + days_from_civil(year, 1, 1) as f64
}

/// `YYYY-MM-DDTHH:MM:SS.mmmZ`, rounded to the nearest millisecond.
fn utc_iso(julian_day_ut: f64) -> String {
    let total_millis = ((julian_day_ut - UNIX_EPOCH_JULIAN_DAY) * MILLIS_PER_DAY).round() as i64;
    let days = total_millis.div_euclid(86_400_000);
    let millis_of_day = total_millis.rem_euclid(86_400_000);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let day_of_era = z.rem_euclid(146_097);
    let year_of_era = (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let shifted_month = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * shifted_month + 2) / 5 + 1;
    let month = if shifted_month < 10 { shifted_month + 3 } else { shifted_month - 9 };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{:03}Z",
        millis_of_day / 3_600_000,
        millis_of_day / 60_000 % 60,
        millis_of_day / 1_000 % 60,
        millis_of_day % 1_000
    )
}

/// Signed distance from the target, in `(-180, 180]`.
fn offset(longitude: f64, target: f64) -> f64 {
    180.0 - (target - longitude + 180.0).rem_euclid(360.0)
}

/// Every instant in `[start, end)` at which a body in direct motion reaches
/// `target`. `step` must be short enough that the body moves well under 180
/// degrees per step, so the jump at the far side of the circle is never
/// mistaken for a crossing.
fn find_crossings(
    longitude_at: impl Fn(f64) -> Result<f64, ProviderError>,
    target: f64,
    start: f64,
    end: f64,
    step: f64,
) -> Result<Vec<f64>, ProviderError> {
    let read = |time: f64| -> Result<f64, ProviderError> {
        let longitude = longitude_at(time)?;
        // The provider contract requires a normalized longitude. Remapping
        // arbitrary finite values here could conceal an upstream engine bug.
        if (0.0..360.0).contains(&longitude) {
            Ok(offset(longitude, target))
        } else {
            Err(ProviderError)
        }
    };
    let mut crossings = Vec::new();
    let mut left = start;
    let mut left_offset = read(left)?;
    while left < end {
        let right = (left + step).min(end);
        let right_offset = read(right)?;
        // From behind the target (or exactly on it) to ahead of it.
        if left_offset <= 0.0 && right_offset > 0.0 && right_offset - left_offset < 180.0 {
            let (mut low, mut high) = (left, right);
            while high - low > TIME_TOLERANCE_DAYS {
                let middle = low + (high - low) / 2.0;
                if read(middle)? <= 0.0 { low = middle } else { high = middle }
            }
            // The calendar interval is [start, end): a return exactly at the
            // next January boundary belongs to the following year, not both.
            // Check the bracket, not a rounded timestamp, so no millisecond
            // serialization can move an event into the wrong year.
            if low < end && (high < end || read(end)? > 0.0) {
                crossings.push(low + (high - low) / 2.0);
            }
        }
        left = right;
        left_offset = right_offset;
    }
    Ok(crossings)
}

/// Pure decision logic, separated from Tauri so it can be unit tested.
pub fn respond(provider: Option<&dyn EphemerisProvider>, request: &ReturnRequestV1) -> ReturnResponseV1 {
    let (body, step) = match request.body.as_str() {
        // The Sun moves about 1 degree a day, the Moon up to about 15.
        "Sun" => (Luminary::Sun, 1.0),
        "Moon" => (Luminary::Moon, 0.25),
        _ => return failure("invalid_request"),
    };
    let target = request.target_longitude_deg;
    if request.protocol_version != PROTOCOL_VERSION
        || !target.is_finite()
        || !(0.0..360.0).contains(&target)
        || !(MIN_YEAR..=MAX_YEAR).contains(&request.year)
    {
        return failure("invalid_request");
    }
    let Some(provider) = provider else {
        return failure("provider_unavailable");
    };
    let start = year_start_julian_day(request.year);
    let end = year_start_julian_day(request.year + 1);
    match find_crossings(|time| provider.luminary_longitude(body, time), target, start, end, step) {
        Ok(crossings) => ReturnResponseV1 {
            protocol_version: PROTOCOL_VERSION,
            status: "ok",
            provider: Some(provider.info()),
            instants: Some(
                crossings
                    .into_iter()
                    .map(|julian_day_ut| ReturnInstantV1 { utc_iso: utc_iso(julian_day_ut), julian_day_ut })
                    .collect(),
            ),
        },
        Err(ProviderError) => failure("calculation_failed"),
    }
}

#[tauri::command]
pub fn find_returns(request: ReturnRequestV1) -> ReturnResponseV1 {
    respond(chart_calculation::active_provider(), &request)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chart_calculation::{ChartSnapshotV1, ValidatedRequest};

    const J2000: f64 = 2_451_545.0;

    /// Uniform circular motion: not an ephemeris, just a known answer.
    struct UniformMotion {
        sun_degrees_per_day: f64,
        moon_degrees_per_day: f64,
    }
    impl EphemerisProvider for UniformMotion {
        fn info(&self) -> ProviderInfoV1 {
            ProviderInfoV1 { id: "synthetic_test", engine_version: "0".to_string() }
        }
        fn chart(&self, _request: &ValidatedRequest) -> Result<ChartSnapshotV1, ProviderError> {
            Err(ProviderError)
        }
        fn luminary_longitude(&self, body: Luminary, julian_day_ut: f64) -> Result<f64, ProviderError> {
            let rate = match body {
                Luminary::Sun => self.sun_degrees_per_day,
                Luminary::Moon => self.moon_degrees_per_day,
            };
            Ok((100.0 + rate * (julian_day_ut - J2000)).rem_euclid(360.0))
        }
    }
    const SKY: UniformMotion = UniformMotion { sun_degrees_per_day: 360.0 / 365.25, moon_degrees_per_day: 360.0 / 27.25 };

    fn request(body: &str, target: f64, year: i32) -> ReturnRequestV1 {
        ReturnRequestV1 { protocol_version: 1, body: body.to_string(), target_longitude_deg: target, year }
    }

    #[test]
    fn test_julian_day_and_iso_conversions_agree_with_known_dates() {
        assert_eq!(year_start_julian_day(2000), 2_451_544.5);
        assert_eq!(year_start_julian_day(1970), UNIX_EPOCH_JULIAN_DAY);
        assert_eq!(utc_iso(J2000), "2000-01-01T12:00:00.000Z");
        assert_eq!(utc_iso(UNIX_EPOCH_JULIAN_DAY), "1970-01-01T00:00:00.000Z");
        assert_eq!(utc_iso(year_start_julian_day(2024) + 59.0), "2024-02-29T00:00:00.000Z");
        assert_eq!(utc_iso(year_start_julian_day(1900) + 59.0), "1900-03-01T00:00:00.000Z");
        assert_eq!(utc_iso(year_start_julian_day(1601) - 0.5), "1600-12-31T12:00:00.000Z");
        assert_eq!(utc_iso(J2000 + 0.5 + 1.5 / 86_400.0), "2000-01-02T00:00:01.500Z");
    }

    #[test]
    fn test_offsets_are_signed_and_wrap_at_the_far_side_of_the_circle() {
        assert_eq!(offset(10.0, 350.0), 20.0);
        assert_eq!(offset(350.0, 10.0), -20.0);
        assert_eq!(offset(190.0, 10.0), 180.0);
        assert_eq!(offset(10.0, 10.0), 0.0);
    }

    #[test]
    fn test_solar_return_matches_the_analytic_answer_for_uniform_motion() {
        // Longitude is 100 deg at J2000 and gains 360 deg every 365.25 days.
        let response = respond(Some(&SKY), &request("Sun", 190.0, 2000));
        assert_eq!(response.status, "ok");
        assert_eq!(response.provider.as_ref().unwrap().id, "synthetic_test");
        let instants = response.instants.unwrap();
        assert_eq!(instants.len(), 1);
        let expected = J2000 + 90.0 / SKY.sun_degrees_per_day;
        assert!((instants[0].julian_day_ut - expected).abs() < 2e-9);
        assert_eq!(instants[0].utc_iso, utc_iso(expected));
    }

    #[test]
    fn test_a_lunar_year_lists_every_return_in_order_and_evenly_spaced() {
        let instants = respond(Some(&SKY), &request("Moon", 250.0, 2001)).instants.unwrap();
        assert!(instants.len() == 13 || instants.len() == 14, "found {}", instants.len());
        for pair in instants.windows(2) {
            assert!((pair[1].julian_day_ut - pair[0].julian_day_ut - 27.25).abs() < 1e-6);
        }
        let (start, end) = (year_start_julian_day(2001), year_start_julian_day(2002));
        assert!(instants.iter().all(|instant| instant.julian_day_ut >= start && instant.julian_day_ut < end));
        assert!(instants.iter().all(|instant| instant.utc_iso.starts_with("2001-")));
    }

    #[test]
    fn test_year_boundaries_are_half_open_so_no_return_is_counted_twice() {
        // A body that sits exactly on the target at the start of 2001.
        let start = year_start_julian_day(2001);
        let on_boundary = |time: f64| Ok((40.0 + (time - start)).rem_euclid(360.0));
        let this_year = find_crossings(on_boundary, 40.0, start, start + 365.0, 1.0).unwrap();
        assert_eq!(this_year.len(), 2, "the start instant and the one 360 days later");
        assert!((this_year[0] - start).abs() < 2e-9);
        let previous_year = find_crossings(on_boundary, 40.0, start - 365.0, start, 1.0).unwrap();
        assert_eq!(previous_year.len(), 1);
        assert!((previous_year[0] - (start - 360.0)).abs() < 2e-9);
    }

    #[test]
    fn test_crossing_exactly_at_end_is_not_returned_for_previous_year() {
        let start = year_start_julian_day(2001);
        let at_next_year = |time: f64| Ok((40.0 + (time - (start + 365.0))).rem_euclid(360.0));
        let previous = find_crossings(at_next_year, 40.0, start, start + 365.0, 1.0).unwrap();
        assert_eq!(previous.len(), 1, "only the prior 360-day cycle belongs to the preceding year");
        assert!((previous[0] - (start + 5.0)).abs() < 2e-9);
        let following = find_crossings(at_next_year, 40.0, start + 365.0, start + 730.0, 1.0).unwrap();
        assert_eq!(following.len(), 2);
        assert!((following[0] - (start + 365.0)).abs() < 2e-9);
    }

    #[test]
    fn test_crossing_just_before_end_remains_in_previous_year() {
        let start = year_start_julian_day(2001);
        let at_last_second = |time: f64| Ok((40.0 + (time - (start + 365.0 - 1.0 / 86_400.0))).rem_euclid(360.0));
        let previous = find_crossings(at_last_second, 40.0, start, start + 365.0, 1.0).unwrap();
        assert_eq!(previous.len(), 2);
        assert!((previous[1] - (start + 365.0 - 1.0 / 86_400.0)).abs() < 2e-9);
    }

    #[test]
    fn test_unbounded_provider_longitudes_fail_closed() {
        let start = year_start_julian_day(2001);
        for bad in [-0.01, 360.0, 720.0, f64::NAN, f64::INFINITY] {
            let result = find_crossings(|_| Ok(bad), 40.0, start, start + 1.0, 0.25);
            assert_eq!(result, Err(ProviderError), "accepted longitude {bad:?}");
        }
        assert!(find_crossings(|_| Ok(0.0), 40.0, start, start + 1.0, 0.25).is_ok());
        assert!(find_crossings(|_| Ok(359.999), 40.0, start, start + 1.0, 0.25).is_ok());
    }

    #[test]
    fn test_invalid_requests_never_reach_the_provider() {
        let mut wrong_protocol = request("Sun", 10.0, 2000);
        wrong_protocol.protocol_version = 2;
        for bad in [
            wrong_protocol,
            request("Mars", 10.0, 2000),
            request("sun", 10.0, 2000),
            request("Sun", 360.0, 2000),
            request("Sun", -0.1, 2000),
            request("Sun", f64::NAN, 2000),
            request("Sun", f64::INFINITY, 2000),
            request("Moon", 10.0, 1599),
            request("Moon", 10.0, 2401),
        ] {
            let response = respond(Some(&SKY), &bad);
            assert_eq!(response.status, "invalid_request");
            assert!(response.instants.is_none() && response.provider.is_none());
        }
    }

    #[test]
    fn test_missing_or_failing_providers_are_reported_not_papered_over() {
        assert_eq!(respond(None, &request("Sun", 10.0, 2000)).status, "provider_unavailable");
        struct NoLuminaries;
        impl EphemerisProvider for NoLuminaries {
            fn info(&self) -> ProviderInfoV1 {
                ProviderInfoV1 { id: "synthetic_test", engine_version: "0".to_string() }
            }
            fn chart(&self, _request: &ValidatedRequest) -> Result<ChartSnapshotV1, ProviderError> {
                Err(ProviderError)
            }
        }
        let response = respond(Some(&NoLuminaries), &request("Sun", 10.0, 2000));
        assert_eq!(response.status, "calculation_failed");
        assert!(response.instants.is_none());
    }

    #[test]
    fn test_wire_format_matches_the_typescript_contract() {
        let raw = serde_json::to_value(respond(Some(&SKY), &request("Sun", 190.0, 2000))).unwrap();
        assert_eq!(raw["protocolVersion"], 1);
        assert_eq!(raw["status"], "ok");
        assert_eq!(raw["provider"]["id"], "synthetic_test");
        assert!(raw["instants"][0]["utcIso"].is_string());
        assert!(raw["instants"][0]["julianDayUt"].is_number());
        let extra = r#"{"protocolVersion":1,"body":"Sun","targetLongitudeDeg":1.0,"year":2000,"name":"x"}"#;
        assert!(serde_json::from_str::<ReturnRequestV1>(extra).is_err());
        let exact = r#"{"protocolVersion":1,"body":"Sun","targetLongitudeDeg":1.0,"year":2000}"#;
        assert!(serde_json::from_str::<ReturnRequestV1>(exact).is_ok());
    }

    #[cfg(feature = "virgostars-ephemeris")]
    mod with_virgostars_ephemeris {
        use super::*;
        use crate::virgostars_provider::{data_available, VirgoStarsEphemeris};

        #[test]
        fn test_the_sun_returns_to_its_j2000_longitude_one_tropical_year_later() {
            if !data_available() { return; } // needs the local DE441 file
            let target = VirgoStarsEphemeris.luminary_longitude(Luminary::Sun, J2000).unwrap();
            // 2000 holds two returns: the reference instant itself and the next one,
            // which falls on 31 December because a tropical year is 365.2422 days.
            let instants = respond(Some(&VirgoStarsEphemeris), &request("Sun", target, 2000)).instants.unwrap();
            assert_eq!(instants.len(), 2, "{instants:?}");
            assert!((instants[0].julian_day_ut - J2000).abs() < 1.0 / 86_400.0);
            let year_length = instants[1].julian_day_ut - instants[0].julian_day_ut;
            assert!((year_length - 365.2422).abs() < 0.01, "year of {year_length} days");
            assert!(instants[1].utc_iso.starts_with("2000-12-31T17:"), "{}", instants[1].utc_iso);
            for instant in &instants {
                let found = VirgoStarsEphemeris.luminary_longitude(Luminary::Sun, instant.julian_day_ut).unwrap();
                assert!(offset(found, target).abs() < 1e-6);
            }
            assert_eq!(respond(Some(&VirgoStarsEphemeris), &request("Sun", target, 2001)).instants.unwrap().len(), 1);
        }

        #[test]
        fn test_lunar_returns_recur_about_every_sidereal_month() {
            if !data_available() { return; } // needs the local DE441 file
            let target = VirgoStarsEphemeris.luminary_longitude(Luminary::Moon, J2000).unwrap();
            let instants = respond(Some(&VirgoStarsEphemeris), &request("Moon", target, 2001)).instants.unwrap();
            assert!(instants.len() == 13 || instants.len() == 14, "found {}", instants.len());
            for pair in instants.windows(2) {
                let gap = pair[1].julian_day_ut - pair[0].julian_day_ut;
                assert!((26.5..28.5).contains(&gap), "gap of {gap} days");
            }
            for instant in &instants {
                let found = VirgoStarsEphemeris.luminary_longitude(Luminary::Moon, instant.julian_day_ut).unwrap();
                assert!(offset(found, target).abs() < 1e-5);
            }
        }
    }
}
