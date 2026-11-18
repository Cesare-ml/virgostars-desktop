import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const exchange = readFileSync(new URL('../src-tauri/src/pkce_token_exchange.rs', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const cargo = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');

test('native code exchange remains inert and not exposed to Tauri/Angular', () => {
  assert.match(native, /mod pkce_token_exchange;/);
  assert.match(exchange, /pub trait TokenHttpTransport/);
  assert.match(exchange, /pub struct NativeAccessGrant/);
  assert.doesNotMatch(exchange, /#\s*\[tauri::command\]|derive\([^)]*Serialize|console\.log|window\.|localStorage|@tauri-apps/);
  assert.doesNotMatch(native.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /pkce_token_exchange/);
  assert.match(cargo, /^serde_json = "1"$/m);
});

test('token request uses one-time code, strict staging endpoint and exact form fields', () => {
  assert.match(exchange, /valid_consent_origin\(browser_page\.as_str\(\)\)/);
  assert.match(exchange, /valid_loopback_uri\(bound_redirect_uri\)/);
  assert.match(exchange, /"\/chart-sync\/v1\/token"/);
  for (const field of ['grant_type', 'client_id', 'redirect_uri', 'code', 'code_verifier']) {
    assert.match(exchange, new RegExp(`\\.append_pair\\("${field}"`));
  }
  assert.match(exchange, /let CallbackDecision::Approved \{ code, code_verifier \} = decision else/);
  assert.match(exchange, /TokenExchangeError::Denied/);
  assert.match(exchange, /MAX_FORM_BYTES: usize = 2048/);
});

test('access token response fails closed, is bounded and never escapes as serializable data', () => {
  assert.match(exchange, /MAX_RESPONSE_BYTES: usize = 8192/);
  assert.match(exchange, /MAX_ACCESS_SECONDS: u64 = 15 \* 60/);
  assert.match(exchange, /let bytes = Zeroizing::new\(response.body\)/);
  assert.match(exchange, /access_token: Zeroizing<String>/);
  assert.match(exchange, /#\[serde\(deny_unknown_fields\)\]/);
  assert.match(exchange, /let raw_token = Zeroizing::new\(std::mem::take\(&mut parsed.access_token\)\)/);
  assert.match(exchange, /if response.status != 200/);
  assert.match(exchange, /expires == 0 \|\| expires > MAX_ACCESS_SECONDS/);
  assert.match(exchange, /"chart_sync:read chart_sync:notes" => TokenScope::ReadAndNotes/);
  assert.doesNotMatch(exchange, /refresh_token|Authorization: Bearer|println!|eprintln!|tracing::|log::/);
});
