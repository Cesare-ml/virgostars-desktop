import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('the city-search native worker installs a bounded SQLite progress callback', () => {
  const rust = read('src-tauri/src/offline_places.rs');
  const cargo = read('src-tauri/Cargo.toml');
  assert.match(cargo, /rusqlite\s*=\s*\{\s*version\s*=\s*"0\.32",\s*features\s*=\s*\["bundled",\s*"hooks"\]/);
  assert.match(rust, /const QUERY_BUDGET: Duration = Duration::from_secs\(4\);/);
  assert.match(rust, /const SQLITE_PROGRESS_OPS: i32 = 1_000;/);
  assert.match(rust, /\.progress_handler\(SQLITE_PROGRESS_OPS, Some\(move \|\| Instant::now\(\) >= deadline\)\)/);
  assert.match(rust, /install_query_deadline\(&mut connection, deadline\)\?/);
  assert.match(rust, /busy_timeout\(Duration::from_secs\(1\)\)/);
});

test('the native query remains strictly offline and concurrency bounded', () => {
  const rust = read('src-tauri/src/offline_places.rs');
  assert.match(rust, /SQLITE_OPEN_READ_ONLY/);
  assert.match(rust, /query_only/);
  assert.match(rust, /MAX_ACTIVE_QUERIES: usize = 2/);
  assert.match(rust, /spawn_blocking\(move \|\|/);
  assert.match(rust, /BaseDirectory::Resource/);
  assert.doesNotMatch(rust, /reqwest|Command::new|https?:\/\//);
});

test('timeouts are mapped to stable, non-sensitive IPC error codes', () => {
  const rust = read('src-tauri/src/offline_places.rs');
  assert.match(rust, /"PLACE_QUERY_TIMEOUT"/);
  assert.match(rust, /\.map_err\(\|_\| query_error\(deadline\)\)/);
  assert.match(rust, /\.map_err\(str::to_string\)/);
  assert.doesNotMatch(rust, /\.map_err\(\|err\|\s*err\.to_string\(\)\)/);
});

test('Rust unit tests contain both normal and expired-deadline SQL paths', () => {
  const rust = read('src-tauri/src/offline_places.rs');
  assert.match(rust, /fn sqlite_progress_hook_allows_a_valid_short_query\(\)/);
  assert.match(rust, /SELECT 42/);
  assert.match(rust, /fn expired_sqlite_progress_deadline_interrupts_long_running_work\(\)/);
  assert.match(rust, /WITH RECURSIVE seq\(n\) AS/);
  assert.match(rust, /result\.is_err\(\)/);
});
