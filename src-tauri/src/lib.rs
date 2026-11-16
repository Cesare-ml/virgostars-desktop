// Local-only IPC: a read-only runtime probe, an offline place search, a chart calculation,
// a local chart archive and a solar/lunar return search. The WebView geolocation grant is
// reached only after the explicit location action in Angular; no coordinates are returned by
// IPC or persisted by this permission handler.
mod runtime_probe;
mod offline_places;
mod chart_calculation;
mod chart_archive;
mod return_search;
// Temporary astronomy provider, compiled only on request. The canonical Rust
// ephemeris bridge replaces it after upstream validation.
#[cfg(feature = "swiss-ephemeris")]
mod swiss_provider;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Leave geolocation consent to WebView2's own permission flow. Do not
        // silently grant it here, and deny unrelated WebView permission kinds.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Geolocation => tauri::webview::PermissionResponse::Default,
            _ => tauri::webview::PermissionResponse::Deny,
        })
        .manage(offline_places::PlaceSearchGate::default())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
