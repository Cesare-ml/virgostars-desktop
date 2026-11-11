import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
const fixture = JSON.parse(readFileSync(new URL('../contracts/sync/ack-fingerprint-001.json',import.meta.url), 'utf8'));
const prefix = 'virgostars-ack-fp-001\n';
const ID=/^synthetic-[a-zA-Z0-9_-]+$/;
function reject(reason){throw new Error(reason);}
function canonical(value,depth=0) {
  if(depth>64)reject('depth');
  if(value===null||value===true||value===false)return JSON.stringify(value);
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value))reject('integer required');
    return JSON.stringify(value);
  }
  if(typeof value==='string'){
    if(!/^[\x20-\x7E]*$/.test(value))reject('non-ascii/control');
    return JSON.stringify(value);
  }
  if(Array.isArray(value))return '['+value.map(v=>canonical(v,depth+1)).join(',')+']';
  if(!value||typeof value!=='object'||Object.getPrototypeOf(value)!==Object.prototype)reject('plain object required');
  return '{'+Object.keys(value).sort().map(k=>{
    if(['__proto__','constructor','prototype'].includes(k))reject('unsafe key');
    return canonical(k,depth+1)+':'+canonical(value[k],depth+1);
  }).join(',')+'}';
}
function digest(q){
  if(!q||typeof q!=='object'||Array.isArray(q))reject('request object required');
  const required=['profile','mutation','entityType','entity','operation','baseRevision','createdAt'];
  const keys=Object.keys(q).sort();
  const allowed=[...required,'payload'];
  if(required.some(k=>!Object.hasOwn(q,k))||keys.some(k=>!allowed.includes(k)))reject('invalid envelope');
  if(!ID.test(q.profile)||!ID.test(q.mutation)||!ID.test(q.entity)||q.entityType!=='subject')reject('fictional identifiers only');
  if(q.operation!=='upsert'&&q.operation!=='delete')reject('operation');
  if(q.operation==='upsert'&&(!Object.hasOwn(q,'payload')||q.payload===null))reject('upsert payload');
  if(q.operation==='delete'&&Object.hasOwn(q,'payload'))reject('delete has payload');
  if(q.baseRevision!==null&&(typeof q.baseRevision!=='string'||q.baseRevision.length>128))reject('revision');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(q.createdAt))reject('timestamp');
  const json=canonical(q);
  if(Buffer.byteLength(json,'utf8')>262144)reject('oversize');
  return createHash('sha256').update(prefix+json).digest('hex');
}
test('golden corpus contains three distinct frozen semantic hashes',()=>{
  assert.equal(fixture.schema,'ACK-FP-001');assert.equal(fixture.domainSeparator,prefix);
  assert.equal(fixture.vectors.length,3);
  for(const v of fixture.vectors)assert.equal(digest(v.request),v.sha256,v.name);
});
test('nested key ordering does not change fingerprint',()=>{
  const a=fixture.vectors[1].request;
  const b={...a,payload:{label:'Fictional chart 2',items:['test',2,false,null],meta:{a:true,z:3}}};
  assert.equal(digest(a),digest(b));
});
test('changed payload, entity, revision and operation cannot reuse digest',()=>{
  const a=fixture.vectors[0].request; const h=digest(a);
  for(const change of [{payload:{label:'Changed'}},{entity:'synthetic-other'},{baseRevision:'rev-x'},{mutation:'synthetic-new'}])assert.notEqual(digest({...a,...change}),h);
});
test('delete must omit payload and upsert needs object payload',()=>{
  const a=fixture.vectors[2].request;assert.match(digest(a),/^[0-9a-f]{64}$/);
  assert.throws(()=>digest({...a,payload:{}}),/delete has payload/);
  assert.throws(()=>digest({...a,operation:'upsert'}),/upsert payload/);
});
test('unsupported numeric, text and key forms fail closed',()=>{
  const a=fixture.vectors[0].request;
  for(const payload of [{label:'Café'},{value:1.5},{value:9007199254740992},JSON.parse('{"__proto__":1}')])assert.throws(()=>digest({...a,payload}),/integer|required|non-ascii|unsafe key/);
  assert.throws(()=>digest({...a,profile:'actual-account'}),/fictional identifiers/);
  assert.throws(()=>digest({...a,unexpected:'extra'}),/invalid envelope/);
});
