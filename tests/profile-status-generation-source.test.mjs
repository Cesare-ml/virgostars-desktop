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
  assert.match(source,/fn publish_hint\(/);
  assert.match(source,/fn visible_hint\(&self\)/);
  assert.doesNotMatch(source,/fn complete\(/);
  assert.doesNotMatch(source,/fn is_current\(/);
  assert.match(source,/fn invalidate\(&self\)/);
  assert.match(source,/state\.revision != ticket\.revision/);
  assert.match(source,/state\.pending = false;/);
  assert.match(source,/state\.revision\.checked_add\(1\)/);
});

test('mutex errors and epoch exhaustion fail closed without unwrap in non-test implementation',()=>{
  const implementation=source.split('#[cfg(test)]')[0];
  assert.match(implementation,/self\.state\.lock\(\)\.ok\(\)\?/);
  assert.match(implementation,/Err\(_\) => return false/);
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
    'retired_profile_stays_closed_after_10000_retry_attempts',
    'profile_switch_uses_independent_new_fence',
    'generation_exhaustion_permanently_fails_closed',
    'poisoned_generation_cannot_publish_or_restart',
  ]);
});


test('publishing a UI hint is atomic with consuming its newest generation',()=>{
  const implementation=source.split('#[cfg(test)]')[0];
  const publish=implementation.split('pub(crate) fn publish_hint(')[1].split('pub(crate) fn visible_hint(')[0];
  assert.ok(publish);
  assert.match(publish,/let mut state = match self\.state\.lock\(\)/);
  assert.match(publish,/state\.revision != ticket\.revision/);
  assert.match(publish,/state\.pending = false;\s*state\.visible = hint;\s*true/s);
  assert.doesNotMatch(publish,/\b(?:std::fs|tauri|SQLCipher|login)\b/);
});

test('begin, revoke and poisoned state all reset UI hint to blocked',()=>{
  const implementation=source.split('#[cfg(test)]')[0];
  const begin=implementation.split('pub(crate) fn begin(&self)')[1].split('pub(crate) fn publish_hint(')[0];
  const revoke=implementation.split('pub(crate) fn invalidate(&self)')[1];
  assert.match(begin,/state\.pending = false;\s*state\.visible = ProfileStatusUiHint::Blocked;/s);
  assert.equal((revoke.match(/state\.visible = ProfileStatusUiHint::Blocked/g)||[]).length,2);
  assert.match(implementation,/pub\(crate\) enum ProfileStatusUiHint/);
  assert.match(implementation,/#\[default\]\s*Blocked/);
  assert.match(implementation,/retired: bool/);
  assert.match(implementation,/state\.exhausted \|\| state\.retired/);
  assert.match(implementation,/state\.exhausted \|\| state\.retired \|\| !state\.pending/);
  assert.match(implementation,/Err\(_\) => return false/);
  assert.match(implementation,/_ => ProfileStatusUiHint::Blocked/);
});

test('race test forces simultaneous native publication and logout',()=>{
  const race=source.split('fn competing_completions_accept_exactly_one()')[1]
    .split('fn generation_exhaustion_permanently_fails_closed()')[0];
  assert.match(race,/Barrier::new\(3\)/);
  assert.match(race,/publish_gate\.publish_hint/);
  assert.match(race,/lock_gate\.invalidate\(\)/);
  assert.match(race,/assert_eq!\(gate\.visible_hint\(\), ProfileStatusUiHint::Blocked\)/);
});

test('Rust concurrent joins consume each JoinHandle before filtering results',()=>{
  const race=source.split('fn competing_completions_accept_exactly_one()')[1]
    .split('fn generation_exhaustion_permanently_fails_closed()')[0];
  assert.match(race,/\.into_iter\(\)\s*\.map\(\|worker\| worker\.join\(\)/s);
  assert.doesNotMatch(race,/\.filter\(\|worker\| worker\.join\(\)/s);
});

test('logout retires a native profile fence permanently, including poisoned state',()=>{
  const implementation=source.split('#[cfg(test)]')[0];
  const begin=implementation.split('pub(crate) fn begin(&self)')[1].split('pub(crate) fn publish_hint(')[0];
  const logout=implementation.split('pub(crate) fn invalidate(&self)')[1];
  assert.match(begin,/state\.exhausted \|\| state\.retired/);
  assert.equal((logout.match(/state\.retired = true;/g)||[]).length,2);
  assert.match(implementation,/if state\.exhausted \|\| state\.retired \|\| !state\.pending/);
  assert.match(implementation,/Ok\(state\) if !state\.exhausted && !state\.retired/);
});

test('a new profile receives a new fence, never reuses the retired fence',()=>{
  const switched=source.split('fn profile_switch_uses_independent_new_fence()')[1]
    .split('fn generation_exhaustion_permanently_fails_closed()')[0];
  assert.match(switched,/let new_profile = ProfileStatusGenerationFence::default\(\)/);
  assert.match(switched,/old\.invalidate\(\)/);
  assert.match(switched,/assert!\(old\.begin\(\)\.is_none\(\)\)/);
  assert.match(switched,/assert!\(!new_profile\.publish_hint\(&old_ticket,/);
  assert.match(switched,/assert!\(!old\.publish_hint\(&new_ticket,/);
});
