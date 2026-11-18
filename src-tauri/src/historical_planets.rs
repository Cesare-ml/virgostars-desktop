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
}

impl HistoricalPlanetRequest {
    fn valid(&self) -> bool {
        self.protocol_version == 1
            && matches!(
                self.body.as_str(),
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
            && [self.jd_ut1, self.delta_t_seconds, self.uncertainty_seconds]
                .iter()
                .all(|x| x.is_finite())
            && self.uncertainty_seconds >= 0.0
            && !self.delta_t_source.trim().is_empty()
            && self.delta_t_source.len() <= 200
    }
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
    pub longitude_deg: f64,
    pub latitude_deg: f64,
    pub distance_au: f64,
    pub longitude_speed_deg_per_tdb_day: f64,
    pub latitude_speed_deg_per_tdb_day: f64,
    pub radial_speed_au_per_tdb_day: f64,
    pub radial_correction_applied: bool,
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
    }
}
