// Keep the signing overlay passed by build-signed-installer.ps1 in the Tauri invocation.
export function installerArguments(extra = []) {
  if (extra.length !== 0 && (extra.length !== 2 || extra[0] !== '--config' ||
      extra[1] !== '.local/updater/tauri-release.conf.json')) {
    throw new Error('Unsupported installer arguments');
  }
  return ['build', '--bundles', 'nsis',
    '--config', '.local/places/tauri-places.conf.json',
    '--config', '.local/ephemeris/tauri-ephemeris.conf.json',
    '--config', '.local/release-licenses/tauri-license.conf.json', ...extra];
}
