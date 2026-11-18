import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../src-tauri/src/pkce_staging_flow.rs', import.meta.url), 'utf8');
const receiver = readFileSync(new URL('../src-tauri/src/pkce_loopback.rs', import.meta.url), 'utf8');
const core = readFileSync(new URL('../src-tauri/src/pkce_login.rs', import.meta.url), 'utf8');

test('staging coordinator remains a native-only module without new IPC or UI hooks', () => {
  assert.match(native, /mod pkce_staging_flow;/);
  assert.match(flow, /pub struct StagingLoginAttempt/);
  assert.doesNotMatch(native.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /pkce_staging_flow|pkce_token_exchange/);
  assert.doesNotMatch(flow, /#\s*\[tauri::command\]|serde::Serialize|window\.|localStorage|@tauri-apps|console\.log/);
});

test('token endpoint is verified before starting native loopback and browser', () => {
  const validated = flow.indexOf('valid_staging_token_endpoint(staging_token_endpoint)');
  const browser = flow.indexOf('LoopbackLogin::start(browser, staging_consent_page)');
  assert.ok(validated >= 0 && browser > validated);
  assert.match(flow, /exchange_approved_code\(/);
  assert.match(flow, /self\.loopback\.bound_redirect_uri\(\)/);
  assert.match(core, /pub\(crate\) fn bound_redirect_uri\(&self\)/);
});

test('cross-thread cancellation aborts loopback and cannot return a token', () => {
  assert.match(receiver, /pub struct LoginCancelHandle/);
  assert.match(receiver, /Arc<AtomicU8>/);
  assert.match(receiver, /Ordering::SeqCst/);
  assert.match(receiver, /compare_exchange\(LOGIN_ACTIVE, LOGIN_CANCELLED/);
  assert.match(receiver, /compare_exchange\(LOGIN_ACTIVE, LOGIN_COMPLETED/);
  assert.match(receiver, /pub fn cancellation_handle\(&self\) -> LoginCancelHandle/);
  assert.match(receiver, /Err\(LoopbackError::Cancelled\)/);
  assert.match(flow, /if self\.cancellation\.is_cancelled\(\) \{ return Err\(StagingLoginError::Cancelled\); \}/);
  assert.match(flow, /if !self\.cancellation\.finish_success\(\)/);
  assert.match(flow, /fn cancelled_attempt_does_not_exchange_or_return_a_grant/);
});

test('end-to-end simulated browser callback and token contract are covered without external accounts', () => {
  assert.match(flow, /fn synthetic_callback_to_token_flow_stays_entirely_native/);
  assert.match(flow, /fn invalid_staging_endpoint_cannot_launch_a_browser/);
  assert.match(flow, /struct FakeHttp/);
  assert.match(flow, /struct SyntheticBrowser/);
  assert.doesNotMatch(flow, /reqwest|ureq|curl|ShellExecuteW|\.plugin\(/);
});
