import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Tauri registers the read-only protocol command exactly once', () => {
  const entry = read('src-tauri/src/lib.rs');
  const command = read('src-tauri/src/runtime_probe.rs');
  assert.match(entry, /mod runtime_probe;/);
  assert.equal((entry.match(/runtime_probe::desktop_runtime_info/g) || []).length, 1);
  assert.match(entry, /invoke_handler\(tauri::generate_handler!\[/);
  assert.match(command, /#\[tauri::command\]/);
  assert.match(command, /pub fn desktop_runtime_info\(\) -> DesktopRuntimeInfoV1/);
});

test('Rust probe has no account, astronomy, sync or online capability enabled', () => {
  const source=read('src-tauri/src/runtime_probe.rs');
  for (const field of ['account_connected','cloud_sync_available','ephemeris_ready']) {
    assert.match(source, new RegExp(field + ': false'));
  }
  assert.match(source, /fixture_kind: "synthetic_demo"/);
  assert.doesNotMatch(source, /https?:\/\/|reqwest|fetch\(|Command::new|std::fs/);
});

test('Angular uses real Tauri API instead of permissive global API bridge', () => {
  const source=read('src/app/native/runtime.ts');
  const cargo=read('src-tauri/Cargo.toml');
  const npm=JSON.parse(read('package.json'));
  assert.match(source, /from '@tauri-apps\/api\/core'/);
  assert.match(source, /probeDesktopRuntime/);
  assert.equal(npm.dependencies['@tauri-apps/api'],'2.12.2');
  assert.match(cargo, /serde\s*=\s*\{\s*version\s*=\s*"1"/);
});

test('Angular shell presents native status without treating it as login', () => {
  const component=read('src/app/desktop-app.component.ts');
  const html=read('src/app/desktop-app.component.html');
  assert.match(component, /await inspectDesktopRuntime\(\)/);
  assert.match(component, /runtimeStatus: MessageKey = 'runtime.checking'/);
  // The check still runs, but no technical environment caption is shown to the user.
  assert.doesNotMatch(html, /t\(runtimeStatus\)/);
  assert.match(html, /t\('account.unavailable'\)/);
});
