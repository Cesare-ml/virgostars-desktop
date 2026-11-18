// Local-only IPC: a read-only runtime probe, an offline place search, a chart calculation
// a local chart archive and a solar/lunar return search.
// No privileged account, storage or network command.
mod runtime_probe;
mod offline_places;
mod chart_calculation;
mod archive_keys;
mod archive_vault;
mod chart_archive;
mod houses;
mod return_search;
mod solar_events;
// The canonical astronomy provider (VirgoStars-Ephemeris), behind the `virgostars-ephemeris` feature.
#[cfg(feature = "virgostars-ephemeris")]
mod virgostars_provider;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            // The ephemeris data files are found by the host (environment or ephemeris.json), never by the WebView.
            #[cfg(feature = "virgostars-ephemeris")]
            {
                use tauri::Manager;
                if let Ok(folder) = _app.path().app_local_data_dir() {
                    virgostars_provider::configure(folder, _app.path().resource_dir().ok());
                }
            }
            Ok(())
        })
        .manage(offline_places::PlaceSearchGate::default())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns, solar_events::calculate_solar_events])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
