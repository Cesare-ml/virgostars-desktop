import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const session = readFileSync(new URL('../src-tauri/src/pkce_native_session.rs', import.meta.url), 'utf8');
const flow = readFileSync(new URL('../src-tauri/src/pkce_staging_flow.rs', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/CONNECTED_ACCOUNT_NATIVE_SESSION_2026-11-18.md', import.meta.url), 'utf8');

test('native session is compiled as a Rust-only module with no UI/IPC grant', () => {
  assert.match(native, /mod pkce_native_session;/);
  assert.match(session, /pub struct NativeLoginSession/);
  assert.match(session, /pub struct NativeLoginSnapshot/);
  assert.doesNotMatch(native.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /pkce_native_session|NativeLoginSession/);
  assert.doesNotMatch(session, /#\s*\[tauri::command\]|derive\([^)]*Serialize|access_token:|code_verifier:|bearer:|localStorage|window\./);
});

test('session delegates only to existing bounded staging coordinator and runs a Rust worker', () => {
  assert.match(session, /StagingLoginAttempt::begin\(browser, consent_url, token_endpoint\)/);
  assert.match(session, /attempt\.wait_and_exchange\(&transport, max_wait\)/);
  assert.match(session, /thread::Builder::new\(\)/);
  assert.match(session, /\.spawn\(move \|\|/);
  assert.match(session, /max_wait\.is_zero\(\) \|\| max_wait > Duration::from_secs\(600\)/);
  assert.match(flow, /if !self\.cancellation\.finish_success\(\)/);
});

test('public status carries only opaque metadata and expiry discards a grant', () => {
  for (const key of ['attempt_id: String', 'phase: NativeLoginPhase', 'remaining_seconds: u64']) {
    assert.ok(session.includes(key), key);
  }
  assert.match(session, /SecretState::Connected\(grant\)/);
  assert.match(session, /\*state = SecretState::Expired/);
  assert.match(session, /pub fn snapshot\(&self\) -> NativeLoginSnapshot/);
  assert.doesNotMatch(session, /pub fn (bearer|token|access_token)\(/);
});

test('cancel/disconnect and drop prevent late worker success from resurrecting a session', () => {
  assert.match(session, /pub fn cancel\(&self\)/);
  assert.match(session, /self\.cancellation\.is_cancelled\(\)/);
  assert.match(session, /pub fn disconnect\(&self\)/);
  assert.match(session, /\*current = SecretState::Disconnected/);
  assert.match(session, /if matches!\(\*current, SecretState::Pending\)/);
  assert.match(session, /impl Drop for NativeLoginSession/);
  assert.match(session, /self\.disconnect\(\)/);
  assert.match(session, /fn synthetic_callback_reaches_native_connected_then_local_disconnect/);
  assert.match(session, /fn cancellation_never_exchanges_or_returns_secrets_in_snapshot/);
  assert.match(docs, /Non esiste un \*\*refresh token\*\*/);
});
