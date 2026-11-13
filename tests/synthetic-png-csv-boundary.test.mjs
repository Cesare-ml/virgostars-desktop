import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFictionalAngles } from '../src/app/fictional-geometry.ts';
import { buildSyntheticChartCsv, SYNTHETIC_DATA_STATUS } from '../src/app/synthetic-csv-export.ts';
import { validatePngDataUrl, syntheticPngFilename } from '../src/app/png-export-safety.ts';
import { requestSyntheticPngDownload } from '../src/app/png-download.ts';

const VALID_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9YlxYy8AAAAASUVORK5CYII=';
const PLANETS = ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
function syntheticCsv() {
  const geometry = buildFictionalAngles(0);
  return buildSyntheticChartCsv(
    PLANETS.map((name, index) => ({name, longitude: geometry.planetLongitudes[index]})),
    geometry.houseCusps.map((longitude, index) => ({number: index+1, longitude})),
  );
}
function downloadPort(failClick = false) {
  const calls = [];
  return { calls, port: {
    createAnchor: () => {
      calls.push('create');
      return {
        set href(value) { calls.push(['href', value]); },
        set download(value) { calls.push(['filename', value]); },
        click() { calls.push('click'); if (failClick) throw new Error('click failed'); },
        remove() { calls.push('remove'); },
      };
    },
    appendAnchor: () => calls.push('append'),
  }};
}

test('a validated PNG download request does not alter any fictional CSV rows', () => {
  const before = syntheticCsv();
  const {calls, port} = downloadPort();
  requestSyntheticPngDownload(validatePngDataUrl(VALID_PNG), syntheticPngFilename('natal', 'light'), port);
  assert.deepEqual(calls.map(entry => Array.isArray(entry) ? entry[0] : entry),
    ['create','href','filename','append','click','remove']);
  assert.equal(syntheticCsv(), before);
  assert.equal(before.trimEnd().split('\r\n').length, 23);
  assert.ok(before.includes(SYNTHETIC_DATA_STATUS));
});

test('bad renderer output is rejected before creating any browser anchor', () => {
  for (const payload of ['https://example.test/chart.png', 'javascript:alert(1)',
    'data:text/html;base64,PGgxPkhlbGxvPC9oMT4=', null, {}]) {
    const {calls,port} = downloadPort();
    const before = syntheticCsv();
    assert.throws(() => requestSyntheticPngDownload(validatePngDataUrl(payload),
      syntheticPngFilename('natal', 'dark'), port), /Invalid PNG export/);
    assert.deepEqual(calls, []);
    assert.equal(syntheticCsv(), before);
  }
});

test('unapproved filename mode or theme cannot initiate an anchor or change CSV', () => {
  const {calls,port} = downloadPort();
  assert.throws(() => requestSyntheticPngDownload(validatePngDataUrl(VALID_PNG),
    syntheticPngFilename('../../unsafe', 'dark'), port), /Invalid PNG export/);
  assert.deepEqual(calls, []);
  assert.equal(syntheticCsv().includes('planet,Sun,19.3,' + SYNTHETIC_DATA_STATUS), true);
});

test('failed PNG click cleans the anchor and leaves fictional data untouched', () => {
  const original = syntheticCsv();
  const {calls,port} = downloadPort(true);
  assert.throws(() => requestSyntheticPngDownload(validatePngDataUrl(VALID_PNG),
    syntheticPngFilename('synastry', 'light'), port), /click failed/);
  assert.deepEqual(calls.slice(-3), ['append','click','remove']);
  assert.equal(syntheticCsv(), original);
});

test('Angular uses validated PNG download before access to any anchor href', () => {
  const app = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  const png = app.slice(app.indexOf('  async exportPng():'), app.indexOf('  exportSyntheticCsv():'));
  assert.ok(png.includes('validatePngDataUrl(png)'));
  assert.ok(png.includes('syntheticPngFilename(exportMode, exportTheme)'));
  assert.ok(png.includes('requestSyntheticPngDownload(safePng, safeFilename, {'));
  assert.ok(png.includes("document.body.appendChild(anchor)"));
  assert.ok(!png.includes('link.href=png'));
  assert.ok(!png.includes('fetch(') && !png.includes('invoke('));
  const csv = app.slice(app.indexOf('  exportSyntheticCsv():'), app.indexOf('  private renderError'));
  assert.ok(csv.includes('buildSyntheticChartCsv(this.planets, this.houses)'));
  assert.ok(csv.includes('createSyntheticCsvBrowserPort({'));
});
