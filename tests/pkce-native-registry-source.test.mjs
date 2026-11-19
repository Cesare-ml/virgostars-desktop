import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const registry = readFileSync(new URL('../src-tauri/src/pkce_native_registry.rs', import.meta.url), 'utf8');
const session = readFileSync(new URL('../src-tauri/src/pkce_native_session.rs', import.meta.url), 'utf8');
const native = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/CONNECTED_ACCOUNT_NATIVE_REGISTRY_2026-11-18.md', import.meta.url), 'utf8');

test('registry is a Rust-only module, not a Tauri command or serializable grant', () => {
  assert.match(native, /mod pkce_native_registry;/);
  assert.match(registry, /pub struct NativeLoginRegistry/);
  assert.match(registry, /pub enum NativeRegistrySnapshot/);
  assert.doesNotMatch(native.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /pkce_native_registry|NativeLoginRegistry/);
  assert.doesNotMatch(registry, /#\s*\[tauri::command\]|derive\([^)]*Serialize|access_token:|bearer:|localStorage|console\.log/);
});

test('one reservation is installed before potentially blocking system-browser launch', () => {
  const reserve = registry.indexOf('state.slot = Slot::Starting(Arc::clone(&reservation));');
  const browser = registry.indexOf('NativeLoginSession::start(');
  assert.ok(reserve >= 0 && browser > reserve);
  assert.match(registry, /if !matches!\(&state\.slot, Slot::Idle\) \{ return Err\(NativeRegistryError::Busy\); \}/);
  assert.match(registry, /Arc::ptr_eq\(current, &reservation\)/);
  assert.match(registry, /reservation\.load\(Ordering::SeqCst\)/);
  assert.match(registry, /state\.slot = Slot::Active\(session\)/);
});

test('stale IDs do not cancel or disconnect another session', () => {
  assert.match(registry, /pub fn cancel\(&self, expected_attempt_id: &str\) -> bool/);
  assert.match(registry, /pub fn disconnect\(&self, expected_attempt_id: &str\) -> bool/);
  assert.match(registry, /snapshot\.attempt_id != expected_attempt_id/);
  assert.match(registry, /session\.snapshot\(\)\.attempt_id != expected_attempt_id/);
  assert.match(registry, /snapshot\.phase != NativeLoginPhase::Pending/);
  assert.match(session, /impl Drop for NativeLoginSession/);
  assert.match(registry, /fn admits_one_attempt_then_rejects_busy_and_stale_cancel/);
});

test('shutdown closes registry permanently and blocks installation after browser launch', () => {
  assert.match(registry, /pub fn shutdown\(&self\)/);
  assert.match(registry, /state\.closed = true/);
  assert.match(registry, /reservation\.store\(true, Ordering::SeqCst\)/);
  assert.match(registry, /Slot::Active\(session\) => drop\(session\)/);
  assert.match(registry, /impl Drop for NativeLoginRegistry/);
  assert.match(registry, /fn shutdown_during_browser_launch_prevents_late_session_installation/);
  assert.match(docs, /Rust toolchain|Rust\/Cargo/);
  assert.match(docs, /no refresh|refresh token/);
});
