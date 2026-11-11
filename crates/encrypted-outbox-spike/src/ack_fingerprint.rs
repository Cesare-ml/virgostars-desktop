//! Synthetic, versioned ACK request fingerprint reference for Rust/TypeScript.
//!
//! NOT wired to SQLCipher ledger, Tauri, VirgoStars accounts or cloud.
//! Deliberately restricted to an ASCII/JSON-safe subset so that JS and Rust
//! cannot disagree about Unicode key ordering, floating-point serialization,
//! or unknown fields. A wider contract needs a separately reviewed version.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::fmt::Write;

const DOMAIN: &str = "virgostars-ack-fp-001\n";
const MAX_CANONICAL_BYTES: usize = 262_144;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AckRequest {
    pub profile: String,
    pub mutation: String,
    pub entity_type: String,
    pub entity: String,
    pub operation: String,
    pub base_revision: Option<String>,
    pub created_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub payload: Option<Value>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FingerprintError {
    UnsupportedRequest,
}

impl std::fmt::Display for FingerprintError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        // No payload content, profile name, key or path is included in errors.
        f.write_str("Unsupported synthetic ACK fingerprint request")
    }
}
impl std::error::Error for FingerprintError {}

type Result<T> = std::result::Result<T, FingerprintError>;
fn invalid() -> FingerprintError { FingerprintError::UnsupportedRequest }

fn synthetic_identifier(value: &str) -> bool {
    value.strip_prefix("synthetic-").is_some_and(|suffix| {
        !suffix.is_empty()
            && value.len() <= 128
            && suffix.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    })
}

fn printable_ascii(value: &str) -> bool {
    value.bytes().all(|b| (0x20..=0x7e).contains(&b))
}

fn utc_second_string(value: &str) -> bool {
    let bytes = value.as_bytes();
    let pattern = b"0000-00-00T00:00:00Z";
    bytes.len() == pattern.len()
        && bytes.iter().zip(pattern.iter()).all(|(found, expected)| {
            if *expected == b'0' { found.is_ascii_digit() } else { found == expected }
        })
}

/// Mirror the intentionally narrow JSON canonicalization used by the
/// ACK-FP-001 TypeScript reference. ASCII key ordering is identical for
/// UTF-8 byte order and JavaScript UTF-16 code-unit order.
fn append_canonical(value: &Value, out: &mut String, depth: usize) -> Result<()> {
    if depth > 64 { return Err(invalid()); }
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        Value::Number(n) => {
            let signed = n.as_i64().is_some_and(|v| (-MAX_SAFE_INTEGER..=MAX_SAFE_INTEGER).contains(&v));
            let unsigned = n.as_u64().is_some_and(|v| v <= MAX_SAFE_INTEGER as u64);
            if !signed && !unsigned { return Err(invalid()); }
            out.push_str(&n.to_string());
        }
        Value::String(text) => {
            if !printable_ascii(text) { return Err(invalid()); }
            let encoded = serde_json::to_string(text).map_err(|_| invalid())?;
            out.push_str(&encoded);
        }
        Value::Array(items) => {
            out.push('[');
            for (index, child) in items.iter().enumerate() {
                if index != 0 { out.push(','); }
                append_canonical(child, out, depth + 1)?;
            }
            out.push(']');
        }
        Value::Object(object) => {
            let mut keys: Vec<&String> = object.keys().collect();
            keys.sort_unstable_by(|a, b| a.as_bytes().cmp(b.as_bytes()));
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if matches!(key.as_str(), "__proto__" | "prototype" | "constructor") {
                    return Err(invalid());
                }
                if index != 0 { out.push(','); }
                append_canonical(&Value::String((*key).clone()), out, depth + 1)?;
                out.push(':');
                append_canonical(object.get(*key).ok_or_else(invalid)?, out, depth + 1)?;
            }
            out.push('}');
        }
    }
    if out.len() > MAX_CANONICAL_BYTES { return Err(invalid()); }
    Ok(())
}

fn validate(request: &AckRequest) -> Result<()> {
    if !synthetic_identifier(&request.profile)
        || !synthetic_identifier(&request.mutation)
        || !synthetic_identifier(&request.entity)
        || request.entity_type != "subject"
        || !utc_second_string(&request.created_at)
    { return Err(invalid()); }
    if request.base_revision.as_ref().is_some_and(|rev| {
        rev.is_empty() || rev.len() > 128 || !printable_ascii(rev)
    }) { return Err(invalid()); }
    match request.operation.as_str() {
        "upsert" if request.payload.as_ref().is_some_and(|value| !value.is_null()) => Ok(()),
        "delete" if request.payload.is_none() => Ok(()),
        _ => Err(invalid()),
    }
}

/// Returns SHA-256 lowercase hex over the exact ACK-FP-001 domain prefix,
/// then sorted-key JSON. This is **not** a MAC or authenticated receipt.
/// Never use this digest alone to authorize a server or user.
pub fn fingerprint(request: &AckRequest) -> Result<String> {
    validate(request)?;
    let serialized = serde_json::to_value(request).map_err(|_| invalid())?;
    let mut canonical = String::new();
    append_canonical(&serialized, &mut canonical, 0)?;
    let mut hasher = Sha256::new();
    hasher.update(DOMAIN.as_bytes());
    hasher.update(canonical.as_bytes());
    let bytes = hasher.finalize();
    let mut hex = String::with_capacity(64);
    for byte in bytes {
        write!(&mut hex, "{byte:02x}").map_err(|_| invalid())?;
    }
    Ok(hex)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample() -> AckRequest {
        serde_json::from_value(json!({
            "profile":"synthetic-owner-a",
            "mutation":"synthetic-m1",
            "entityType":"subject",
            "entity":"synthetic-e1",
            "operation":"upsert",
            "baseRevision":null,
            "createdAt":"2026-11-11T16:00:00Z",
            "payload":{"label":"Fictional birth chart"}
        })).unwrap()
    }

    #[test]
    fn shared_vectors_are_bit_for_bit_identical_to_node() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../contracts/sync/ack-fingerprint-001.json"
        )).unwrap();
        assert_eq!(fixture["schema"], "ACK-FP-001");
        assert_eq!(fixture["domainSeparator"], DOMAIN);
        let vectors = fixture["vectors"].as_array().unwrap();
        assert_eq!(vectors.len(), 3);
        for vector in vectors {
            let request: AckRequest = serde_json::from_value(vector["request"].clone()).unwrap();
            assert_eq!(fingerprint(&request).unwrap(), vector["sha256"].as_str().unwrap());
        }
    }

    #[test]
    fn reordered_nested_keys_preserve_the_digest() {
        let mut request = sample();
        request.payload = Some(json!({"meta":{"z":3,"a":true},"items":[2,false,null]}));
        let first = fingerprint(&request).unwrap();
        request.payload = Some(json!({"items":[2,false,null],"meta":{"a":true,"z":3}}));
        assert_eq!(fingerprint(&request).unwrap(), first);
    }

    #[test]
    fn wrong_body_or_nonascii_and_float_fail_closed() {
        let mut request = sample();
        let initial = fingerprint(&request).unwrap();
        request.payload = Some(json!({"label":"Changed"}));
        assert_ne!(fingerprint(&request).unwrap(), initial);
        request.payload = Some(json!({"label":"Café"}));
        assert_eq!(fingerprint(&request), Err(invalid()));
        request.payload = Some(json!({"value":1.5}));
        assert_eq!(fingerprint(&request), Err(invalid()));
        request.payload = Some(json!({"value":9_007_199_254_740_992_u64}));
        assert_eq!(fingerprint(&request), Err(invalid()));
        request.payload = Some(serde_json::from_str(r#"{"__proto__":1}"#).unwrap());
        assert_eq!(fingerprint(&request), Err(invalid()));
        request.profile = "real-account".into();
        assert_eq!(fingerprint(&request), Err(invalid()));
    }

    #[test]
    fn deletion_cannot_carry_payload_and_unknown_envelope_fields_fail() {
        let mut request = sample();
        request.operation = "delete".into();
        assert_eq!(fingerprint(&request), Err(invalid()));
        request.payload = None;
        assert!(fingerprint(&request).is_ok());
        request.operation = "upsert".into();
        request.payload = Some(Value::Null);
        assert_eq!(fingerprint(&request), Err(invalid()));
        let unknown = r#"{"profile":"synthetic-a","mutation":"synthetic-m",
          "entityType":"subject","entity":"synthetic-e","operation":"delete",
          "baseRevision":null,"createdAt":"2026-11-11T16:02:00Z",
          "unexpected":"refuse"}"#;
        assert!(serde_json::from_str::<AckRequest>(unknown).is_err());
    }
}
