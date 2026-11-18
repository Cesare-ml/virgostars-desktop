import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';

const bundle = await build({
  entryPoints: [new URL('../src/app/astro/manual-planetary-hour.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { resolveManualPlanetaryHour } = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const solar = {
  sunriseLocal:'2024-06-20T05:00', sunsetLocal:'2024-06-20T21:00',
  nextSunriseLocal:'2024-06-21T05:00',
};

test('uses the sunrise local civil weekday and 12 unequal daylight hours', () => {
  const hour = resolveManualPlanetaryHour('2024-06-20T03:00:00.000Z', 'Europe/Rome', solar);
  assert.deepEqual(hour, {
    status:'READY', ruler:'JUPITER', number:1, segment:'DAY',
    startUtc:'2024-06-20T03:00:00.000Z', endUtc:'2024-06-20T04:20:00.000Z',
  });
  const later = resolveManualPlanetaryHour('2024-06-20T10:00:00.000Z', 'Europe/Rome', solar);
  assert.equal(later.status,'READY');
  assert.equal(later.number,6);
  assert.equal(later.ruler,'MOON');
});

test('after local midnight but before next sunrise still uses previous day ruler', () => {
  const night = resolveManualPlanetaryHour('2024-06-21T02:30:00.000Z', 'Europe/Rome', solar);
  assert.equal(night.status,'READY');
  assert.equal(night.number,24);
  assert.equal(night.segment,'NIGHT');
});

test('missing, malformed, reversed or DST-impossible event readings fail closed', () => {
  assert.equal(resolveManualPlanetaryHour('2024-06-20T09:00:00Z','Europe/Rome', {...solar, nextSunriseLocal:''}).status,'INCOMPLETE');
  assert.equal(resolveManualPlanetaryHour('2024-06-20T09:00:00Z','Europe/Rome', {...solar, sunsetLocal:'2024-06-19T18:00'}).status,'INVALID_CLOCK');
  assert.equal(resolveManualPlanetaryHour('2024-06-20T09:00:00Z','Europe/Rome', {...solar, sunriseLocal:'2024-06-31T05:00'}).status,'INVALID_CLOCK');
  assert.equal(resolveManualPlanetaryHour('2024-06-20T09:00:00Z','Europe/Rome', {...solar, sunriseLocal:'2024-03-31T02:30'}).status,'INVALID_CLOCK');
  assert.equal(resolveManualPlanetaryHour('2024-06-20T09:00:00Z','Bad/Zone', solar).status,'INVALID_CLOCK');
});

test('outside sunrise-to-next-sunrise schedule never guesses an hour ruler', () => {
  assert.deepEqual(resolveManualPlanetaryHour('2024-06-20T02:59:59.000Z','Europe/Rome',solar), {
    status:'OUTSIDE_INTERVAL', ruler:null,
  });
  assert.equal(resolveManualPlanetaryHour('2024-06-21T03:00:00.000Z','Europe/Rome',solar).status,'OUTSIDE_INTERVAL');
});

test('desktop gives explicit manual precedence and resets solar inputs for another chart', () => {
  const component = readFileSync(new URL('../src/app/desktop-app.component.ts', import.meta.url),'utf8');
  const html = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url),'utf8');
  assert.match(component,/return this.manualHourRuler \|\| \(hour.status === 'READY' \? hour.ruler : ''\)/);
  assert.match(component,/this.solarClockInputs = \{sunriseLocal:'',sunsetLocal:'',nextSunriseLocal:''\}/);
  assert.match(html,/setSolarClockInput\('sunriseLocal', \$event\)/);
  assert.match(html,/setSolarClockInput\('sunsetLocal', \$event\)/);
  assert.match(html,/setSolarClockInput\('nextSunriseLocal', \$event\)/);
});
