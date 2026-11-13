import test from 'node:test';
import assert from 'node:assert/strict';
import {resolveCivilTime} from '../src/app/native/civil-time.ts';
import {selectCivilInstant} from '../src/app/native/civil-time-choice.ts';
import {submitCivilCalculation} from '../src/app/native/civil-calculation-dispatch.ts';

const rome=(date,time)=>({date,time,timeZone:'Europe/Rome'});
const loc={latMicro:43769560,lngMicro:11255810};
const key='opaque.session_abc.1';
const selector = (input, chosen) => selectCivilInstant(input, resolveCivilTime, chosen);
const create=()=>{
  const drafts=[];
  const queue={submit(draft){drafts.push(draft);return drafts.length;}};
  return {queue,drafts,send:(input,selectedUtc=null,location=loc,calculationKey=key)=>
    submitCivilCalculation(input,selector,location,calculationKey,queue,selectedUtc)};
};

test('resolved winter time dispatches canonical UTC to committed calculation queue port',()=>{
  const h=create();
  const result=h.send(rome('2026-01-15','08:05'));
  assert.equal(result.status,'submitted');assert.equal(result.requestSeq,1);
  assert.deepEqual(h.drafts,[{
    intent:'committed',utcIso:'2026-01-15T07:05:00.000Z',
    latMicro:43769560,lngMicro:11255810,timeZone:'Europe/Rome',
    calculationKey:key,
  }]);
  assert.equal(result.selection.timeZoneSource,'host_iana_unpinned');
  assert.equal(result.selection.offsetSeconds,3600);
});

test('ambiguous Rome DST hour never reaches queue without exact choice',()=>{
  const h=create(),result=h.send(rome('2026-10-25','02:30'));
  assert.equal(result.status,'choice_required');assert.equal(result.choices.length,2);
  assert.deepEqual(h.drafts,[]);
});

test('both explicit fall-back UTC choices dispatch separately and preserve offsets',()=>{
  const h=create(),date=rome('2026-10-25','02:30');
  const a=h.send(date,'2026-10-25T00:30:00.000Z');
  const b=h.send(date,'2026-10-25T01:30:00.000Z');
  assert.equal(a.status,'submitted');assert.equal(b.status,'submitted');
  assert.deepEqual(h.drafts.map(x=>x.utcIso),[
    '2026-10-25T00:30:00.000Z','2026-10-25T01:30:00.000Z']);
  assert.deepEqual([a.selection.offsetSeconds,b.selection.offsetSeconds],[7200,3600]);
});

test('an old selected UTC is rejected when date/time or zone changed',()=>{
  const h=create(),chosen='2026-10-25T00:30:00.000Z';
  assert.equal(h.send(rome('2026-10-25','03:30'),chosen).status,'selection_invalid');
  assert.equal(h.send(rome('2026-10-25','02:31'),chosen).status,'selection_invalid');
  assert.equal(h.send({date:'2026-10-25',time:'02:30',timeZone:'UTC'},chosen).status,'selection_invalid');
  assert.deepEqual(h.drafts,[]);
});

test('nonexistent DST hours and missing calendar dates never dispatch',()=>{
  const h=create();
  assert.equal(h.send(rome('2026-03-29','02:30')).status,'nonexistent');
  assert.equal(h.send(rome('2026-02-30','08:05')).status,'invalid');
  assert.equal(h.send({date:'2011-12-30',time:'12:00',timeZone:'Pacific/Apia'}).status,'nonexistent');
  assert.deepEqual(h.drafts,[]);
});

test('invalid geographic coordinates are rejected before calling resolver or queue',()=>{
  const h=create();let resolverCalls=0;
  for(const location of [null,{latMicro:NaN,lngMicro:0},{latMicro:0.5,lngMicro:0},
    {latMicro:90_000_001,lngMicro:0},{latMicro:0,lngMicro:-180_000_001},
    {latMicro:Infinity,lngMicro:0}]) {
    const result=submitCivilCalculation(rome('2026-01-15','08:05'),()=>{
      resolverCalls++;return {status:'nonexistent',timeZone:'UTC'};
    },location,key,h.queue);
    assert.equal(result.status,'location_invalid');
  }
  assert.equal(resolverCalls,0);assert.deepEqual(h.drafts,[]);
});

test('missing or unsafe calculation keys cannot send birth data to queue',()=>{
  const h=create();
  for(const value of [null,undefined,'','key with spaces','<script>','a'.repeat(129),
    'birth:2026/01/15','\n',{},1]) {
    assert.equal(submitCivilCalculation(rome('2026-01-15','08:05'),selector,loc,value,h.queue).status,'calculation_key_invalid');
  }
  assert.deepEqual(h.drafts,[]);
});

test('queue refusal and exceptions are sanitized, not reported as scientific success',()=>{
  const input=rome('2026-01-15','08:05');
  for(const queue of [{submit:()=>null},{submit:()=>0},{submit:()=>NaN},
    {submit:()=>{throw new Error('Private path/birth record')} }]) {
    assert.equal(submitCivilCalculation(input,selector,loc,key,queue).status,'queue_unavailable');
  }
});

test('resolver failure remains sanitized and does not dispatch',()=>{
  const drafts=[],queue={submit:(x)=>{drafts.push(x);return 1}};
  const result=submitCivilCalculation(rome('2026-01-15','08:05'),()=>{throw new Error('private-data')},loc,key,queue);
  assert.deepEqual(result,{status:'invalid',code:'TIME_ZONE_UNAVAILABLE'});
  assert.deepEqual(drafts,[]);
});

test('half-hour rollback is not automatically resolved either',()=>{
  const h=create(),input={date:'2026-04-05',time:'01:45',timeZone:'Australia/Lord_Howe'};
  const first=h.send(input);assert.equal(first.status,'choice_required');
  assert.deepEqual(h.drafts,[]);
  const second=h.send(input,first.choices[1].instantUtc);
  assert.equal(second.status,'submitted'); assert.equal(second.selection.offsetSeconds,37800);
});

test('quarter-hour zone and historical second-level offset are sent without rounding',()=>{
  const h=create();
  const kath=h.send({date:'2026-05-05',time:'12:00',timeZone:'Asia/Kathmandu'});
  const historical=h.send({date:'1900-01-15',time:'08:05',timeZone:'Europe/Amsterdam'});
  assert.equal(kath.status,'submitted');assert.equal(historical.status,'submitted');
  assert.equal(kath.selection.offsetSeconds,20700);
  assert.equal(Number.isInteger(historical.selection.offsetSeconds),true);
  assert.equal(new Date(Date.parse(historical.selection.instantUtc)+
    historical.selection.offsetSeconds*1000).toISOString(),'1900-01-15T08:05:00.000Z');
});

test('queue receives only whitelisted draft keys, never raw date, time or records',()=>{
  const h=create();h.send(rome('2026-01-15','08:05'));
  assert.deepEqual(Object.keys(h.drafts[0]).sort(),
    ['calculationKey','intent','latMicro','lngMicro','timeZone','utcIso'].sort());
  assert.equal(JSON.stringify(h.drafts[0]).includes('08:05'),false);
});
