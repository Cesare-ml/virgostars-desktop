//! Versioned read-only provider boundary for natal solar events.
//!
//! The pinned VirgoStars-Ephemeris core still has no reviewed rise/set API.
//! The production provider is therefore deliberately absent; tests use a
//! fixture provider, never an astronomical approximation in Desktop.
use crate::chart_calculation::{self, ChartRequestV1, ValidatedRequest};
use serde::Serialize;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SolarObserverV1 {
    pub latitude_deg: f64,
    pub longitude_deg_east: f64,
    pub elevation_meters: f64,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SolarModelV1 {
    pub horizon_definition_id: String,
    pub refraction_model_id: String,
    pub event_algorithm_id: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SolarSourceV1 {
    pub engine_id: &'static str,
    pub engine_version: String,
    pub kernel_set_id: String,
    pub time_model_id: String,
    /// Provider metadata is NOT independent scientific verification.
    pub evidence: &'static str,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "availability")]
pub enum SolarEventWindowV1 {
    #[serde(rename = "AVAILABLE")]
    Available {
        #[serde(rename = "sunriseUtc")]
        sunrise_utc: String,
        #[serde(rename = "sunsetUtc")]
        sunset_utc: String,
        #[serde(rename = "nextSunriseUtc")]
        next_sunrise_utc: String,
    },
    #[serde(rename = "UNAVAILABLE")]
    Unavailable { reason: &'static str },
}

/// Actual sunrise preceding the instant, sunset, then the following sunrise.
/// The local weekday belongs to Angular, derived from sunrise and IANA zone;
/// it must never be guessed from the UTC birth date or longitude.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SolarEventSnapshotV1 {
    pub observer: SolarObserverV1,
    pub model: SolarModelV1,
    pub source: SolarSourceV1,
    pub events: SolarEventWindowV1,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SolarEventsResponseV1 {
    pub protocol_version: u8,
    pub status: &'static str,
    pub snapshot: Option<SolarEventSnapshotV1>,
}

#[derive(Debug, Clone, Copy)]
pub struct SolarProviderError;

/// The reviewed VirgoStars-Ephemeris adapter will implement this port.
/// It must find the solar day *containing* the UTC instant, including births
/// before sunrise, and return explicit unavailable states at polar latitudes.
pub trait SolarEventsProvider: Send + Sync {
    fn covers(&self, _request: &ValidatedRequest) -> bool { true }
    fn events(&self, request: &ValidatedRequest) -> Result<SolarEventSnapshotV1, SolarProviderError>;
}

fn failure(status: &'static str) -> SolarEventsResponseV1 {
    SolarEventsResponseV1 { protocol_version: 1, status, snapshot: None }
}

/// Pure native response policy: independent of Tauri and JPL file availability.
pub fn respond(provider: Option<&dyn SolarEventsProvider>, request: &ChartRequestV1) -> SolarEventsResponseV1 {
    let Some(valid) = chart_calculation::validate(request) else {
        return failure("invalid_request");
    };
    let Some(provider) = provider else {
        return failure("provider_unavailable");
    };
    if !provider.covers(&valid) {
        return failure("out_of_range");
    }
    match provider.events(&valid) {
        Ok(snapshot) => SolarEventsResponseV1 { protocol_version: 1, status: "ok", snapshot: Some(snapshot) },
        Err(SolarProviderError) => failure("calculation_failed"),
    }
}

fn active_provider() -> Option<&'static dyn SolarEventsProvider> {
    // The stacked Ephemeris solar-event PRs are not part of the pinned revision.
    None
}

#[tauri::command]
pub fn calculate_solar_events(request: ChartRequestV1) -> SolarEventsResponseV1 {
    respond(active_provider(), &request)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn natal(utc: &str) -> ChartRequestV1 {
        ChartRequestV1 {
            protocol_version: 1,
            utc_iso: utc.to_owned(),
            lat_micro: 41_902_800,
            lng_micro: 12_496_400,
        }
    }

    #[test]
    fn valid_natal_never_receives_invented_sun_events() {
        let result = respond(active_provider(), &natal("2024-06-20T10:00:00.000Z"));
        assert_eq!(result.status, "provider_unavailable");
        assert_eq!(result.snapshot, None);
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["protocolVersion"], 1);
        assert!(json["snapshot"].is_null());
    }

    #[test]
    fn malformed_natal_is_rejected_before_provider_selection() {
        assert_eq!(respond(None, &natal("2024-02-30T10:00:00Z")).status, "invalid_request");
        let mut wrong_place = natal("2024-06-20T10:00:00Z");
        wrong_place.lat_micro = 91_000_000;
        assert_eq!(respond(None, &wrong_place).status, "invalid_request");
    }

    fn fixture(events: SolarEventWindowV1) -> SolarEventSnapshotV1 {
        SolarEventSnapshotV1 {
            observer: SolarObserverV1 { latitude_deg: 41.9028, longitude_deg_east: 12.4964, elevation_meters: 0.0 },
            model: SolarModelV1 {
                horizon_definition_id: "USNO_MINUS_50_ARCMIN".into(),
                refraction_model_id: "STANDARD".into(),
                event_algorithm_id: "FIXTURE_ONLY".into(),
            },
            source: SolarSourceV1 {
                engine_id: "VIRGOSTARS_EPHEMERIS",
                engine_version: "0.0.0-test".into(),
                kernel_set_id: "SYNTHETIC".into(),
                time_model_id: "UTC_FIXTURE".into(),
                evidence: "CALLER_ASSERTED_NOT_VERIFIED",
            },
            events,
        }
    }

    struct FixedProvider(Result<SolarEventSnapshotV1, SolarProviderError>);
    impl SolarEventsProvider for FixedProvider {
        fn events(&self, _request: &ValidatedRequest) -> Result<SolarEventSnapshotV1, SolarProviderError> {
            self.0.clone()
        }
    }

    struct OutOfRange;
    impl SolarEventsProvider for OutOfRange {
        fn covers(&self, _request: &ValidatedRequest) -> bool { false }
        fn events(&self, _request: &ValidatedRequest) -> Result<SolarEventSnapshotV1, SolarProviderError> {
            panic!("a rejected epoch must never reach the solar provider")
        }
    }

    #[test]
    fn the_fixture_port_serializes_previous_day_sunrise_without_guessing_weekday() {
        let provider = FixedProvider(Ok(fixture(SolarEventWindowV1::Available {
            sunrise_utc: "2024-06-19T03:00:00.000Z".into(),
            sunset_utc: "2024-06-19T19:00:00.000Z".into(),
            next_sunrise_utc: "2024-06-20T03:00:00.000Z".into(),
        })));
        let result = respond(Some(&provider), &natal("2024-06-20T02:00:00.000Z"));
        assert_eq!(result.status, "ok");
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["snapshot"]["events"]["sunriseUtc"], "2024-06-19T03:00:00.000Z");
        assert_eq!(json["snapshot"]["events"]["availability"], "AVAILABLE");
        assert_eq!(json["snapshot"]["observer"]["longitudeDegEast"], 12.4964);
        assert!(json["snapshot"].get("weekday").is_none());
    }

    #[test]
    fn polar_unavailability_is_distinct_from_error_and_out_of_range() {
        let polar = FixedProvider(Ok(fixture(SolarEventWindowV1::Unavailable { reason: "POLAR_NIGHT" })));
        let result = respond(Some(&polar), &natal("2024-06-20T10:00:00Z"));
        assert_eq!(result.status, "ok");
        assert_eq!(serde_json::to_value(&result).unwrap()["snapshot"]["events"]["reason"], "POLAR_NIGHT");
        let broken = FixedProvider(Err(SolarProviderError));
        assert_eq!(respond(Some(&broken), &natal("2024-06-20T10:00:00Z")).status, "calculation_failed");
        assert_eq!(respond(Some(&OutOfRange), &natal("2024-06-20T10:00:00Z")).status, "out_of_range");
    }
}
