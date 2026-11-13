import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {register} from 'node:module';
register(new URL('./ts-relative-resolution-loader.mjs',import.meta.url),import.meta.url);
const {NatalSignedQueuePreview}=await import('../src/app/natal-signed-queue-preview.ts');
const {captureNatalPreviewAnchor}=await import('../src/app/natal-preview-freshness.ts');

const place={source:'owned-world-cities',sourceId:42,name:'Fictional City',countryName:'Fictionland',countryCode:'IT',
  stateId:1,region:'Test Region',latMicro:43769560,lngMicro:11255810,timeZone:'Europe/Rome'};
const early={isoUtc:'2026-10-25T00:30:00.000Z',epochMs:Date.parse('2026-10-25T00:30:00.000Z'),offsetMinutesEast:120};
const late={isoUtc:'2026-10-25T01:30:00.000Z',epochMs:Date.parse('2026-10-25T01:30:00.000Z'),offsetMinutesEast:60};
const fold=()=>({status:'ambiguous',timezone:'Europe/Rome',tzdbVersion:'2026b',caution:null,candidates:[{...early},{...late}]});
const coverage=()=>({providerId:'fake-native-unavailable',earliestUtc:'2026-01-01T00:00:00.000Z',latestUtc:'2026-12-31T23:59:59.999Z'});
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(){
  const draft={inputRevision:1,preview:null,
    state:{name:'Fictional Person',civil:{year:2026,month:10,day:25,hour:2,minute:30,birthTimeKnown:true},place:{...place}},
    validate(){return {ok:true,preview:{protocolVersion:1,name:this.state.name,
      civil:{...this.state.civil},place:{...this.state.place},utcResolution:this.state.civil.birthTimeKnown?'pending_historical_tzdb':'unknown_birth_time'}};},
    refresh(){this.preview=this.validate().preview;},
    change(fn){fn(this.state);this.inputRevision++;this.preview=null;},
  };
  draft.refresh();
  return {draft,anchor:captureNatalPreviewAnchor(draft),resolution:fold(),coverage:coverage()};
}
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve};}
function delayedCrypto(){
  const blocker=deferred(),state={calls:0};
  const cryptoProvider={subtle:{
    generateKey:(...args)=>webcrypto.subtle.generateKey(...args),
    sign:async(...args)=>{state.calls++;await blocker.promise;return webcrypto.subtle.sign(...args)},
  }};
  return {cryptoProvider,blocker,state};
}
const make=async (notify=()=>{},crypto=webcrypto)=>NatalSignedQueuePreview.create('synthetic_session',notify,crypto);
const submit=(session,f,utc=late.isoUtc)=>session.submit(f.draft,f.anchor,f.resolution,utc,f.coverage);

test('genuine WebCrypto HMAC signs preview into the actual queue, which remains unavailable only',async()=>{
  const f=fixture(),received=[],session=await make(o=>received.push(o));
  assert.deepEqual(await submit(session,f),{status:'queued',requestSeq:1});
  await settle();
  assert.deepEqual(received,[{kind:'unavailable'}]);
  const seen=JSON.stringify(received);
  for(const privatePart of ['Fictional Person','2026-10-25','Fictional City','43769560'])assert.ok(!seen.includes(privatePart));
  session.dispose();
});

test('an ambiguous autumn hour never starts signing without the explicit selected UTC',async()=>{
  const f=fixture(),received=[],session=await make(o=>received.push(o));
  assert.deepEqual(await submit(session,f,null),{status:'selection_required'});
  await settle();assert.deepEqual(received,[]);session.dispose();
});

test('bad UTC selection and unknown birth time reject before signing',async()=>{
  const f=fixture(),session=await make();
  assert.equal((await submit(session,f,'2026-10-25T09:30:00.000Z')).status,'selection_invalid');
  f.draft.change(s=>{s.civil.birthTimeKnown=false;s.civil.hour=null;s.civil.minute=null;});f.draft.refresh();
  f.anchor=captureNatalPreviewAnchor(f.draft);
  assert.equal((await submit(session,f)).status,'time_unknown');session.dispose();
});

test('200 rapid submissions collapse into one latest HMAC and one unavailable outcome',async()=>{
  const f=fixture(),received=[],session=await make(o=>received.push(o));
  const requests=[];
  for(let i=0;i<200;i++)requests.push(submit(session,f,i%2?early.isoUtc:late.isoUtc));
  const results=await Promise.all(requests);
  assert.equal(results.filter(r=>r.status==='queued').length,1);
  assert.equal(results.filter(r=>r.status==='superseded').length,199);
  assert.equal(results.at(-1).requestSeq,1);
  await settle();assert.deepEqual(received,[{kind:'unavailable'}]);session.dispose();
});

test('one active delayed crypto operation plus one replaceable pending, never unlimited signs',async()=>{
  const f=fixture(),received=[],delayed=delayedCrypto();
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const first=submit(session,f);
  await settle();assert.equal(delayed.state.calls,1);
  const pending=[];
  for(let i=0;i<300;i++)pending.push(submit(session,f,i%2?early.isoUtc:late.isoUtc));
  await settle();assert.equal(delayed.state.calls,1);
  delayed.blocker.resolve();
  const results=await Promise.all([first,...pending]);
  assert.equal(results.filter(r=>r.status==='queued').length,1);
  assert.equal(results.filter(r=>r.status==='superseded').length,300);
  assert.equal(delayed.state.calls,2);
  await settle();assert.deepEqual(received,[{kind:'unavailable'}]);session.dispose();
});

test('invalid submission cancels an active signature immediately, before crypto settles',async()=>{
  const f=fixture(),delayed=delayedCrypto(),received=[];
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const first=submit(session,f);
  await settle();assert.equal(delayed.state.calls,1);
  const invalid=await submit(session,f,null);
  assert.deepEqual(invalid,{status:'selection_required'});
  assert.deepEqual(await first,{status:'superseded'});
  delayed.blocker.resolve();await settle();assert.deepEqual(received,[]);session.dispose();
});

test('edit during signing is rejected after cryptographic await, even without explicit invalidate',async()=>{
  const f=fixture(),delayed=delayedCrypto(),received=[];
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const pending=submit(session,f);await settle();
  f.draft.change(s=>{s.civil.minute=31});
  delayed.blocker.resolve();
  assert.deepEqual(await pending,{status:'stale_preview'});
  await settle();assert.deepEqual(received,[]);session.dispose();
});

test('changed timezone-database version while signing blocks stale completed HMAC',async()=>{
  const f=fixture(),delayed=delayedCrypto(),received=[];
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const pending=submit(session,f);await settle();
  f.resolution.tzdbVersion='2026c';delayed.blocker.resolve();
  assert.deepEqual(await pending,{status:'stale_preview'});
  await settle();assert.deepEqual(received,[]);session.dispose();
});

test('changed declared provider coverage while signing invalidates previous HMAC',async()=>{
  const f=fixture(),delayed=delayedCrypto(),received=[];
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const pending=submit(session,f);await settle();
  f.coverage.providerId='fake-native-v2';delayed.blocker.resolve();
  assert.deepEqual(await pending,{status:'stale_preview'});
  await settle();assert.deepEqual(received,[]);session.dispose();
});

test('invalidate resolves active signing promptly and suppresses any future callback',async()=>{
  const f=fixture(),delayed=delayedCrypto(),received=[];
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const pending=submit(session,f);await settle();session.invalidate();
  assert.deepEqual(await pending,{status:'superseded'});
  delayed.blocker.resolve();await settle();assert.deepEqual(received,[]);session.dispose();
});

test('dispose resolves an active signing request and rejects all future submissions',async()=>{
  const f=fixture(),delayed=delayedCrypto(),received=[];
  const session=await make(o=>received.push(o),delayed.cryptoProvider);
  const first=submit(session,f);await settle();session.dispose();
  assert.deepEqual(await first,{status:'queue_unavailable'});
  assert.deepEqual(await submit(session,f),{status:'queue_unavailable'});
  delayed.blocker.resolve();await settle();assert.deepEqual(received,[]);
  session.dispose();
});

test('invalid IANA timezone reaches queue validation, never a provider',async()=>{
  const f=fixture(),session=await make();
  f.draft.change(s=>{s.place.timeZone='Fake/Invalid'});f.draft.refresh();
  f.anchor=captureNatalPreviewAnchor(f.draft);f.resolution.timezone='Fake/Invalid';
  assert.deepEqual(await submit(session,f),{status:'queue_rejected'});
  session.dispose();
});

test('HMAC signer failure does not emit a raw error or start queue',async()=>{
  const f=fixture(),received=[];
  const cryptoProvider={subtle:{generateKey:(...args)=>webcrypto.subtle.generateKey(...args),
    sign:async()=>{throw new Error('private path and personal data');}}};
  const session=await make(o=>received.push(o),cryptoProvider);
  assert.deepEqual(await submit(session,f),{status:'identity_unavailable'});
  await settle();assert.deepEqual(received,[]);session.dispose();
});

test('new adapters receive distinct HMAC secrets and can be discarded independently',async()=>{
  const f=fixture(),a=await make(),b=await make();
  assert.deepEqual(await submit(a,f),{status:'queued',requestSeq:1});
  assert.deepEqual(await submit(b,f),{status:'queued',requestSeq:1});
  a.dispose();
  assert.deepEqual(await submit(b,f),{status:'queued',requestSeq:2});
  b.dispose();
});

test('invalid session identifier is rejected before requesting a cryptographic key',async()=>{
  let calls=0;
  await assert.rejects(NatalSignedQueuePreview.create('wrong/identifier',()=>{},
    {subtle:{generateKey:async()=>{calls++;return null;}}}),/Invalid calculation session/);
  assert.equal(calls,0);
});
