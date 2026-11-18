import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

// Node's type-stripping runner does not resolve extensionless TS imports; keep
// the production import unchanged and resolve this one explicitly for tests.
const contractUrl = new URL('../src/app/native/historical-calendar-contract.ts', import.meta.url);
const dependencyUrl = new URL('../src/app/native/historical-planets-contract.ts', import.meta.url);
const source = readFileSync(contractUrl, 'utf8').replace("'./historical-planets-contract'", JSON.stringify(dependencyUrl.href));
const temporaryDir = mkdtempSync(join(tmpdir(), 'vsd-calendar-'));
const temporaryFile = join(temporaryDir, 'contract.ts');
let contract;
try {
  writeFileSync(temporaryFile, source, {flag:'wx'});
  contract = await import(pathToFileURL(temporaryFile).href);
} finally {
  unlinkSync(temporaryFile);
  rmdirSync(temporaryDir);
}
const {validHistoricalCalendar, requestHistoricalCalendar} = contract;

const request = Object.freeze({body:'Moon', year:2000, month:1, day:1, hour:12, minute:0, second:0,
  deltaT:{kind:'espenakMeeus2006', uncertaintySeconds:2}});
const ok = () => ({protocolVersion:1, status:'ok', result:{body:'Moon', jdUt1:2451545, jdTt:2451545.00074,
  jdTdb:2451545.00074, deltaTSeconds:63.86, uncertaintySeconds:2, deltaTSource:'Espenak-Meeus 2006',
  longitudeDeg:223, latitudeDeg:4, distanceAu:0.0025, longitudeSpeedDegPerTdbDay:12,
  latitudeSpeedDegPerTdbDay:0.2, radialSpeedAuPerTdbDay:0.00001, radialCorrectionApplied:true}});

test('accepts Gregorian leap days and enforces model and requested date bounds', () => {
  assert.equal(validHistoricalCalendar(request), true);
  assert.equal(validHistoricalCalendar({...request, month:2, day:29}), true);
  assert.equal(validHistoricalCalendar({...request, year:1900, month:2, day:29}), false);
  assert.equal(validHistoricalCalendar({...request, year:0, month:2, day:29}), true);
  assert.equal(validHistoricalCalendar({...request, year:-1}), true);
  assert.equal(validHistoricalCalendar({...request, year:-1999}), true);
  assert.equal(validHistoricalCalendar({...request, year:-2000}), false);
  assert.equal(validHistoricalCalendar({...request, year:3000, month:12, day:31}), true);
  assert.equal(validHistoricalCalendar({...request, year:3001}), false);
  const manual = {kind:'supplied', seconds:200, uncertaintySeconds:50, source:'synthetic'};
  assert.equal(validHistoricalCalendar({...request, year:-12999, deltaT:manual}), true);
  assert.equal(validHistoricalCalendar({...request, year:3999, deltaT:manual}), true);
  assert.equal(validHistoricalCalendar({...request, year:-13000, deltaT:manual}), false);
  assert.equal(validHistoricalCalendar({...request, year:4000, deltaT:manual}), false);
  assert.equal(validHistoricalCalendar({...request, deltaT:{...manual, source:' '}}), false);
  assert.equal(validHistoricalCalendar({...request, deltaT:{...manual, uncertaintySeconds:-1}}), false);
});

test('requires the 2004 standard-error estimate to stay inside its stated range', async () => {
  const deltaT = {kind:'espenakMeeus2006EstimatedUncertainty'};
  const estimated = {...request, year:0, month:1, day:1, hour:0, deltaT};
  assert.equal(validHistoricalCalendar({...estimated, year:-999}), true);
  assert.equal(validHistoricalCalendar({...estimated, year:-1000}), false);
  assert.equal(validHistoricalCalendar({...estimated, year:1200}), true);
  assert.equal(validHistoricalCalendar({...estimated, year:1200, minute:1}), false);
  assert.equal(validHistoricalCalendar({...estimated, year:1201}), false);
  const raw = ok();
  raw.result.deltaTSeconds = 10583.6;
  raw.result.uncertaintySeconds = 264.992;
  raw.result.uncertaintySource = 'Morrison-Stephenson 2004 standard error';
  const transport = {isNative:()=>true, invoke:async ()=>raw};
  const result = await requestHistoricalCalendar(transport, estimated);
  assert.equal(result.kind, 'ready');
  assert.equal(result.planet.uncertaintySource, raw.result.uncertaintySource);
  delete raw.result.uncertaintySource;
  assert.equal((await requestHistoricalCalendar(transport, estimated)).kind, 'unavailable');
});

test('dispatches the selected model and checks source and uncertainty in the reply', async () => {
  let sent;
  const response = ok();
  const transport = {isNative:()=>true, invoke:async (...args)=>{sent=args; return response;}};
  assert.equal((await requestHistoricalCalendar(transport, request)).kind, 'ready');
  assert.deepEqual(sent, ['calculate_historical_planet_calendar', {request:{protocolVersion:1, ...request}}]);
  response.result.deltaTSource = 'other';
  assert.equal((await requestHistoricalCalendar(transport, request)).kind, 'unavailable');
  assert.equal((await requestHistoricalCalendar({...transport, isNative:()=>false}, request)).kind, 'not_native');
});

test('optionally returns two detached sensitivity samples and rejects incomplete or inconsistent samples', async () => {
  const requested = {...request, includeScenarios:true};
  const raw = ok();
  const calls = [];
  const transport = {isNative:()=>true, invoke:async (...args)=>{calls.push(args); return raw;}};
  assert.equal((await requestHistoricalCalendar(transport, requested)).kind, 'unavailable');
  raw.result.sensitivity = {
    lower:{deltaTSeconds:63.86 - 2, longitudeDeg:222.99, latitudeDeg:3.99},
    upper:{deltaTSeconds:63.86 + 2, longitudeDeg:223.01, latitudeDeg:4.01},
  };
  const result = await requestHistoricalCalendar(transport, requested);
  assert.equal(result.kind, 'ready');
  assert.equal(calls.at(-1)[1].request.includeScenarios, true);
  assert.ok(Object.isFrozen(result.planet.sensitivity.lower));
  raw.result.sensitivity.lower.longitudeDeg = 100;
  assert.equal(result.planet.sensitivity.lower.longitudeDeg, 222.99);
  raw.result.sensitivity.upper.deltaTSeconds = 100;
  assert.equal((await requestHistoricalCalendar(transport, requested)).kind, 'unavailable');
  assert.equal(validHistoricalCalendar({...request, includeScenarios:'yes'}), false);
});
