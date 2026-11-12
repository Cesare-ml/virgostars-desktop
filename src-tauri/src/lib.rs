// A read-only runtime capabilities probe; no privileged account, storage or network IPC.
mod runtime_probe;
// Synthetic staging transport is never compiled into release builds.
#[cfg(all(debug_assertions, feature = "copilot-staging"))]
mod copilot_staging_bridge;
// The native Rust ephemeris bridge will be integrated only after upstream validation.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // No online command exists in normal/release builds.
    #[cfg(not(all(debug_assertions, feature = "copilot-staging")))]
    let builder = builder
        .invoke_handler(tauri::generate_handler![runtime_probe::desktop_runtime_info]);
    // Explicitly opted-in DEBUG lab with local loopback staging JWT.
    #[cfg(all(debug_assertions, feature = "copilot-staging"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        runtime_probe::desktop_runtime_info,
        copilot_staging_bridge::copilot_staging_preview,
        copilot_staging_bridge::copilot_staging_ready
    ]);
    builder
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
