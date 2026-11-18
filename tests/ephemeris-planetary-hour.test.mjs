import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const bundle = await build({
  entryPoints:[fileURLToPath(new URL('../src/app/astro/ephemeris-planetary-hour.ts',import.meta.url))],
  bundle:true,platform:'node',format:'esm',write:false,
});
const {resolveEphemerisPlanetaryHour} = await import(
  `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`
);

const chart = Object.freeze({
  utcIso:'2024-06-20T10:00:00.000Z',timeZone:'Europe/Rome',
  latMicro:41_902_800,lngMicro:12_496_400,
});
const source = Object.freeze({
  weekday:'THURSDAY',
  observer:{latitudeDeg:41.9028,longitudeDegEast:12.4964,elevationMeters:20},
  model:{horizonDefinitionId:'USNO_MINUS_50_ARCMIN',refractionModelId:'STANDARD',eventAlgorithmId:'EXPERIMENTAL'},
  source:{engineId:'VIRGOSTARS_EPHEMERIS',engineVersion:'0.1.0',kernelSetId:'DE441_TEST',timeModelId:'EXPLICIT_UT1_TT_TDB',evidence:'CALLER_ASSERTED_NOT_VERIFIED'},
  events:{availability:'AVAILABLE',sunriseUtc:'2024-06-20T03:00:00.000Z',sunsetUtc:'2024-06-20T19:00:00.000Z',nextSunriseUtc:'2024-06-21T03:00:00.000Z'},
});

test('valid source handshake resolves the natal hour and retains unverified provenance', () => {
  const result = resolveEphemerisPlanetaryHour(chart,source);
  assert.equal(result.status,'READY');
  assert.equal(result.number,6);
  assert.equal(result.ruler,'MOON');
  assert.equal(result.provenance,'CALLER_ASSERTED_NOT_SCIENTIFICALLY_VERIFIED');
  assert.equal(result.model.horizonDefinitionId,'USNO_MINUS_50_ARCMIN');
  assert.equal(result.source.kernelSetId,'DE441_TEST');
});

test('wrong observer, weekday and instant cannot silently produce a ruler', () => {
  assert.deepEqual(resolveEphemerisPlanetaryHour({...chart,latMicro:41_911_000},source),{
    status:'MISMATCHED_OBSERVER',ruler:null,
  });
  assert.equal(resolveEphemerisPlanetaryHour(chart,{...source,weekday:'WEDNESDAY'}).status,'WEEKDAY_MISMATCH');
  assert.equal(resolveEphemerisPlanetaryHour({...chart,utcIso:'2024-06-20T02:30:00.000Z'},source).status,'OUTSIDE_INTERVAL');
});

test('malformed engine descriptors are rejected even for polar/unavailable events', () => {
  const unavailable = {...source,events:{availability:'UNAVAILABLE',reason:'POLAR_DAY'}};
  assert.equal(resolveEphemerisPlanetaryHour(chart,unavailable).status,'UNAVAILABLE');
  assert.equal(resolveEphemerisPlanetaryHour(chart,{...unavailable,source:{...source.source,engineId:'UNTRUSTED'}}).status,'INVALID_SOURCE');
  assert.equal(resolveEphemerisPlanetaryHour(chart,{...source,model:{...source.model,refractionModelId:''}}).status,'INVALID_SOURCE');
});

test('solar events at the wrong local day do not masquerade as the UTC weekday', () => {
  const dateBoundary = {...source,
    weekday:'THURSDAY',
    events:{availability:'AVAILABLE',sunriseUtc:'2024-06-19T23:30:00.000Z',sunsetUtc:'2024-06-20T12:00:00.000Z',nextSunriseUtc:'2024-06-20T23:30:00.000Z'},
  };
  // The local calendar in Rome has already advanced to Thursday.
  assert.equal(resolveEphemerisPlanetaryHour({...chart,utcIso:'2024-06-20T01:00:00.000Z'},dateBoundary).status,'READY');
});
