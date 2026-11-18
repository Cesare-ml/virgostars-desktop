// Local-only IPC: a read-only runtime probe, an offline place search, a chart calculation
// a local chart archive and a solar/lunar return search.
// Account IPC is a fail-closed disabled-only status stub; no network or credential command.
mod runtime_probe;
mod offline_places;
mod chart_calculation;
mod archive_keys;
mod archive_vault;
mod chart_archive;
// Native PKCE candidate only: deliberately no Tauri command or browser launch.
mod pkce_login;
// Bounded loopback listener candidate, intentionally not a registered command.
mod pkce_loopback;
// Strict OS browser adapter exists, but is not yet called or exposed through IPC.
mod system_browser;
// Native-only, transport-injected staging token exchange; not an IPC command.
mod pkce_token_exchange;
// Native-only staging login flow coordinator; intentionally not Tauri IPC.
mod pkce_staging_flow;
// Rust-only ephemeral account session; no Tauri IPC or persistent credentials.
mod pkce_native_session;
// One native-only login owner with admission control; no IPC registration.
mod pkce_native_registry;
// Fail-closed, disabled staging account IPC; never starts or authenticates.
mod connected_account_ipc;
mod houses;
mod return_search;
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
        .manage(pkce_native_registry::NativeLoginRegistry::new())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places, chart_calculation::calculate_chart, chart_archive::chart_archive, return_search::find_returns, connected_account_ipc::desktop_connected_account_v1])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
