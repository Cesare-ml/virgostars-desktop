// No privileged IPC commands or cloud calls in the renderer spike.
// The native Rust ephemeris bridge will be integrated only after upstream validation.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
