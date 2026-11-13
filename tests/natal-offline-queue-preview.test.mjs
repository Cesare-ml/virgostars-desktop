import assert from 'node:assert/strict';
import test from 'node:test';
import {captureNatalPreviewAnchor} from '../src/app/natal-preview-freshness.ts';
import {register} from 'node:module';
register(new URL('./ts-relative-resolution-loader.mjs', import.meta.url), import.meta.url);
const {NatalOfflineQueuePreview} = await import('../src/app/natal-offline-queue-preview.ts');
import {readFileSync} from 'node:fs';

const place={
  id:42,name:'Fictionalville',italianName:null,latMicro:43769560,
  lngMicro:11255810,population:200,stateId:12,region:'Invented region',
  timeZone:'Europe/Rome',countryName:'Fictional country',countryCode:'IT',
};
const early={isoUtc:'2026-10-25T00:30:00.000Z',epochMs:Date.parse('2026-10-25T00:30:00.000Z'),offsetMinutesEast:120};
const late={isoUtc:'2026-10-25T01:30:00.000Z',epochMs:Date.parse('2026-10-25T01:30:00.000Z'),offsetMinutesEast:60};
const fold={status:'ambiguous',timezone:'Europe/Rome',tzdbVersion:'2026b',caution:null,candidates:[early,late]};
const coverage={providerId:'synthetic-only-v1',earliestUtc:'2026-01-01T00:00:00.000Z',latestUtc:'2026-12-31T23:59:59.999Z'};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
/** Type-compatible, entirely fictional natal state fixture; queue and handoff are real. */
function form(){
  const draft={
    name:'Fictional Person',year:'2026',month:'10',day:'25',hour:'02',minute:'30',
    birthTimeKnown:true,place:{...place},inputRevision:0,preview:null,
    validate(){return {ok:true,preview:{
      protocolVersion:1,name:this.name,
      civil:{year:Number(this.year),month:Number(this.month),day:Number(this.day),
        hour:this.birthTimeKnown?Number(this.hour):null,
        minute:this.birthTimeKnown?Number(this.minute):null,
        birthTimeKnown:this.birthTimeKnown},
      place:{source:'owned-world-cities',sourceId:this.place.id,name:this.place.name,
        countryName:this.place.countryName,countryCode:this.place.countryCode,
        stateId:this.place.stateId,region:this.place.region,latMicro:this.place.latMicro,
        lngMicro:this.place.lngMicro,timeZone:this.place.timeZone},
      utcResolution:this.birthTimeKnown?'pending_historical_tzdb':'unknown_birth_time',
    }}} ,
    showPreview(){this.preview=this.validate().preview;return true},
    update(field,value){this[field]=value;this.inputRevision++;this.preview=null},
    setPlace(value){this.place=value;this.inputRevision++;this.preview=null},
    setBirthTimeKnown(value){this.birthTimeKnown=value;this.inputRevision++;this.preview=null},
  };
  assert.equal(draft.showPreview(),true);
  return {draft,anchor:captureNatalPreviewAnchor(draft)};
}
function session(){
  const received=[];
  const s=new NatalOfflineQueuePreview('fictional_session',outcome=>received.push(outcome));
  return {s,received};
}

test('actual queue never launches an ambiguous hour without user choice',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  assert.deepEqual(s.submit(draft,anchor,fold,null,coverage),{status:'selection_required'});
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('selected fold candidate reaches real latest-only queue and reports unavailable',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  assert.deepEqual(s.submit(draft,anchor,fold,late.isoUtc,coverage),{status:'queued',requestSeq:1});
  await settle();assert.deepEqual(received,[{kind:'unavailable'}]);
  assert.equal(JSON.stringify(received).includes('Fictional Person'),false);
  s.dispose();
});
test('wrong or stale UTC choices cannot enqueue',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  assert.equal(s.submit(draft,anchor,fold,'2026-10-25T04:00:00.000Z',coverage).status,'selection_invalid');
  draft.update('minute','31');
  assert.equal(s.submit(draft,anchor,fold,late.isoUtc,coverage).status,'stale_preview');
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('unknown birth time never enters actual queue',async()=>{
  const {draft}=form();draft.setBirthTimeKnown(false);assert.equal(draft.showPreview(),true);
  const {s,received}=session();
  const out=s.submit(draft,captureNatalPreviewAnchor(draft),fold,late.isoUtc,coverage);
  assert.deepEqual(out,{status:'time_unknown'});
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('provider coverage missing and out-of-range fail before queue call',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  assert.equal(s.submit(draft,anchor,fold,early.isoUtc,null).status,'coverage_unavailable');
  const no2026={...coverage,earliestUtc:'2027-01-01T00:00:00.000Z',latestUtc:'2027-12-31T23:59:59.999Z'};
  assert.equal(s.submit(draft,anchor,fold,early.isoUtc,no2026).status,'outside_provider_range');
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('200 same-turn valid submissions coalesce in real queue to one latest unavailable response',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  for(let i=0;i<200;i++){
    const r=s.submit(draft,anchor,fold,i%2?early.isoUtc:late.isoUtc,coverage);
    assert.equal(r.status,'queued');assert.equal(r.requestSeq,i+1);
  }
  await settle();assert.deepEqual(received,[{kind:'unavailable'}]);s.dispose();
});
test('invalid later submission cancels earlier work before its microtask starts',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  assert.equal(s.submit(draft,anchor,fold,early.isoUtc,coverage).status,'queued');
  draft.update('minute','35');
  assert.equal(s.submit(draft,anchor,fold,early.isoUtc,coverage).status,'stale_preview');
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('manual invalidation cancels pending unavailable response',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  s.submit(draft,anchor,fold,early.isoUtc,coverage);s.invalidate();
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('dispose before microtask suppresses notification and later submissions',async()=>{
  const {draft,anchor}=form(),{s,received}=session();
  s.submit(draft,anchor,fold,early.isoUtc,coverage);s.dispose();
  await settle();assert.deepEqual(received,[]);
  assert.deepEqual(s.submit(draft,anchor,fold,early.isoUtc,coverage),{status:'queue_unavailable'});
  s.dispose();
});
test('invalid host IANA timezone is never sent to any native port',async()=>{
  const {draft}=form();draft.setPlace({...place,timeZone:'Fake/Invalid'});
  assert.equal(draft.showPreview(),true);
  const anchor=captureNatalPreviewAnchor(draft), resolution={...fold,timezone:'Fake/Invalid'};
  const {s,received}=session();
  assert.deepEqual(s.submit(draft,anchor,resolution,early.isoUtc,coverage),{status:'queue_rejected'});
  await settle();assert.deepEqual(received,[]);s.dispose();
});
test('transport and native ports are never injectable by callers',()=>{
  const code=readFileSync(new URL('../src/app/natal-offline-queue-preview.ts',import.meta.url),'utf8');
  assert.match(code,/new LatestCalculationQueue<never>\(/);
  assert.match(code,/status:'unavailable'/);
  assert.match(code,/\(_value\):_value is never=>false/);
  assert.doesNotMatch(code,/\binvoke\s*\(|\bfetch\s*\(|\blocalStorage\b|\bsessionStorage\b/);
});
