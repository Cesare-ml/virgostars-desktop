import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const source=read('src-tauri/src/profile_status_generation.rs');
const entry=read('src-tauri/src/lib.rs');

test('native status fence is internal, compiled, and not Tauri command',()=>{
  assert.match(entry,/\bmod profile_status_generation\s*;/);
  assert.doesNotMatch(entry,/pub\s+mod\s+profile_status_generation/);
  assert.doesNotMatch(source,/#\[tauri::command\]/);
  assert.doesNotMatch(entry,/profile_status_generation::[A-Za-z_]+/);
});

test('existing native IPC handlers and counts are unchanged',()=>{
  const matches=[...entry.matchAll(/\.invoke_handler\(tauri::generate_handler!\[([^\]]+)\]\)/gs)];
  assert.equal(matches.length,1);
  const commands=matches[0][1].split(',').map(x=>x.trim());
  assert.deepEqual(commands,['runtime_probe::desktop_runtime_info','offline_places::search_offline_places']);
});

test('no privileged storage, credential, filesystem or network imports',()=>{
  assert.doesNotMatch(source,/\b(?:use|extern\s+crate)\s+(?:tauri|rusqlite|sqlcipher|reqwest|tokio|hyper|serde)\b/);
  assert.doesNotMatch(source,/\b(?:std::fs|std::net|Command::new|unsafe\s*\{|include_bytes!|env!)\b/);
  assert.doesNotMatch(source,/\b(?:profile_id|user_id|password|token_secret|access_token|jwt|private_key)\s*:/);
});

test('ticket is opaque and scoped to a specific Rust fence instance',()=>{
  assert.match(source,/pub\(crate\) struct ProfileStatusTicket\s*\{\s*instance: Arc<\(\)>/s);
  assert.match(source,/Arc::ptr_eq\(&self\.instance, &ticket\.instance\)/);
  assert.doesNotMatch(source,/pub\s+(?:struct|enum)\s+ProfileStatusTicket/);
  assert.doesNotMatch(source,/Serialize|Deserialize/);
});

test('old, duplicated and after-logout callbacks are rejected in native code',()=>{
  assert.match(source,/fn begin\(&self\)/);
  assert.match(source,/fn complete\(&self, ticket: &ProfileStatusTicket\)/);
  assert.match(source,/fn invalidate\(&self\)/);
  assert.match(source,/state\.revision != ticket\.revision/);
  assert.match(source,/state\.pending = false;/);
  assert.match(source,/state\.revision\.checked_add\(1\)/);
});

test('mutex errors and epoch exhaustion fail closed without unwrap in non-test implementation',()=>{
  const implementation=source.split('#[cfg(test)]')[0];
  assert.match(implementation,/self\.state\.lock\(\)\.ok\(\)\?/);
  assert.match(implementation,/Err\(_\) => false/);
  assert.match(implementation,/state\.exhausted = true/);
  assert.doesNotMatch(implementation,/\.unwrap\(/);
  assert.doesNotMatch(implementation,/\.expect\(/);
});

test('Rust unit tests cover concurrency, stale, overflow and poisoned mutex',()=>{
  const tests=[...source.matchAll(/#\[test\]\s*fn\s+([a-z_]+)\(/g)].map(x=>x[1]);
  assert.deepEqual(tests,[
    'latest_only_and_single_use','lock_revokes_pending_status',
    'separate_profiles_cannot_exchange_equal_revision_tickets',
    'many_rapid_refreshes_do_not_resurrect_previous_status',
    'competing_completions_accept_exactly_one',
    'generation_exhaustion_permanently_fails_closed',
    'poisoned_generation_cannot_publish_or_restart',
  ]);
});
