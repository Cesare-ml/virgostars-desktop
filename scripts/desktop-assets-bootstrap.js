// Injected only into the staged synthetic demo. Runs before Angular bootstraps.
// The bundled assets resolve through the same Tauri origin, without an HTTP server.
(() => {
  const current = new URL(location.href);
  if (!current.searchParams.has('assets')) {
    current.searchParams.set('assets', new URL('/assets/', current.origin).href);
    location.replace(current.href);
  }
})();
