import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveHistoricalNewChart, savedChartFields} from '../src/app/new-chart-form.ts';
const fields={name:'Test',date:'0-02-29',time:'12:30:12',timeZone:'',latitude:'41.9',longitude:'12.5',placeName:'Roma fittizia'};
const options={calendar:'julian',offset:'localMeanSolar',offsetSeconds:'0',deltaT:'supplied',deltaTSeconds:'120',
  civilUncertaintySeconds:'60',deltaTUncertaintySeconds:'30'};
test('historical form produces explicit local time and keeps UTC absent',()=>{
  const result=resolveHistoricalNewChart(fields,options);
  assert.equal(result.status,'ready');
  assert.equal(result.input.utcIso,'');
  assert.equal(result.input.historical.civil.year,0);
  assert.equal(result.input.historical.deltaT.seconds,120);
  assert.deepEqual(savedChartFields({...result.input,id:'x',createdAtMs:1,updatedAtMs:1}),
    {...fields,date:'0-02-29',time:'12:30:12',latitude:'41.900000',longitude:'12.500000'});
});
test('rejects invalid calendar dates and missing ΔT instead of guessing',()=>{
  assert.equal(resolveHistoricalNewChart({...fields,date:'1900-02-29'},{...options,calendar:'gregorian'}).status,'problem');
  assert.equal(resolveHistoricalNewChart(fields,{...options,deltaTSeconds:''}).status,'problem');
  assert.equal(resolveHistoricalNewChart({...fields,date:'-13000-01-01'},options).status,'problem');
});
test('editing a historical record retains fractional seconds',()=>{
  const result=resolveHistoricalNewChart({...fields,time:'12:30:00.000000001'},options);
  assert.equal(result.status,'ready');
  assert.equal(savedChartFields({...result.input,id:'x',createdAtMs:1,updatedAtMs:1}).time,'12:30:00.000000001');
});
