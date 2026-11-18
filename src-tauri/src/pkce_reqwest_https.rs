//! Compiled native HTTPS adapter candidate for staging PKCE token exchange.
//! The guarded login flow uses this transport on a native worker. Group writes
//! remain unexposed; live service integration and review are still required.
#![allow(dead_code)]

use crate::pkce_token_exchange::{
    valid_staging_token_endpoint, NativeAccessGrant, TokenHttpResponse, TokenHttpTransport, TokenScope,
};
use reqwest::blocking::{Body, Client};
use reqwest::header::{HeaderValue, ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::redirect::Policy;
use std::io::{self, Read};
use std::time::Duration;
use url::Url;
use zeroize::Zeroizing;

const MAX_TOKEN_FORM_BYTES: usize = 2048;
const MAX_TOKEN_RESPONSE_BYTES: usize = 8192;
const MAX_TOKEN_CONTENT_TYPE_BYTES: usize = 64;
const MAX_TOKEN_DEADLINE: Duration = Duration::from_secs(10);
const MAX_SESSION_RESPONSE_BYTES: u64 = 1024;
const MAX_GROUP_RESPONSE_BYTES: u64 = 65536;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct GroupRequest<'a> { sync_id: &'a str, base_groups: &'a [String], groups: &'a [String] }

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GroupResponse { contract_version: u8, status: String, groups: Vec<String> }

#[derive(PartialEq, Eq)]
pub(crate) enum GroupWriteResult { Updated, Unchanged, Conflict(Vec<String>) }

pub(crate) trait GroupWriteTransport {
    fn replace_groups(&self, token_endpoint: &Url, grant: &NativeAccessGrant,
        sync_id: &str, base_groups: &[String], groups: &[String]) -> Result<GroupWriteResult, ()>;
}

fn parse_group_response(status: u16, bytes: &[u8], desired: &[String]) -> Result<GroupWriteResult, ()> {
    let response: GroupResponse = serde_json::from_slice(bytes).map_err(|_| ())?;
    if response.contract_version != 1 || !crate::chart_archive::valid_groups(&response.groups) { return Err(()); }
    match (status, response.status.as_str()) {
        (200, "updated") if response.groups == desired => Ok(GroupWriteResult::Updated),
        (200, "unchanged") if response.groups == desired => Ok(GroupWriteResult::Unchanged),
        (409, "conflict") => Ok(GroupWriteResult::Conflict(response.groups)),
        _ => Err(()),
    }
}

fn restricted_client(timeout: Duration) -> Result<Client, ()> {
    Client::builder()
        .https_only(true)
        .tls_backend_rustls()
        .redirect(Policy::none())
        .no_proxy()
        .referer(false)
        .timeout(timeout)
        .connect_timeout(timeout)
        .build()
        .map_err(|_| ())
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SessionResponse {
    contract_version: u8,
    status: String,
    scope: String,
    profile_ref: String,
}

fn valid_session_response(bytes: &[u8], expected_scope: &str) -> Option<String> {
    let response = serde_json::from_slice::<SessionResponse>(bytes).ok()?;
    if response.contract_version != 1 || response.status != "active" || response.scope != expected_scope
        || !crate::chart_archive::valid_id(&response.profile_ref) { return None; }
    Some(response.profile_ref)
}

/// Owns the only intentionally retained copy of the one-use form payload.
/// The sending HTTP implementation may make additional transient copies;
/// those are not guaranteed to be zeroized by reqwest/hyper.
struct SecretFormReader {
    bytes: Zeroizing<Vec<u8>>,
    offset: usize,
}

impl SecretFormReader {
    fn new(body: &str) -> Self {
        Self { bytes: Zeroizing::new(body.as_bytes().to_vec()), offset: 0 }
    }
}

impl Read for SecretFormReader {
    fn read(&mut self, target: &mut [u8]) -> io::Result<usize> {
        if target.is_empty() || self.offset == self.bytes.len() { return Ok(0); }
        let count = target.len().min(self.bytes.len() - self.offset);
        target[..count].copy_from_slice(&self.bytes[self.offset..self.offset + count]);
        self.offset += count;
        Ok(count)
    }
}

/// Rust-only transport, never constructed in or returned to the WebView.
/// `post_form` is blocking: it MUST run on the dedicated native worker.
pub struct StagingReqwestHttps;

impl GroupWriteTransport for StagingReqwestHttps {
    /// Native-only, bounded group update. The caller must tie any result to
    /// the still-current verified session and persist it transactionally; this
    /// helper is deliberately not exposed to the WebView or invoked yet.
    fn replace_groups(&self, token_endpoint: &Url, grant: &NativeAccessGrant,
        sync_id: &str, base_groups: &[String], groups: &[String]) -> Result<GroupWriteResult, ()> {
        if grant.scope() != TokenScope::ReadAndGroupWrite || grant.profile_ref().is_none()
            || !grant.matches_token_endpoint(token_endpoint)
            || grant.remaining_seconds(std::time::Instant::now()) == 0
            || !crate::chart_archive::valid_id(sync_id)
            || !crate::chart_archive::valid_groups(base_groups)
            || !crate::chart_archive::valid_groups(groups) { return Err(()); }
        let mut destination = valid_staging_token_endpoint(token_endpoint.as_str()).ok_or(())?;
        destination.set_path("/chart-sync/v1/groups");
        let payload = Zeroizing::new(serde_json::to_string(&GroupRequest {sync_id,base_groups,groups}).map_err(|_| ())?);
        if payload.len() > 262144 { return Err(()); }
        let auth_value = Zeroizing::new(format!("Bearer {}", grant.bearer()));
        let mut auth = HeaderValue::from_str(&auth_value).map_err(|_| ())?;
        auth.set_sensitive(true);
        let client = restricted_client(MAX_TOKEN_DEADLINE)?;
        let reader = SecretFormReader::new(&payload);
        let response = client.post(destination).header(ACCEPT,"application/json")
            .header(CONTENT_TYPE,"application/json").header(AUTHORIZATION,auth)
            .body(Body::sized(reader,payload.len() as u64)).send().map_err(|_| ())?;
        let status = response.status().as_u16();
        if !matches!(status,200 | 409) || response.content_length().is_some_and(|n| n > MAX_GROUP_RESPONSE_BYTES) { return Err(()); }
        let content_type = response.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).ok_or(())?;
        if !content_type.eq_ignore_ascii_case("application/json")
            && !content_type.eq_ignore_ascii_case("application/json; charset=utf-8") { return Err(()); }
        let mut bytes = Zeroizing::new(Vec::new());
        response.take(MAX_GROUP_RESPONSE_BYTES + 1).read_to_end(&mut bytes).map_err(|_| ())?;
        if bytes.len() as u64 > MAX_GROUP_RESPONSE_BYTES { return Err(()); }
        parse_group_response(status, &bytes, groups)
    }
}

impl TokenHttpTransport for StagingReqwestHttps {
    fn post_form(
        &self,
        endpoint: &Url,
        body: &str,
        timeout: Duration,
        max_response_bytes: usize,
    ) -> Result<TokenHttpResponse, ()> {
        // Defense in depth: do not rely exclusively on the caller's checks.
        if valid_staging_token_endpoint(endpoint.as_str()).is_none()
            || body.is_empty() || body.len() > MAX_TOKEN_FORM_BYTES
            || timeout.is_zero() || timeout > MAX_TOKEN_DEADLINE
            || max_response_bytes == 0 || max_response_bytes > MAX_TOKEN_RESPONSE_BYTES
        { return Err(()); }

        // A fresh, short-lived client avoids storing cookies/credentials or
        // inheriting a broader app HTTP client's configuration. No redirects,
        // proxy environment, custom trust roots, key logging or retries.
        let client = restricted_client(timeout)?;

        let reader = SecretFormReader::new(body);
        let response = client
            .post(endpoint.as_str())
            .header(ACCEPT, "application/json")
            .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
            .body(Body::sized(reader, body.len() as u64))
            .send()
            .map_err(|_| ())?;

        // In particular, a 301/302/307/308 is never followed and a one-time
        // authorization code is never posted to the supplied Location host.
        let status = response.status().as_u16();
        if status != 200 {
            return Ok(TokenHttpResponse { status, content_type: String::new(), body: Vec::new() });
        }
        if response.content_length().is_some_and(|n| n > max_response_bytes as u64) {
            return Err(());
        }
        let content_type = response
            .headers()
            .get(CONTENT_TYPE)
            .ok_or(())?
            .as_bytes();
        if content_type.len() > MAX_TOKEN_CONTENT_TYPE_BYTES { return Err(()); }
        let content_type = std::str::from_utf8(content_type).map_err(|_| ())?.to_owned();

        // The limit applies to the actual streamed body, not just the
        // untrusted Content-Length. One extra byte detects an oversized body.
        let mut bytes = Zeroizing::new(Vec::with_capacity(max_response_bytes.min(4096)));
        response
            .take((max_response_bytes + 1) as u64)
            .read_to_end(&mut bytes)
            .map_err(|_| ())?;
        if bytes.len() > max_response_bytes { return Err(()); }

        Ok(TokenHttpResponse {
            status,
            content_type,
            body: std::mem::take(&mut *bytes),
        })
    }

    fn verify_grant(&self, endpoint: &Url, grant: &NativeAccessGrant) -> Result<String, ()> {
        if !grant.matches_token_endpoint(endpoint) { return Err(()); }
        let mut session = valid_staging_token_endpoint(endpoint.as_str()).ok_or(())?;
        session.set_path("/chart-sync/v1/session");
        let client = restricted_client(MAX_TOKEN_DEADLINE)?;
        let value = Zeroizing::new(format!("Bearer {}", grant.bearer()));
        let mut auth = HeaderValue::from_str(&value).map_err(|_| ())?;
        auth.set_sensitive(true);
        let response = client.get(session).header(ACCEPT, "application/json")
            .header(AUTHORIZATION, auth).send().map_err(|_| ())?;
        if response.status().as_u16() != 200
            || response.content_length().is_some_and(|n| n > MAX_SESSION_RESPONSE_BYTES) {
            return Err(());
        }
        let content_type = response.headers().get(CONTENT_TYPE).and_then(|v| v.to_str().ok()).ok_or(())?;
        if !content_type.eq_ignore_ascii_case("application/json")
            && !content_type.eq_ignore_ascii_case("application/json; charset=utf-8") { return Err(()); }
        let mut body = Vec::new();
        response.take(MAX_SESSION_RESPONSE_BYTES + 1).read_to_end(&mut body).map_err(|_| ())?;
        if body.len() as u64 > MAX_SESSION_RESPONSE_BYTES { return Err(()); }
        valid_session_response(&body, grant.scope().as_str()).ok_or(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sensitive_form_reader_streams_exact_bytes_then_exhausts() {
        let mut reader = SecretFormReader::new("code=A%2BB&code_verifier=secret");
        let mut sink = [0u8; 7];
        let mut payload = Vec::new();
        loop {
            let received = reader.read(&mut sink).unwrap();
            if received == 0 { break; }
            payload.extend_from_slice(&sink[..received]);
        }
        assert_eq!(payload, b"code=A%2BB&code_verifier=secret");
        assert_eq!(reader.read(&mut sink).unwrap(), 0);
        payload.fill(0);
    }

    #[test]
    fn refuses_untrusted_destination_without_network() {
        let transport = StagingReqwestHttps;
        let fake = Url::parse("https://staging.virgostars.it.evil.test/chart-sync/v1/token").unwrap();
        assert!(transport.post_form(&fake, "code=abc", Duration::from_secs(10), 8192).is_err());
    }

    #[test]
    fn refuses_overlong_body_and_invalid_deadline_without_network() {
        let transport = StagingReqwestHttps;
        let staging = Url::parse("https://staging.virgostars.it/chart-sync/v1/token").unwrap();
        assert!(transport.post_form(&staging, &"A".repeat(2049), Duration::from_secs(10), 8192).is_err());
        assert!(transport.post_form(&staging, "code=abc", Duration::ZERO, 8192).is_err());
        assert!(transport.post_form(&staging, "code=abc", Duration::from_secs(11), 8192).is_err());
        assert!(transport.post_form(&staging, "code=abc", Duration::from_secs(10), 8193).is_err());
    }

    #[test]
    fn session_verification_requires_the_exact_public_contract() {
        let body = br#"{"contractVersion":1,"status":"active","scope":"chart_sync:read","profileRef":"44444444-4444-4444-8444-444444444444"}"#;
        assert!(valid_session_response(body, "chart_sync:read").is_some());
        assert!(valid_session_response(body, "chart_sync:read chart_sync:groups:write").is_none());
        assert!(valid_session_response(br#"{"contractVersion":1,"status":"active","scope":"chart_sync:read","profileRef":"other"}"#, "chart_sync:read").is_none());
        let schema: serde_json::Value = serde_json::from_str(include_str!(
            "../../contracts/connected-session.v1.schema.json"
        )).unwrap();
        let response: serde_json::Value = serde_json::from_slice(body).unwrap();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["required"].as_array().unwrap().len(), response.as_object().unwrap().len());
        for key in ["contractVersion", "status"] {
            assert_eq!(schema["properties"][key]["const"], response[key]);
        }
        assert!(schema["properties"]["scope"]["enum"].as_array().unwrap().contains(&response["scope"]));
        for invalid in [
            &br#"{"contractVersion":1,"status":"active","scope":"chart_sync:read","deviceId":"x"}"#[..],
            &br#"{"contractVersion":1,"status":"active","scope":"chart_sync:read chart_sync:notes"}"#[..],
            &br#"{"contractVersion":1,"status":"active","status":"active","scope":"chart_sync:read"}"#[..],
            &br#"{"contractVersion":2,"status":"active","scope":"chart_sync:read"}"#[..],
        ] { assert!(valid_session_response(invalid, "chart_sync:read").is_none()); }
    }

    #[test]
    fn group_reply_requires_matching_status_and_strict_bounded_fields() {
        let schema: serde_json::Value = serde_json::from_str(include_str!("../../contracts/group-update-response.v1.schema.json")).unwrap();
        assert_eq!(schema["additionalProperties"], false);
        assert_eq!(schema["properties"]["status"]["enum"], serde_json::json!(["updated", "unchanged", "conflict"]));
        assert_eq!(schema["properties"]["groups"]["maxItems"], 50);
        let desired = vec!["Gruppo fittizio".to_owned()];
        assert!(matches!(parse_group_response(200, br#"{"contractVersion":1,"status":"updated","groups":["Gruppo fittizio"]}"#, &desired), Ok(GroupWriteResult::Updated)));
        assert!(matches!(parse_group_response(409, br#"{"contractVersion":1,"status":"conflict","groups":["Web fittizio"]}"#, &desired), Ok(GroupWriteResult::Conflict(groups)) if groups == ["Web fittizio"]));
        assert!(parse_group_response(200, br#"{"contractVersion":1,"status":"updated","groups":["sbagliato"]}"#, &desired).is_err());
        assert!(parse_group_response(200, br#"{"contractVersion":1,"status":"updated","groups":["Gruppo fittizio"],"token":"no"}"#, &desired).is_err());
        assert!(parse_group_response(409, br#"{"contractVersion":1,"status":"unchanged","groups":["Gruppo fittizio"]}"#, &desired).is_err());
    }
}
