//! Read-only, strictly local development probe. Not an astronomy or user-account API.
//! No credentials, birth data, network requests, filesystem paths or privileged commands.
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRuntimeInfoV1 {
    pub protocol_version: u8,
    pub product: &'static str,
    pub application_version: &'static str,
    pub platform: &'static str,
    pub fixture_kind: &'static str,
    pub account_connected: bool,
    pub cloud_sync_available: bool,
    pub ephemeris_ready: bool,
}

#[tauri::command]
pub fn desktop_runtime_info() -> DesktopRuntimeInfoV1 {
    DesktopRuntimeInfoV1 {
        protocol_version: 1,
        product: "VirgoStars Desktop",
        application_version: env!("CARGO_PKG_VERSION"),
        platform: std::env::consts::OS,
        fixture_kind: "synthetic_demo",
        account_connected: false,
        cloud_sync_available: false,
        ephemeris_ready: false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_probe_never_claims_unimplemented_account_or_astrology() {
        let probe = desktop_runtime_info();
        assert_eq!(probe.protocol_version, 1);
        assert_eq!(probe.product, "VirgoStars Desktop");
        assert_eq!(probe.fixture_kind, "synthetic_demo");
        assert!(!probe.account_connected);
        assert!(!probe.cloud_sync_available);
        assert!(!probe.ephemeris_ready);
        assert!(!probe.platform.is_empty());
    }

    #[test]
    fn test_serialized_protocol_keys_match_typescript() {
        let raw = serde_json::to_value(desktop_runtime_info()).unwrap();
        assert_eq!(raw["protocolVersion"], 1);
        assert_eq!(raw["product"], "VirgoStars Desktop");
        assert_eq!(raw["fixtureKind"], "synthetic_demo");
        assert_eq!(raw["cloudSyncAvailable"], false);
        assert_eq!(raw["ephemerisReady"], false);
        assert_eq!(raw["accountConnected"], false);
    }
}
