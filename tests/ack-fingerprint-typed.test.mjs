import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ackFingerprint001, canonicalAckRequest001} from '../contracts/sync/ack-fingerprint-001.ts';
const {vectors} = JSON.parse(readFileSync(new URL('../contracts/sync/ack-fingerprint-001.json',import.meta.url),'utf8'));
const example = vectors[0].request;

test('browser Web Crypto TypeScript output matches three independent fixed golden hashes',async()=>{
  for(const v of vectors) assert.equal(await ackFingerprint001(v.request), v.sha256, v.name);
});
test('recursive key sorting is stable and changes to payload or revision alter the digest',async()=>{
  const a=vectors[1].request;
  const b={...a,payload:{label:'Fictional chart 2',items:['test',2,false,null],meta:{a:true,z:3}}};
  assert.equal(await ackFingerprint001(a),await ackFingerprint001(b));
  assert.notEqual(await ackFingerprint001(a),await ackFingerprint001({...a,baseRevision:'rev-2'}));
});
test('missing baseRevision, null delete payload, mismatched shape fail closed',()=>{
  const {baseRevision, ...missing}=example;
  for(const q of [missing,{...vectors[2].request,payload:null},{...example,operation:'delete'}, {...example,extra:'field'}]) {
    assert.throws(()=>canonicalAckRequest001(q),/Unsupported/);
  }
});
test('align identifier/revision bounds and negative-zero semantics with Rust',()=>{
  for(const q of [
    {...example,mutation:'synthetic-'+ 'x'.repeat(130)},
    {...example,baseRevision:''},
    {...example,baseRevision:'é'},
    {...example,payload:{value:-0}},
    {...example,payload:{value:1.5}},
  ]) assert.throws(()=>canonicalAckRequest001(q),/Unsupported/);
});
test('rejects accessor/symbol/prototype pollution and noncanonical arrays without invoking getters',()=>{
  let getterCalled=false;
  const accessor={};Object.defineProperty(accessor,'secret',{enumerable:true,get(){getterCalled=true;return 'bad';}});
  const poisoned=JSON.parse('{"__proto__":42}');
  const symbol={a:1};symbol[Symbol('hidden')]=true;
  const hole=Array(2);hole[0]=1;
  const extra=[1];extra.more=2;
  for(const payload of [accessor,poisoned,symbol,hole,extra]) assert.throws(()=>canonicalAckRequest001({...example,payload}),/Unsupported/);
  assert.equal(getterCalled,false);
});
test('deleted payload must be absent and strict JSON encoding preserves printable quotes',async()=>{
  const deletion=vectors[2].request;
  assert.equal(await ackFingerprint001(deletion),vectors[2].sha256);
  assert.throws(()=>canonicalAckRequest001({...deletion,payload:undefined}),/Unsupported/);
  const escaped={...example,payload:{note:'A "fictional" chart \\ key'}};
  assert.match(canonicalAckRequest001(escaped),/fictional/);
});
