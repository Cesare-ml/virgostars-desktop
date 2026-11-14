import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  DEMO_PRESETS, DEMO_NAMES, DEFAULT_DEMO_PRESET, demoPresetDefinition,
  nextDemoPreset, fictionalAngles, fictionalPlanetPositions, fictionalHousePositions,
} from '../src/app/demo-presets.ts';

test('three fixed fictional presets cycle in deterministic order without external data', () => {
  assert.deepEqual(DEMO_PRESETS.map(p => p.id), ['a', 'b', 'c']);
  assert.equal(DEFAULT_DEMO_PRESET, 'a');
  assert.equal(nextDemoPreset('a'), 'b');
  assert.equal(nextDemoPreset('b'), 'c');
  assert.equal(nextDemoPreset('c'), 'a');
  assert.deepEqual(DEMO_PRESETS.map(p => p.shift), [0, 45, 120]);
});

test('preset selection is allowlisted and immutable', () => {
  assert.ok(Object.isFrozen(DEMO_PRESETS));
  assert.ok(DEMO_PRESETS.every(Object.isFrozen));
  for (const bad of ['', 'unknown', '__proto__', null, 7]) {
    assert.throws(() => demoPresetDefinition(bad), /Unknown synthetic/);
    assert.throws(() => nextDemoPreset(bad), /Unknown synthetic/);
  }
  for (const id of ['a', 'b', 'c']) assert.match(demoPresetDefinition(id).labelKey, /^demo\.preset\.[abc]$/);
});

test('planet and house inspector positions follow the same shift as each fixture', () => {
  assert.equal(DEMO_NAMES.length, 10);
  for (const preset of DEMO_PRESETS) {
    const planets = fictionalPlanetPositions(preset.shift);
    const houses = fictionalHousePositions(preset.shift);
    const angles = fictionalAngles(preset.shift);
    assert.deepEqual(planets.map(p => p.name), [...DEMO_NAMES]);
    assert.equal(planets.length, 10);
    assert.equal(houses.length, 12);
    assert.equal(houses[0].longitude, angles.ascendant);
    assert.deepEqual(houses.map(h => h.number), Array.from({length: 12}, (_, i) => i + 1));
    for (const longitude of [...planets.map(p => p.longitude), ...houses.map(h => h.longitude), angles.mc]) {
      assert.ok(Number.isFinite(longitude) && longitude >= 0 && longitude < 360);
    }
  }
});

test('presets really produce different longitudes, with unchanged default fixture', () => {
  assert.deepEqual(fictionalPlanetPositions().map(p => p.longitude),
    [19.3, 83.1, 44.8, 129.4, 167.1, 208.6, 278.1, 305.6, 347.7, 6.5]);
  assert.equal(fictionalAngles().ascendant, 103);
  assert.equal(fictionalAngles().mc, 15);
  assert.notDeepEqual(fictionalPlanetPositions(0), fictionalPlanetPositions(45));
  assert.notDeepEqual(fictionalHousePositions(45), fictionalHousePositions(120));
});

test('offsets wrap to 0..360 and invalid offsets fail without creating NaN longitudes', () => {
  for (const shift of [-720, -41, 360, 725]) {
    assert.ok(fictionalPlanetPositions(shift).every(p => p.longitude >= 0 && p.longitude < 360));
    assert.ok(fictionalHousePositions(shift).every(h => h.longitude >= 0 && h.longitude < 360));
  }
  for (const invalid of [NaN, Infinity, -Infinity]) {
    assert.throws(() => fictionalAngles(invalid), /Invalid synthetic/);
    assert.throws(() => fictionalPlanetPositions(invalid), /Invalid synthetic/);
  }
});

test('returned arrays are fresh and no mutable state leaks between samples', () => {
  const first = fictionalPlanetPositions(0);
  first[0].longitude = -1;
  const second = fictionalPlanetPositions(0);
  assert.equal(second[0].longitude, 19.3);
  const house = fictionalHousePositions(0);
  house[0].longitude = -1;
  assert.equal(fictionalHousePositions(0)[0].longitude, 103);
});

test('Angular switching wires chart, planet rows and house rows to one selected synthetic offset', () => {
  const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
  const fixture = read('src/app/fictional-fixture.ts');
  const app = read('src/app/desktop-app.component.ts');
  const html = read('src/app/desktop-app.component.html');
  const locales = read('src/app/translations.ts');
  assert.match(fixture, /fictionalPlanetPositions\(shift\)/);
  assert.match(fixture, /fictionalHousePositions\(shift\)/);
  assert.match(app, /const shift = demoPresetDefinition\(next\)\.shift/);
  assert.match(app, /this\.natal = makeFictionalTheme\(shift\)/);
  assert.match(app, /this\.transit = makeFictionalTheme\(shift \+ 23\)/);
  assert.match(app, /this\.synastry = makeFictionalTheme\(shift \+ 58\)/);
  assert.match(app, /this\.planets = fictionalPlanets\(shift\)/);
  assert.match(app, /this\.houses = fictionalHouses\(shift\)/);
  assert.match(html, /\(click\)="switchDemoPreset\(\)"/);
  assert.match(html, /\[disabled\]="!ready\|\|busy"/);
  assert.match(locales, /"demo\.next":/);
});
