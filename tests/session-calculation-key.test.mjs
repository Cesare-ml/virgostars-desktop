import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {SessionCalculationKeyV1} from '../src/app/session-calculation-key.ts';

const candidate = Object.freeze({
 status:'provisional_only',protocolVersion:1,
 instantUtc:'2026-10-25T01:30:00.000Z',latMicro:43769560,lngMicro:11255810,
 timeZone:'Europe/Rome',offsetSeconds:3600,tzdbVersion:'2026b',tzdbCaution:null,
 timeZoneProvenance:'bundled_moment_unverified',declaredProviderId:'test-native-unavailable',
});
const keyring=()=>SessionCalculationKeyV1.create(webcrypto);

test('same session and same input produce same opaque queue-valid HMAC key',async()=>{
 const ring=await keyring();
 const a=await ring.forPreview(candidate),b=await ring.forPreview({...candidate});
 assert.equal(a,b);
 assert.match(a,/^natal_hmac1\.[0-9a-f]{64}$/);
 assert.ok(a.length<=128);
 ring.dispose();
});
test('independent sessions do not share their fingerprint secret',async()=>{
 const a=await keyring(),b=await keyring();
 assert.notEqual(await a.forPreview(candidate),await b.forPreview(candidate));
 a.dispose();b.dispose();
});
test('all current calculation-affecting fields are domain-separated',async()=>{
 const ring=await keyring(),original=await ring.forPreview(candidate);
 const variants=[
  ['instantUtc','2026-10-25T00:30:00.000Z'],['latMicro',43000000],
  ['lngMicro',11000000],['timeZone','Etc/UTC'],['offsetSeconds',7200],
  ['tzdbVersion','2026c'],['tzdbCaution','pre_1970'],
  ['declaredProviderId','test-native-unavailable-v2'],
 ];
 for (const [field,value] of variants){
   assert.notEqual(await ring.forPreview({...candidate,[field]:value}),original,field);
 }
 ring.dispose();
});
test('object property insertion order does not affect canonical identity',async()=>{
 const ring=await keyring();
 const reversed=Object.fromEntries(Object.entries(candidate).reverse());
 assert.equal(await ring.forPreview(reversed),await ring.forPreview(candidate));
 ring.dispose();
});
test('key never embeds raw birth data, provider or timezone names',async()=>{
 const ring=await keyring(),value=await ring.forPreview(candidate);
 for (const secret of ['2026-10-25','Europe/Rome','test-native-unavailable','43769560']){
   assert.ok(!value.includes(secret));
 }
 ring.dispose();
});
test('unmodeled extra properties fail closed rather than collide with the same key',async()=>{
 const ring=await keyring();
 await assert.rejects(ring.forPreview({...candidate,houseSystem:'placidus'}),/Calculation identity unavailable/);
 ring.dispose();
});
test('missing or malformed fields are rejected without leaking values',async()=>{
 const ring=await keyring();
 const {timeZone:_omit,...missing}=candidate;
 for (const bad of [missing,null,[],
  {...candidate,instantUtc:'2026-02-30T01:30:00.000Z'},
  {...candidate,instantUtc:'2026-10-25T02:30:00+01:00'},
  {...candidate,latMicro:NaN},{...candidate,lngMicro:180_000_001},
  {...candidate,offsetSeconds:0.25},{...candidate,offsetSeconds:99_999},
  {...candidate,timeZone:'<script>'},{...candidate,tzdbVersion:'unknown'},
  {...candidate,declaredProviderId:'private name'},
  {...candidate,status:'ready'},{...candidate,protocolVersion:2},
  {...candidate,tzdbCaution:'unchecked'},
  {...candidate,timeZoneProvenance:'trusted'},
 ])await assert.rejects(ring.forPreview(bad),e=>e.message==='Calculation identity unavailable');
 ring.dispose();
});
test('unavailable WebCrypto or insecure key generation never falls back to plaintext hash',async()=>{
 await assert.rejects(SessionCalculationKeyV1.create(null),/Calculation identity unavailable/);
 const broken={subtle:{generateKey:async()=>{throw Error('private system path')}}};
 await assert.rejects(SessionCalculationKeyV1.create(broken),e=>e.message==='Calculation identity unavailable');
 const extractable={subtle:{generateKey:async()=>({type:'secret',extractable:true,algorithm:{name:'HMAC'},usages:['sign']})}};
 await assert.rejects(SessionCalculationKeyV1.create(extractable),/Calculation identity unavailable/);
});
test('dispose revokes key use and is idempotent',async()=>{
 const ring=await keyring();await ring.forPreview(candidate);
 ring.dispose();ring.dispose();
 await assert.rejects(ring.forPreview(candidate),/Calculation identity unavailable/);
});
test('key computed after dispose is rejected even when crypto ignores cancellation',async()=>{
 let release;
 const pending=new Promise(resolve=>{release=resolve});
 const source={subtle:{
  generateKey:async()=>({type:'secret',extractable:false,algorithm:{name:'HMAC'},usages:['sign']}),
  sign:async()=>{await pending;return new Uint8Array(32).buffer;},
 }};
 const ring=await SessionCalculationKeyV1.create(source),answer=ring.forPreview(candidate);
 ring.dispose();release();
 await assert.rejects(answer,/Calculation identity unavailable/);
});
test('unexpected cryptographic signatures are rejected',async()=>{
 const source={subtle:{
  generateKey:async()=>({type:'secret',extractable:false,algorithm:{name:'HMAC'},usages:['sign']}),
  sign:async()=>new Uint8Array(1).buffer,
 }};
 const ring=await SessionCalculationKeyV1.create(source);
 await assert.rejects(ring.forPreview(candidate),/Calculation identity unavailable/);
 ring.dispose();
});
