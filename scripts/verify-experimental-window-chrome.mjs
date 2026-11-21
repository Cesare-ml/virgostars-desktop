/**
 * Windows-specific Tauri overrides are merged *after* tauri.conf.json.
 * Review them independently so the security gate cannot be bypassed by an
 * unreviewed platform configuration. macOS and Linux remain native/decorated.
 */
import assert from 'node:assert/strict';
import {readFileSync, lstatSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CHROME_PERMISSIONS = Object.freeze([
  'core:window:allow-close',
  'core:window:allow-is-maximized',
  'core:window:allow-minimize',
  'core:window:allow-toggle-maximize',
  'core:window:allow-internal-toggle-maximize',
  'core:window:allow-start-dragging',
  'core:window:allow-start-resize-dragging',
  // Native resize/focus/DPI subscriptions, scoped to this single WebView.
  'core:event:allow-listen',
  'core:event:allow-unlisten',
]);

export function verifyWindowsChromeOverride(base, override) {
  assert.deepEqual(Object.keys(override).sort(), ['app'], 'unexpected Windows override root');
  assert.deepEqual(Object.keys(override.app).sort(), ['security', 'windows'], 'unexpected Windows app override');
  assert.equal(base.app.windows.length, 1);
  assert.deepEqual(override.app.windows, [{
    ...base.app.windows[0],
    decorations: false,
    transparent: true,
    windowEffects: {effects: ['mica']},
  }], 'unreviewed Windows window options or missing base sizing/identity');
  assert.deepEqual(Object.keys(override.app.security), ['capabilities'], 'unexpected Windows security override');
  assert.deepEqual(override.app.security.capabilities, [{
    identifier: 'windows-chrome-experiment',
    description: 'Main window: minimal native controls for the experimental Windows titlebar',
    windows: ['main'],
    platforms: ['windows'],
    permissions: [...CHROME_PERMISSIONS],
  }], 'Windows native capabilities must remain strictly scoped');
  return Object.freeze({windows:1, platform:'windows'});
}

export function verifyWindowsChromeCheckout(root = ROOT) {
  const basePath = join(root, 'src-tauri', 'tauri.conf.json');
  const overridePath = join(root, 'src-tauri', 'tauri.windows.conf.json');
  for (const path of [basePath, overridePath]) {
    const st = lstatSync(path);
    assert.ok(st.isFile() && !st.isSymbolicLink(), 'unsafe window config file');
  }
  return verifyWindowsChromeOverride(
    JSON.parse(readFileSync(basePath, 'utf8')),
    JSON.parse(readFileSync(overridePath, 'utf8')),
  );
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    verifyWindowsChromeCheckout();
    console.log('Experimental Windows chrome: reviewed Mica and restricted native controls.');
  } catch {
    console.error('WINDOW CHROME GATE: unreviewed platform config.');
    process.exitCode = 1;
  }
}
