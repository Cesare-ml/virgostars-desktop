// A read-only runtime capabilities probe; no privileged account, storage or network IPC.
mod runtime_probe;
mod offline_places;
// The native Rust ephemeris bridge will be integrated only after upstream validation.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(offline_places::PlaceSearchGate::default())
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info, offline_places::search_offline_places])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
