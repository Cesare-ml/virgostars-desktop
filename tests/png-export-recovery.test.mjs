import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS} from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const component = read('src/app/desktop-app.component.ts');
const template = read('src/app/desktop-app.component.html');

test('PNG export failure preserves an already-ready chart and permits retry', () => {
  // Source-level Angular integration contract: unit tests cannot instantiate
  // the third-party WebGL renderer or Tauri WebView2.
  const start = component.indexOf('async exportPng(): Promise<void>');
  const end = component.indexOf('private renderError(', start);
  assert.ok(start >= 0 && end > start);
  const exportMethod = component.slice(start, end);
  assert.match(exportMethod, /if\(!this\.ready \|\| this\.busy \|\| this\.destroyed \|\| this\.exporting\) return/);
  assert.match(exportMethod, /this\.status = 'export\.failed'/);
  assert.match(exportMethod, /this\.status='exported'/);
  assert.match(exportMethod, /finally\s*\{ this\.exporting=false; if\(!this\.destroyed\) \{ this\.busy=false;/);
  assert.doesNotMatch(exportMethod, /this\.renderError\(/);
  assert.doesNotMatch(exportMethod, /this\.ready\s*=\s*false/);
});

test('rendering failure still blocks access to invalid chart state', () => {
  const handler = component.slice(component.indexOf('private renderError('));
  assert.match(handler, /this\.status='status\.error'/);
  assert.match(handler, /this\.ready=false/);
  assert.match(handler, /this\.busy=false/);
});

test('PNG-specific failure and download-request status are bilingual and announce current activity', () => {
  for (const locale of ['it', 'en']) {
    const strings = STRINGS[locale];
    assert.ok(strings['export.failed'].trim());
    assert.ok(strings['exported'].trim());
    assert.ok(strings['status.error'].trim());
  }
  assert.match(STRINGS.it['export.failed'], /riprova/i);
  assert.match(STRINGS.en['export.failed'], /retry/i);
  assert.match(template, /class="chart-message" \*ngIf="busy" role="status">\{\{t\(status\)\}\}/);
  assert.match(template, /class="status-message" role="status">\{\{t\(status\)\}\}/);
});
