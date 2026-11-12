//! Experimental, local-only Tauri calculation handshake. No ephemeris is wired.
//! The only successful response is unavailable, never invented sky positions.
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::State;

const MAX_ACTIVE_PROBES: usize = 1;
const MAX_JS_SAFE_SEQ: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CalculationIntent {
    Now,
    Scrub,
    Preview,
    Committed,
    Transit,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CalculationProbeRequestV1 {
    protocol_version: u8,
    session_id: String,
    request_seq: u64,
    intent: CalculationIntent,
    utc_iso: String,
    lat_micro: i32,
    lng_micro: i32,
    time_zone: String,
    calculation_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculationProbeReplyV1 {
    protocol_version: u8,
    session_id: String,
    request_seq: u64,
    calculation_key: String,
    status: &'static str,
    reason_code: &'static str,
}

#[derive(Default)]
pub struct CalculationProbeGate {
    active: Arc<AtomicUsize>,
}

struct CalculationPermit(Arc<AtomicUsize>);
impl Drop for CalculationPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}

impl CalculationProbeGate {
    fn try_reserve(&self) -> Option<CalculationPermit> {
        self.active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < MAX_ACTIVE_PROBES).then_some(n + 1)
            })
            .ok()
            .map(|_| CalculationPermit(Arc::clone(&self.active)))
    }
}

fn all_ascii(bytes: &[u8], allowed: impl Fn(u8) -> bool) -> bool {
    !bytes.is_empty() && bytes.iter().copied().all(allowed)
}

fn valid_zone(zone: &str) -> bool {
    if zone.is_empty() || zone.len() > 80 { return false; }
    let mut parts = zone.split('/');
    let first = parts.next().unwrap_or_default();
    all_ascii(first.as_bytes(), |b| b.is_ascii_alphabetic() || b == b'_') &&
        parts.all(|part| all_ascii(part.as_bytes(),
            |b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'+' | b'-')))
}

fn digits(bytes: &[u8]) -> u32 {
    bytes.iter().fold(0, |n, b| n * 10 + u32::from(*b - b'0'))
}

// Input hygiene only: this is NOT an astronomical time-scale conversion.
fn valid_utc_iso(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 24 { return false; }
    for (index, byte) in b.iter().enumerate() {
        let expected = match index {
            4 | 7 => Some(b'-'), 10 => Some(b'T'), 13 | 16 => Some(b':'),
            19 => Some(b'.'), 23 => Some(b'Z'), _ => None,
        };
        if let Some(symbol) = expected {
            if *byte != symbol { return false; }
        } else if !byte.is_ascii_digit() { return false; }
    }
    let year = digits(&b[..4]);
    let month = digits(&b[5..7]);
    let day = digits(&b[8..10]);
    let hour = digits(&b[11..13]);
    let minute = digits(&b[14..16]);
    let second = digits(&b[17..19]);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    day >= 1 && day <= max_day && hour <= 23 && minute <= 59 && second <= 59
}

fn valid_request(request: &CalculationProbeRequestV1) -> bool {
    request.protocol_version == 1 &&
    matches!(request.intent, CalculationIntent::Now | CalculationIntent::Scrub |
        CalculationIntent::Preview | CalculationIntent::Committed | CalculationIntent::Transit) &&
    request.request_seq >= 1 && request.request_seq <= MAX_JS_SAFE_SEQ &&
    request.session_id.len() <= 80 && all_ascii(request.session_id.as_bytes(),
        |b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-')) &&
    valid_utc_iso(&request.utc_iso) &&
    i64::from(request.lat_micro).abs() <= 90_000_000 &&
    i64::from(request.lng_micro).abs() <= 180_000_000 &&
    valid_zone(&request.time_zone) &&
    request.calculation_key.len() <= 128 && all_ascii(request.calculation_key.as_bytes(),
        |b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'.' | b':' | b'-'))
}

fn unavailable(request: CalculationProbeRequestV1) -> CalculationProbeReplyV1 {
    CalculationProbeReplyV1 {
        protocol_version: 1,
        session_id: request.session_id,
        request_seq: request.request_seq,
        calculation_key: request.calculation_key,
        status: "unavailable",
        reason_code: "EPHEMERIS_NOT_INTEGRATED",
    }
}

/// Dedicated command, distinct from desktop_runtime_info. Never accesses a kernel.
/// Single native worker slot; additional calls fail fast rather than waiting.
#[tauri::command]
pub async fn desktop_calculation_probe(
    gate: State<'_, CalculationProbeGate>,
    request: CalculationProbeRequestV1,
) -> Result<CalculationProbeReplyV1, &'static str> {
    if !valid_request(&request) { return Err("CALC_REQUEST_INVALID"); }
    let permit = gate.try_reserve().ok_or("CALC_WORKER_BUSY")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        // This intentionally is NOT a fake planetary calculation.
        unavailable(request)
    })
    .await
    .map_err(|_| "CALC_WORKER_FAILURE")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> CalculationProbeRequestV1 {
        CalculationProbeRequestV1 {
            protocol_version: 1, session_id: "session_A".into(), request_seq: 2,
            intent: CalculationIntent::Now,
            utc_iso: "2026-11-12T12:00:00.000Z".into(),
            lat_micro: 44_123_456, lng_micro: 11_345_678,
            time_zone: "Europe/Rome".into(), calculation_key: "test.key:2".into(),
        }
    }

    #[test]
    fn rejects_invalid_civil_dates_and_leap_seconds() {
        assert!(valid_utc_iso("2024-02-29T23:59:59.999Z"));
        for value in ["2026-02-29T23:59:59.000Z", "2026-11-31T12:00:00.000Z",
            "2026-11-12T24:00:00.000Z", "2026-11-12T12:00:60.000Z",
            "2026-11-12T12:00:00+01:00", "not-a-date"] {
            assert!(!valid_utc_iso(value), "unexpected valid date: {value}");
        }
    }

    #[test]
    fn validates_request_bounds_and_unsupported_protocol() {
        assert!(valid_request(&sample()));
        let mut req = sample(); req.request_seq = 0;
        assert!(!valid_request(&req));
        let mut req = sample(); req.request_seq = MAX_JS_SAFE_SEQ + 1;
        assert!(!valid_request(&req));
        let mut req = sample(); req.lat_micro = 90_000_001;
        assert!(!valid_request(&req));
        let mut req = sample(); req.lat_micro = i32::MIN;
        assert!(!valid_request(&req));
        let mut req = sample(); req.time_zone = "https://example.com".into();
        assert!(!valid_request(&req));
        let mut req = sample(); req.protocol_version = 2;
        assert!(!valid_request(&req));
    }

    #[test]
    fn rejects_unexpected_json_fields_and_unrecognized_intents() {
        let mut input = serde_json::json!({
            "protocolVersion": 1, "sessionId": "session_A", "requestSeq": 2,
            "intent": "now", "utcIso": "2026-11-12T12:00:00.000Z",
            "latMicro": 44123456, "lngMicro": 11345678,
            "timeZone": "Europe/Rome", "calculationKey": "test.key:2"
        });
        assert!(serde_json::from_value::<CalculationProbeRequestV1>(input.clone()).is_ok());
        input["unknownField"] = serde_json::json!(true);
        assert!(serde_json::from_value::<CalculationProbeRequestV1>(input.clone()).is_err());
        input.as_object_mut().unwrap().remove("unknownField");
        input["intent"] = serde_json::json!("import_database");
        assert!(serde_json::from_value::<CalculationProbeRequestV1>(input).is_err());
    }

    #[test]
    fn gate_never_allows_more_than_one_active_native_slot() {
        let gate = CalculationProbeGate::default();
        let permit = gate.try_reserve().expect("first native slot");
        assert!(gate.try_reserve().is_none());
        drop(permit);
        assert!(gate.try_reserve().is_some());
    }

    #[test]
    fn always_reports_explicit_unavailable_without_any_sky_snapshot() {
        let result = serde_json::to_value(unavailable(sample())).unwrap();
        assert_eq!(result["protocolVersion"], 1);
        assert_eq!(result["sessionId"], "session_A");
        assert_eq!(result["requestSeq"], 2);
        assert_eq!(result["calculationKey"], "test.key:2");
        assert_eq!(result["status"], "unavailable");
        assert_eq!(result["reasonCode"], "EPHEMERIS_NOT_INTEGRATED");
        assert!(result.get("snapshot").is_none());
        assert!(result.get("providerVersion").is_none());
    }
}
