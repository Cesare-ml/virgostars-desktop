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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GroupConflictRequest {
    protocol_version: u8,
    operation: String,
    attempt_id: String,
    chart_id: Option<String>,
    local_groups: Option<Vec<String>>,
    server_groups: Option<Vec<String>>,
    choice: Option<String>,
}

impl GroupConflictRequest {
    fn valid(&self) -> bool {
        if self.protocol_version != 1 || !valid_attempt_id(&self.attempt_id) { return false; }
        match self.operation.as_str() {
            "list" => self.chart_id.is_none() && self.local_groups.is_none()
                && self.server_groups.is_none() && self.choice.is_none(),
            "resolve" => self.chart_id.as_deref().is_some_and(crate::chart_archive::valid_id)
                && self.local_groups.as_deref().is_some_and(crate::chart_archive::valid_groups)
                && self.server_groups.as_deref().is_some_and(crate::chart_archive::valid_groups)
                && matches!(self.choice.as_deref(),Some("local" | "server")),
            _ => false,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupConflictReply {
    protocol_version: u8,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    conflicts: Option<Vec<crate::chart_archive::GroupConflictView>>,
}

/// Candidate conflict UI boundary. Account/profile and server chart identity
/// are resolved by native code, never accepted from the WebView.
#[tauri::command]
pub async fn desktop_group_conflicts_v1(
    request: GroupConflictRequest, _app: tauri::AppHandle,
) -> Result<GroupConflictReply, &'static str> {
    if !request.valid() { return Err(NATIVE_UNAVAILABLE); }
    #[cfg(feature = "staging-connected-account")]
    {
        use crate::chart_archive::ArchivePaths;
        use crate::pkce_native_registry::GroupConflictChoice;
        let (Some(consent),Some(token)) = (option_env!("VIRGOSTARS_DESKTOP_STAGING_CONSENT"),
            option_env!("VIRGOSTARS_DESKTOP_STAGING_TOKEN")) else {
            return Ok(GroupConflictReply {protocol_version:1,status:"disabled",conflicts:None});
        };
        if crate::pkce_login::valid_consent_origin(consent).is_none()
            || crate::pkce_token_exchange::valid_staging_token_endpoint(token).is_none() {
            return Ok(GroupConflictReply {protocol_version:1,status:"disabled",conflicts:None});
        }
        let app = _app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let folder = app.path().app_local_data_dir().map_err(|_| NATIVE_UNAVAILABLE)?;
            let paths = ArchivePaths::in_folder(&folder);
            let registry = app.state::<NativeLoginRegistry>();
            if request.operation == "list" {
                let conflicts = registry.list_group_conflicts(&request.attempt_id,&paths,&crate::archive_keys::OsKeyStore)
                    .map_err(|_| NATIVE_UNAVAILABLE)?;
                return Ok(GroupConflictReply {protocol_version:1,status:"ok",conflicts:Some(conflicts)});
            }
            let local = request.local_groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?;
            let server = request.server_groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?;
            let chosen = if request.choice.as_deref() == Some("local") { local } else { server };
            let choice = GroupConflictChoice {chart_id:request.chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,local,server,chosen};
            let status = match registry.resolve_group_conflict(&request.attempt_id,&paths,&crate::archive_keys::OsKeyStore,&choice) {
                Ok(()) => "resolved",
                Err("stale") => "stale",
                Err("write_not_authorized") => "write_not_authorized",
                Err(_) => return Err(NATIVE_UNAVAILABLE),
            };
            Ok(GroupConflictReply {protocol_version:1,status,conflicts:None})
        }).await.map_err(|_| NATIVE_UNAVAILABLE)?
    }
    #[cfg(not(feature = "staging-connected-account"))]
    { Ok(GroupConflictReply {protocol_version:1,status:"disabled",conflicts:None}) }
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

    #[test]
    fn group_conflict_request_requires_exact_bounded_data_without_account_ids() {
        let list = json!({"protocolVersion":1,"operation":"list","attemptId":UUID});
        assert!(serde_json::from_value::<GroupConflictRequest>(list.clone()).unwrap().valid());
        let resolve = json!({"protocolVersion":1,"operation":"resolve","attemptId":UUID,
            "chartId":"11111111-1111-4111-8111-111111111111","localGroups":["Locale"],
            "serverGroups":["Web"],"choice":"local"});
        assert!(serde_json::from_value::<GroupConflictRequest>(resolve.clone()).unwrap().valid());
        let mut extra = list;
        extra["profileRef"] = json!("11111111-1111-4111-8111-111111111111");
        assert!(serde_json::from_value::<GroupConflictRequest>(extra).is_err());
        let mut bad = resolve;
        bad["localGroups"] = json!((0..51).map(|n| format!("Gruppo {n}")).collect::<Vec<_>>());
        assert!(!serde_json::from_value::<GroupConflictRequest>(bad).unwrap().valid());
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
