import test from 'node:test';
import assert from 'node:assert/strict';
import {validHistoricalChartRequest, requestHistoricalChart, decodeHistoricalChart} from '../src/app/native/historical-chart-contract.ts';
import {decodeChartResponse} from '../src/app/native/chart-calculation-contract.ts';
import {validChartRecord, decodeArchiveResponse, requestArchive} from '../src/app/native/chart-archive-contract.ts';
import {resolveHistoricalNewChart} from '../src/app/new-chart-form.ts';
import {buildTemaRenderData} from '../src/app/astro/tema-render-data.ts';

const request = {civil:{year:0, month:2, day:29, hour:12, minute:0, second:0,
  calendar:'julian', offset:{kind:'localMeanSolar'}, uncertaintySeconds:60},
  deltaT:{kind:'supplied', seconds:100, uncertaintySeconds:5, source:'test'},
  latMicro:41900000, lngMicro:12500000};
const body = (id, ephemerisSource) => ({id, longitudeDeg:20, latitudeDeg:0, distanceAu:1,
  longitudeSpeed:1, latitudeSpeed:0, distanceSpeed:0, rightAscensionDeg:21, declinationDeg:1, ephemerisSource});
const raw = () => ({protocolVersion:1, status:'ok', provider:{id:'virgostars_ephemeris', engineVersion:'test'},
  chart:{julianDayUt:1721117, bodies:[body('Sun','jpl'),body('Moon','jpl'),body('mean Node','lunar_model')],
    houses:[], unavailableBodies:[], unavailableHouseSystems:[]},
  time:{jdUt1:1721117, jdTt:1721117+100/86400, deltaTSeconds:100, deltaTUncertaintySeconds:5,
    deltaTSource:'test', civilUncertaintySeconds:60, offsetSecondsEast:3000, offsetSource:'LOCAL_MEAN_SOLAR_TIME'}});
const historicRecord = () => ({id:'11111111-1111-4111-8111-111111111111', name:'Test', utcIso:'', timeZone:'',
  latMicro:request.latMicro, lngMicro:request.lngMicro, placeName:'Test', historical:{protocolVersion:1,...request}});

test('historical input checks calendar and keeps local time distinct from UTC', () => {
  assert.equal(validHistoricalChartRequest(request), true);
  assert.equal(validHistoricalChartRequest({...request,civil:{...request.civil,calendar:'gregorian',year:1900}}), false);
  assert.equal(validHistoricalChartRequest({...request,civil:{...request.civil,uncertaintySeconds:-1}}), false);
  assert.equal(validChartRecord(historicRecord()), true);
  assert.equal(validChartRecord({...historicRecord(),utcIso:'2000-01-01T00:00:00Z'}), false);
  assert.equal(validChartRecord({...historicRecord(),lngMicro:1}), false);
});
test('historical native response carries the same UT1 and keeps model points distinct', async () => {
  const response = decodeHistoricalChart(raw(), decodeChartResponse);
  assert.equal(response.kind,'ready');
  assert.equal(response.chart.bodies[2].ephemerisSource,'lunar_model');
  assert.equal(response.time.civilUncertaintySeconds,60);
  assert.throws(() => decodeChartResponse(raw()));
  const wrong = raw(); wrong.time.jdUt1++;
  assert.throws(() => decodeHistoricalChart(wrong, decodeChartResponse));
  const calls=[];
  const result=await requestHistoricalChart({isNative:()=>true,invoke:async (...args)=>{calls.push(args);return raw();}},request,decodeChartResponse);
  assert.equal(result.kind,'ready');
  assert.equal(calls[0][0],'calculate_historical_chart');
  const mismatched=raw(); mismatched.time.offsetSecondsEast=0;
  assert.equal((await requestHistoricalChart({isNative:()=>true,invoke:async()=>mismatched},request,decodeChartResponse)).kind,'unavailable');
});
test('archive round-trips historical input without synthesizing UTC', async () => {
  const record=historicRecord();
  const saved={...record,createdAtMs:1,updatedAtMs:2};
  const reply={protocolVersion:1,status:'ok',charts:[saved],legacyPresent:false};
  const result=decodeArchiveResponse(reply);
  assert.equal(result.status,'ok');
  assert.deepEqual(result.charts[0].historical,record.historical);
  assert.ok(Object.isFrozen(result.charts[0].historical.civil));
  saved.historical.civil.year = 5;
  assert.equal(result.charts[0].historical.civil.year,0);
  saved.historical.civil.year = 0;
  let sent;
  const output=await requestArchive({isNative:()=>true,invoke:async (_command,args)=>{sent=args;return reply;}},{operation:'save',chart:record});
  assert.equal(output.kind,'ready');
  assert.equal(sent.request.chart.utcIso,'');
  assert.deepEqual(sent.request.chart.historical, record.historical);
  const hostile=historicRecord();
  Object.defineProperty(hostile.historical.civil,'year',{get(){throw new Error('private');},enumerable:true});
  assert.equal(validChartRecord(hostile),false);
});

test('form, historical calculation, wheel data and archive share one saved input', async () => {
  const fields={name:'Test',date:'0-02-29',time:'12:00:00',timeZone:'',latitude:'41.9',longitude:'12.5',placeName:'Test'};
  const options={calendar:'julian',offset:'localMeanSolar',offsetSeconds:'0',deltaT:'supplied',deltaTSeconds:'100',civilUncertaintySeconds:'60',deltaTUncertaintySeconds:'5'};
  const form=resolveHistoricalNewChart(fields,options);
  assert.equal(form.status,'ready');
  const nativeResponse=raw();
  nativeResponse.time.deltaTSource='User supplied';
  nativeResponse.chart.houses=[{id:'placido',cuspsDeg:Array.from({length:12},(_,i)=>(100+i*30)%360),ascendantDeg:100,mcDeg:10,armcDeg:11,vertexDeg:220}];
  const result=await requestHistoricalChart({isNative:()=>true,invoke:async()=>nativeResponse},form.input.historical,decodeChartResponse);
  assert.equal(result.kind,'ready');
  const wheel=buildTemaRenderData(result.chart,'29/02/1 BCE 12:00:00');
  assert.equal(wheel.dataora,'29/02/1 BCE 12:00:00');
  assert.equal(wheel.houses.placido.house.length,12);
  const stored={...historicRecord(),historical:form.input.historical,createdAtMs:1,updatedAtMs:2};
  const archive=decodeArchiveResponse({protocolVersion:1,status:'ok',charts:[stored],legacyPresent:false});
  assert.deepEqual(archive.charts[0].historical,form.input.historical);
  assert.equal(archive.charts[0].utcIso,'');
});
