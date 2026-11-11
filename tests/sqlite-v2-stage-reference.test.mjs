import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ackFingerprint001, canonicalAckRequest001 } from '../contracts/sync/ack-fingerprint-001.ts';
const v1=readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql',import.meta.url),'utf8');
const v2=readFileSync(new URL('../contracts/sqlite/0002_ack_ledger.sql',import.meta.url),'utf8');
const CLOCK='2026-11-11T21:00:00Z', A='synthetic-owner-a', B='synthetic-owner-b';
const dir=mkdtempSync(join(tmpdir(),'vs-fictional-stage-'));
function tx(db,job){db.exec('BEGIN IMMEDIATE');try{const result=job();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
function setup(path=':memory:'){
 const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON;');
 const ver=db.prepare('PRAGMA user_version').get().user_version;
 if(ver===0){db.exec(v1);for(const id of [A,B])db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(id);tx(db,()=>db.exec(v2));}
 else if(ver!==2)throw Error('Unknown fixture schema');
 return db;
}
function q(mutation='synthetic-m1',entity='synthetic-e1',profile=A,payload={label:'Fictional chart'}){
 return {profile,mutation,entityType:'subject',entity,operation:'upsert',baseRevision:null,createdAt:CLOCK,payload};
}
function outbox(db,profile,mutation){return db.prepare('SELECT * FROM local_outbox WHERE profile_id=? AND mutation_id=?').get(profile,mutation);}
function local(db,profile,entity){return db.prepare("SELECT * FROM local_entities WHERE profile_id=? AND entity_type='subject' AND entity_id=?").get(profile,entity);}
function ack(db,request,digest,revision='rev-1'){
 return tx(db,()=>{
 const rec=outbox(db,request.profile,request.mutation);if(!rec)throw Error('Missing pending');
 db.prepare('INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?,?,?,?,?,?,?)').run(request.profile,request.mutation,'subject',request.entity,digest,'accepted',revision,CLOCK);
 db.prepare('UPDATE local_entities SET server_revision=? WHERE profile_id=? AND entity_id=?').run(revision,request.profile,request.entity);
 db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(request.profile,request.mutation);
 });
}
async function stage(db,req,{fail=false}={}){
 canonicalAckRequest001(req);const hash=await ackFingerprint001(req);
 return tx(db,()=>{
  const prior=db.prepare('SELECT request_fingerprint FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?').get(req.profile,req.mutation);
  if(prior){if(prior.request_fingerprint===hash)return 'already-acknowledged';throw Error('Reuse of acknowledged ID');}
  if(outbox(db,req.profile,req.mutation))throw Error('Duplicate pending ID');
  const row=local(db,req.profile,req.entity);const current=row?.server_revision??null;
  if(current!==req.baseRevision)throw Error('Stale server revision');
  const blocked=db.prepare("SELECT count(*) AS n FROM local_outbox WHERE profile_id=? AND entity_type='subject' AND entity_id=? AND (state='conflict' OR base_server_revision IS NOT ?)").get(req.profile,req.entity,current).n;
  if(blocked)throw Error('Unresolved conflict or stale queued operation');
  const payload=req.operation==='upsert'?JSON.stringify(req.payload):null;
  db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision) VALUES (?,'subject',?,?,?,1) ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET payload_json=excluded.payload_json,locally_deleted=excluded.locally_deleted,local_revision=local_entities.local_revision+1")
    .run(req.profile,req.entity,payload,req.operation==='delete'?1:0);
  db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc) VALUES (?,?,?,?,?,?,?,?)")
    .run(req.profile,req.mutation,req.entityType,req.entity,req.operation,payload,req.baseRevision,req.createdAt);
  if(fail)throw Error('Synthetic failure before commit');
  return 'queued';
 });
}

test('v2 stages an upsert atomically and preserves its immutable pending snapshot',async()=>{
 const db=setup();try{const req=q();assert.equal(await stage(db,req),'queued');
 assert.equal(outbox(db,A,req.mutation).payload_json,JSON.stringify(req.payload));
 assert.equal(local(db,A,req.entity).local_revision,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger').get().n,0);
 }finally{db.close();}
});
test('a pending ID cannot be reused to alter an entity',async()=>{
 const db=setup();try{const req=q();await stage(db,req);
 await assert.rejects(stage(db,{...req,payload:{label:'Overwrite'}}),/Duplicate pending/);
 assert.equal(local(db,A,req.entity).payload_json,JSON.stringify(req.payload));
 assert.equal(local(db,A,req.entity).local_revision,1);
 }finally{db.close();}
});
test('already acknowledged exact request is a no-op; mismatched request is refused',async()=>{
 const db=setup();try{const req=q();await stage(db,req);ack(db,req,await ackFingerprint001(req));
 assert.equal(await stage(db,req),'already-acknowledged');
 await assert.rejects(stage(db,{...req,payload:{label:'Different'}}),/Reuse of acknowledged/);
 assert.equal(local(db,A,req.entity).local_revision,1);
 assert.equal(local(db,A,req.entity).payload_json,JSON.stringify(req.payload));
 }finally{db.close();}
});
test('v2 stages multiple unsent edits but holds stale dependents after first ACK',async()=>{
 const db=setup();try{const first=q(),second=q('synthetic-m2');await stage(db,first);await stage(db,second);
 assert.equal(local(db,A,first.entity).local_revision,2);
 ack(db,first,await ackFingerprint001(first));
 await assert.rejects(stage(db,q('synthetic-m3')),/Stale|Unresolved/);
 assert.ok(outbox(db,A,second.mutation));
 }finally{db.close();}
});
test('conflicted outbox blocks edits only to that entity',async()=>{
 const db=setup();try{const req=q();await stage(db,req);
 db.prepare("UPDATE local_outbox SET state='conflict', conflict_server_revision='rev-server' WHERE mutation_id=?").run(req.mutation);
 await assert.rejects(stage(db,q('synthetic-m2')),/Unresolved conflict/);
 assert.equal(await stage(db,q('synthetic-m3','synthetic-e2')),'queued');
 }finally{db.close();}
});
test('delete leaves local tombstone and a subsequent independent entity can be staged',async()=>{
 const db=setup();try{const deletion=q();deletion.operation='delete';delete deletion.payload;
 assert.equal(await stage(db,deletion),'queued');
 assert.equal(local(db,A,deletion.entity).locally_deleted,1);
 assert.equal(outbox(db,A,deletion.mutation).payload_json,null);
 assert.equal(await stage(db,q('synthetic-m3','synthetic-e2')),'queued');
 }finally{db.close();}
});
test('failure before COMMIT does not leave a partial entity or outbox entry',async()=>{
 const db=setup();try{const req=q();await assert.rejects(stage(db,req,{fail:true}),/Synthetic failure/);
 assert.equal(local(db,A,req.entity),undefined);
 assert.equal(outbox(db,A,req.mutation),undefined);
 }finally{db.close();}
});
test('mutation IDs are profile scoped and do not mix payloads',async()=>{
 const db=setup();try{const a=q(),b=q('synthetic-m1','synthetic-e1',B,{label:'Other fictional chart'});
 await stage(db,a);await stage(db,b);
 assert.equal(local(db,A,a.entity).payload_json,JSON.stringify(a.payload));
 assert.equal(local(db,B,b.entity).payload_json,JSON.stringify(b.payload));
 }finally{db.close();}
});
test('invalid non-ASCII, decimals, and missing profiles never mutate data',async()=>{
 const db=setup();try{
 for(const data of [{label:'Café'},{angle:12.5}])await assert.rejects(stage(db,{...q(),payload:data}),/Unsupported/);
 await assert.rejects(stage(db,q('synthetic-new','synthetic-e1','synthetic-unknown')),/constraint/i);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM local_entities').get().n,0);
 }finally{db.close();}
});
test('acknowledged ID remains unusable after reopening the synthetic file',async()=>{
 const path=join(dir,'synthetic-reopen.db');let db=setup(path);const req=q();await stage(db,req);ack(db,req,await ackFingerprint001(req));db.close();db=setup(path);
 try{assert.equal(await stage(db,req),'already-acknowledged');
 await assert.rejects(stage(db,{...req,payload:{label:'replay attack'}}),/Reuse of acknowledged/);
 }finally{db.close();}
});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
