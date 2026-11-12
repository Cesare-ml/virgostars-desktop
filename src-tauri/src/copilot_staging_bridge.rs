//! Virgo Stars AI: *synthetic-only* transport for locally built DEBUG+feature staging tests.
//!
//! This module is absent from release builds. It is NOT the future authentication
//! implementation: a separate reviewed system-browser PKCE + OS vault is required.
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use reqwest::{header, redirect, Client, StatusCode, Url};
use serde::Deserialize;
use serde_json::{json, Value};

const PATH: &str = "/api/v1/ai/copilot-preview/message";
const CAPABILITIES_PATH: &str = "/api/v1/ai/copilot-preview/capabilities";
const MAX_RESPONSE_BYTES: usize = 8192;
const STAGING_ENABLED_ENV: &str = "VIRGOSTARS_COPILOT_PREVIEW_STAGING_ENABLED";
const STAGING_ORIGIN_ENV: &str = "VIRGOSTARS_COPILOT_PREVIEW_STAGING_BACKEND_ORIGIN";
const STAGING_TEST_BEARER_ENV: &str = "VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER";
// Optional ONLY for the locally launched, unsigned test fixture. The private
// Virgo Stars staging backend does not use or need a fixture session challenge.
const STAGING_FIXTURE_SESSION_ENV: &str = "VIRGOSTARS_COPILOT_FIXTURE_SESSION";

// Keep HTTP requests bounded across all Tauri IPC callers, not only Angular.
// The WebView can abandon a request without cancelling native HTTP.
static STAGING_HTTP_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct StagingHttpPermit<'a> {
    gate: &'a AtomicBool,
}

impl<'a> StagingHttpPermit<'a> {
    fn acquire(gate: &'a AtomicBool) -> Option<Self> {
        gate.compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
            .ok()
            .map(|_| Self { gate })
    }
}

impl Drop for StagingHttpPermit<'_> {
    fn drop(&mut self) {
        // Released on success, failure, timeout, or future cancellation.
        self.gate.store(false, Ordering::Release);
    }
}


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

fn valid_fixture_session(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn validate_staging_capabilities(value: &Value, expected_fixture_session: Option<&str>) -> bool {
    // If a launcher requested a specific fixture, Rust must not silently
    // accept another local service after the launcher verified its readiness.
    // In a real private staging backend no fixture ID is configured.
    if let Some(expected) = expected_fixture_session {
        if !valid_fixture_session(expected)
            || value.get("labSession").and_then(Value::as_str) != Some(expected)
        {
            return false;
        }
    }
    if value.get("contract").and_then(Value::as_str) != Some("VirgoStarsCopilotPreviewCapabilities")
        || value.get("version").and_then(Value::as_str) != Some("0.1.0")
        || value.get("stage").and_then(Value::as_str) != Some("STAGING_SYNTHETIC")
        || value.get("enabled").and_then(Value::as_bool) != Some(true)
        || value.get("providerEnabled").and_then(Value::as_bool) != Some(false)
        || value.get("modelSelectorAvailable").and_then(Value::as_bool) != Some(false)
    {
        return false;
    }
    let actions = match value.get("actions").and_then(Value::as_array) {
        Some(value) => value,
        None => return false,
    };
    let focus_options = match value.get("focusOptions").and_then(Value::as_array) {
        Some(value) => value,
        None => return false,
    };
    actions.len() == 1
        && actions[0].as_str() == Some("describe_focus")
        && focus_options.len() == 3
        && ["NATAL:VENUS", "NATAL:SUN", "TRANSIT:SATURN"]
            .iter()
            .all(|item| focus_options.iter().any(|value| value.as_str() == Some(*item)))
}

fn staging_http_client() -> Result<Client, &'static str> {
    Client::builder()
        .timeout(Duration::from_secs(5))
        // Do not leak the synthetic staging JWT to HTTP(S)_PROXY/ALL_PROXY.
        .no_proxy()
        .redirect(redirect::Policy::none())
        .build()
        .map_err(|_| "copilot_staging_client_unavailable")
}

async fn bounded_json(mut response: reqwest::Response) -> Result<Value, &'static str> {
    let is_json = response
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|s| s.to_str().ok())
        .map(|s| s.split(';').next() == Some("application/json"))
        .unwrap_or(false);
    if !is_json {
        return Err("copilot_staging_unexpected_response");
    }
    if response.content_length().is_some_and(|len| len > MAX_RESPONSE_BYTES as u64) {
        return Err("copilot_staging_response_too_large");
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| "copilot_staging_backend_unavailable")?
    {
        if bytes.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
            return Err("copilot_staging_response_too_large");
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| "copilot_staging_unexpected_response")
}

/// Checks an actual AUTHENTICATED Virgo Stars staging capability response.
/// The Rust process keeps the short-lived staging JWT; only a boolean crosses
/// IPC. No real charts, notes, credentials or vendor endpoints are sent.
#[tauri::command]
pub async fn copilot_staging_ready() -> bool {
    let enabled = std::env::var(STAGING_ENABLED_ENV).ok();
    let origin = std::env::var(STAGING_ORIGIN_ENV).ok();
    let bearer = std::env::var(STAGING_TEST_BEARER_ENV).ok();
    let fixture_session = match std::env::var(STAGING_FIXTURE_SESSION_ENV) {
        Ok(session) => Some(session),
        Err(std::env::VarError::NotPresent) => None,
        // An existing but non-Unicode environment value must never silently
        // disable a requested per-launch identity check.
        Err(std::env::VarError::NotUnicode(_)) => return false,
    };
    if !staging_configured(enabled.as_deref(), origin.as_deref(), bearer.as_deref())
        || fixture_session
            .as_deref()
            .is_some_and(|session| !valid_fixture_session(session))
    {
        return false;
    }
    let _permit = match StagingHttpPermit::acquire(&STAGING_HTTP_IN_FLIGHT) {
        Some(permit) => permit,
        None => return false,
    };
    let base = match origin.as_deref().and_then(|raw| staging_origin(raw).ok()) {
        Some(url) => url,
        None => return false,
    };
    let endpoint = match base.join(CAPABILITIES_PATH) {
        Ok(url) => url,
        Err(_) => return false,
    };
    let client = match staging_http_client() {
        Ok(client) => client,
        Err(_) => return false,
    };
    let response = match client
        .get(endpoint)
        .bearer_auth(bearer.as_deref().unwrap_or_default())
        .header(header::ACCEPT, "application/json")
        .send()
        .await
    {
        Ok(response) if response.status() == StatusCode::OK => response,
        _ => return false,
    };
    match bounded_json(response).await {
        Ok(value) => validate_staging_capabilities(&value, fixture_session.as_deref()),
        Err(_) => false,
    }
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

/// Defense-in-depth at the native-to-WebView boundary: accept only the
/// server-owned synthetic FACT_ONLY preview and build a new allowlisted JSON
/// envelope. Never relay arbitrary server keys (for example tokens, prompts,
/// unapproved commands or private chart material) into the Angular WebView.
fn project_preview_envelope(value: &Value, expected: &Focus) -> Result<Value, &'static str> {
    const INVALID: &str = "copilot_staging_unexpected_response";
    validate_preview_envelope(value)?;
    if value.get("methodApproved").and_then(Value::as_bool) != Some(false)
        || value.get("contentOrigin").and_then(Value::as_str) != Some("DETERMINISTIC_FACT")
        || value.get("providerCostUsd").and_then(Value::as_f64) != Some(0.0)
    {
        return Err(INVALID);
    }
    let disclosure = value.get("disclosures").ok_or(INVALID)?;
    if disclosure.get("birthDataIncluded").and_then(Value::as_bool) != Some(false)
        || disclosure.get("personalChartIncluded").and_then(Value::as_bool) != Some(false)
        || disclosure.get("aiGeneratedTextPresent").and_then(Value::as_bool) != Some(false)
    {
        return Err(INVALID);
    }
    let data = value.get("data").ok_or(INVALID)?;
    let answer = data.get("answer").and_then(Value::as_str).ok_or(INVALID)?;
    let answer_units = answer.encode_utf16().count();
    if answer.trim().is_empty() || answer_units > 4000 {
        return Err(INVALID);
    }
    // Revisions must round-trip as exact integers into JavaScript.
    let revision = data.get("chartRevision").and_then(Value::as_u64).ok_or(INVALID)?;
    if revision > 9_007_199_254_740_991 {
        return Err(INVALID);
    }
    if data.get("source").and_then(Value::as_str) != Some("MOCK_DETERMINISTIC") {
        return Err(INVALID);
    }
    let remote_focus = data.get("focus").ok_or(INVALID)?;
    if remote_focus.get("layer").and_then(Value::as_str) != Some(expected.layer.as_str())
        || remote_focus.get("bodyId").and_then(Value::as_str) != Some(expected.body_id.as_str())
    {
        return Err(INVALID);
    }
    let commands = data.get("chartCommands").and_then(Value::as_array).ok_or(INVALID)?;
    if commands.len() != 1 {
        return Err(INVALID);
    }
    let command = &commands[0];
    if command.get("type").and_then(Value::as_str) != Some("chart.highlightAspects") {
        return Err(INVALID);
    }
    let aspects = command.get("aspectIds").and_then(Value::as_array).ok_or(INVALID)?;
    if aspects.len() > 80 {
        return Err(INVALID);
    }
    let mut unique = std::collections::HashSet::new();
    let mut aspect_ids = Vec::with_capacity(aspects.len());
    for raw in aspects {
        let id = raw.as_str().ok_or(INVALID)?;
        let suffix = id.strip_prefix("synthetic:").ok_or(INVALID)?;
        if suffix.is_empty()
            || suffix.len() > 96
            || !suffix.bytes().all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == b':' || ch == b'-')
            || !unique.insert(id)
        {
            return Err(INVALID);
        }
        aspect_ids.push(id.to_owned());
    }
    Ok(json!({
        "contract": "VirgoStarsCopilotMockPreviewEnvelope",
        "version": "0.1.0",
        "stage": "STAGING_SYNTHETIC",
        "syntheticFixture": true,
        "astrologyIsReal": false,
        "methodApproved": false,
        "providerInvoked": false,
        "interpretationStatus": "FACT_ONLY",
        "data": {
            "answer": answer,
            "chartRevision": revision,
            "source": "MOCK_DETERMINISTIC",
            "focus": { "layer": expected.layer.as_str(), "bodyId": expected.body_id.as_str() },
            // Synthetic identifiers are display-only in Angular; never applied
            // to the actual chart renderer.
            "chartCommands": [{ "type": "chart.highlightAspects", "aspectIds": aspect_ids }]
        }
    }))
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
    let _permit = StagingHttpPermit::acquire(&STAGING_HTTP_IN_FLIGHT)
        .ok_or_else(|| "copilot_staging_busy".to_owned())?;

    // No URLs or credentials are accepted from Angular's IPC payload.
    let endpoint = origin.join(PATH).map_err(|_| "copilot_staging_invalid_origin")?;
    let client = staging_http_client().map_err(str::to_owned)?;
    let payload = json!({
        "action": "describe_focus",
        "focus": { "layer": focus.layer.as_str(), "bodyId": focus.body_id.as_str() }
    });
    let response = client
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
    let envelope = bounded_json(response).await.map_err(str::to_owned)?;
    project_preview_envelope(&envelope, &focus).map_err(str::to_owned)
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
    fn optional_lab_session_requires_exact_lowercase_128_bit_hex() {
        assert!(valid_fixture_session("a5a5a5a5b6b6b6b6c7c7c7c7d8d8d8d8"));
        for invalid in [
            "",
            "abc",
            "A5A5A5A5B6B6B6B6C7C7C7C7D8D8D8D8",
            "a5a5a5a5b6b6b6b6c7c7c7c7d8d8d8d",
            "a5a5a5a5b6b6b6b6c7c7c7c7d8d8d8d80",
            "a5a5a5a5b6b6b6b6c7c7c7c7d8d8d8d!",
            "a5a5a5a5b6b6b6b6c7c7c7c7d8d8d8d\\n",
        ] {
            assert!(!valid_fixture_session(invalid), "{invalid:?}");
        }
    }

    #[test]
    fn capabilities_must_be_exactly_the_staging_mock_contract() {
        let valid = json!({
            "contract": "VirgoStarsCopilotPreviewCapabilities",
            "version": "0.1.0",
            "stage": "STAGING_SYNTHETIC",
            "enabled": true,
            "providerEnabled": false,
            "modelSelectorAvailable": false,
            "actions": ["describe_focus"],
            "focusOptions": ["NATAL:VENUS", "NATAL:SUN", "TRANSIT:SATURN"]
        });
        assert!(validate_staging_capabilities(&valid, None));
        // The real backend does not need the test-only labSession extension.
        let session = "a5a5a5a5b6b6b6b6c7c7c7c7d8d8d8d8";
        assert!(!validate_staging_capabilities(&valid, Some(session)));
        let mut fixture = valid.clone();
        fixture["labSession"] = json!(session);
        assert!(validate_staging_capabilities(&fixture, Some(session)));
        assert!(!validate_staging_capabilities(
            &fixture,
            Some("f1f1f1f1e2e2e2e2d3d3d3d3c4c4c4c4")
        ));
        assert!(!validate_staging_capabilities(&fixture, Some("invalid")));
        assert!(!validate_staging_capabilities(&fixture, Some("A5A5A5A5B6B6B6B6C7C7C7C7D8D8D8D8")));
        for (field, bad_value) in [
            ("stage", json!("PRODUCTION")),
            ("enabled", json!(false)),
            ("providerEnabled", json!(true)),
            ("modelSelectorAvailable", json!(true)),
            ("actions", json!(["freeform_prompt"])),
            ("focusOptions", json!(["NATAL:VENUS"]))
        ] {
            let mut invalid = valid.clone();
            invalid[field] = bad_value;
            assert!(!validate_staging_capabilities(&invalid, None), "{field}");
        }
    }

    fn synthetic_preview_fixture() -> Value {
        json!({
            "contract": "VirgoStarsCopilotMockPreviewEnvelope",
            "version": "0.1.0",
            "requestId": "server-request-id-is-not-forwarded",
            "stage": "STAGING_SYNTHETIC",
            "syntheticFixture": true,
            "astrologyIsReal": false,
            "methodApproved": false,
            "providerInvoked": false,
            "providerCostUsd": 0,
            "contentOrigin": "DETERMINISTIC_FACT",
            "interpretationStatus": "FACT_ONLY",
            "disclosures": {
                "notice": "fictional sample",
                "birthDataIncluded": false,
                "personalChartIncluded": false,
                "aiGeneratedTextPresent": false
            },
            "data": {
                "answer": "VENUS (NATAL). Aspetti presenti: 1. Demo FACT_ONLY.",
                "chartRevision": 1,
                "source": "MOCK_DETERMINISTIC",
                "focus": { "layer": "NATAL", "bodyId": "VENUS" },
                "chartCommands": [{
                    "type": "chart.highlightAspects",
                    "aspectIds": ["synthetic:transit:saturn:venus"]
                }]
            }
        })
    }

    #[test]
    fn preview_projects_only_allowlisted_fields_across_native_ipc() {
        let mut input = synthetic_preview_fixture();
        input["accessToken"] = json!("LEAK_SENTINEL");
        input["data"]["privateChart"] = json!("PRIVATE_CHART_SENTINEL");
        input["data"]["chartCommands"][0]["prompt"] = json!("DO_NOT_FORWARD");
        let projected = project_preview_envelope(&input, &focus("NATAL", "VENUS"))
            .expect("synthetic preview should validate");
        assert_eq!(projected["data"]["answer"], input["data"]["answer"]);
        assert_eq!(projected["data"]["focus"], input["data"]["focus"]);
        assert_eq!(projected["data"]["chartCommands"], json!([{
            "type": "chart.highlightAspects",
            "aspectIds": ["synthetic:transit:saturn:venus"]
        }]));
        assert!(projected.get("requestId").is_none());
        assert!(projected.get("accessToken").is_none());
        assert!(projected.get("disclosures").is_none());
        assert!(projected["data"].get("privateChart").is_none());
        assert!(projected["data"]["chartCommands"][0].get("prompt").is_none());
        assert_eq!(projected["interpretationStatus"], "FACT_ONLY");
    }

    #[test]
    fn preview_refuses_wrong_focus_commands_and_flags() {
        let baseline = synthetic_preview_fixture();
        let expected = focus("NATAL", "VENUS");
        assert!(project_preview_envelope(&baseline, &expected).is_ok());
        assert!(project_preview_envelope(&baseline, &focus("NATAL", "SUN")).is_err());

        let mut wrong = baseline.clone();
        wrong["methodApproved"] = json!(true);
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["providerCostUsd"] = json!(1);
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["disclosures"]["birthDataIncluded"] = json!(true);
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["data"]["source"] = json!("REAL_MODEL");
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["data"]["chartRevision"] = json!(9_007_199_254_740_992_u64);
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["data"]["answer"] = json!("");
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["data"]["chartCommands"][0]["type"] = json!("chart.setTransitInstant");
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["data"]["chartCommands"][0]["aspectIds"] = json!(["real:aspect"]);
        assert!(project_preview_envelope(&wrong, &expected).is_err());
        wrong = baseline.clone();
        wrong["data"]["chartCommands"][0]["aspectIds"] =
            json!(["synthetic:transit:saturn:venus", "synthetic:transit:saturn:venus"]);
        assert!(project_preview_envelope(&wrong, &expected).is_err());
    }

    #[test]
    fn native_http_guard_limits_overlap_and_recovers_after_drop() {
        let gate = AtomicBool::new(false);
        let first = StagingHttpPermit::acquire(&gate).expect("first request permitted");
        assert!(StagingHttpPermit::acquire(&gate).is_none(), "overlapping request must fail");
        assert!(gate.load(Ordering::Acquire));
        drop(first);
        assert!(!gate.load(Ordering::Acquire));
        {
            let _second = StagingHttpPermit::acquire(&gate).expect("guard reusable after failure");
            assert!(StagingHttpPermit::acquire(&gate).is_none());
        }
        assert!(!gate.load(Ordering::Acquire), "scope exit must release permit");
        assert!(StagingHttpPermit::acquire(&gate).is_some());
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
