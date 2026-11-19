// Native host: typed local IPC and explicitly configured connected-account commands.
mod runtime_probe;
mod offline_places;
mod chart_calculation;
mod archive_keys;
mod archive_vault;
mod chart_archive;
mod chart_photos;
// Native PKCE primitives: secrets remain in Rust.
mod pkce_login;
// Bounded loopback listener candidate, intentionally not a registered command.
mod pkce_loopback;
// Strict OS browser adapter exists, but is not yet called or exposed through IPC.
mod system_browser;
// Native-only, transport-injected staging token exchange; not an IPC command.
mod pkce_token_exchange;
// Isolated secure-storage primitive; not yet wired to the live login flow.
mod refresh_credential_store;
mod refresh_cycle;
#[cfg(feature = "persistent-connected-account")]
mod persistent_transport;
// Compiled for native tests; not connected to an IPC command or login flow.
mod pkce_reqwest_https;
// Native-only staging login flow coordinator; intentionally not Tauri IPC.
mod pkce_staging_flow;
// Rust-only ephemeral account session; no Tauri IPC or persistent credentials.
mod pkce_native_session;
// One native-only login owner with admission control; no IPC registration.
mod pkce_native_registry;
// Versioned account IPC: default disabled, explicit staging build only.
mod connected_account_ipc;
mod houses;
mod return_search;
mod synod_events;
mod historical_planets;
mod historical_chart;
mod updater;
mod update_backup;
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
        .manage(pkce_native_registry::NativeLoginRegistry::new())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns, synod_events::synod_events, historical_planets::calculate_historical_planet, historical_planets::calculate_historical_planet_calendar, historical_chart::calculate_historical_chart, updater::check_updates, updater::install_update, star_link::open_star_page, connected_account_ipc::desktop_connected_account_v1, connected_account_ipc::desktop_group_conflicts_v1, connected_account_ipc::desktop_chart_sync_v1])
        .build(tauri::generate_context!())
        .expect("failed to build VirgoStars Desktop")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                use tauri::Manager;
                app.state::<pkce_native_registry::NativeLoginRegistry>().shutdown();
            }
        });
}
