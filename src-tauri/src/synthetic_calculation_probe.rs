//! Synthetic-only CPU/IPC benchmark, NOT VirgoStars-Ephemeris.
//! No chart/birth fields, network, storage, planetary positions, accounts or UI claims.
use serde::{Deserialize, Serialize};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use std::time::Instant;
use tauri::State;

const MAX_ACTIVE: usize = 2;
const MAX_ITERATIONS: u32 = 200_000;
const MAX_SAFE_JS_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyntheticProbeInput {
    seed: u32,
    iterations: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SyntheticProbeRequest {
    protocol_version: u8,
    session_id: String,
    request_seq: u64,
    calculation_key: String,
    input: SyntheticProbeInput,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntheticProbeResult {
    synthetic_only: bool,
    fixture_kind: &'static str,
    iterations: u32,
    checksum_hex: String,
    /// CPU work only; excludes Angular/Tauri IPC and scheduling latency.
    worker_micros: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyntheticProbeResponse {
    protocol_version: u8,
    session_id: String,
    request_seq: u64,
    calculation_key: String,
    result: SyntheticProbeResult,
}

#[derive(Default)]
pub struct SyntheticProbeGate {
    active: Arc<AtomicUsize>,
}
struct WorkPermit(Arc<AtomicUsize>);
impl Drop for WorkPermit {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::AcqRel);
    }
}
impl SyntheticProbeGate {
    fn try_acquire(&self) -> Option<WorkPermit> {
        self.active
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < MAX_ACTIVE).then_some(n + 1)
            })
            .ok()
            .map(|_| WorkPermit(Arc::clone(&self.active)))
    }
}

fn valid_token(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b':'))
}
fn validate(request: &SyntheticProbeRequest) -> Result<(), &'static str> {
    if request.protocol_version != 1 {
        return Err("SYNTHETIC_PROTOCOL_UNSUPPORTED");
    }
    if !valid_token(&request.session_id)
        || !valid_token(&request.calculation_key)
        || request.request_seq == 0
        || request.request_seq > MAX_SAFE_JS_INTEGER
        || request.input.iterations == 0
        || request.input.iterations > MAX_ITERATIONS
    {
        return Err("SYNTHETIC_INVALID_REQUEST");
    }
    Ok(())
}

/// Fully deterministic integer work for IPC profiling only, not astronomy.
/// A tiny fixed-size result bounds serialized output independently of iterations.
fn run_probe(request: SyntheticProbeRequest) -> SyntheticProbeResponse {
    let started = Instant::now();
    let mut checksum: u32 = 2_166_136_261;
    for index in 0..request.input.iterations {
        checksum = (checksum ^ request.input.seed.wrapping_add(index))
            .wrapping_mul(16_777_619);
    }
    let elapsed = started.elapsed().as_micros().min(u128::from(u32::MAX)) as u32;
    SyntheticProbeResponse {
        protocol_version: 1,
        session_id: request.session_id,
        request_seq: request.request_seq,
        calculation_key: request.calculation_key,
        result: SyntheticProbeResult {
            synthetic_only: true,
            fixture_kind: "synthetic_ipc_probe",
            iterations: request.input.iterations,
            checksum_hex: format!("{checksum:08x}"),
            worker_micros: elapsed,
        },
    }
}

/// Two native worker permits globally; additional calls fail *before* spawn.
/// The TypeScript latest-only queue owns per-chart coalescing.
#[tauri::command]
pub async fn synthetic_calculation_probe(
    request: SyntheticProbeRequest,
    gate: State<'_, SyntheticProbeGate>,
) -> Result<SyntheticProbeResponse, String> {
    validate(&request).map_err(str::to_owned)?;
    let permit = gate.try_acquire().ok_or("SYNTHETIC_BUSY")?;
    tauri::async_runtime::spawn_blocking(move || {
        let _permit = permit;
        run_probe(request)
    })
    .await
    .map_err(|_| "SYNTHETIC_WORKER_FAILED".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(iterations: u32) -> SyntheticProbeRequest {
        SyntheticProbeRequest {
            protocol_version: 1,
            session_id: "chart-synthetic".into(),
            request_seq: 42,
            calculation_key: "time:synthetic".into(),
            input: SyntheticProbeInput { seed: 17, iterations },
        }
    }

    #[test]
    fn deterministic_checksum_and_unambiguous_marker() {
        let first = run_probe(request(20_000));
        let second = run_probe(request(20_000));
        assert_eq!(first.result.checksum_hex, second.result.checksum_hex);
        assert_eq!(first.result.checksum_hex.len(), 8);
        assert_eq!(first.result.fixture_kind, "synthetic_ipc_probe");
        assert!(first.result.synthetic_only);
        assert_eq!(first.result.iterations, 20_000);
        assert_eq!(first.session_id, "chart-synthetic");
        assert_eq!(first.request_seq, 42);
    }

    #[test]
    fn malformed_protocol_or_overlarge_work_is_rejected() {
        assert_eq!(validate(&request(0)), Err("SYNTHETIC_INVALID_REQUEST"));
        assert_eq!(
            validate(&request(MAX_ITERATIONS + 1)),
            Err("SYNTHETIC_INVALID_REQUEST")
        );
        let mut invalid = request(1);
        invalid.protocol_version = 2;
        assert_eq!(validate(&invalid), Err("SYNTHETIC_PROTOCOL_UNSUPPORTED"));
        invalid.protocol_version = 1;
        invalid.session_id = "birth info should not be sent".into();
        assert_eq!(validate(&invalid), Err("SYNTHETIC_INVALID_REQUEST"));
        invalid.session_id = "ok".into();
        invalid.request_seq = MAX_SAFE_JS_INTEGER + 1;
        assert_eq!(validate(&invalid), Err("SYNTHETIC_INVALID_REQUEST"));
    }

    #[test]
    fn native_gate_is_bounded_and_drop_releases_capacity() {
        let gate = SyntheticProbeGate::default();
        let a = gate.try_acquire().expect("first permit");
        let b = gate.try_acquire().expect("second permit");
        assert!(gate.try_acquire().is_none());
        drop(a);
        let c = gate.try_acquire().expect("released permit");
        drop(b);
        drop(c);
        assert_eq!(gate.active.load(Ordering::Acquire), 0);
    }

    #[test]
    fn camel_case_round_trip_and_no_planetary_payload() {
        let fixture = serde_json::json!({
            "protocolVersion": 1,
            "sessionId": "chart-synthetic",
            "requestSeq": 1,
            "calculationKey": "benchmark",
            "input": { "seed": 123, "iterations": 10 }
        });
        let request: SyntheticProbeRequest = serde_json::from_value(fixture).unwrap();
        assert!(validate(&request).is_ok());
        let response = serde_json::to_value(run_probe(request)).unwrap();
        assert_eq!(response["result"]["syntheticOnly"], true);
        assert_eq!(response["result"]["fixtureKind"], "synthetic_ipc_probe");
        assert_eq!(response["protocolVersion"], 1);
        assert_eq!(response["sessionId"], "chart-synthetic");
        assert!(response.get("planets").is_none());
        assert!(response["result"].get("positions").is_none());
    }

    #[test]
    fn reject_unknown_input_fields() {
        let input = serde_json::json!({
            "protocolVersion": 1,
            "sessionId": "chart",
            "requestSeq": 1,
            "calculationKey": "benchmark",
            "input": { "seed": 1, "iterations": 1, "birthName": "not allowed" }
        });
        assert!(serde_json::from_value::<SyntheticProbeRequest>(input).is_err());
    }
}
