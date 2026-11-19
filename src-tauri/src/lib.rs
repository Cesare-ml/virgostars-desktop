// Local IPC: runtime probe, offline place search, chart calculation, archive,
// event searches and a narrowly scoped system-browser link to a VirgoStars star.
// No privileged account, arbitrary external URL or cloud-storage command.
mod runtime_probe;
mod offline_places;
mod chart_calculation;
mod archive_keys;
mod archive_vault;
mod chart_archive;
mod chart_photos;
mod houses;
mod return_search;
mod synod_events;
mod historical_planets;
mod historical_chart;
mod updater;
mod update_backup;
mod de441_operations;
#[cfg(feature = "virgostars-ephemeris")]
mod de441_catalog;
#[cfg(all(feature = "updater-loopback-test", not(debug_assertions)))]
compile_error!("The loopback acceptance feature is forbidden in release builds");
mod star_link;
// The canonical astronomy provider (VirgoStars-Ephemeris), behind the `virgostars-ephemeris` feature.
#[cfg(feature = "virgostars-ephemeris")]
mod virgostars_provider;
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().pubkey(option_env!("VIRGOSTARS_UPDATER_PUBLIC_KEY").unwrap_or("")).build())
        .manage(updater::UpdateState::default())
        .manage(de441_operations::DownloadState::default())
        .setup(|_app| {
            #[cfg(feature = "updater-loopback-test")]
            if !_app.config().identifier.starts_with("it.virgostars.desktop.updatertest.") {
                return Err("loopback acceptance build requires an isolated application identifier".into());
            }
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
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns, synod_events::synod_events, historical_planets::calculate_historical_planet, historical_planets::calculate_historical_planet_calendar, historical_chart::calculate_historical_chart, updater::check_updates, updater::install_update, star_link::open_star_page, de441_operations::de441_packages])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
