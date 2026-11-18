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
  assert.equal(validHistoricalCalendar({...request, year:-1}), false);
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
