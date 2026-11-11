//! Virgo Stars AI: *synthetic-only* transport for locally built DEBUG+feature staging tests.
//!
//! This module is absent from release builds. It is NOT the future authentication
//! implementation: a separate reviewed system-browser PKCE + OS vault is required.
use std::time::Duration;

use reqwest::{header, redirect, Client, StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};

const PATH: &str = "/api/v1/ai/copilot-preview/message";
const MAX_RESPONSE_BYTES: usize = 8192;
const STAGING_ENABLED_ENV: &str = "VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED";
const STAGING_ORIGIN_ENV: &str = "VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN";
const STAGING_TEST_BEARER_ENV: &str = "VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Focus {
    layer: String,
    body_id: String,
}

impl Focus {
    fn allowed(&self) -> bool {
        matches!(
            (self.layer.as_str(), self.body_id.as_str()),
            ("NATAL", "VENUS") | ("NATAL", "SUN") | ("TRANSIT", "SATURN")
        )
    }
}

fn staging_origin(value: &str) -> Result<Url, &'static str> {
    let url = Url::parse(value).map_err(|_| "copilot_staging_invalid_origin")?;
    // Only a local, explicitly staged backend; no public domains, DNS names,
    // redirects, paths, credentials or query parameters can be client-selected.
    if url.scheme() != "http"
        || url.host_str() != Some("127.0.0.1")
        || url.port().is_none()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err("copilot_staging_invalid_origin");
    }
    Ok(url)
}

fn staging_test_bearer(token: &str) -> Result<&str, &'static str> {
    // This token is a *short-lived synthetic staging user JWT*, never an API
    // vendor key or a real user's session token.
    if token.len() < 32
        || token.len() > 4096
        || token.split('.').count() != 3
        || token.split('.').any(str::is_empty)
        || !token
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-' || b == b'.')
    {
        return Err("copilot_staging_invalid_test_token");
    }
    Ok(token)
}

fn staging_configured(enabled: Option<&str>, origin: Option<&str>, bearer: Option<&str>) -> bool {
    enabled == Some("1")
        && origin.is_some_and(|value| staging_origin(value).is_ok())
        && bearer.is_some_and(|value| staging_test_bearer(value).is_ok())
}

/// Local, read-only capability check. It does not contact the backend, validate
/// a user session, or make the host's token available to the WebView.
#[tauri::command]
pub fn copilot_staging_ready() -> bool {
    let enabled = std::env::var(STAGING_ENABLED_ENV).ok();
    let origin = std::env::var(STAGING_ORIGIN_ENV).ok();
    let bearer = std::env::var(STAGING_TEST_BEARER_ENV).ok();
    staging_configured(enabled.as_deref(), origin.as_deref(), bearer.as_deref())
}

fn validate_preview_envelope(value: &Value) -> Result<(), &'static str> {
    if value.get("contract").and_then(Value::as_str)
        != Some("VirgoStarsCopilotMockPreviewEnvelope")
        || value.get("version").and_then(Value::as_str) != Some("0.1.0")
        || value.get("stage").and_then(Value::as_str) != Some("STAGING_SYNTHETIC")
        || value.get("syntheticFixture").and_then(Value::as_bool) != Some(true)
        || value.get("astrologyIsReal").and_then(Value::as_bool) != Some(false)
        || value.get("providerInvoked").and_then(Value::as_bool) != Some(false)
        || value.get("interpretationStatus").and_then(Value::as_str) != Some("FACT_ONLY")
    {
        return Err("copilot_staging_unexpected_response");
    }
    Ok(())
}

#[tauri::command]
pub async fn copilot_staging_preview(focus: Focus) -> Result<Value, String> {
    if !focus.allowed() {
        return Err("copilot_staging_unsupported_focus".into());
    }
    // Fail closed unless a human has explicitly enabled a DEBUG+feature lab.
    if std::env::var(STAGING_ENABLED_ENV).ok().as_deref() != Some("1") {
        return Err("copilot_staging_disabled".into());
    }
    let base = std::env::var(STAGING_ORIGIN_ENV)
        .map_err(|_| "copilot_staging_not_configured".to_owned())?;
    let origin = staging_origin(&base).map_err(str::to_owned)?;
    let token = std::env::var(STAGING_TEST_BEARER_ENV)
        .map_err(|_| "copilot_staging_test_auth_missing".to_owned())?;
    let bearer = staging_test_bearer(&token).map_err(str::to_owned)?;

    // No URLs or credentials are accepted from Angular's IPC payload.
    let endpoint = origin.join(PATH).map_err(|_| "copilot_staging_invalid_origin")?;
    let client = Client::builder()
        .timeout(Duration::from_secs(5))
        // Ignore inherited HTTP(S)_PROXY / ALL_PROXY variables. A synthetic
        // staging-user JWT must never be forwarded to a proxy process.
        .no_proxy()
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|_| "copilot_staging_client_unavailable")?;
    let payload = json!({
        "action": "describe_focus",
        "focus": { "layer": focus.layer, "bodyId": focus.body_id }
    });
    let mut response = client
        .post(endpoint)
        .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
        .header(header::ACCEPT, "application/json")
        .json(&payload)
        .send()
        .await
        .map_err(|_| "copilot_staging_backend_unavailable")?;

    match response.status() {
        StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN => {
            return Err("copilot_staging_not_authorized".into())
        }
        StatusCode::TOO_MANY_REQUESTS => return Err("copilot_staging_rate_limited".into()),
        StatusCode::OK => {}
        _ => return Err("copilot_staging_backend_unavailable".into()),
    }
    let json_content_type = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|s| s.to_str().ok())
        .map(|s| s.split(';').next() == Some("application/json"))
        .unwrap_or(false);
    if !json_content_type {
        return Err("copilot_staging_unexpected_response".into());
    }
    if response.content_length().is_some_and(|len| len > MAX_RESPONSE_BYTES as u64) {
        return Err("copilot_staging_response_too_large".into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "copilot_staging_backend_unavailable")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("copilot_staging_response_too_large".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let envelope: Value = serde_json::from_slice(&bytes)
        .map_err(|_| "copilot_staging_unexpected_response")?;
    validate_preview_envelope(&envelope).map_err(str::to_owned)?;
    Ok(envelope)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn focus(layer: &str, body_id: &str) -> Focus {
        Focus {
            layer: layer.into(),
            body_id: body_id.into(),
        }
    }

    #[test]
    fn only_three_synthetic_focus_choices_exist() {
        assert!(focus("NATAL", "VENUS").allowed());
        assert!(focus("NATAL", "SUN").allowed());
        assert!(focus("TRANSIT", "SATURN").allowed());
        assert!(!focus("TRANSIT", "VENUS").allowed());
        assert!(!focus("NATAL", "SATURN").allowed());
        assert!(!focus("NATAL", "UNKNOWN").allowed());
    }

    #[test]
    fn loopback_origin_cannot_be_broadened() {
        assert!(staging_origin("http://127.0.0.1:3000").is_ok());
        for invalid in [
            "https://virgostars.it",
            "https://staging.virgostars.it",
            "http://localhost:3000",
            "http://127.0.0.1",
            "http://127.0.0.1:3000/other",
            "http://127.0.0.1:3000/?next=http://evil.invalid",
            "http://example.com:3000",
            "http://user:pass@127.0.0.1:3000/",
        ] {
            assert!(staging_origin(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn test_bearer_requires_jwt_shape_and_rejects_header_injection() {
        assert!(staging_test_bearer("eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.SYNTHETIC_TEST_SIGNATURE").is_ok());
        for invalid in [
            "token",
            "vendor-api-key",
            "a.b",
            "a..c",
            "abc.def.ghi\r\nX-Test:bad",
        ] {
            assert!(staging_test_bearer(invalid).is_err());
        }
    }

    #[test]
    fn readiness_is_fail_closed_for_missing_flag_origin_or_token() {
        let token = "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.SYNTHETIC_TEST_SIGNATURE";
        let origin = "http://127.0.0.1:3000";
        assert!(staging_configured(Some("1"), Some(origin), Some(token)));
        assert!(!staging_configured(None, Some(origin), Some(token)));
        assert!(!staging_configured(Some("0"), Some(origin), Some(token)));
        assert!(!staging_configured(Some("1"), None, Some(token)));
        assert!(!staging_configured(Some("1"), Some("https://example.com"), Some(token)));
        assert!(!staging_configured(Some("1"), Some(origin), None));
        assert!(!staging_configured(Some("1"), Some(origin), Some("bad-token")));
    }

    #[test]
    fn preview_must_remain_synthetic_fact_only() {
        let valid = json!({
            "contract": "VirgoStarsCopilotMockPreviewEnvelope",
            "version": "0.1.0",
            "stage": "STAGING_SYNTHETIC",
            "syntheticFixture": true,
            "astrologyIsReal": false,
            "providerInvoked": false,
            "interpretationStatus": "FACT_ONLY"
        });
        assert!(validate_preview_envelope(&valid).is_ok());
        for (field, bad) in [
            ("stage", json!("PRODUCTION")),
            ("syntheticFixture", json!(false)),
            ("astrologyIsReal", json!(true)),
            ("providerInvoked", json!(true)),
            ("interpretationStatus", json!("KNOWLEDGE_RESOLVED")),
        ] {
            let mut invalid = valid.clone();
            invalid[field] = bad;
            assert!(validate_preview_envelope(&invalid).is_err());
        }
    }
}
