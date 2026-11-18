//! Versioned, disabled-by-default native account IPC boundary.
//!
//! This is deliberately **not** an authentication command. It validates the
//! exact public request shape, but never launches a browser, exchanges a code,
//! reads the registry's secret state, or returns account credentials.
#![allow(dead_code)]

use crate::pkce_native_registry::NativeLoginRegistry;
use serde_json::Value;
use tauri::State;

const PROTOCOL_VERSION: u64 = 1;
const NATIVE_UNAVAILABLE: &str = "native_unavailable";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DisabledConnectedAccountReply {
    protocol_version: u8,
    status: &'static str,
}

fn valid_attempt_id(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 36 || b[8] != b'-' || b[13] != b'-' || b[18] != b'-' || b[23] != b'-'
        || b[14] != b'4' || !matches!(b[19], b'8' | b'9' | b'a' | b'b') {
        return false;
    }
    b.iter().enumerate().all(|(i, c)| match i {
        8 | 13 | 18 | 23 => *c == b'-',
        _ => c.is_ascii_digit() || (b'a'..=b'f').contains(c),
    })
}

fn valid_request(value: &Value) -> bool {
    let Some(obj) = value.as_object() else { return false; };
    if obj.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
        return false;
    }
    match obj.get("operation").and_then(Value::as_str) {
        Some("start") => obj.len() == 2 && obj.contains_key("protocolVersion") && obj.contains_key("operation"),
        Some("status" | "cancel") => {
            obj.len() == 3 && obj.contains_key("protocolVersion") && obj.contains_key("operation") &&
                obj.get("attemptId").and_then(Value::as_str).is_some_and(valid_attempt_id)
        }
        _ => false,
    }
}

/// Intentionally registered as Tauri IPC but always returns disabled, even
/// when Angular's local feature flag is accidentally enabled. The managed
/// registry is injected to prove a single native owner exists; it is never
/// queried or mutated by this stub. No credentials can cross this boundary.
#[tauri::command]
pub fn desktop_connected_account_v1(
    request: Value,
    _registry: State<'_, NativeLoginRegistry>,
) -> Result<DisabledConnectedAccountReply, &'static str> {
    if !valid_request(&request) { return Err(NATIVE_UNAVAILABLE); }
    Ok(DisabledConnectedAccountReply { protocol_version: 1, status: "disabled" })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const UUID: &str = "123e4567-e89b-42d3-a456-426614174000";

    #[test]
    fn only_exact_data_only_v1_operations_are_accepted() {
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"start"})));
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"status","attemptId":UUID})));
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"cancel","attemptId":UUID})));
        for invalid in [
            json!({"protocolVersion":2,"operation":"start"}),
            json!({"protocolVersion":1,"operation":"start","attemptId":null}),
            json!({"protocolVersion":1,"operation":"start","redirectUri":"http://127.0.0.1"}),
            json!({"protocolVersion":1,"operation":"status"}),
            json!({"protocolVersion":1,"operation":"status","attemptId":null}),
            json!({"protocolVersion":1,"operation":"status","attemptId":"wrong"}),
            json!({"protocolVersion":1,"operation":"cancel","attemptId":UUID,"token":"secret"}),
            json!({"protocolVersion":1,"operation":"disconnect","attemptId":UUID}),
            json!([1,"start"]),
        ] {
            assert!(!valid_request(&invalid));
        }
    }

    #[test]
    fn disabled_response_has_exactly_two_public_fields() {
        let value = serde_json::to_value(DisabledConnectedAccountReply {
            protocol_version:1, status:"disabled",
        }).unwrap();
        assert_eq!(value, json!({"protocolVersion":1,"status":"disabled"}));
        assert!(value.get("attemptId").is_none());
        assert!(value.get("accessToken").is_none());
        assert!(value.get("deviceId").is_none());
    }
}
