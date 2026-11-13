import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');

test('Angular shell registers a lifecycle-owned window shortcut listener', () => {
  const app = read('src/app/desktop-app.component.ts');
  assert.match(app, /HostListener/);
  assert.match(app, /@HostListener\('window:keydown', \['\$event'\]\)/);
  assert.match(app, /parseDesktopShortcut\(event\)/);
  assert.match(app, /if \(this\.destroyed \|\| this\.exporting\) return/);
});
test('shortcut mode actions reuse the existing guarded rendering path', () => {
  const app = read('src/app/desktop-app.component.ts');
  const handler = app.slice(app.indexOf('onDesktopShortcut(event:'), app.indexOf('ngAfterViewInit():'));
  assert.match(handler, /!this\.initialized \|\| this\.busy/);
  assert.match(handler, /this\.setMode\(action\.mode\)/);
  assert.match(handler, /!this\.ready \|\| this\.busy/);
  assert.match(handler, /this\.fitChart\(\)/);
  assert.equal((handler.match(/event\.preventDefault\(\)/g) ?? []).length, 2);
});
test('settings inspector advertises shortcuts without changing renderer data', () => {
  const html = read('src/app/desktop-app.component.html');
  assert.match(html, /t\('shortcuts\.title'\)/);
  assert.match(html, /t\('shortcuts\.help'\)/);
  assert.match(html, /\(click\)="setMode\(item\)"/);
  assert.match(html, /\(click\)="fitChart\(\)"/);
});
test('the shortcut legend has matching nonempty Italian and English content', () => {
  const src = read('src/app/translations.ts');
  for (const key of ['shortcuts.title','shortcuts.help']) {
    const escaped = key.replace('.', '\\.');
    const re = new RegExp('"' + escaped + '":"([^"]+)"', 'g');
    const values = [...src.matchAll(re)].map(match => match[1]);
    assert.equal(values.length, 2, key + ' must be available for both locales');
    assert.ok(values.every(value => value.trim().length > 0));
  }
});
