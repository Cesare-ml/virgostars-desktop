// A read-only runtime capabilities probe; no privileged account, storage or network IPC.
mod runtime_probe;
// The native Rust ephemeris bridge will be integrated only after upstream validation.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
