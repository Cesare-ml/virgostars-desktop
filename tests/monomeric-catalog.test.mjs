import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

// Bundle the tiny pure TS resolver in memory: tests need neither a browser nor
// Node-only .ts import syntax that would break Angular's production compiler.
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/app/astro/monomeric-catalog.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { monomerPointLabel, resolveMonomers } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);
const LEGACY_THEBAN_MONOMERS = Array.from({length:360}, (_, index) =>
  resolveMonomers(index, 'shown-degree').primary.sourceText);

test('the 360 legacy source labels preserve the four screenshot images', () => {
  assert.equal(LEGACY_THEBAN_MONOMERS.length, 360);
  const expected = [
    [4, 'sparviero'],       // Aries 4
    [94, 'aspetta un uomo'], // Cancer 4
    [184, 'Uomo a cavallo'], // Libra 4
    [274, 'Due chiavi'],    // Capricorn 4
  ];
  for (const [index, snippet] of expected) {
    assert.match(LEGACY_THEBAN_MONOMERS[index], new RegExp(snippet));
    const resolved = resolveMonomers(index + 0.93, 'shown-degree');
    assert.equal(resolved.primary.sourcePointIndex, index);
    assert.deepEqual(resolved.adjacent, []);
  }
});

test('the displayed-degree mode is explicitly a 0–29 source label lookup', () => {
  const aries = resolveMonomers(4 + 56 / 60, 'shown-degree');
  assert.equal(monomerPointLabel(aries.primary, 'it'), 'Ariete 4°');
  assert.equal(resolveMonomers(360, 'shown-degree').primary.sourcePointIndex, 0);
  assert.equal(resolveMonomers(-0.01, 'shown-degree').primary.sourcePointIndex, 359);
});

test('Costesèque minute policy: 00′–30′ lower, 31′–59′ upper, including sign boundary', () => {
  assert.equal(resolveMonomers(4 + 30/60, 'costeseque-1940').primary.sourcePointIndex, 4);
  assert.equal(resolveMonomers(4 + 30.99/60, 'costeseque-1940').primary.sourcePointIndex, 4);
  assert.equal(resolveMonomers(4 + 31/60, 'costeseque-1940').primary.sourcePointIndex, 5);
  assert.equal(resolveMonomers(29 + 59/60, 'costeseque-1940').primary.sourcePointIndex, 30);
  assert.equal(resolveMonomers(359 + 59/60, 'costeseque-1940').primary.sourcePointIndex, 0);
});

test('Costesèque retains both active adjacent source points across zodiac boundaries', () => {
  const result = resolveMonomers(359.9, 'costeseque-1940');
  assert.equal(result.primary.sourcePointIndex, 0);
  assert.deepEqual(result.adjacent.map(point => point.sourcePointIndex), [359,1]);
  assert.equal(result.adjacent[0].sourceText, LEGACY_THEBAN_MONOMERS[359]);
});

test('historical Antares and Sirius cases are compatible with point plus adjacency', () => {
  const antares = resolveMonomers(240 + 9 + 33/60, 'costeseque-1940');
  assert.equal(antares.primary.sourcePointIndex, 250);
  assert.ok(antares.adjacent.some(point => point.sourcePointIndex === 249));
  const sirius = resolveMonomers(90 + 13 + 59/60, 'costeseque-1940');
  assert.equal(sirius.primary.sourcePointIndex, 104);
});

test('invalid longitude or implicit convention is rejected', () => {
  assert.throws(() => resolveMonomers(NaN, 'shown-degree'), RangeError);
  assert.throws(() => resolveMonomers(Infinity, 'costeseque-1940'), RangeError);
  assert.throws(() => resolveMonomers(4), RangeError);
});

test('desktop exposes the convention explicitly and renders historical ruler texts', () => {
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
  const ts = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url), 'utf8');
  assert.match(html, /<option value="shown-degree">/);
  assert.match(html, /<option value="costeseque-1940">/);
  assert.match(html, /monomeric-neighbor-card/);
  assert.match(ts, /description: `\$\{monomerPointLabel\(point, this.locale\)\} · \$\{point.sourceText\}`/);
  assert.match(ts, /rulerDescription: `\$\{monomerPointLabel\(rulerPoint, this.locale\)\} · \$\{rulerPoint.sourceText\}`/);
  assert.match(ts, /manualHourRuler: TraditionalPlanet \| '' = ''/);
});
