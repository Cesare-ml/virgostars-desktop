//! Versioned native account IPC. Default builds remain disabled. An explicit
//! staging-only build can expose narrowly scoped, credential-free status.
#![allow(dead_code)]

use crate::pkce_native_registry::NativeLoginRegistry;
use serde_json::Value;
use tauri::State;
#[cfg(feature = "staging-connected-account")]
use tauri::Manager;

// Production endpoints form a fixed pair, never supplied by the WebView.
#[cfg(feature = "staging-connected-account")]
fn configured_endpoints() -> (Option<&'static str>, Option<&'static str>) {
    #[cfg(feature = "production-connected-account")]
    { (Some("https://virgostars.it/collega-dispositivo"), Some("https://api.virgostars.it/chart-sync/v1/token")) }
    #[cfg(not(feature = "production-connected-account"))]
    { (option_env!("VIRGOSTARS_DESKTOP_STAGING_CONSENT"), option_env!("VIRGOSTARS_DESKTOP_STAGING_TOKEN")) }
}

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
    #[serde(skip_serializing_if = "Option::is_none")]
    persistent: Option<bool>,
}

impl ConnectedAccountReply {
    fn disabled() -> Self { Self { protocol_version: 1, status: "disabled", attempt_id: None, expires_in_seconds: None, scope: None, persistent: None } }
    #[cfg(feature = "staging-connected-account")]
    fn status(status: &'static str, attempt_id: String) -> Self {
        Self { protocol_version: 1, status, attempt_id: Some(attempt_id), expires_in_seconds: None, scope: None, persistent: None }
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
        let (Some(consent),Some(token)) = configured_endpoints() else {
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

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChartSyncRequest {
    protocol_version: u8,
    operation: String,
    attempt_id: Option<String>,
    chart_id: Option<String>,
    base_groups: Option<Vec<String>>,
    groups: Option<Vec<String>>,
    local_chart_id: Option<String>,
    local_updated_at_ms: Option<i64>,
    source_updated_at_ms: Option<i64>,
    local_date: Option<String>,
    local_time: Option<String>,
}

impl ChartSyncRequest {
    fn valid(&self) -> bool {
        if self.protocol_version != 1 { return false; }
        let association_fields=self.local_chart_id.is_some() || self.local_updated_at_ms.is_some() || self.source_updated_at_ms.is_some();
        let civil_fields=self.local_date.is_some() || self.local_time.is_some();
        match self.operation.as_str() {
            "sync" | "list" => self.attempt_id.as_deref().is_some_and(valid_attempt_id)
                && self.chart_id.is_none() && self.base_groups.is_none() && self.groups.is_none() && !association_fields && !civil_fields,
            "offline_list" => self.attempt_id.is_none() && self.chart_id.is_none() && self.base_groups.is_none() && self.groups.is_none() && !association_fields && !civil_fields,
            "set_groups" | "offline_set_groups" => (if self.operation=="set_groups" {
                self.attempt_id.as_deref().is_some_and(valid_attempt_id)
            } else { self.attempt_id.is_none() }) && self.chart_id.as_deref().is_some_and(crate::chart_archive::valid_id)
                && self.base_groups.as_deref().is_some_and(crate::chart_archive::valid_groups)
                && self.groups.as_deref().is_some_and(crate::chart_archive::valid_groups) && !association_fields && !civil_fields,
            "associate" => self.attempt_id.as_deref().is_some_and(valid_attempt_id)
                && self.chart_id.as_deref().is_some_and(crate::chart_archive::valid_id)
                && self.local_chart_id.as_deref().is_some_and(crate::chart_archive::valid_id)
                && self.local_updated_at_ms.is_some_and(|v|v>=0) && self.source_updated_at_ms.is_some_and(|v|v>=0)
                && self.base_groups.as_deref().is_some_and(crate::chart_archive::valid_groups)
                && self.groups.as_deref().is_some_and(crate::chart_archive::valid_groups) && !civil_fields,
            "queue_create" => self.attempt_id.as_deref().is_some_and(valid_attempt_id)
                && self.chart_id.as_deref().is_some_and(crate::chart_archive::valid_id)
                && self.local_updated_at_ms.is_some_and(|v|v>=0) && self.local_chart_id.is_none() && self.source_updated_at_ms.is_none()
                && self.base_groups.as_deref().is_some_and(crate::chart_archive::valid_groups) && self.groups.is_none()
                && self.local_date.as_deref().is_some_and(crate::chart_archive::valid_civil_date)
                && self.local_time.as_deref().is_some_and(crate::chart_archive::valid_civil_clock),
            "cancel_rejected" => self.attempt_id.as_deref().is_some_and(valid_attempt_id)
                && self.chart_id.as_deref().is_some_and(crate::chart_archive::valid_id)
                && self.base_groups.is_none() && self.groups.is_none() && !association_fields && !civil_fields,
            _ => false,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ChartSyncSummaryReply { imported: usize, updated: usize, already_linked: usize, uploaded: usize, conflicts: usize }

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChartSyncReply {
    protocol_version: u8,
    status: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    charts: Option<Vec<crate::chart_archive::CivilChartView>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    summary: Option<ChartSyncSummaryReply>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pending_chart_ids: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    rejected_chart_ids: Option<Vec<String>>,
}

/// All account scoping and HTTP credentials are owned by native code. Network
/// and archive operations run on a blocking worker, never the UI executor.
#[tauri::command]
pub async fn desktop_chart_sync_v1(request: ChartSyncRequest, _app: tauri::AppHandle)
    -> Result<ChartSyncReply, &'static str> {
    if !request.valid() { return Err(NATIVE_UNAVAILABLE); }
    #[cfg(feature = "staging-connected-account")]
    {
        let (Some(consent),Some(token)) = configured_endpoints() else {
            return Ok(ChartSyncReply {protocol_version:1,status:"disabled",charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None});
        };
        if crate::pkce_login::valid_consent_origin(consent).is_none()
            || crate::pkce_token_exchange::valid_staging_token_endpoint(token).is_none() {
            return Ok(ChartSyncReply {protocol_version:1,status:"disabled",charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None});
        }
        let app = _app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let folder = app.path().app_local_data_dir().map_err(|_| NATIVE_UNAVAILABLE)?;
            let paths = crate::chart_archive::ArchivePaths::in_folder(&folder);
            let registry = app.state::<NativeLoginRegistry>();
            let keys = crate::archive_keys::OsKeyStore;
            match request.operation.as_str() {
                "list" => {
                    let charts=registry.list_civil_charts(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys).map_err(|_| NATIVE_UNAVAILABLE)?;
                    let pending=registry.pending_chart_create_ids(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys,false).map_err(|_|NATIVE_UNAVAILABLE)?;
                    let rejected=registry.pending_chart_create_ids(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys,true).map_err(|_|NATIVE_UNAVAILABLE)?;
                    Ok(ChartSyncReply {protocol_version:1,status:"ok",charts:Some(charts),summary:None,pending_chart_ids:Some(pending),rejected_chart_ids:Some(rejected)})
                },
                "offline_list" => {
                    let charts=registry.list_offline_civil_charts(&paths,&keys).map_err(|_| NATIVE_UNAVAILABLE)?;
                    let pending=registry.offline_pending_chart_create_ids(&paths,&keys,false).map_err(|_|NATIVE_UNAVAILABLE)?;
                    let rejected=registry.offline_pending_chart_create_ids(&paths,&keys,true).map_err(|_|NATIVE_UNAVAILABLE)?;
                    Ok(ChartSyncReply {protocol_version:1,status:"ok",charts:Some(charts),summary:None,pending_chart_ids:Some(pending),rejected_chart_ids:Some(rejected)})
                },
                "sync" => {
                    let summary=registry.sync_civil_charts(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,token,&paths,&keys,&crate::pkce_reqwest_https::StagingReqwestHttps)
                        .map_err(|_| NATIVE_UNAVAILABLE)?;
                    let summary=ChartSyncSummaryReply {imported:summary.imported,updated:summary.updated,
                        already_linked:summary.already_linked,uploaded:summary.uploaded,conflicts:summary.conflicts};
                    Ok(ChartSyncReply {protocol_version:1,status:"ok",charts:None,summary:Some(summary),pending_chart_ids:None,rejected_chart_ids:None})
                },
                "set_groups" => {
                    let result=registry.set_civil_groups(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys,request.chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,
                        request.base_groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?,request.groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?);
                    let status=match result {Ok(())=>"ok",Err("stale")=>"stale",Err(_)=>return Err(NATIVE_UNAVAILABLE)};
                    Ok(ChartSyncReply {protocol_version:1,status,charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None})
                },
                "associate" => {
                    let choice=crate::chart_archive::AssociationChoice {
                        local_id:request.local_chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,source_id:request.chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,
                        local_updated:request.local_updated_at_ms.ok_or(NATIVE_UNAVAILABLE)?,source_updated:request.source_updated_at_ms.ok_or(NATIVE_UNAVAILABLE)?,
                        local_groups:request.groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?,source_groups:request.base_groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?};
                    let result=registry.associate_civil_chart(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys,&choice);
                    let status=match result {Ok(())=>"ok",Err("stale")=>"stale",Err(_)=>return Err(NATIVE_UNAVAILABLE)};
                    Ok(ChartSyncReply {protocol_version:1,status,charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None})
                },
                "queue_create" => {
                    let choice=crate::chart_archive::CreateChartChoice {chart_id:request.chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,
                        updated_at_ms:request.local_updated_at_ms.ok_or(NATIVE_UNAVAILABLE)?,groups:request.base_groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?,
                        local_date:request.local_date.as_deref().ok_or(NATIVE_UNAVAILABLE)?,local_time:request.local_time.as_deref().ok_or(NATIVE_UNAVAILABLE)?,include_groups:false};
                    let result=registry.queue_chart_create(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys,&choice);
                    let status=match result {Ok(())=>"ok",Err("stale")=>"stale",Err(_)=>return Err(NATIVE_UNAVAILABLE)};
                    Ok(ChartSyncReply {protocol_version:1,status,charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None})
                },
                "cancel_rejected" => {
                    let result=registry.cancel_rejected_chart_create(request.attempt_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,&paths,&keys,request.chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?);
                    let status=match result {Ok(())=>"ok",Err("stale")=>"stale",Err(_)=>return Err(NATIVE_UNAVAILABLE)};
                    Ok(ChartSyncReply {protocol_version:1,status,charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None})
                },
                "offline_set_groups" => {
                    let result=registry.set_offline_civil_groups(&paths,&keys,request.chart_id.as_deref().ok_or(NATIVE_UNAVAILABLE)?,
                        request.base_groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?,request.groups.as_deref().ok_or(NATIVE_UNAVAILABLE)?);
                    let status=match result {Ok(())=>"ok",Err("stale")=>"stale",Err(_)=>return Err(NATIVE_UNAVAILABLE)};
                    Ok(ChartSyncReply {protocol_version:1,status,charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None})
                },
                _ => Err(NATIVE_UNAVAILABLE),
            }
        }).await.map_err(|_| NATIVE_UNAVAILABLE)?
    }
    #[cfg(not(feature = "staging-connected-account"))]
    { Ok(ChartSyncReply {protocol_version:1,status:"disabled",charts:None,summary:None,pending_chart_ids:None,rejected_chart_ids:None}) }
}

fn valid_request(value: &Value) -> bool {
    let Some(obj) = value.as_object() else { return false; };
    if obj.get("protocolVersion").and_then(Value::as_u64) != Some(PROTOCOL_VERSION) {
        return false;
    }
    match obj.get("operation").and_then(Value::as_str) {
        Some("start") => obj.len() == 2 && obj.contains_key("protocolVersion") && obj.contains_key("operation"),
        Some("restore") => obj.len() == 2 && obj.contains_key("protocolVersion") && obj.contains_key("operation"),
        Some("status" | "cancel" | "disconnect") => {
            obj.len() == 3 && obj.contains_key("protocolVersion") && obj.contains_key("operation") &&
                obj.get("attemptId").and_then(Value::as_str).is_some_and(valid_attempt_id)
        }
        Some("signout") => obj.len() == 3 && obj.contains_key("protocolVersion") && obj.contains_key("operation") &&
            obj.get("attemptId").and_then(Value::as_str).is_some_and(valid_attempt_id),
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
        let (Some(consent), Some(token)) = configured_endpoints() else { return Ok(ConnectedAccountReply::disabled()); };
        if crate::pkce_login::valid_consent_origin(consent).is_none()
            || crate::pkce_token_exchange::valid_staging_token_endpoint(token).is_none() {
            return Ok(ConnectedAccountReply::disabled());
        }
        let operation = request["operation"].as_str().ok_or(NATIVE_UNAVAILABLE)?;
        if operation == "restore" {
            #[cfg(feature = "persistent-connected-account")]
            {
                let app = _app.clone();
                let id = tauri::async_runtime::spawn_blocking(move || {
                    app.state::<NativeLoginRegistry>().restore(crate::pkce_reqwest_https::StagingReqwestHttps, token)
                }).await.map_err(|_|NATIVE_UNAVAILABLE)?.map_err(|_|NATIVE_UNAVAILABLE)?;
                return match id {
                    Some(id) => { let mut reply=ConnectedAccountReply::status("pending",id); reply.expires_in_seconds=Some(60); Ok(reply) },
                    None => Ok(ConnectedAccountReply {protocol_version:1,status:"idle",attempt_id:None,expires_in_seconds:None,scope:None,persistent:None}),
                };
            }
            #[cfg(not(feature = "persistent-connected-account"))]
            { return Ok(ConnectedAccountReply::disabled()); }
        }
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
        if operation == "signout" {
            let app = _app.clone();
            let id = attempt_id.to_owned();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let registry = app.state::<NativeLoginRegistry>();
                #[cfg(feature = "persistent-connected-account")]
                let revoked = registry.revoke(&id, &crate::pkce_reqwest_https::StagingReqwestHttps, token).is_ok();
                #[cfg(not(feature = "persistent-connected-account"))]
                let revoked = true;
                let disconnected = revoked && registry.disconnect(&id);
                revoked && disconnected
            }).await.map_err(|_|NATIVE_UNAVAILABLE)?;
            if !result { return Err(NATIVE_UNAVAILABLE); }
            return Ok(ConnectedAccountReply::status("disconnected",attempt_id.to_owned()));
        }
        if operation == "cancel" {
            if !_registry.cancel(attempt_id) { return Err(NATIVE_UNAVAILABLE); }
            return Ok(ConnectedAccountReply::status("cancelled", attempt_id.to_owned()));
        }
        if operation == "disconnect" {
            if !_registry.disconnect(attempt_id) { return Err(NATIVE_UNAVAILABLE); }
            return Ok(ConnectedAccountReply::status("disconnected", attempt_id.to_owned()));
        }
        let app = _app.clone();
        let snapshot = tauri::async_runtime::spawn_blocking(move || app.state::<NativeLoginRegistry>().snapshot())
            .await.map_err(|_|NATIVE_UNAVAILABLE)?;
        let NativeRegistrySnapshot::Active(snapshot) = snapshot else { return Err(NATIVE_UNAVAILABLE); };
        if snapshot.attempt_id != attempt_id { return Err(NATIVE_UNAVAILABLE); }
        let phase = match snapshot.phase {
            NativeLoginPhase::Pending => "pending", NativeLoginPhase::Connected => "connected",
            NativeLoginPhase::Denied => "denied", NativeLoginPhase::Expired => "expired",
            NativeLoginPhase::Cancelled => "cancelled", NativeLoginPhase::Disconnected => "disconnected",
            NativeLoginPhase::Failed => "failed",
            NativeLoginPhase::Offline => "offline",
        };
        let mut reply = ConnectedAccountReply::status(phase, snapshot.attempt_id);
        if phase == "pending" { reply.expires_in_seconds = Some(snapshot.remaining_seconds); }
        if phase == "connected" {
            reply.scope = Some(snapshot.scope.ok_or(NATIVE_UNAVAILABLE)?.as_str());
            #[cfg(feature = "persistent-connected-account")]
            { reply.persistent = Some(snapshot.persistent); }
        }
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
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"restore"})));
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"status","attemptId":UUID})));
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"cancel","attemptId":UUID})));
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"disconnect","attemptId":UUID})));
        assert!(valid_request(&json!({"protocolVersion":1,"operation":"signout","attemptId":UUID})));
        for invalid in [
            json!({"protocolVersion":2,"operation":"start"}),
            json!({"protocolVersion":1,"operation":"start","attemptId":null}),
            json!({"protocolVersion":1,"operation":"restore","attemptId":UUID}),
            json!({"protocolVersion":1,"operation":"signout"}),
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

    #[test]
    fn chart_sync_requests_are_bounded_and_never_accept_profile_or_remote_identity() {
        for op in ["sync","list"] {
            let request=json!({"protocolVersion":1,"operation":op,"attemptId":UUID});
            assert!(serde_json::from_value::<ChartSyncRequest>(request).unwrap().valid());
        }
        assert!(serde_json::from_value::<ChartSyncRequest>(json!({"protocolVersion":1,"operation":"offline_list"})).unwrap().valid());
        assert!(!serde_json::from_value::<ChartSyncRequest>(json!({"protocolVersion":1,"operation":"offline_list","attemptId":UUID})).unwrap().valid());
        let request=json!({"protocolVersion":1,"operation":"set_groups","attemptId":UUID,
            "chartId":"11111111-1111-4111-8111-111111111111","baseGroups":[],"groups":["Fittizio"]});
        assert!(serde_json::from_value::<ChartSyncRequest>(request.clone()).unwrap().valid());
        let offline=json!({"protocolVersion":1,"operation":"offline_set_groups",
            "chartId":"11111111-1111-4111-8111-111111111111","baseGroups":[],"groups":["Fittizio"]});
        assert!(serde_json::from_value::<ChartSyncRequest>(offline).unwrap().valid());
        let mut extra=request.clone(); extra["profileRef"]=json!(UUID);
        assert!(serde_json::from_value::<ChartSyncRequest>(extra).is_err());
        let mut invalid=request; invalid["groups"]=json!(["dup","dup"]);
        assert!(!serde_json::from_value::<ChartSyncRequest>(invalid).unwrap().valid());
        let queue=json!({"protocolVersion":1,"operation":"queue_create","attemptId":UUID,
            "chartId":"11111111-1111-4111-8111-111111111111","localUpdatedAtMs":1000,
            "localDate":"2001-02-03","localTime":"05:05:06","baseGroups":[]});
        assert!(serde_json::from_value::<ChartSyncRequest>(queue.clone()).unwrap().valid());
        let mut invalid=queue.clone(); invalid["localTime"]=json!("25:00:00");
        assert!(!serde_json::from_value::<ChartSyncRequest>(invalid).unwrap().valid());
        let mut extra=queue; extra["profileRef"]=json!(UUID);
        assert!(serde_json::from_value::<ChartSyncRequest>(extra).is_err());
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
