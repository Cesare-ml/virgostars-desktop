//! Versioned native account IPC. Default builds remain disabled. An explicit
//! staging-only build can expose narrowly scoped, credential-free status.
#![allow(dead_code)]

use crate::pkce_native_registry::NativeLoginRegistry;
use serde_json::Value;
use tauri::State;
#[cfg(feature = "staging-connected-account")]
use tauri::Manager;

const PROTOCOL_VERSION: u64 = 1;
const NATIVE_UNAVAILABLE: &str = "native_unavailable";

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedAccountReply {
    protocol_version: u8,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    attempt_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    expires_in_seconds: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    scope: Option<&'static str>,
}

impl ConnectedAccountReply {
    fn disabled() -> Self { Self { protocol_version: 1, status: "disabled", attempt_id: None, expires_in_seconds: None, scope: None } }
    #[cfg(feature = "staging-connected-account")]
    fn status(status: &'static str, attempt_id: String) -> Self {
        Self { protocol_version: 1, status, attempt_id: Some(attempt_id), expires_in_seconds: None, scope: None }
    }
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
        Some("status" | "cancel" | "disconnect") => {
            obj.len() == 3 && obj.contains_key("protocolVersion") && obj.contains_key("operation") &&
                obj.get("attemptId").and_then(Value::as_str).is_some_and(valid_attempt_id)
        }
        _ => false,
    }
}

/// Only a specifically built staging client with two explicit native endpoints
/// may start a login. Endpoint validation remains in the native flow.
#[tauri::command]
pub async fn desktop_connected_account_v1(
    request: Value,
    _registry: State<'_, NativeLoginRegistry>,
    _app: tauri::AppHandle,
) -> Result<ConnectedAccountReply, &'static str> {
    if !valid_request(&request) { return Err(NATIVE_UNAVAILABLE); }
    #[cfg(feature = "staging-connected-account")]
    {
        use crate::pkce_native_registry::NativeRegistrySnapshot;
        use crate::pkce_native_session::NativeLoginPhase;
        let (Some(consent), Some(token)) = (option_env!("VIRGOSTARS_DESKTOP_STAGING_CONSENT"),
            option_env!("VIRGOSTARS_DESKTOP_STAGING_TOKEN")) else { return Ok(ConnectedAccountReply::disabled()); };
        if crate::pkce_login::valid_consent_origin(consent).is_none()
            || crate::pkce_token_exchange::valid_staging_token_endpoint(token).is_none() {
            return Ok(ConnectedAccountReply::disabled());
        }
        let operation = request["operation"].as_str().ok_or(NATIVE_UNAVAILABLE)?;
        if operation == "start" {
            let app = _app.clone();
            let id = tauri::async_runtime::spawn_blocking(move || {
                let registry = app.state::<NativeLoginRegistry>();
                registry.start(&crate::system_browser::OsDefaultBrowser,
                    crate::pkce_reqwest_https::StagingReqwestHttps, consent, token,
                    std::time::Duration::from_secs(600))
            }).await.map_err(|_| NATIVE_UNAVAILABLE)?.map_err(|_| NATIVE_UNAVAILABLE)?;
            let mut reply = ConnectedAccountReply::status("pending", id);
            reply.expires_in_seconds = Some(600);
            return Ok(reply);
        }
        let attempt_id = request["attemptId"].as_str().ok_or(NATIVE_UNAVAILABLE)?;
        if operation == "cancel" {
            if !_registry.cancel(attempt_id) { return Err(NATIVE_UNAVAILABLE); }
            return Ok(ConnectedAccountReply::status("cancelled", attempt_id.to_owned()));
        }
        if operation == "disconnect" {
            if !_registry.disconnect(attempt_id) { return Err(NATIVE_UNAVAILABLE); }
            return Ok(ConnectedAccountReply::status("disconnected", attempt_id.to_owned()));
        }
        let NativeRegistrySnapshot::Active(snapshot) = _registry.snapshot() else { return Err(NATIVE_UNAVAILABLE); };
        if snapshot.attempt_id != attempt_id { return Err(NATIVE_UNAVAILABLE); }
        let phase = match snapshot.phase {
            NativeLoginPhase::Pending => "pending", NativeLoginPhase::Connected => "connected",
            NativeLoginPhase::Denied => "denied", NativeLoginPhase::Expired => "expired",
            NativeLoginPhase::Cancelled => "cancelled", NativeLoginPhase::Disconnected => "disconnected",
            NativeLoginPhase::Failed => "failed",
        };
        let mut reply = ConnectedAccountReply::status(phase, snapshot.attempt_id);
        if phase == "pending" { reply.expires_in_seconds = Some(snapshot.remaining_seconds); }
        if phase == "connected" { reply.scope = Some(snapshot.scope.ok_or(NATIVE_UNAVAILABLE)?.as_str()); }
        Ok(reply)
    }
    #[cfg(not(feature = "staging-connected-account"))]
    { Ok(ConnectedAccountReply::disabled()) }
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
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"disconnect","attemptId":UUID})));
        for invalid in [
            json!({"protocolVersion":2,"operation":"start"}),
            json!({"protocolVersion":1,"operation":"start","attemptId":null}),
            json!({"protocolVersion":1,"operation":"start","redirectUri":"http://127.0.0.1"}),
            json!({"protocolVersion":1,"operation":"status"}),
            json!({"protocolVersion":1,"operation":"status","attemptId":null}),
            json!({"protocolVersion":1,"operation":"status","attemptId":"wrong"}),
            json!({"protocolVersion":1,"operation":"cancel","attemptId":UUID,"token":"secret"}),
            json!({"protocolVersion":1,"operation":"disconnect"}),
            json!([1,"start"]),
        ] {
            assert!(!valid_request(&invalid));
        }
    }

    #[test]
    fn disabled_response_has_exactly_two_public_fields() {
        let value = serde_json::to_value(ConnectedAccountReply::disabled()).unwrap();
        assert_eq!(value, json!({"protocolVersion":1,"status":"disabled"}));
        assert!(value.get("attemptId").is_none());
        assert!(value.get("accessToken").is_none());
        assert!(value.get("deviceId").is_none());
    }

    #[cfg(feature = "staging-connected-account")]
    #[test]
    fn connected_response_contains_only_public_scope_and_attempt_id() {
        let mut reply = ConnectedAccountReply::status("connected", UUID.to_owned());
        reply.scope = Some("chart_sync:read");
        assert_eq!(serde_json::to_value(reply).unwrap(), json!({
            "protocolVersion":1,"status":"connected","attemptId":UUID,"scope":"chart_sync:read"
        }));
    }
}
