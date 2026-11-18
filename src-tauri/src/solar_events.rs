//! Reserved read-only boundary for natal solar events.
//!
//! The pinned VirgoStars-Ephemeris core does not yet expose reviewed rise/set
//! calculations. Never substitute a calendar approximation or synthetic events.
use serde::Serialize;
use crate::chart_calculation::{self, ChartRequestV1};

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SolarEventsResponseV1 {
    pub protocol_version: u8,
    pub status: &'static str,
    // When an independently reviewed provider is connected, a versioned solar
    // event snapshot will be exposed here. Today it is always absent.
    pub snapshot: Option<()>,
}

fn respond(request: &ChartRequestV1) -> SolarEventsResponseV1 {
    SolarEventsResponseV1 {
        protocol_version: 1,
        status: if chart_calculation::validate(request).is_some() {
            "provider_unavailable"
        } else {
            "invalid_request"
        },
        snapshot: None,
    }
}

#[tauri::command]
pub fn calculate_solar_events(request: ChartRequestV1) -> SolarEventsResponseV1 {
    respond(&request)
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
        let result = respond(&natal("2024-06-20T10:00:00.000Z"));
        assert_eq!(result.status, "provider_unavailable");
        assert_eq!(result.snapshot, None);
        let json = serde_json::to_value(&result).unwrap();
        assert_eq!(json["protocolVersion"], 1);
        assert!(json["snapshot"].is_null());
    }

    #[test]
    fn malformed_natal_is_rejected_before_provider_selection() {
        assert_eq!(respond(&natal("2024-02-30T10:00:00Z")).status, "invalid_request");
        let mut wrong_place = natal("2024-06-20T10:00:00Z");
        wrong_place.lat_micro = 91_000_000;
        assert_eq!(respond(&wrong_place).status, "invalid_request");
    }
}
