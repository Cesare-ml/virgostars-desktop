import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../src-tauri/src/pkce_loopback.rs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src-tauri/src/pkce_login.rs', import.meta.url), 'utf8');

test('candidate listener stays Rust-only and cannot silently become an IPC command', () => {
  assert.doesNotMatch(source, /#\s*\[tauri::command\]/);
  assert.doesNotMatch(source, /serde::Serialize|tauri::generate_handler|\.plugin\(/);
  assert.match(source, /trait SystemBrowserOpener/);
});

test('listener binds loopback before constructing the PKCE attempt and opening a browser', () => {
  const bound = source.indexOf('TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0)))');
  const attempt = source.indexOf('PendingPkceLogin::new(local_port');
  const browser = source.indexOf('browser.open_in_system_browser(&url)');
  assert.ok(bound >= 0 && attempt > bound && browser > attempt);
  assert.match(source, /const MAX_REQUEST_BYTES: usize = 4096/);
  assert.match(source, /const MAX_CONNECTIONS: u8 = 32/);
  assert.match(source, /Content-Security-Policy: default-src 'none'/);
});

test('browser callback never goes directly to Angular and host-only PKCE code is zeroizing', () => {
  assert.match(core, /code: Zeroizing<String>/);
  assert.match(core, /code_verifier: Zeroizing<String>/);
  assert.match(source, /fn wait_for_callback\(&mut self, max_wait: Duration\) -> Result<CallbackDecision/);
  assert.doesNotMatch(source, /@tauri-apps|localStorage|console\.log|window\./);
});

test('staging consent URL is explicit, rejects public VirgoStars and never falls back', () => {
  assert.doesNotMatch(source, /const CONSENT_PAGE: &str = "https:\/\/www\.virgostars\.it/);
  assert.match(source, /pub fn start<B: SystemBrowserOpener>\(browser: &B, staging_consent_page: &str\)/);
  assert.match(source, /attempt\.consent_url\(staging_consent_page\)/);
  assert.match(core, /fn valid_consent_origin\(candidate: &str\)/);
  assert.match(core, /"staging" \| "preview"/);
  assert.match(core, /labels\[labels\.len\(\) - 2\] == "virgostars"/);
  assert.match(core, /uri\.as_str\(\) != candidate/);
  assert.match(source, /fn rejects_public_or_untrusted_consent_before_invoking_browser\(/);
});
