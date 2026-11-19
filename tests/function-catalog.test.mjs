import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FUNCTION_CATALOG, summarizeCatalog} from '../src/app/function-catalog.ts';
import {calculatedPngFilename, syntheticPngFilename} from '../src/app/png-export-safety.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const entries = FUNCTION_CATALOG.flatMap(group => group.entries);

test('every menu entry has a unique id, both labels and an honest status', () => {
  const ids = entries.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(FUNCTION_CATALOG.map(group => group.id)).size, FUNCTION_CATALOG.length);
  for (const entry of entries) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(entry.it.trim() && entry.en.trim(), entry.id);
    assert.ok(['available', 'planned', 'excluded'].includes(entry.status), entry.id);
    // Only something that works may be clickable.
    assert.equal(entry.action !== undefined, entry.status === 'available', entry.id);
  }
});

test('the catalog is frozen and its summary matches the entries', () => {
  assert.ok(Object.isFrozen(FUNCTION_CATALOG) && FUNCTION_CATALOG.every(Object.isFrozen));
  assert.ok(entries.every(Object.isFrozen));
  const summary = summarizeCatalog();
  assert.equal(summary.available + summary.planned + summary.excluded, entries.length);
  assert.equal(summary.available, entries.filter(entry => entry.status === 'available').length);
  assert.ok(summary.planned > summary.available, 'most of the menu is still to be built');
});

test('the functions that work today are exactly the reviewed set', () => {
  assert.deepEqual(entries.filter(entry => entry.status === 'available').map(entry => entry.id).sort(), [
    'antiscia', 'applications', 'archive', 'aspect-direction', 'aspect-focus', 'aspect-orbs', 'aspects', 'austral-inversion', 'celestial-elements', 'contra-antiscia', 'decades', 'decans', 'dodecatemoria', 'fixed-stars', 'house-system', 'latitudes',
    'lunar-return', 'monomoiria', 'natal', 'new-chart', 'planet-info', 'planet-of-year', 'planet-orbs', 'real-time',
    'session-charts', 'solar-return', 'synastry', 'terms', 'transits', 'transsaturnians',
  ]);
});

test('scope exclusions stay listed as excluded, not as planned work', () => {
  const excluded = entries.filter(entry => entry.status === 'excluded').map(entry => entry.id).sort();
  assert.deepEqual(excluded, ['chakra', 'physiognomy']);
});

test('the component dispatches every catalog action and disables the rest', () => {
  const component = read('src/app/desktop-app.component.ts');
  const html = read('src/app/desktop-app.component.html');
  for (const action of new Set(entries.map(entry => entry.action).filter(Boolean))) {
    assert.match(component, new RegExp("case '" + action + "':"), action);
  }
  // Available entries are active buttons; everything else sits in a collapsed, disabled list.
  assert.match(html, /\*ngFor="let entry of availableIn\(group\)"\s+\[disabled\]="busy \|\| calcBusy \|\| \(entry.action==='monomeri' && !monomeriAvailable\)"/);
  assert.match(html, /\*ngFor="let entry of unavailableIn\(group\)" disabled/);
});

test('calculated exports are never named like fixture exports', () => {
  assert.equal(calculatedPngFilename('natal', 'dark'), 'virgostars-chart-natal-dark.png');
  assert.notEqual(calculatedPngFilename('transits', 'light'), syntheticPngFilename('transits', 'light'));
  assert.throws(() => calculatedPngFilename('progressions', 'light'), /Invalid PNG export/);
  const download = read('src/app/png-download.ts');
  assert.match(download, /\['synthetic', 'chart'\]/);
});

test('a calculated chart is never paired with fixture overlays', () => {
  const component = read('src/app/desktop-app.component.ts');
  // No placeholder chart exists any more: overlays only ever come from calculated charts.
  assert.doesNotMatch(component, /makeFictionalTheme|fictionalPlanets|fictionalHouses/);
  assert.match(component, /const transit = this\.displayedTransit\?\.render;/);
  assert.match(component, /this\.displayChart\(this\.synodChart\)\?\.render : this\.partnerChart\?\.render;/);
  assert.match(component, /const present = AXIS_IDS\.includes\(id\) \|\| id in planets;/);
  assert.match(component, /target\.att = present && setting\.shown;/);
});
