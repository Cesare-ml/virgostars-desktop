# Startup current-sky location

**Status: prototype.** On startup the desktop opens the chart panel. If the WebView already has an explicit geolocation grant, VirgoStars requests a fresh one-shot location and calculates the current sky automatically. On first use, the user must press **Use device location**; this is the in-app consent action. The Tauri host grants only the WebView's geolocation permission request after that explicit UI action. Other permission kinds remain at their default policy.

If geolocation is denied, unsupported, unavailable or times out, the user can still choose a place from the bundled offline city catalogue and press **Now**. Browser previews do not silently auto-request device location.

Coordinates are held only in the chart form/session memory. They are not uploaded, not automatically written to the SQLite archive and are not retained as a default location. The user can explicitly save the resulting chart as a historical snapshot. The display time zone is initially taken from the device's IANA time-zone setting; edit it in the form if the device setting differs from the actual place.

The frontend checks for a secure context before calling the Web Geolocation API. WebView2 geolocation is host-permission mediated; file-URL documents do not expose the browser geolocation API. See Microsoft's WebView2 security/permissions guidance and Tauri's WebView permission API.

Windows/WebView2 manual acceptance remains required: first-run click and grant, previously granted startup, denial, Windows location services disabled, timeout, offline operation, and verification that location never leaves local calculation/session state. macOS geolocation support must be checked separately before claiming parity.
