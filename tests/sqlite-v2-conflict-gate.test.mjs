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

// New synthetic v2 conflict receipt reference: no real server authentication.
function pendingRequest(row){return {profile:row.profile_id,mutation:row.mutation_id,entityType:row.entity_type,entity:row.entity_id,operation:row.operation,baseRevision:row.base_server_revision,createdAt:row.created_at_utc,...(row.operation==='upsert'?{payload:JSON.parse(row.payload_json)}:{})};}
function conflicts(db,profile){return db.prepare("SELECT mutation_id,entity_id,conflict_server_revision AS remote_revision FROM local_outbox WHERE profile_id=? AND state='conflict' AND entity_type='subject' ORDER BY sequence").all(profile);}
async function markConflict(db,profile,mutation,hash,remote,interrupt=false){
 if(!/^synthetic-[A-Za-z0-9_-]+$/.test(profile)||!/^synthetic-[A-Za-z0-9_-]+$/.test(mutation)||!/^[a-f0-9]{64}$/.test(hash)||typeof remote!=='string'||remote.length<1||remote.length>128||!/^[\x20-\x7e]+$/.test(remote))throw Error('Invalid input');
 const before=outbox(db,profile,mutation);if(!before)throw Error('Unknown mutation');
 const computed=await ackFingerprint001(pendingRequest(before));
 return tx(db,()=>{
  const row=outbox(db,profile,mutation);
  if(!row||row.sequence!==before.sequence||JSON.stringify(pendingRequest(row))!==JSON.stringify(pendingRequest(before)))throw Error('Changed pending snapshot');
  if(computed!==hash)throw Error('Wrong fingerprint');
  if(row.state==='conflict'){
   if(row.conflict_server_revision===remote)return 'replayed';
   throw Error('Conflicting repeated receipt');
  }
  if(row.state!=='pending'||row.conflict_server_revision!==null||row.base_server_revision===remote)throw Error('Invalid transition');
  const oldest=db.prepare("SELECT min(sequence) AS s FROM local_outbox WHERE profile_id=? AND entity_type='subject' AND entity_id=?").get(profile,row.entity_id).s;
  const current=local(db,profile,row.entity_id)?.server_revision??null;
  if(oldest!==row.sequence||current!==row.base_server_revision)throw Error('Out-of-order or stale conflict');
  const count=db.prepare("UPDATE local_outbox SET state='conflict',conflict_server_revision=? WHERE profile_id=? AND mutation_id=? AND state='pending' AND conflict_server_revision IS NULL").run(remote,profile,mutation).changes;
  if(count!==1||interrupt)throw Error('Interrupted before commit');
  return 'recorded';
 });
}

test('conflict marks outbox without overwriting local fictional subject',async()=>{
 const db=setup();try{const req=q();await stage(db,req);assert.equal(await markConflict(db,A,req.mutation,await ackFingerprint001(req),'rev-remote'),'recorded');
 assert.deepEqual(conflicts(db,A).map(x=>({...x})),[{mutation_id:req.mutation,entity_id:req.entity,remote_revision:'rev-remote'}]);
 assert.equal(local(db,A,req.entity).payload_json,JSON.stringify(req.payload));assert.equal(local(db,A,req.entity).server_revision,null);
 assert.equal(outbox(db,A,req.mutation).payload_json,JSON.stringify(req.payload));}finally{db.close();}
});
test('exact replay is accepted, different conflict revision is rejected',async()=>{
 const db=setup();try{const req=q();await stage(db,req);const h=await ackFingerprint001(req);await markConflict(db,A,req.mutation,h,'rev-x');
 assert.equal(await markConflict(db,A,req.mutation,h,'rev-x'),'replayed');
 await assert.rejects(markConflict(db,A,req.mutation,h,'rev-y'),/Conflicting repeated/);assert.equal(conflicts(db,A).length,1);}finally{db.close();}
});
test('wrong hash, unknown mutation and invalid revision never mark conflict',async()=>{
 const db=setup();try{const req=q();await stage(db,req);
 await assert.rejects(markConflict(db,A,req.mutation,'0'.repeat(64),'rev-x'),/Wrong fingerprint/);
 await assert.rejects(markConflict(db,A,'synthetic-missing',await ackFingerprint001(req),'rev-x'),/Unknown/);
 await assert.rejects(markConflict(db,A,req.mutation,await ackFingerprint001(req),''),/Invalid input/);
 assert.equal(conflicts(db,A).length,0);}finally{db.close();}
});
test('second mutation cannot receive conflict while an earlier edit is pending',async()=>{
 const db=setup();try{const first=q(),second=q('synthetic-m2');await stage(db,first);await stage(db,second);
 await assert.rejects(markConflict(db,A,second.mutation,await ackFingerprint001(second),'rev-x'),/Out-of-order/);
 assert.equal(outbox(db,A,first.mutation).state,'pending');}finally{db.close();}
});
test('conflicts are isolated between profiles and expose metadata only',async()=>{
 const db=setup();try{const req=q('synthetic-m1','synthetic-e1',B,{label:'Fictional B'});await stage(db,req);await markConflict(db,B,req.mutation,await ackFingerprint001(req),'rev-b');
 assert.equal(conflicts(db,A).length,0);assert.equal(conflicts(db,B).length,1);
 assert.deepEqual(Object.keys(conflicts(db,B)[0]),['mutation_id','entity_id','remote_revision']);}finally{db.close();}
});
test('injected conflict failure rolls back and remains pending after reopen',async()=>{
 const path=join(dir,'synthetic-conflict.db');let db=setup(path);const req=q();await stage(db,req);const hash=await ackFingerprint001(req);
 await assert.rejects(markConflict(db,A,req.mutation,hash,'rev-x',true),/Interrupted/);db.close();db=setup(path);
 try{assert.equal(outbox(db,A,req.mutation).state,'pending');assert.equal(conflicts(db,A).length,0);
 assert.equal(await markConflict(db,A,req.mutation,hash,'rev-x'),'recorded');}finally{db.close();}
});
test('conflict blocks same entity but leaves unrelated entities free',async()=>{
 const db=setup();try{const req=q();await stage(db,req);await markConflict(db,A,req.mutation,await ackFingerprint001(req),'rev-x');
 await assert.rejects(stage(db,q('synthetic-m2')),/Unresolved conflict/);
 assert.equal(await stage(db,q('synthetic-m3','synthetic-e2')),'queued');
 assert.equal(db.prepare('SELECT count(*) AS n FROM local_ack_ledger').get().n,0);}finally{db.close();}
});
test.after(()=>rmSync(dir,{recursive:true,force:true}));
