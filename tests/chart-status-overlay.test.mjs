import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS, translate} from '../src/app/translations.ts';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');

test('chart busy overlay displays the current render/export status', () => {
  const html = read('src/app/desktop-app.component.html');
  const overlay = html.match(/<div class="chart-message"[^>]*>[^<]*<\/div>/)?.[0];
  assert.ok(overlay, 'expected chart-stage progress overlay');
  assert.match(overlay, /\*ngIf="busy && chartPresentation==='wheel'"/);
  assert.match(overlay, /\{\{t\(status\)\}\}/);
  assert.doesNotMatch(overlay, /t\('chart.loading'\)/);
  assert.match(html, /<vs-elements-view \*ngIf="view==='chart' && activeChart && chartPresentation==='elements'"/,
    'elements presentation has its own overlay; wheel loading must not obscure it');
});

test('visual overlay is not a second screen-reader live status', () => {
  const html = read('src/app/desktop-app.component.html');
  const overlay = html.match(/<div class="chart-message"[^>]*>[^<]*<\/div>/)?.[0];
  assert.ok(overlay);
  assert.match(overlay, /aria-hidden="true"/);
  assert.doesNotMatch(overlay, /role="status"|aria-live=/);
  assert.match(html, /class="status-message" role="status"[^>]*>\{\{t\(status\)\}\}/,
    'the toolbar continues to announce state changes');
  assert.match(html, /class="chart-error"[^>]*role="alert"/,
    'renderer failures remain accessible as alerts');
});

test('component transitions already differentiate rendering and PNG export', () => {
  const component = read('src/app/desktop-app.component.ts');
  assert.match(component, /this\.busy=true; this\.ready=false; this\.error=''; this\.status='chart.loading'/);
  assert.match(component, /this\.busy=true; this\.status='exporting'/);
  assert.match(component, /this\.status='exported'/);
  assert.match(component, /this\.status='chart.ready'/);
});

test('English and Italian status labels distinguish export from rendering', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const locale of ['it', 'en']) {
    const rendering = translate(locale, 'chart.loading');
    const exporting = translate(locale, 'exporting');
    const exported = translate(locale, 'exported');
    assert.ok(rendering.trim() && exporting.trim() && exported.trim());
    assert.notEqual(rendering, exporting);
    assert.notEqual(rendering, exported);
    assert.notEqual(exporting, exported);
  }
});
