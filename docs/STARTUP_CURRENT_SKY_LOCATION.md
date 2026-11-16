# Startup current-sky location

**Status: prototype.** On startup the desktop opens the chart panel. If the WebView already has an explicit geolocation grant, VirgoStars requests a fresh one-shot location and calculates the current sky automatically. On first use, the user must press **Use device location** to initiate the request; WebView2 then handles its own permission prompt. Tauri returns `PermissionResponse::Default` for geolocation so the platform/browser flow remains in control, and explicitly denies other WebView permission kinds.

If geolocation is denied, unsupported, unavailable or times out, the user can still choose a place from the bundled offline city catalogue and press **Now**. Browser previews do not silently auto-request device location.

Coordinates are held only in the chart form/session memory. They are not uploaded, not automatically written to the SQLite archive and are not retained as a default location. The user can explicitly save the resulting chart as a historical snapshot. The display time zone is initially taken from the device's IANA time-zone setting; edit it in the form if the device setting differs from the actual place.

The frontend checks for a secure context before calling the Web Geolocation API. Tauri 2.12 exposes a typed permission callback; `Default` delegates geolocation consent to the platform flow, while other permission kinds are denied. See [Tauri PermissionResponse](https://docs.rs/tauri/2.12.5/tauri/webview/enum.PermissionResponse.html), [Tauri PermissionKind](https://docs.rs/tauri/2.12.5/tauri/webview/enum.PermissionKind.html) and [Microsoft WebView2 permission handling](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/overview-features-apis).

Windows/WebView2 manual acceptance remains required: first-run click and grant, previously granted startup, denial, Windows location services disabled, timeout, offline operation, and verification that location never leaves local calculation/session state. macOS geolocation support must be checked separately before claiming parity.
