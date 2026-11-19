//! Versioned, opt-in historical chart request. No UTC, local timezone or ΔT
//! is inferred, and no path or sensitive diagnostics cross the IPC boundary.
use crate::chart_calculation::{ChartSnapshotV1, ProviderInfoV1};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalChartRequest {
    pub(crate) protocol_version: u8,
    civil: HistoricalCivil,
    delta_t: HistoricalDeltaT,
    pub(crate) lat_micro: i32,
    pub(crate) lng_micro: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HistoricalCivil {
    year: i32,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: f64,
    calendar: CalendarChoice,
    offset: OffsetChoice,
    uncertainty_seconds: f64,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
enum CalendarChoice {
    Gregorian,
    Julian,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum OffsetChoice {
    LocalMeanSolar,
    Supplied { seconds_east: f64, source: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum HistoricalDeltaT {
    Supplied {
        seconds: f64,
        uncertainty_seconds: f64,
        source: String,
    },
    EspenakMeeus2006 {
        uncertainty_seconds: f64,
    },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalChartTime {
    jd_ut1: f64,
    jd_tt: f64,
    delta_t_seconds: f64,
    delta_t_uncertainty_seconds: f64,
    delta_t_source: String,
    civil_uncertainty_seconds: f64,
    offset_seconds_east: f64,
    offset_source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalChartResponse {
    protocol_version: u8,
    status: &'static str,
    provider: Option<ProviderInfoV1>,
    chart: Option<ChartSnapshotV1>,
    time: Option<HistoricalChartTime>,
}

fn failure(status: &'static str) -> HistoricalChartResponse {
    HistoricalChartResponse {
        protocol_version: 1,
        status,
        provider: None,
        chart: None,
        time: None,
    }
}

impl HistoricalChartRequest {
    /// Validate stored input without opening an ephemeris or depending on a
    /// platform timezone database; this also runs on archive read/write.
    pub(crate) fn valid(&self) -> bool {
        let c = &self.civil;
        let leap = c.year.rem_euclid(4) == 0
            && (matches!(c.calendar, CalendarChoice::Julian)
                || c.year.rem_euclid(100) != 0
                || c.year.rem_euclid(400) == 0);
        let days = match c.month {
            1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
            4 | 6 | 9 | 11 => 30,
            2 if leap => 29,
            2 => 28,
            _ => 0,
        };
        let label =
            |s: &str| !s.trim().is_empty() && s.len() <= 200 && !s.chars().any(char::is_control);
        let uncertainty = |x: f64| x.is_finite() && x >= 0.0;
        self.protocol_version == 1
            && (-12999..=3999).contains(&c.year)
            && c.day >= 1
            && c.day <= days
            && c.hour < 24
            && c.minute < 60
            && c.second.is_finite()
            && (0.0..60.0).contains(&c.second)
            && uncertainty(c.uncertainty_seconds)
            && self.lat_micro.unsigned_abs() <= 90_000_000
            && self.lng_micro.unsigned_abs() <= 180_000_000
            && match &c.offset {
                OffsetChoice::LocalMeanSolar => true,
                OffsetChoice::Supplied {
                    seconds_east,
                    source,
                } => seconds_east.is_finite() && seconds_east.abs() <= 86400.0 && label(source),
            }
            && match &self.delta_t {
                HistoricalDeltaT::Supplied {
                    seconds,
                    uncertainty_seconds,
                    source,
                } => seconds.is_finite() && uncertainty(*uncertainty_seconds) && label(source),
                HistoricalDeltaT::EspenakMeeus2006 {
                    uncertainty_seconds,
                } => uncertainty(*uncertainty_seconds),
            }
    }
}

#[tauri::command]
pub fn calculate_historical_chart(request: HistoricalChartRequest) -> HistoricalChartResponse {
    if !request.valid() {
        return failure("invalid_request");
    }
    #[cfg(not(feature = "virgostars-ephemeris"))]
    {
        let _ = request;
        failure("provider_unavailable")
    }
    #[cfg(feature = "virgostars-ephemeris")]
    {
        calculate(request)
    }
}

#[cfg(feature = "virgostars-ephemeris")]
fn calculate(request: HistoricalChartRequest) -> HistoricalChartResponse {
    use virgostars_ephemeris_core::calendar::{Calendar, CalendarDateTime, TimeScale};
    use virgostars_ephemeris_core::historical_civil_time::{
        local_to_ut1, HistoricalCivilInput, HistoricalOffset,
    };
    use virgostars_ephemeris_core::mvp_planets::PlanetaryTime;
    use virgostars_ephemeris_core::rise_transit::Site;
    let date = &request.civil;
    let offset = match &date.offset {
        OffsetChoice::LocalMeanSolar => HistoricalOffset::LocalMeanSolar {
            longitude_deg_east: f64::from(request.lng_micro) / 1e6,
        },
        OffsetChoice::Supplied {
            seconds_east,
            source,
        } => HistoricalOffset::Supplied {
            seconds_east: *seconds_east,
            source,
        },
    };
    let civil = HistoricalCivilInput {
        local: CalendarDateTime {
            year: date.year,
            month: date.month,
            day: date.day,
            hour: date.hour,
            minute: date.minute,
            second: date.second,
            scale: TimeScale::Ut1,
        },
        calendar: match date.calendar {
            CalendarChoice::Gregorian => Calendar::ProlepticGregorian,
            CalendarChoice::Julian => Calendar::ProlepticJulian,
        },
        offset,
        uncertainty_seconds: date.uncertainty_seconds,
    };
    let epoch = match local_to_ut1(civil) {
        Ok(epoch) => epoch,
        Err(_) => return failure("invalid_request"),
    };
    let (delta, uncertainty, source) = match &request.delta_t {
        HistoricalDeltaT::Supplied {
            seconds,
            uncertainty_seconds,
            source,
        } => (*seconds, *uncertainty_seconds, source.as_str()),
        HistoricalDeltaT::EspenakMeeus2006 {
            uncertainty_seconds,
        } => {
            let Ok(time) = PlanetaryTime::espenak_meeus_2006(epoch.jd_ut1, *uncertainty_seconds)
            else {
                return failure("time_source_out_of_range");
            };
            (time.delta_t_seconds, time.uncertainty_seconds, time.source)
        }
    };
    if !delta.is_finite()
        || !uncertainty.is_finite()
        || uncertainty < 0.0
        || source.trim().is_empty()
        || source.len() > 200
        || source.chars().any(char::is_control)
    {
        return failure("invalid_request");
    }
    let site = Site {
        latitude_deg: f64::from(request.lat_micro) / 1e6,
        longitude_deg_east: f64::from(request.lng_micro) / 1e6,
        height_m: 0.0,
    };
    match crate::virgostars_provider::historical_chart(
        civil,
        delta,
        uncertainty,
        source,
        &site,
        None,
    ) {
        None => failure("provider_unavailable"),
        Some(Err(_)) => failure("calculation_failed"),
        Some(Ok(result)) => HistoricalChartResponse {
            protocol_version: 1,
            status: "ok",
            provider: Some(ProviderInfoV1 {
                id: "virgostars_ephemeris",
                engine_version: crate::virgostars_provider::ENGINE_VERSION.to_owned(),
            }),
            time: Some(HistoricalChartTime {
                jd_ut1: result.epoch.jd_ut1,
                jd_tt: result.epoch.jd_tt,
                delta_t_seconds: result.epoch.delta_t_seconds,
                delta_t_uncertainty_seconds: result.epoch.uncertainty_seconds,
                delta_t_source: result.delta_t_source,
                civil_uncertainty_seconds: result.civil.uncertainty_seconds,
                offset_seconds_east: result.civil.offset_seconds_east,
                offset_source: result.civil.offset_source,
            }),
            chart: Some(result.chart),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(year: i32) -> HistoricalChartRequest {
        serde_json::from_value(serde_json::json!({
            "protocolVersion": 1, "latMicro": 41900000, "lngMicro": 12500000,
            "civil": {"year":year, "month":3, "day":20, "hour":12, "minute":0, "second":0.0,
                "calendar":"julian", "offset":{"kind":"localMeanSolar"}, "uncertaintySeconds":60.0},
            "deltaT":{"kind":"supplied", "seconds":69.0, "uncertaintySeconds":2.0, "source":"test"}
        }))
        .unwrap()
    }

    #[test]
    fn rejects_invalid_dates_offsets_and_delta_t() {
        let mut r = request(2000);
        r.civil.month = 13;
        assert_eq!(calculate_historical_chart(r).status, "invalid_request");
        let mut r = request(2000);
        r.civil.offset = OffsetChoice::Supplied {
            seconds_east: 90000.0,
            source: "test".into(),
        };
        assert_eq!(calculate_historical_chart(r).status, "invalid_request");
        let mut r = request(2000);
        r.delta_t = HistoricalDeltaT::Supplied {
            seconds: 69.0,
            uncertainty_seconds: -1.0,
            source: "test".into(),
        };
        assert_eq!(calculate_historical_chart(r).status, "invalid_request");
        let mut r = request(-2000);
        r.delta_t = HistoricalDeltaT::EspenakMeeus2006 {
            uncertainty_seconds: 1.0,
        };
        assert_eq!(
            calculate_historical_chart(r).status,
            "time_source_out_of_range"
        );
        let mut r = request(2000);
        r.lat_micro = i32::MIN;
        assert_eq!(calculate_historical_chart(r).status, "invalid_request");
    }

    #[test]
    fn real_de441_historical_request_retains_time_and_chart() {
        if std::env::var_os("VIRGOSTARS_DE441_PATH").is_none() {
            return;
        }
        for year in [-12999, 0, 2000, 3999] {
            let result = calculate_historical_chart(request(year));
            assert_eq!(result.status, "ok", "year {year}");
            let time = result.time.unwrap();
            assert_eq!(time.civil_uncertainty_seconds, 60.0);
            assert_eq!(time.delta_t_uncertainty_seconds, 2.0);
            assert_eq!(time.offset_seconds_east, 3000.0);
            let chart = result.chart.unwrap();
            assert_eq!(chart.julian_day_ut, time.jd_ut1);
            assert_eq!(chart.bodies.len(), 14);
            assert_eq!(chart.houses.len(), 5);
            assert_eq!(chart.unavailable_bodies, vec!["Chiron"]);
        }
    }

    #[test]
    #[cfg(feature = "virgostars-ephemeris")]
    #[ignore = "requires the separately supplied Desktop DE441 base slice"]
    fn desktop_base_supports_explicit_historical_years() {
        assert!(std::env::var_os("VIRGOSTARS_DE441_PATH").is_some());
        // The supplied ΔT in request() is synthetic. This exercises the
        // explicit historical contract, not historical time accuracy.
        for year in [1000, 2200] {
            let result = calculate_historical_chart(request(year));
            assert_eq!(result.status, "ok", "year {year}");
            let chart = result.chart.expect("historical chart");
            assert_eq!(chart.bodies.len(), 14);
            assert_eq!(chart.houses.len(), 5);
            assert_eq!(chart.unavailable_bodies, vec!["Chiron"]);
            let time = result.time.expect("explicit time metadata");
            assert_eq!(time.delta_t_uncertainty_seconds, 2.0);
            let mut modelled = request(year);
            modelled.delta_t = HistoricalDeltaT::EspenakMeeus2006 {
                uncertainty_seconds: 2.0,
            };
            let result = calculate_historical_chart(modelled);
            assert_eq!(result.status, "ok", "modelled year {year}");
            assert_eq!(result.time.expect("model metadata").delta_t_source, "Espenak-Meeus 2006");
        }
    }
}
