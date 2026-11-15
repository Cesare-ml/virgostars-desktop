import test from 'node:test';
import assert from 'node:assert/strict';
import {RENDER_POINT_ORDER, aspectPoints, computeAspects, formatOrb} from '../src/app/astro/aspects.ts';
import {ASPECT_DEFINITIONS, defaultChartSettings} from '../src/app/chart-settings.ts';

// Visibly fictional positions chosen so each aspect is obvious.
const point = (name, longitude, speed = 1, declination = 0) => ({name, longitude, speed, declination});
const find = (rows, from, to, aspect) => rows.find(row => row.from === from && row.to === to && (!aspect || row.aspect === aspect));
const run = (points, change) => {
  const settings = defaultChartSettings();
  change?.(settings);
  return computeAspects(points, settings, ASPECT_DEFINITIONS);
};

test('major aspects are found within the orb of the second point', () => {
  const rows = run([point('Sun', 10), point('Moon', 132), point('Mars', 190), point('Saturn', 105.5)]);
  assert.equal(find(rows, 'Sun', 'Moon', 'trigono').orbDeg, 2);
  assert.equal(find(rows, 'Sun', 'Mars', 'opposizione').orbDeg, 0);
  assert.ok(Math.abs(find(rows, 'Sun', 'Saturn', 'quadrato').orbDeg - 5.5) < 1e-9);
  assert.equal(find(rows, 'Moon', 'Mars', 'sestile').orbDeg, 2);
  assert.ok(Math.abs(find(rows, 'Mars', 'Saturn', 'quadrato').orbDeg - 5.5) < 1e-9);
  assert.equal(find(rows, 'Moon', 'Saturn'), undefined, '26.5 degrees is no active aspect');
  assert.equal(rows.length, 5);
  assert.ok(rows.every(row => row.allowedOrbDeg === 6));
});

test('aspects wrap around the start of the zodiac', () => {
  const rows = run([point('Sun', 358), point('Moon', 1), point('Mars', 178.5)]);
  assert.equal(find(rows, 'Sun', 'Moon', 'congiunzione').orbDeg, 3);
  assert.ok(Math.abs(find(rows, 'Sun', 'Mars', 'opposizione').orbDeg - 0.5) < 1e-9);
});

test('the orb is that of the second point, capped by a smaller aspect orb', () => {
  const points = [point('Sun', 0), point('Moon', 65)];
  assert.ok(find(run(points), 'Sun', 'Moon', 'sestile'));
  // Tighten the Moon: 5 degrees from exact no longer fits.
  assert.equal(find(run(points, s => { s.points.Moon.orb = 4; }), 'Sun', 'Moon'), undefined);
  // Tightening the first point of the pair changes nothing.
  assert.ok(find(run(points, s => { s.points.Sun.orb = 1; }), 'Sun', 'Moon', 'sestile'));
  // An aspect orb caps the point orb only when it is smaller.
  assert.equal(find(run(points, s => { s.aspects.sestile.orb = 3; }), 'Sun', 'Moon'), undefined);
  const wide = find(run(points, s => { s.aspects.sestile.orb = 10; }), 'Sun', 'Moon', 'sestile');
  assert.equal(wide.allowedOrbDeg, 6);
  // The limit itself is excluded, as in the renderer.
  assert.equal(find(run([point('Sun', 0), point('Moon', 66)]), 'Sun', 'Moon'), undefined);
});

test('only active aspects between points that take part in aspects are listed', () => {
  const points = [point('Sun', 0), point('Moon', 150), point('Uranus', 120)];
  const defaults = run(points);
  assert.equal(find(defaults, 'Sun', 'Moon'), undefined, 'quincunx is off by default');
  assert.equal(find(defaults, 'Sun', 'Uranus'), undefined, 'Uranus is not aspected by default');
  const enabled = run(points, s => { s.aspects.quinconce.active = true; s.points.Uranus.aspects = true; });
  // Default quincunx orb is 2 degrees and caps the 6 degrees of the Moon.
  assert.equal(find(enabled, 'Sun', 'Moon', 'quinconce').allowedOrbDeg, 2);
  assert.ok(find(enabled, 'Sun', 'Uranus', 'trigono'));
  // Without the Sun, its trine with Uranus goes and Moon-Uranus (30 degrees) is not an active aspect.
  assert.equal(run(points, s => { s.points.Sun.aspects = false; s.points.Uranus.aspects = true; }).length, 0);
});

test('axes never aspect each other and a point never aspects its own opposite', () => {
  const rows = run([
    point('Sun', 100), {name: 'MC', longitude: 10, speed: null, declination: null},
    {name: 'AS', longitude: 100, speed: null, declination: null},
    {name: 'DS', longitude: 280, speed: null, declination: null},
    point('true Node', 40), point('true Node Sud', 220), point('osc. Apogee', 40), point('osc. Perigee', 220),
  ]);
  assert.equal(find(rows, 'MC', 'AS'), undefined);
  assert.equal(find(rows, 'AS', 'DS'), undefined);
  assert.equal(find(rows, 'true Node', 'true Node Sud'), undefined);
  assert.equal(find(rows, 'osc. Apogee', 'osc. Perigee'), undefined);
  assert.ok(find(rows, 'Sun', 'AS', 'congiunzione'));
  assert.ok(find(rows, 'Sun', 'MC', 'quadrato'));
  assert.ok(find(rows, 'true Node', 'osc. Apogee', 'congiunzione'), 'different points may still be conjunct');
});

test('applying and separating follow the daily motions; axes count as fixed', () => {
  // Moon behind the exact trine and faster: closing in.
  assert.equal(find(run([point('Sun', 0, 1), point('Moon', 118, 13)]), 'Sun', 'Moon').applying, true);
  // Moon past the exact trine and faster: moving away.
  assert.equal(find(run([point('Sun', 0, 1), point('Moon', 122, 13)]), 'Sun', 'Moon').applying, false);
  // A retrograde planet moving back toward exactness applies.
  assert.equal(find(run([point('Sun', 0, 1), point('Mars', 93, -0.3)]), 'Sun', 'Mars').applying, true);
  // Second point behind the first (negative side of the circle).
  assert.equal(find(run([point('Sun', 100, 1), point('Moon', 38, 13)]), 'Sun', 'Moon', 'sestile').applying, true);
  assert.equal(find(run([point('Sun', 100, 1), point('Moon', 42, 13)]), 'Sun', 'Moon', 'sestile').applying, false);
  // Exact, or no relative motion: not stated.
  assert.equal(find(run([point('Sun', 0, 1), point('Moon', 120, 13)]), 'Sun', 'Moon').applying, null);
  assert.equal(find(run([point('Sun', 0, 1), point('Mars', 91, 1)]), 'Sun', 'Mars').applying, null);
  // A planet approaching a fixed axis.
  const toAxis = run([point('Sun', 97, 1), {name: 'AS', longitude: 100, speed: null, declination: null}]);
  assert.equal(find(toAxis, 'Sun', 'AS', 'congiunzione').applying, true);
});

test('Phi aspects follow the order of the signs', () => {
  const on = s => { s.aspects.philunare.active = true; s.aspects.phisolare.active = true; };
  const ahead = run([point('Sun', 300), point('Moon', 77)], on);
  assert.ok(Math.abs(find(ahead, 'Sun', 'Moon', 'philunare').orbDeg - 0.5) < 1e-9, '137 degrees ahead across 0 Aries');
  // The same separation in the other direction is the solar Phi (222.49 ahead), not the lunar one.
  const behind = run([point('Sun', 77), point('Moon', 300)], on);
  assert.equal(find(behind, 'Sun', 'Moon', 'philunare'), undefined);
  assert.ok(find(behind, 'Sun', 'Moon', 'phisolare'));
  assert.equal(find(behind, 'Sun', 'Moon', 'phisolare').allowedOrbDeg, 2);
});

test('declination parallels use a fixed one-degree orb and need both declinations', () => {
  const on = s => { s.aspects.parallelodideclinazione.active = true; s.aspects.antiparallelo.active = true; };
  const rows = run([point('Sun', 10, 1, 12.4), point('Moon', 200, 13, 11.8), point('Mars', 300, 0.5, -12.9),
    {name: 'AS', longitude: 50, speed: null, declination: null}], on);
  const parallel = find(rows, 'Sun', 'Moon', 'parallelodideclinazione');
  assert.ok(Math.abs(parallel.orbDeg - 0.6) < 1e-9);
  assert.equal(parallel.allowedOrbDeg, 1);
  assert.equal(parallel.applying, null);
  assert.ok(find(rows, 'Sun', 'Mars', 'antiparallelo'));
  assert.equal(find(rows, 'Moon', 'Mars', 'antiparallelo'), undefined, '1.1 degrees apart');
  assert.ok(rows.every(row => row.kind === 'longitude' || (row.from !== 'AS' && row.to !== 'AS')));
});

test('chart points follow the renderer order; hidden bodies are left out, axes kept', () => {
  const body = (longitude, longitudeSpeed = 1) => ({longitude, longitudeSpeed, equatoriale: {declination: 3}});
  const data = {
    as: 100, ds: 280, mc: 10, ic: 190,
    planets: {'true Node': body(40, -0.05), Moon: body(132, 13), Sun: body(10), 'mean Node': body(41, -0.05), Chiron: body(200)},
  };
  const settings = defaultChartSettings();
  const points = aspectPoints(data, settings.points);
  assert.deepEqual(points.map(p => p.name), ['Sun', 'Moon', 'Chiron', 'MC', 'IC', 'AS', 'DS', 'true Node']);
  assert.deepEqual(points.find(p => p.name === 'AS'), {name: 'AS', longitude: 100, speed: null, declination: null});
  assert.deepEqual(points.find(p => p.name === 'Moon'), {name: 'Moon', longitude: 132, speed: 13, declination: 3});
  assert.ok(RENDER_POINT_ORDER.indexOf('MC') < RENDER_POINT_ORDER.indexOf('AS'));
  settings.points.Moon.shown = false;
  assert.ok(!aspectPoints(data, settings.points).some(p => p.name === 'Moon'));
});

test('orbs are shown in degrees and whole minutes', () => {
  assert.equal(formatOrb(0), "0°00'");
  assert.equal(formatOrb(2.0833334), "2°05'");
  assert.equal(formatOrb(5.9999), "5°59'");
});
