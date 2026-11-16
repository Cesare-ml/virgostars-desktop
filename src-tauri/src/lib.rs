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
        // The frontend calls geolocation only from an explicit user action or after a
        // previous grant. Do not auto-grant camera, microphone or other WebView permissions.
        .on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Geolocation => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        })
        .manage(offline_places::PlaceSearchGate::default())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
