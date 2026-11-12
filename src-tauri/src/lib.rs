// Read-only runtime capabilities and local-only experimental integrations.
mod runtime_probe;
mod offline_places;
mod calculation_probe;
// The canonical Rust ephemeris engine is NOT linked to this app yet.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(offline_places::PlaceSearchGate::default())
        .manage(calculation_probe::CalculationProbeGate::default())
        .invoke_handler(tauri::generate_handler![
            runtime_probe::desktop_runtime_info,
            offline_places::search_offline_places,
            calculation_probe::desktop_calculation_probe,
        ])
        .run(tauri::generate_context!())
        .expect("failed to launch the synthetic VirgoStars Desktop renderer spike");
}
