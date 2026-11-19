import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const ipc = readFileSync(new URL('../src-tauri/src/connected_account_ipc.rs', import.meta.url), 'utf8');
const host = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const ui = readFileSync(new URL('../src/app/native/connected-account-contract.ts', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/CONNECTED_ACCOUNT_IPC_DISABLED_BRIDGE_2026-11-18.md', import.meta.url), 'utf8');

test('one Tauri account command is registered and owns a single native registry', () => {
  assert.match(host, /mod connected_account_ipc;/);
  assert.match(host, /\.manage\(pkce_native_registry::NativeLoginRegistry::new\(\)\)/);
  assert.match(host.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /connected_account_ipc::desktop_connected_account_v1/);
  assert.equal((host.match(/connected_account_ipc::desktop_connected_account_v1/g) ?? []).length, 1);
  assert.match(ipc, /#\[tauri::command\]\s*pub async fn desktop_connected_account_v1\(/);
  assert.match(ipc, /_registry: State<'_, NativeLoginRegistry>/);
});

test('IPC validates strict v1 start/status/cancel shapes and UUIDv4 attempts', () => {
  assert.match(ipc, /const PROTOCOL_VERSION: u64 = 1;/);
  assert.match(ipc, /Some\("start"\) => obj\.len\(\) == 2/);
  assert.match(ipc, /Some\("status" \| "cancel" \| "disconnect"\) =>/);
  assert.match(ipc, /obj\.len\(\) == 3/);
  assert.match(ipc, /is_some_and\(valid_attempt_id\)/);
  assert.match(ipc, /b\[14\] != b'4'/);
  assert.match(ipc, /fn only_exact_data_only_v1_operations_are_accepted/);
});

test('IPC defaults to disabled and staging activation uses only public status', () => {
  assert.match(ipc, /status: "disabled"/);
  assert.match(ipc, /protocol_version: 1/);
  assert.match(ipc, /Err\(NATIVE_UNAVAILABLE\)/);
  assert.match(ipc, /#\[cfg\(feature = "staging-connected-account"\)\]/);
  assert.match(ipc, /#\[cfg\(not\(feature = "staging-connected-account"\)\)\]/);
  assert.match(ipc, /valid_consent_origin\(consent\)/);
  assert.match(ipc, /valid_staging_token_endpoint\(token\)/);
  assert.match(ipc, /spawn_blocking/);
  assert.doesNotMatch(ipc, /access_token|refresh_token|code_verifier|println!|eprintln!/i);
  assert.match(ipc, /fn disabled_response_has_exactly_two_public_fields/);
  assert.match(ui, /if \(options\.enabled !== true\) return \{kind: 'disabled'\};/);
  assert.match(ui, /status === 'disabled' && exactKeys\(raw, \['protocolVersion', 'status'\]\)/);
});

test('runbook preserves the disabled staging gate and records protocol mismatch', () => {
  assert.match(docs, /charts:read/);
  assert.match(docs, /chart_sync:read/);
  assert.match(docs, /Rust\/Cargo/);
  assert.match(docs, /disabled/);
  assert.match(docs, /no deployment|non distribuire|non effettuare deploy/i);
});
