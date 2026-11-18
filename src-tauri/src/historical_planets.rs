//! Opt-in diagnostic for one apparent planet at an explicitly supplied UT1 epoch.
//! This is independent of the civil-time chart contract and makes no UTC assumption.
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalPlanetRequest {
    protocol_version: u8,
    pub(crate) body: String,
    pub(crate) jd_ut1: f64,
    pub(crate) delta_t_seconds: f64,
    pub(crate) uncertainty_seconds: f64,
    pub(crate) delta_t_source: String,
    #[serde(skip)]
    pub(crate) uncertainty_source: Option<String>,
    #[serde(skip)]
    pub(crate) usno_source_error: Option<UsnoSourceError>,
    #[serde(default)]
    pub(crate) include_scenarios: bool,
}

/// A proleptic Gregorian date already expressed in UT1, not civil time or UTC.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistoricalCalendarRequest {
    protocol_version: u8,
    body: String,
    year: i32,
    month: u8,
    day: u8,
    hour: u8,
    minute: u8,
    second: f64,
    delta_t: HistoricalDeltaT,
    #[serde(default)]
    include_scenarios: bool,
}

#[derive(Debug, Deserialize)]
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
    EspenakMeeus2006EstimatedUncertainty,
    Usno {
        uncertainty_seconds: f64,
        #[serde(default)]
        allow_predictions: bool,
    },
}

fn supported_body(body: &str) -> bool {
    matches!(
        body,
        "Sun"
            | "Moon"
            | "Mercury"
            | "Venus"
            | "Mars"
            | "Jupiter"
            | "Saturn"
            | "Uranus"
            | "Neptune"
            | "Pluto"
    )
}

#[cfg(feature = "virgostars-ephemeris")]
fn resolve_calendar(
    request: HistoricalCalendarRequest,
) -> Result<HistoricalPlanetRequest, &'static str> {
    resolve_calendar_with(request, crate::virgostars_provider::historical_usno_delta_t)
}

#[cfg(feature = "virgostars-ephemeris")]
fn resolve_calendar_with(
    request: HistoricalCalendarRequest,
    lookup: impl FnOnce(f64, bool) -> Result<(f64, &'static str, Option<f64>), &'static str>,
) -> Result<HistoricalPlanetRequest, &'static str> {
    use virgostars_ephemeris_core::calendar::{Calendar, TimeScale};
    use virgostars_ephemeris_core::calendar_decimal_hours::{julday_f64, DecimalHourDateTime};
    if request.protocol_version != 1
        || !supported_body(&request.body)
        || !(-12999..=3999).contains(&request.year)
        || request.hour > 23
        || request.minute > 59
        || !request.second.is_finite()
        || !(0.0..60.0).contains(&request.second)
    {
        return Err("invalid_request");
    }
    let date = |year, month, day, decimal_hour| {
        julday_f64(
            DecimalHourDateTime {
                year,
                month,
                day,
                decimal_hour,
                scale: TimeScale::Ut1,
            },
            Calendar::ProlepticGregorian,
        )
        .map_err(|_| "invalid_request")
    };
    let hour = f64::from(request.hour) + f64::from(request.minute) / 60.0 + request.second / 3600.0;
    let jd_ut1 = date(request.year, request.month, request.day, hour)?;
    let (delta_t_seconds, uncertainty_seconds, delta_t_source, uncertainty_source, usno_source_error) = match request
        .delta_t
    {
        HistoricalDeltaT::Supplied {
            seconds,
            uncertainty_seconds,
            source,
        } => (seconds, uncertainty_seconds, source, None, None),
        HistoricalDeltaT::Usno {
            uncertainty_seconds,
            allow_predictions,
        } => {
            if !uncertainty_seconds.is_finite() || uncertainty_seconds < 0.0 {
                return Err("invalid_request");
            }
            let (seconds, source, error_seconds) = lookup(jd_ut1, allow_predictions)?;
            (seconds, uncertainty_seconds, source.to_string(), None, Some(UsnoSourceError { seconds: error_seconds }))
        }
        choice => {
            if !(-1999..=3000).contains(&request.year) {
                return Err("invalid_request");
            }
            let start = date(request.year, 1, 1, 0.0)?;
            let end = date(request.year + 1, 1, 1, 0.0)?;
            let decimal_year = f64::from(request.year) + (jd_ut1 - start) / (end - start);
            let seconds =
                virgostars_ephemeris_core::delta_t_long_range::espenak_meeus_2006_extended(
                    decimal_year,
                )
                .map_err(|_| "invalid_request")?;
            let (uncertainty_seconds, uncertainty_source) = match choice {
                HistoricalDeltaT::EspenakMeeus2006 { uncertainty_seconds } => (uncertainty_seconds, None),
                HistoricalDeltaT::EspenakMeeus2006EstimatedUncertainty => (
                    virgostars_ephemeris_core::delta_t_long_range::morrison_stephenson_2004_standard_error(decimal_year).map_err(|_| "invalid_request")?,
                    Some("Morrison-Stephenson 2004 standard error".to_string()),
                ),
                HistoricalDeltaT::Supplied { .. } => unreachable!(),
                HistoricalDeltaT::Usno { .. } => unreachable!(),
            };
            (
                seconds,
                uncertainty_seconds,
                "Espenak-Meeus 2006".to_string(),
                uncertainty_source,
                None,
            )
        }
    };
    let resolved = HistoricalPlanetRequest {
        protocol_version: 1,
        body: request.body,
        jd_ut1,
        delta_t_seconds,
        uncertainty_seconds,
        delta_t_source,
        uncertainty_source,
        usno_source_error,
        include_scenarios: request.include_scenarios,
    };
    resolved
        .valid()
        .then_some(resolved)
        .ok_or("invalid_request")
}

/// Calendar conversion is strictly UT1; the model and its uncertainty are opt-in and bounded.
#[tauri::command]
pub fn calculate_historical_planet_calendar(
    request: HistoricalCalendarRequest,
) -> HistoricalPlanetResponse {
    #[cfg(feature = "virgostars-ephemeris")]
    {
        match resolve_calendar(request) {
            Ok(resolved) => calculate_historical_planet(resolved),
            Err(status) => response(status, None),
        }
    }
    #[cfg(not(feature = "virgostars-ephemeris"))]
    {
        let _ = request;
        response("provider_unavailable", None)
    }
}

impl HistoricalPlanetRequest {
    fn valid(&self) -> bool {
        self.protocol_version == 1
            && supported_body(&self.body)
            && [self.jd_ut1, self.delta_t_seconds, self.uncertainty_seconds]
                .iter()
                .all(|x| x.is_finite())
            && self.uncertainty_seconds >= 0.0
            && !self.delta_t_source.trim().is_empty()
            && self.delta_t_source.len() <= 200
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsnoSourceError {
    pub seconds: Option<f64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalPlanetResult {
    pub body: String,
    pub jd_ut1: f64,
    pub jd_tt: f64,
    pub jd_tdb: f64,
    pub delta_t_seconds: f64,
    pub uncertainty_seconds: f64,
    pub delta_t_source: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub uncertainty_source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub usno_source_error: Option<UsnoSourceError>,
    pub longitude_deg: f64,
    pub latitude_deg: f64,
    pub distance_au: f64,
    pub longitude_speed_deg_per_tdb_day: f64,
    pub latitude_speed_deg_per_tdb_day: f64,
    pub radial_speed_au_per_tdb_day: f64,
    pub radial_correction_applied: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sensitivity: Option<HistoricalSensitivity>,
}

/// Two explicit perturbations, not bounds or confidence intervals.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalSensitivitySample {
    pub delta_t_seconds: f64,
    pub longitude_deg: f64,
    pub latitude_deg: f64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalSensitivity {
    pub lower: HistoricalSensitivitySample,
    pub upper: HistoricalSensitivitySample,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoricalPlanetResponse {
    protocol_version: u8,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<HistoricalPlanetResult>,
}

fn response(
    status: &'static str,
    result: Option<HistoricalPlanetResult>,
) -> HistoricalPlanetResponse {
    HistoricalPlanetResponse {
        protocol_version: 1,
        status,
        result,
    }
}

#[tauri::command]
pub fn calculate_historical_planet(request: HistoricalPlanetRequest) -> HistoricalPlanetResponse {
    if !request.valid() {
        return response("invalid_request", None);
    }
    #[cfg(feature = "virgostars-ephemeris")]
    {
        match crate::virgostars_provider::historical_planet(&request) {
            None => response("provider_unavailable", None),
            Some(Err(())) => response("calculation_failed", None),
            Some(Ok(result)) => response("ok", Some(result)),
        }
    }
    #[cfg(not(feature = "virgostars-ephemeris"))]
    response("provider_unavailable", None)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request() -> HistoricalPlanetRequest {
        HistoricalPlanetRequest {
            protocol_version: 1,
            body: "Moon".into(),
            jd_ut1: 2451545.0,
            delta_t_seconds: 64.0,
            uncertainty_seconds: 1.0,
            delta_t_source: "test source".into(),
            uncertainty_source: None,
            usno_source_error: None,
            include_scenarios: false,
        }
    }
    #[test]
    fn validates_time_source_and_body() {
        assert!(request().valid());
        let mut r = request();
        r.uncertainty_seconds = -1.0;
        assert!(!r.valid());
        r = request();
        r.jd_ut1 = f64::NAN;
        assert!(!r.valid());
        r = request();
        r.delta_t_source = "  ".into();
        assert!(!r.valid());
        r = request();
        r.delta_t_source = "è".repeat(101);
        assert!(!r.valid());
        r = request();
        r.body = "Earth".into();
        assert!(!r.valid());
        r = request();
        r.protocol_version = 2;
        assert!(!r.valid());
    }
    #[test]
    fn rejects_ambiguous_utc_and_extra_fields() {
        let input = r#"{"protocolVersion":1,"body":"Moon","jdUt1":2451545.0,"deltaTSeconds":64.0,"uncertaintySeconds":1.0,"deltaTSource":"test","utc":"2000-01-01"}"#;
        assert!(serde_json::from_str::<HistoricalPlanetRequest>(input).is_err());
    }
    #[test]
    fn rejects_invalid_request_before_provider_lookup() {
        let mut r = request();
        r.delta_t_source.clear();
        assert_eq!(calculate_historical_planet(r).status, "invalid_request");
    }

    #[cfg(feature = "virgostars-ephemeris")]
    #[test]
    fn calendar_usno_preserves_ut1_choice_and_caller_uncertainty() {
        let input = r#"{"protocolVersion":1,"body":"Moon","year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0,"deltaT":{"kind":"usno","uncertaintySeconds":3,"allowPredictions":true}}"#;
        let request: HistoricalCalendarRequest = serde_json::from_str(input).unwrap();
        let resolved = resolve_calendar_with(request, |jd, predictions| {
            assert_eq!(jd, 2451545.0);
            assert!(predictions);
            Ok((64.0, "Local USNO-format prediction (source unverified)", Some(0.3)))
        })
        .unwrap();
        assert_eq!(resolved.delta_t_seconds, 64.0);
        assert_eq!(resolved.uncertainty_seconds, 3.0);
        assert!(resolved.uncertainty_source.is_none());
        assert_eq!(resolved.usno_source_error.unwrap().seconds, Some(0.3));
        assert_eq!(
            resolved.delta_t_source,
            "Local USNO-format prediction (source unverified)"
        );
        let request: HistoricalCalendarRequest = serde_json::from_str(
            &input.replace("\"uncertaintySeconds\":3", "\"uncertaintySeconds\":-1"),
        )
        .unwrap();
        assert_eq!(
            resolve_calendar_with(request, |_, _| panic!(
                "invalid input must not read the table"
            ))
            .unwrap_err(),
            "invalid_request"
        );
        let request: HistoricalCalendarRequest = serde_json::from_str(input).unwrap();
        assert_eq!(
            resolve_calendar_with(request, |_, _| Err("time_source_unavailable")).unwrap_err(),
            "time_source_unavailable"
        );
    }

    #[cfg(feature = "virgostars-ephemeris")]
    #[test]
    #[ignore = "requires separately supplied DE441 and USNO files"]
    fn native_calendar_usno_with_local_tables() {
        use virgostars_ephemeris_core::delta_t_table::DeltaTTable;
        let directory = std::env::var_os("VIRGOSTARS_USNO_DIR").expect("USNO directory required");
        let directory = std::path::PathBuf::from(directory);
        let monthly = std::fs::read_to_string(directory.join("deltat.data")).unwrap();
        let historical = std::fs::read_to_string(directory.join("historic_deltat.data")).unwrap();
        let predictions = std::fs::read_to_string(directory.join("deltat.preds")).ok();
        let table = DeltaTTable::from_usno(&monthly, &historical, predictions.as_deref()).unwrap();
        let expected = table.delta_t(2451545.0).unwrap();
        let input = r#"{"protocolVersion":1,"body":"Moon","year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0,"deltaT":{"kind":"usno","uncertaintySeconds":3,"allowPredictions":false},"includeScenarios":true}"#;
        let result = calculate_historical_planet_calendar(serde_json::from_str(input).unwrap());
        assert_eq!(result.status, "ok");
        let planet = result.result.unwrap();
        assert_eq!(planet.delta_t_seconds, expected.delta_t_seconds);
        assert_eq!(planet.uncertainty_seconds, 3.0);
        assert_eq!(planet.usno_source_error.as_ref().unwrap().seconds, expected.uncertainty_seconds);
        assert_eq!(
            planet.delta_t_source,
            "Local USNO-format non-prediction (source unverified)"
        );
        assert!(planet.sensitivity.is_some());
    }

    #[cfg(not(feature = "virgostars-ephemeris"))]
    #[test]
    fn calendar_without_provider_never_fabricates_a_result() {
        let input = r#"{"protocolVersion":1,"body":"Moon","year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0,"deltaT":{"kind":"espenakMeeus2006","uncertaintySeconds":2}}"#;
        let result = calculate_historical_planet_calendar(serde_json::from_str(input).unwrap());
        assert_eq!(result.status, "provider_unavailable");
        assert!(result.result.is_none());
    }

    #[cfg(feature = "virgostars-ephemeris")]
    #[test]
    fn calendar_uses_ut1_and_opt_in_bounded_delta_t_model() {
        let parse = |text: &str| serde_json::from_str::<HistoricalCalendarRequest>(text).unwrap();
        let model = r#"{"protocolVersion":1,"body":"Moon","year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0,"deltaT":{"kind":"espenakMeeus2006","uncertaintySeconds":2}}"#;
        let r = resolve_calendar(parse(model)).unwrap();
        assert_eq!(r.jd_ut1, 2451545.0);
        assert!((r.delta_t_seconds - 63.86).abs() < 0.01);
        assert_eq!(r.delta_t_source, "Espenak-Meeus 2006");
        assert_eq!(r.uncertainty_seconds, 2.0);
        assert!(resolve_calendar(parse(&model.replace("2000", "-1"))).is_ok());
        assert!(resolve_calendar(parse(&model.replace("2000", "-1999"))).is_ok());
        assert!(resolve_calendar(parse(&model.replace("2000", "-2000"))).is_err());
        assert!(resolve_calendar(parse(&model.replace("2000", "3001"))).is_err());
        assert!(resolve_calendar(parse(&model.replace("\"month\":1", "\"month\":13"))).is_err());
        assert!(resolve_calendar(parse(
            &model.replace("\"uncertaintySeconds\":2", "\"uncertaintySeconds\":-1")
        ))
        .is_err());
        let supplied = r#"{"protocolVersion":1,"body":"Sun","year":-12999,"month":1,"day":1,"hour":0,"minute":0,"second":0,"deltaT":{"kind":"supplied","seconds":200,"uncertaintySeconds":50,"source":"synthetic"}}"#;
        let r = resolve_calendar(parse(supplied)).unwrap();
        assert_eq!(r.delta_t_seconds, 200.0);
        assert_eq!(r.delta_t_source, "synthetic");
        assert!(resolve_calendar(parse(&supplied.replace("-12999", "-13000"))).is_err());
        assert!(resolve_calendar(parse(&supplied.replace("-12999", "4000"))).is_err());
        let auto = r#"{"protocolVersion":1,"body":"Moon","year":0,"month":1,"day":1,"hour":0,"minute":0,"second":0,"deltaT":{"kind":"espenakMeeus2006EstimatedUncertainty"}}"#;
        let r = resolve_calendar(parse(auto)).unwrap();
        assert!((r.uncertainty_seconds - 264.992).abs() < 1.0e-8);
        assert_eq!(
            r.uncertainty_source.as_deref(),
            Some("Morrison-Stephenson 2004 standard error")
        );
        assert!(resolve_calendar(parse(&auto.replace("\"year\":0", "\"year\":-999"))).is_ok());
        assert!(resolve_calendar(parse(&auto.replace("\"year\":0", "\"year\":-1000"))).is_err());
        assert!(resolve_calendar(parse(&auto.replace("\"year\":0", "\"year\":1200"))).is_ok());
        assert!(resolve_calendar(parse(&auto.replace("\"year\":0", "\"year\":1201"))).is_err());
    }

    #[cfg(feature = "virgostars-ephemeris")]
    #[test]
    #[ignore = "requires VIRGOSTARS_DE441_PATH pointing to a local full DE441 file"]
    fn native_bridge_matches_core_with_local_de441() {
        use virgostars_ephemeris_core::calendar::{Calendar, TimeScale};
        use virgostars_ephemeris_core::calendar_decimal_hours::{julday_f64, DecimalHourDateTime};
        use virgostars_ephemeris_core::de441::{Body, De441};
        use virgostars_ephemeris_core::historical_rate_candidate::historical_three_rate_candidate;
        let path = std::env::var_os("VIRGOSTARS_DE441_PATH").expect("DE441 path required");
        let mut ephemeris = De441::open(path).expect("full DE441 required");
        for year in [-12999, 2000, 3999] {
            let jd = julday_f64(
                DecimalHourDateTime {
                    year,
                    month: 7,
                    day: 1,
                    decimal_hour: 12.0,
                    scale: TimeScale::Ut1,
                },
                Calendar::ProlepticGregorian,
            )
            .unwrap();
            for (name, body) in [
                ("Sun", Body::Sun),
                ("Moon", Body::Moon),
                ("Mercury", Body::Mercury),
                ("Pluto", Body::PlutoBarycenter),
            ] {
                let r = HistoricalPlanetRequest {
                    body: name.into(),
                    jd_ut1: jd,
                    delta_t_seconds: 64.0,
                    uncertainty_seconds: 20.0,
                    delta_t_source: "synthetic test".into(),
                    ..request()
                };
                let reference = historical_three_rate_candidate(
                    &mut ephemeris,
                    body,
                    jd,
                    64.0,
                    20.0,
                    "synthetic test",
                )
                .unwrap();
                let response = calculate_historical_planet(r);
                assert_eq!(response.status, "ok");
                let wire = serde_json::to_value(&response).unwrap();
                assert_eq!(wire["protocolVersion"], 1);
                assert_eq!(wire["result"]["jdUt1"], jd);
                assert_eq!(wire["result"]["deltaTSource"], "synthetic test");
                assert!(wire["result"].get("sensitivity").is_none());
                assert!(wire["result"]["longitudeSpeedDegPerTdbDay"].is_number());
                assert!(wire["result"]["latitudeSpeedDegPerTdbDay"].is_number());
                assert!(wire["result"]["radialSpeedAuPerTdbDay"].is_number());
                let actual = response.result.unwrap();
                assert_eq!(actual.jd_tdb, reference.epoch.jd_tdb.0);
                assert_eq!(actual.longitude_deg, reference.rates.base.longitude_deg);
                assert_eq!(actual.latitude_deg, reference.rates.base.latitude_deg);
                assert_eq!(actual.distance_au, reference.rates.base.distance_au);
                assert_eq!(
                    actual.longitude_speed_deg_per_tdb_day,
                    reference.rates.longitude_deg_per_tdb_day
                );
                assert_eq!(
                    actual.latitude_speed_deg_per_tdb_day,
                    reference.rates.latitude_deg_per_tdb_day
                );
                assert_eq!(
                    actual.radial_speed_au_per_tdb_day,
                    reference.rates.radial_au_per_tdb_day
                );
                assert_eq!(
                    actual.radial_correction_applied,
                    reference.rates.radial_correction_applied
                );
                assert_eq!(actual.delta_t_source, "synthetic test");
            }
        }
        let r = HistoricalPlanetRequest {
            jd_ut1: 1.0e9,
            ..request()
        };
        assert_eq!(calculate_historical_planet(r).status, "calculation_failed");
        let input = r#"{"protocolVersion":1,"body":"Moon","year":2000,"month":1,"day":1,"hour":12,"minute":0,"second":0,"deltaT":{"kind":"espenakMeeus2006","uncertaintySeconds":2}}"#;
        let output = calculate_historical_planet_calendar(serde_json::from_str(input).unwrap());
        assert_eq!(output.status, "ok");
        let result = output.result.unwrap();
        assert_eq!(result.jd_ut1, 2451545.0);
        assert_eq!(result.delta_t_source, "Espenak-Meeus 2006");
        assert!((result.delta_t_seconds - 63.86).abs() < 0.01);
        let input = r#"{"protocolVersion":1,"body":"Moon","year":-500,"month":1,"day":1,"hour":0,"minute":0,"second":0,"deltaT":{"kind":"espenakMeeus2006EstimatedUncertainty"},"includeScenarios":true}"#;
        let output = calculate_historical_planet_calendar(serde_json::from_str(input).unwrap());
        assert_eq!(output.status, "ok");
        let result = output.result.unwrap();
        assert!((result.delta_t_seconds - 17203.7).abs() < 0.1);
        assert!((result.uncertainty_seconds - 430.592).abs() < 1.0e-8);
        assert_eq!(
            result.uncertainty_source.as_deref(),
            Some("Morrison-Stephenson 2004 standard error")
        );
        assert!(result.sensitivity.is_some());
        use virgostars_ephemeris_core::historical_delta_t_scenarios::{
            historical_delta_t_scenarios, ScenarioFrame,
        };
        let samples = historical_delta_t_scenarios(
            &mut ephemeris,
            Body::Moon,
            2451545.0,
            64.0,
            3600.0,
            ScenarioFrame::DirectObliquity,
        )
        .unwrap();
        let r = HistoricalPlanetRequest {
            jd_ut1: 2451545.0,
            delta_t_seconds: 64.0,
            uncertainty_seconds: 3600.0,
            include_scenarios: true,
            ..request()
        };
        let output = calculate_historical_planet(r);
        assert_eq!(output.status, "ok");
        let sensitivity = output.result.unwrap().sensitivity.unwrap();
        assert_eq!(
            sensitivity.lower.delta_t_seconds,
            samples.lower.epoch.delta_t_seconds
        );
        assert_eq!(
            sensitivity.lower.longitude_deg,
            samples.lower.fields.longitude_deg
        );
        assert_eq!(
            sensitivity.upper.delta_t_seconds,
            samples.upper.epoch.delta_t_seconds
        );
        assert_eq!(
            sensitivity.upper.longitude_deg,
            samples.upper.fields.longitude_deg
        );
        let r = HistoricalPlanetRequest {
            jd_ut1: 2451545.0,
            delta_t_seconds: 64.0,
            uncertainty_seconds: 1.0e-20,
            include_scenarios: true,
            ..request()
        };
        assert_eq!(calculate_historical_planet(r).status, "calculation_failed");
    }
}
