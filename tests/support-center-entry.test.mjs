import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS} from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const URL = 'https://www.virgostars.it/supporto?source=desktop';

test('Help Center entrypoint is accessible in both expanded and compact navigation', () => {
  const html = read('src/app/desktop-app.component.html');
  const component = read('src/app/desktop-app.component.ts');
  assert.match(html, /\[attr\.title\]="t\('support\.center'\)" \(click\)="openSupport\(\)"/);
  assert.match(html, /class="nav-label"\>\{\{t\('support\.center'\)\}\}/);
  assert.match(html, /role="alert" \*ngIf="supportFailed"/);
  assert.match(component, /await openDesktopSupportCenter\(\)/);
  assert.ok(STRINGS.it['support.center']);
  assert.ok(STRINGS.en['support.center']);
  assert.ok(STRINGS.it['support.unavailable']);
  assert.ok(STRINGS.en['support.unavailable']);
});

test('native opener always uses the same public URL with zero caller parameters', () => {
  const rust = read('src-tauri/src/support_center.rs');
  const adapter = read('src/app/native/support-center.ts');
  const tauri = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.ok(rust.includes(URL));
  assert.ok(adapter.includes(URL));
  assert.match(rust, /pub fn open_support_center\(app: tauri::AppHandle\)/);
  assert.match(rust, /\.open_url\(DESKTOP_SUPPORT_URL, None::<&str>\)/);
  assert.match(adapter, /invoke<unknown>\('open_support_center'\)/);
  assert.deepEqual(tauri.app.security.capabilities, []);
  assert.doesNotMatch(adapter, /(?:fetch\(|HttpClient|localStorage|chartId|birthDate|token|deviceId)/);
  assert.doesNotMatch(rust.split('#[cfg(test)]')[0], /(?:Command::new|std::process|reqwest|birth_date|chart_id|token)/);
});

test('the plugin is registered only on the Rust side, not exposed to WebView', () => {
  const main = read('src-tauri/src/lib.rs');
  const adapter = read('src/app/native/support-center.ts');
  assert.equal((main.match(/\.plugin\(tauri_plugin_opener::init\(\)\)/g) || []).length, 1);
  assert.equal((main.match(/support_center::open_support_center/g) || []).length, 1);
  assert.doesNotMatch(adapter, /@tauri-apps\/plugin-/);
});
