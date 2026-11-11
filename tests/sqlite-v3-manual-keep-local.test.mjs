import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ackFingerprint001, canonicalAckRequest001 } from '../contracts/sync/ack-fingerprint-001.ts';

const sql1=readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql',import.meta.url),'utf8');
const sql2=readFileSync(new URL('../contracts/sqlite/0002_ack_ledger.sql',import.meta.url),'utf8');
const sql3=readFileSync(new URL('../contracts/sqlite/0003_conflict_decisions.sql',import.meta.url),'utf8');
const P='synthetic-owner-a', Q='synthetic-owner-b', CLOCK='2026-11-11T21:30:00Z';
const dir=mkdtempSync(join(tmpdir(),'vs-fictional-resolution-'));
function tx(db,work){db.exec('BEGIN IMMEDIATE');try{const result=work();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}}
function open(path=':memory:'){
  const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
  const v=db.prepare('PRAGMA user_version').get().user_version;
  if(v===0){db.exec(sql1);db.exec(sql2);for(const p of [P,Q]) db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(p);}
  else if(v!==2&&v!==3)throw Error('unknown schema');
  return db;
}
function upgrade(db,fail=false){
  if(db.prepare('PRAGMA user_version').get().user_version!==2)throw Error('wrong upgrade state');
  return tx(db,()=>{ db.exec(sql3); if(fail)throw Error('migration interrupted'); });
}
function request(p=P,mutation='synthetic-old',entity='synthetic-chart',payload={label:'Fictional chart'}){
  return {profile:p,mutation,entityType:'subject',entity,operation:'upsert',baseRevision:null,createdAt:CLOCK,payload};
}
function pending(db,p,m){return db.prepare('SELECT * FROM local_outbox WHERE profile_id=? AND mutation_id=?').get(p,m);}
function local(db,p,e){return db.prepare("SELECT * FROM local_entities WHERE profile_id=? AND entity_type='subject' AND entity_id=?").get(p,e);}
function history(db,p,m){return db.prepare('SELECT * FROM local_conflict_decisions WHERE profile_id=? AND original_mutation_id=?').get(p,m);}
function queuedSnapshot(row){
  return {profile:row.profile_id,mutation:row.mutation_id,entityType:row.entity_type,entity:row.entity_id,
    operation:row.operation,baseRevision:row.base_server_revision,createdAt:row.created_at_utc,
    ...(row.operation==='upsert'?{payload:JSON.parse(row.payload_json)}:{})};
}
async function stageConflict(db,q,remote='rev-remote'){
  canonicalAckRequest001(q);
  db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision) VALUES (?,'subject',?,?,1)").run(q.profile,q.entity,JSON.stringify(q.payload));
  db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc,state,conflict_server_revision) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(q.profile,q.mutation,q.entityType,q.entity,q.operation,JSON.stringify(q.payload),q.baseRevision,q.createdAt,'conflict',remote);
}
async function keepLocal(db,{profile=P,oldId='synthetic-old',newId='synthetic-new',expectedHash,decisionTime=CLOCK,fail=false}){
  // WebCrypto outside transaction only; record re-read and compared after lock.
  const before=pending(db,profile,oldId);
  const digest=before?await ackFingerprint001(queuedSnapshot(before)):null;
  return tx(db,()=>{
    const prior=history(db,profile,oldId);
    if(prior){
      if(prior.original_fingerprint===expectedHash && prior.replacement_mutation_id===newId
        && prior.choice==='keep_local')return 'already-decided';
      throw Error('conflicting decision replay');
    }
    const row=pending(db,profile,oldId);
    if(!before||!row||row.sequence!==before.sequence ||
      canonicalAckRequest001(queuedSnapshot(row))!==canonicalAckRequest001(queuedSnapshot(before)))throw Error('pending record changed');
    if(digest!==expectedHash)throw Error('incorrect local fingerprint');
    if(row.state!=='conflict'||!row.conflict_server_revision)throw Error('unresolved receipt missing');
    if(!/^synthetic-[A-Za-z0-9_-]+$/.test(newId)||newId.length>128||newId===oldId)throw Error('invalid replacement id');
    if(db.prepare('SELECT 1 FROM local_outbox WHERE profile_id=? AND mutation_id=?').get(profile,newId)
      || db.prepare('SELECT 1 FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?').get(profile,newId)
      || db.prepare('SELECT 1 FROM local_conflict_decisions WHERE profile_id=? AND (original_mutation_id=? OR replacement_mutation_id=?)').get(profile,newId,newId))throw Error('replacement id used');
    const siblings=db.prepare("SELECT count(*) AS n FROM local_outbox WHERE profile_id=? AND entity_type='subject' AND entity_id=?").get(profile,row.entity_id).n;
    if(siblings!==1)throw Error('pending dependent edits require review');
    const entity=local(db,profile,row.entity_id);
    if(!entity||entity.server_revision!==row.base_server_revision||entity.payload_json!==row.payload_json||entity.locally_deleted!==Number(row.operation==='delete'))throw Error('local snapshot diverged');
    const newRequest={...queuedSnapshot(row),mutation:newId,baseRevision:row.conflict_server_revision,createdAt:decisionTime};
    canonicalAckRequest001(newRequest);
    db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(profile,oldId);
    db.prepare("UPDATE local_entities SET server_revision=? WHERE profile_id=? AND entity_type='subject' AND entity_id=?")
      .run(row.conflict_server_revision,profile,row.entity_id);
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,
      base_server_revision,created_at_utc) VALUES (?,?,?,?,?,?,?,?)`).run(profile,newId,row.entity_type,row.entity_id,
        row.operation,row.payload_json,row.conflict_server_revision,decisionTime);
    db.prepare(`INSERT INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,
      entity_type,entity_id,original_operation,original_payload_json,original_base_server_revision,
      original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(profile,oldId,digest,row.entity_type,row.entity_id,row.operation,
        row.payload_json,row.base_server_revision,row.created_at_utc,newId,row.conflict_server_revision,'keep_local',decisionTime);
    if(fail)throw Error('simulated crash before commit');
    return 'requeued';
  });
}
function init(){const db=open();upgrade(db);return db;}

test('v2 to v3 is explicit and preserves schema integrity and profile rows',()=>{
 const db=open();try{assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
 upgrade(db);assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 assert.equal(db.prepare('SELECT count(*) AS n FROM local_profiles').get().n,2);
 assert.throws(()=>upgrade(db),/wrong upgrade state/);
 }finally{db.close();}
});
test('v3 schema upgrade aborts atomically and keeps version two',()=>{
 const db=open();try{assert.throws(()=>upgrade(db,true),/migration interrupted/);
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
 assert.equal(db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='local_conflict_decisions'").get().n,0);
 }finally{db.close();}
});
test('keep local records immutable original and a new mutation with new remote base',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);const digest=await ackFingerprint001(q);
 assert.equal(await keepLocal(db,{expectedHash:digest}),'requeued');
 assert.equal(pending(db,P,q.mutation),undefined);
 const h=history(db,P,q.mutation);assert.equal(h.original_fingerprint,digest);
 assert.equal(h.original_payload_json,JSON.stringify(q.payload));assert.equal(h.choice,'keep_local');
 assert.equal(h.original_base_server_revision,null);
 const newer=pending(db,P,'synthetic-new');assert.equal(newer.base_server_revision,'rev-remote');
 assert.equal(newer.payload_json,JSON.stringify(q.payload));assert.equal(local(db,P,q.entity).server_revision,'rev-remote');
 assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{db.close();}
});
test('same manual decision is idempotent, conflicting replay cannot alter it',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);const digest=await ackFingerprint001(q);
 await keepLocal(db,{expectedHash:digest});
 assert.equal(await keepLocal(db,{expectedHash:digest}),'already-decided');
 await assert.rejects(keepLocal(db,{expectedHash:digest,newId:'synthetic-other'}),/conflicting decision/);
 assert.equal(db.prepare('SELECT count(*) AS n FROM local_outbox').get().n,1);
 }finally{db.close();}
});
test('changed fingerprint and invalid replacement id fail without mutation',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);
 await assert.rejects(keepLocal(db,{expectedHash:'0'.repeat(64)}),/incorrect local fingerprint/);
 await assert.rejects(keepLocal(db,{expectedHash:await ackFingerprint001(q),newId:q.mutation}),/invalid replacement id/);
 assert.equal(history(db,P,q.mutation),undefined);assert.ok(pending(db,P,q.mutation));
 }finally{db.close();}
});
test('dependent changes require explicit review, preventing silent loss',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);
 db.prepare('INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?,?,?,?,?,?,?)')
   .run(P,'synthetic-second','subject',q.entity,'upsert',JSON.stringify(q.payload),CLOCK);
 await assert.rejects(keepLocal(db,{expectedHash:await ackFingerprint001(q)}),/dependent edits/);
 assert.ok(pending(db,P,q.mutation));assert.equal(history(db,P,q.mutation),undefined);
 }finally{db.close();}
});
test('local entity changed after conflict must not silently replace newer data',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);
 db.prepare("UPDATE local_entities SET payload_json=? WHERE profile_id=?").run(JSON.stringify({label:'Newer'}),P);
 await assert.rejects(keepLocal(db,{expectedHash:await ackFingerprint001(q)}),/snapshot diverged/);
 }finally{db.close();}
});
test('atomic rollback protects conflict, old local revision and outbox',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);const dig=await ackFingerprint001(q);
 await assert.rejects(keepLocal(db,{expectedHash:dig,fail:true}),/simulated crash/);
 assert.equal(history(db,P,q.mutation),undefined);assert.equal(pending(db,P,q.mutation).state,'conflict');
 assert.equal(local(db,P,q.entity).server_revision,null);assert.equal(pending(db,P,'synthetic-new'),undefined);
 }finally{db.close();}
});
test('database rejects retired original id even by direct raw SQL after resolution',async()=>{
 const db=init();try{const q=request();await stageConflict(db,q);await keepLocal(db,{expectedHash:await ackFingerprint001(q)});
 const original=history(db,P,q.mutation);
 assert.throws(()=>db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
 VALUES (?,?,?,?,?,?,?)`).run(P,original.original_mutation_id,'subject',q.entity,'upsert','{}',CLOCK),/used mutation id/);
 }finally{db.close();}
});
test('decision survives close/reopen and enforces permanent original ID reservation',async()=>{
 const path=join(dir,'fictional-conflict.db');let db=open(path);upgrade(db);const q=request();await stageConflict(db,q);const h=await ackFingerprint001(q);
 await keepLocal(db,{expectedHash:h});db.close();db=open(path);
 try{assert.equal(await keepLocal(db,{expectedHash:h}),'already-decided');
 assert.equal(history(db,P,q.mutation).original_payload_json,JSON.stringify(q.payload));
 assert.equal(pending(db,P,'synthetic-new').state,'pending');
 }finally{db.close();}
});
test('cross-profile original ID use remains isolated',async()=>{
 const db=init();try{const a=request(),b=request(Q,a.mutation,a.entity,{label:'Other fictional'});await stageConflict(db,a);await stageConflict(db,b,'rev-other');
 await keepLocal(db,{profile:Q,expectedHash:await ackFingerprint001(b)});
 assert.equal(pending(db,P,a.mutation).state,'conflict');
 assert.equal(history(db,P,a.mutation),undefined);assert.ok(history(db,Q,b.mutation));
 }finally{db.close();}
});
test.after(()=>rmSync(dir,{force:true,recursive:true}));
