use tauri_plugin_opener::OpenerExt;

// The native side owns a single immutable URL. Never accept a URL or user data from the WebView.
const DESKTOP_SUPPORT_URL: &str = "https://www.virgostars.it/supporto?source=desktop";

#[tauri::command]
pub fn open_support_center(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url(DESKTOP_SUPPORT_URL, None::<&str>)
        .map_err(|_| "Unable to open support center".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_only_public_desktop_support_route() {
        assert_eq!(
            DESKTOP_SUPPORT_URL,
            "https://www.virgostars.it/supporto?source=desktop"
        );
        assert!(!DESKTOP_SUPPORT_URL.contains("token"));
        assert!(!DESKTOP_SUPPORT_URL.contains("chart"));
    }
}
