// VirgoStars Desktop fictional v3 integration reference; intentionally plaintext.
// Uses exact checked-in v1, v2, v3 DDL, never personal records or real credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

const SCHEMAS=['0001_local_outbox.sql','0002_ack_ledger.sql','0003_conflict_decisions.sql'];
const MAX=9_007_199_254_740_991;
const A='synthetic-a',B='synthetic-b';
const TIME='2026-11-11T21:30:00Z';
function open() {
  const db=new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for(const name of SCHEMAS) db.exec(readFileSync(new URL('../contracts/sqlite/'+name,import.meta.url),'utf8'));
  for(const profile of [A,B]) db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(profile);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
  return db;
}
function stage(db, {profile=A,mutation,entity=mutation,state='conflict',deleted=false}={}) {
  const payload=deleted?null:JSON.stringify({label:'Fictional '+mutation});
  db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision)
    VALUES (?,'subject',?,?,?,1)`).run(profile,entity,payload,Number(deleted));
  const row=db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,
     operation,payload_json,created_at_utc,state,conflict_server_revision)
     VALUES (?,?,'subject',?,?,?,?,?,?)`).run(profile,mutation,entity,deleted?'delete':'upsert',payload,
     TIME,state,state==='conflict'?'rev-remote':null);
  return Number(row.lastInsertRowid);
}
function page(db, profile, after=null, limit=2) {
  if(!/^synthetic-[A-Za-z0-9_-]+$/.test(profile)||profile.length>128||
    !Number.isInteger(limit)||limit<1||limit>100||
    (after!==null&&(!Number.isSafeInteger(after)||after<0||after>MAX)))throw Error('invalid cursor/profile/limit');
  db.exec('BEGIN');
  try {
    if(db.prepare('PRAGMA user_version').get().user_version!==3)throw Error('wrong schema');
    const rows=db.prepare(`SELECT sequence,mutation_id,entity_id FROM local_outbox
      WHERE profile_id=? AND entity_type='subject' AND state='conflict' AND sequence>?
      ORDER BY sequence LIMIT ?`).all(profile,after??0,limit+1);
    const items=rows.slice(0,limit);
    const next_after_sequence=rows.length>limit?Number(items.at(-1).sequence):null;
    db.exec('COMMIT');
    return {items,next_after_sequence};
  }catch(e){db.exec('ROLLBACK');throw e;}
}
function walk(db, profile, limit) {
  const all=[];let cursor=null;let calls=0;
  do {
    const p=page(db,profile,cursor,limit);
    for(const r of p.items)all.push(r.mutation_id);
    cursor=p.next_after_sequence;
    if(++calls>300)throw Error('cursor loop');
  } while(cursor!==null);
  return all;
}

test('exact v1/v2/v3 schemas and FK integrity initialize before pagination',()=>{
 const db=open();try{assert.equal(page(db,A).items.length,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}
});
test('interleaved profiles and pending rows paginate 1+1+1 in FIFO order',()=>{
 const db=open();try{
   stage(db,{mutation:'synthetic-a1'});stage(db,{profile:B,mutation:'synthetic-b1'});
   stage(db,{mutation:'synthetic-pending',state:'pending'});
   stage(db,{mutation:'synthetic-a2'});stage(db,{profile:B,mutation:'synthetic-b2'});
   stage(db,{mutation:'synthetic-a3'});
   assert.deepEqual(walk(db,A,1),['synthetic-a1','synthetic-a2','synthetic-a3']);
   assert.deepEqual(walk(db,B,1),['synthetic-b1','synthetic-b2']);
 }finally{db.close();}
});
test('a full terminal page does not advertise a spurious cursor',()=>{
 const db=open();try{stage(db,{mutation:'synthetic-a1'});stage(db,{mutation:'synthetic-a2'});
   assert.equal(page(db,A,null,2).next_after_sequence,null);
 }finally{db.close();}
});
test('deleting an already viewed conflict does not skip the next real conflict',()=>{
 const db=open();try{
   stage(db,{mutation:'synthetic-a1'});stage(db,{mutation:'synthetic-a2'});
   stage(db,{mutation:'synthetic-a3'});stage(db,{mutation:'synthetic-a4'});
   const first=page(db,A,null,2);
   db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-a1');
   assert.deepEqual(page(db,A,first.next_after_sequence,2).items.map(x=>x.mutation_id),['synthetic-a3','synthetic-a4']);
 }finally{db.close();}
});
test('resolution retires first conflict while leaving higher sequence visible',()=>{
 const db=open();try{
   stage(db,{mutation:'synthetic-first'});stage(db,{mutation:'synthetic-second'});
   const first=page(db,A,null,1);assert.equal(first.items[0].mutation_id,'synthetic-first');
   const cursor=first.next_after_sequence;
   // Synthetic on-disk outcome of keep-local: a new pending mutation cannot
   // pretend to be a conflict; prior FIFO positions remain stable.
   db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-first');
   const second=page(db,A,cursor,1);
   assert.deepEqual(second.items.map(x=>x.mutation_id),['synthetic-second']);
   assert.equal(second.next_after_sequence,null);
 }finally{db.close();}
});
test('new conflict added after a page is visible at the next higher sequence',()=>{
 const db=open();try{
   stage(db,{mutation:'synthetic-first'});stage(db,{mutation:'synthetic-second'});
   const first=page(db,A,null,1);stage(db,{mutation:'synthetic-third'});
   assert.deepEqual(page(db,A,first.next_after_sequence,2).items.map(x=>x.mutation_id),['synthetic-second','synthetic-third']);
 }finally{db.close();}
});
test('a delete tombstone is eligible for browsing but only if conflicted',()=>{
 const db=open();try{
   stage(db,{mutation:'synthetic-deleted',deleted:true});
   stage(db,{mutation:'synthetic-pending',deleted:true,state:'pending'});
   assert.deepEqual(walk(db,A,1),['synthetic-deleted']);
 }finally{db.close();}
});
test('safe cursor/limit/profile boundaries fail before querying',()=>{
 const db=open();try{
   for(const args of [[A,-1,1],[A,MAX+1,1],[A,0,0],[A,0,101],[A,1.25,1],['other',null,1]])
     assert.throws(()=>page(db,...args));
   assert.deepEqual(page(db,A,MAX,1),{items:[],next_after_sequence:null});
 }finally{db.close();}
});
test('v3 trigger prevents reusing a retired mutation ID at insert',()=>{
 const db=open();try{
   stage(db,{mutation:'synthetic-first'});
   const row=db.prepare('SELECT * FROM local_outbox').get();
   db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run('synthetic-first');
   const oldHash='a'.repeat(64);
   db.prepare(`INSERT INTO local_conflict_decisions(
     profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,
     original_operation,original_payload_json,original_created_at_utc,
     replacement_mutation_id,remote_revision,choice,decided_at_utc)
     VALUES (?,?,?,'subject',?,'upsert',?,?,?,'rev-remote','keep_local',?)`)
    .run(A,row.mutation_id,oldHash,row.entity_id,row.payload_json,TIME,'synthetic-next',TIME);
   assert.throws(()=>db.prepare(`INSERT INTO local_outbox(
    profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
    VALUES (?,?,'subject',?,'upsert',?,?)`).run(A,'synthetic-first',row.entity_id,row.payload_json,TIME),/already used mutation id/);
 }finally{db.close();}
});
test('deterministic mixed FIFO sequence pages return each profile conflict once',()=>{
 const db=open();try{
   const expectedA=[],expectedB=[];
   for(let n=0;n<60;n++){
     const profile=n%4===0?B:A,mutation='synthetic-fixture-'+n,state=n%7===0?'pending':'conflict';
     stage(db,{profile,mutation,state});
     if(state==='conflict')(profile===A?expectedA:expectedB).push(mutation);
   }
   for(const size of [1,2,3,7,10,100]){
     assert.deepEqual(walk(db,A,size),expectedA);
     assert.deepEqual(walk(db,B,size),expectedB);
   }
 }finally{db.close();}
});
