import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DEFAULT_SKY_PLACE, DEFAULT_STARTUP_PREFERENCE, STARTUP_PREFERENCE_KEY, loadStartupPreference, saveStartupPreference,
} from '../src/app/startup-preference.ts';
import {ASPECT_SYMBOLS, aspectSymbol} from '../src/app/aspect-symbols.ts';
import {ASPECT_DEFINITIONS} from '../src/app/chart-settings.ts';
import {ASPECT_LABEL_KEYS} from '../src/app/point-labels.ts';
import {STRINGS} from '../src/app/translations.ts';
import {formatSpeed} from '../src/app/astro/tema-render-data.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('src/app/desktop-app.component.html');
const component = read('src/app/desktop-app.component.ts');
const ID = '123e4567-e89b-42d3-a456-426614174000';
const memory = () => { const data = new Map(); return {getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); }, data}; };

test('the program opens on the sky of the moment unless the user chose otherwise', () => {
  assert.deepEqual(loadStartupPreference(null), DEFAULT_STARTUP_PREFERENCE);
  assert.equal(DEFAULT_STARTUP_PREFERENCE.mode, 'sky');
  const storage = memory();
  assert.deepEqual(loadStartupPreference(storage), {mode: 'sky', chartId: null});
  assert.equal(saveStartupPreference(storage, {mode: 'natal-transits', chartId: ID}), true);
  assert.deepEqual(loadStartupPreference(storage), {mode: 'natal-transits', chartId: ID});
});

test('a start preference stores only a mode and a chart identity, and anything else is refused', () => {
  const storage = memory();
  assert.equal(saveStartupPreference(storage, {mode: 'natal-transits', chartId: 'not-an-id'}), false);
  assert.equal(saveStartupPreference(storage, {mode: 'anything', chartId: null}), false);
  assert.equal(saveStartupPreference(null, {mode: 'sky', chartId: null}), false);
  saveStartupPreference(storage, {mode: 'sky', chartId: ID});
  assert.deepEqual(JSON.parse(storage.data.get(STARTUP_PREFERENCE_KEY)), {version: 1, mode: 'sky', chartId: ID});
  for (const raw of ['{', '[]', 'null', '{"version":2,"mode":"natal-transits","chartId":"' + ID + '"}',
    '{"version":1,"mode":"natal-transits","chartId":null}', '{"version":1,"mode":"natal-transits","chartId":"x"}', 'x'.repeat(400)]) {
    assert.deepEqual(loadStartupPreference({getItem: () => raw}), DEFAULT_STARTUP_PREFERENCE, raw.slice(0, 30));
  }
  assert.deepEqual(loadStartupPreference({getItem: () => { throw new Error('storage disabled'); }}), DEFAULT_STARTUP_PREFERENCE);
});

test('the sky of the moment has a default place with valid coordinates and zone', () => {
  assert.ok(Math.abs(DEFAULT_SKY_PLACE.latMicro) <= 90_000_000 && Math.abs(DEFAULT_SKY_PLACE.lngMicro) <= 180_000_000);
  assert.match(DEFAULT_SKY_PLACE.timeZone, /^[A-Za-z]+\/[A-Za-z_]+$/);
});

test('there is no demonstration chart: nothing is drawn without a calculated chart', () => {
  assert.doesNotMatch(component, /makeFictionalTheme|fictionalPlanets|fictionalHouses|showDemoChart/);
  assert.match(component, /private chartArguments\(\): \[TemaRender,TemaRender,TemaRender,string\] \| null/);
  assert.match(component, /if \(!args\) \{\s+this\.busy=false; this\.ready=false;/);
  assert.doesNotMatch(html, /t\('fixture'\)|t\('subject'\)|session\.demo/);
  // The program starts by showing the sky, or the chosen chart with its transits.
  assert.match(component, /void this\.showStartupChart\(\);/);
  assert.match(component, /await this\.showTransits\(\); return;/);
  assert.match(component, /await this\.showSky\(\);/);
});

test('functions and settings open from the left menu, not from the right panel', () => {
  const nav = html.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)?.[0] ?? '';
  for (const call of ['openFunctions()', 'openSettings()', "toggleInspectorTab('navigate')", "toggleInspectorTab('aspects')", 'showSky()', 'openArchive()', 'openNewChart()']) {
    assert.ok(nav.includes(call), call);
  }
  const inspector = html.match(/<aside class="inspector"[\s\S]*?<\/aside>/)?.[0] ?? '';
  assert.doesNotMatch(inspector, /id="tab-functions"|id="tab-settings"|vs-chart-settings|vs-returns-panel/);
  assert.match(html, /<section class="drawer" \*ngIf="view==='functions'"/);
  assert.match(html, /<section class="drawer" \[hidden\]="view!=='settings'"/);
});

test('planet info is one button away, on the chart; it is no longer in the left menu', () => {
  assert.match(html, /class="toolbar-button info-button"[\s\S]*?toggleInspectorTab\('planets'\)/);
  const nav = html.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.doesNotMatch(nav, /toggleInspectorTab\('planets'\)/);
  assert.match(html, /<th class="num">\{\{t\('column\.latspeed'\)\}\}<\/th>/);
  assert.match(html, /latitudeSpeedText\(row\.latitudeSpeed\)/);
  assert.equal(formatSpeed(0.0123, 'it', 3), '0,012');
  assert.equal(formatSpeed(-0.0004, 'it', 3), '0');
});

test('the city search is gone from the settings', () => {
  const settings = html.match(/<section class="drawer" \[hidden\]="view!=='settings'"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.ok(settings.length > 200);
  assert.doesNotMatch(settings, /vs-offline-city-picker|selectedCity|cityClock/);
  assert.doesNotMatch(component, /selectedCity|cityClock|onCitySelected|updateCityClock/);
});

test('aspect lists are written with symbols and show names only on hover', () => {
  for (const {id} of ASPECT_DEFINITIONS) {
    assert.ok(ASPECT_SYMBOLS[id], id);
    assert.ok(ASPECT_LABEL_KEYS[id], id);
  }
  assert.equal(aspectSymbol('congiunzione'), '☌');
  assert.equal(aspectSymbol('unknown'), 'unknown');
  const rows = html.match(/class="data-line static aspect-line"[\s\S]*?<\/div>/g) ?? [];
  assert.ok(rows.length >= 2);
  for (const row of rows) {
    assert.match(row, /aspect-point" \[attr\.title\]="planetLabel\(row\.from\)"/);
    assert.match(row, /aspect-sign" \[attr\.title\]="aspectLabel\(row\.aspect\)">\{\{aspectSymbolOf\(row\.aspect\)\}\}/);
    assert.match(row, /aspect-point" \[attr\.title\]="planetLabel\(row\.to\)"/);
    // Applying and separating keep a short word with the full explanation on hover; no letters A and S.
    assert.match(row, /aspects\.appl\.short/);
    assert.doesNotMatch(row, /'A' : 'S'/);
  }
  assert.doesNotMatch(html, /aspects\.legend/);
});

test('applying and separating are labelled in words, not by single letters', () => {
  for (const locale of ['it', 'en']) {
    assert.ok(STRINGS[locale]['aspects.appl.short'].length >= 3);
    assert.ok(STRINGS[locale]['aspects.sep.short'].length >= 3);
    assert.notEqual(STRINGS[locale]['aspects.appl.short'], STRINGS[locale]['aspects.sep.short']);
  }
});
