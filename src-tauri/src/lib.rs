// Local-only IPC: a read-only runtime probe, an offline place search and a chart calculation.
// No privileged account, storage or network command.
mod runtime_probe;
mod offline_places;
mod chart_calculation;
// Temporary astronomy provider, compiled only on request. The canonical Rust
// ephemeris bridge replaces it after upstream validation.
#[cfg(feature = "swiss-ephemeris")]
mod swiss_provider;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(offline_places::PlaceSearchGate::default())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
