import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const browser = readFileSync(new URL('../src-tauri/src/system_browser.rs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src-tauri/src/pkce_login.rs', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');

test('browser opener is native-only, registered as a module but not Tauri IPC', () => {
  assert.match(native, /mod system_browser;/);
  assert.match(browser, /impl SystemBrowserOpener for OsDefaultBrowser/);
  assert.doesNotMatch(browser, /#\s*\[tauri::command\]|serde::Serialize|window\.|localStorage|@tauri-apps/);
  assert.doesNotMatch(native.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /system_browser|pkce_/);
});

test('launch is gated by staging hostname, canonical PKCE query and loopback redirect', () => {
  assert.match(browser, /valid_consent_origin\(base\.as_str\(\)\)/);
  assert.match(browser, /valid_loopback_uri\(redirect\)/);
  assert.match(browser, /client != "virgostars-desktop"/);
  assert.match(browser, /method != "S256"/);
  assert.match(browser, /base\.as_str\(\) == candidate\.as_str\(\)/);
  assert.match(core, /"staging" \| "preview"/);
  assert.match(browser, /rejects_untrusted_origins_and_added_query_parameters/);
});

test('Windows uses native ShellExecuteW and other desktops use fixed argv without a shell', () => {
  assert.match(browser, /ShellExecuteW\(/);
  assert.match(browser, /#\[link\(name = "shell32"\)\]/);
  assert.match(browser, /"open"\.encode_utf16\(\)/);
  assert.match(browser, /if \(outcome as isize\) > 32/);
  assert.match(browser, /Command::new\(program\)/);
  assert.match(browser, /\.args\(&args\)/);
  assert.match(browser, /"open"/);
  assert.match(browser, /"xdg-open"/);
  assert.doesNotMatch(browser, /"explorer\.exe"/);
  assert.doesNotMatch(browser, /Command::new\("(?:sh|bash|cmd|powershell)(?:\.exe)?"\)/i);
  assert.doesNotMatch(browser, /\.arg\("(?:\/C|-c|-Command)"\)/);
  assert.match(browser, /child\.wait\(\)/);
  assert.doesNotMatch(browser, /println!|eprintln!|tracing::|log::/);
});
