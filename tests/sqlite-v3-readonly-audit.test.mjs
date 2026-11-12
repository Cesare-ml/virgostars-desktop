// Fictional-only plain-SQLite semantic audit reference. NOT SQLCipher, IPC, or
// an authenticated sync receipt. Mirror the bounded Rust v3 audit contract.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const ddl = [1,2,3].map(v => readFileSync(new URL('../contracts/sqlite/000'+v+'_'+['local_outbox','ack_ledger','conflict_decisions'][v-1]+'.sql',import.meta.url),'utf8'));
const PROFILE='synthetic-a', ENTITY='synthetic-e1', OLD='synthetic-old', NEW='synthetic-new';
const START='2026-11-10T19:00:00Z', DECIDED='2026-11-11T21:30:00Z';
const DATA=JSON.stringify({label:'Fictional'});
const MAX=10000;
const sid=x => typeof x==='string' && /^synthetic-[A-Za-z0-9_-]+$/.test(x) && x.length<=128;
function canonical(v){
 if(v===null||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){if(!Number.isSafeInteger(v)||Object.is(v,-0))throw Error('unsupported');return JSON.stringify(v);}
 if(typeof v==='string'){if(!/^[\x20-\x7e]*$/.test(v))throw Error('unsupported');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(canonical).join(',')+']';
 if(!v||typeof v!=='object'||Object.getPrototypeOf(v)!==Object.prototype)throw Error('unsupported');
 return '{'+Object.keys(v).sort().map(k=>canonical(k)+':'+canonical(v[k])).join(',')+'}';
}
function fingerprint(r){
 if(!sid(r.profile)||!sid(r.mutation)||!sid(r.entity)||r.entityType!=='subject'||
   !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(r.createdAt)||
   (r.baseRevision!==null && (typeof r.baseRevision!=='string'||!r.baseRevision.length||r.baseRevision.length>128))||
   (r.operation==='upsert' ? r.payload==null : r.operation!=='delete'||Object.hasOwn(r,'payload')))
   throw Error('unsupported');
 return createHash('sha256').update('virgostars-ack-fp-001\n'+canonical(r)).digest('hex');
}
function request(row,original=false){
 const q={profile:row.profile_id,mutation:original?row.original_mutation_id:row.mutation_id,
  entityType:row.entity_type,entity:row.entity_id,
  operation:original?row.original_operation:row.operation,
  baseRevision:original?row.original_base_server_revision:row.base_server_revision,
  createdAt:original?row.original_created_at_utc:row.created_at_utc};
 const data=original?row.original_payload_json:row.payload_json;
 if(q.operation==='upsert')q.payload=JSON.parse(data);
 return q;
}
function open(){const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');for(const sql of ddl)db.exec(sql);
 db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(PROFILE);
 db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision) VALUES (?,'subject',?,?,1)").run(PROFILE,ENTITY,DATA);
 db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc,state,conflict_server_revision) VALUES (?,?,'subject',?,'upsert',?,?,'conflict','rev-remote')").run(PROFILE,OLD,ENTITY,DATA,START);
 return db;
}
function keepLocal(db,id=OLD,replacement=NEW,remote='rev-remote',time=DECIDED){
 const row=db.prepare('SELECT * FROM local_outbox WHERE profile_id=? AND mutation_id=?').get(PROFILE,id);
 const hash=fingerprint(request(row));
 db.exec('BEGIN IMMEDIATE');try{
  db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(PROFILE,id);
  db.prepare('UPDATE local_entities SET server_revision=? WHERE profile_id=? AND entity_id=?').run(remote,PROFILE,ENTITY);
  db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc) VALUES (?,?, 'subject',?,'upsert',?,?,?)").run(PROFILE,replacement,ENTITY,row.payload_json,remote,time);
  db.prepare('INSERT INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,original_operation,original_payload_json,original_base_server_revision,original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc) VALUES (?,?,?,?,?,?,?,?,?,? ,?,\'keep_local\',?)').run(PROFILE,id,hash,'subject',ENTITY,'upsert',row.payload_json,row.base_server_revision,row.created_at_utc,replacement,remote,time);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
}
function audit(db,limit=MAX){
 if(db.prepare('PRAGMA user_version').get().user_version!==3)throw Error('unsupported schema');
 if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('FK corruption');
 db.exec('BEGIN');try{
  const outbox=db.prepare('SELECT * FROM local_outbox ORDER BY sequence').all();
  const acks=db.prepare('SELECT * FROM local_ack_ledger ORDER BY profile_id,mutation_id').all();
  const decisions=db.prepare('SELECT * FROM local_conflict_decisions ORDER BY profile_id,original_mutation_id').all();
  if(Math.max(outbox.length,acks.length,decisions.length)>limit)throw Error('over limit');
  const find=(array,field,value,p)=>array.find(x=>x.profile_id===p && x[field]===value);
  for(const row of outbox){
   fingerprint(request(row));
   if(row.state==='pending' ? row.conflict_server_revision!==null :
     row.state!=='conflict'||!row.conflict_server_revision||row.conflict_server_revision===row.base_server_revision)
     throw Error('invalid state');
   if(find(acks,'mutation_id',row.mutation_id,row.profile_id)||find(decisions,'original_mutation_id',row.mutation_id,row.profile_id))throw Error('overlapping mutation');
  }
  for(const ack of acks){
   if(!sid(ack.profile_id)||!sid(ack.mutation_id)||!sid(ack.entity_id))throw Error('invalid ack');
   if(find(outbox,'mutation_id',ack.mutation_id,ack.profile_id))throw Error('overlapping ack');
  }
  for(const d of decisions){
   if(!sid(d.replacement_mutation_id)||fingerprint(request(d,true))!==d.original_fingerprint)throw Error('archived fingerprint mismatch');
   if(!d.remote_revision||d.remote_revision.length>128||! /^[\x20-\x7e]+$/.test(d.remote_revision))throw Error('invalid remote revision');
   if(find(outbox,'mutation_id',d.original_mutation_id,d.profile_id)||find(acks,'mutation_id',d.original_mutation_id,d.profile_id))throw Error('retired original is still active');
   const repl=find(outbox,'mutation_id',d.replacement_mutation_id,d.profile_id);
   if(repl){
    if(repl.entity_type!==d.entity_type||repl.entity_id!==d.entity_id||repl.operation!==d.original_operation||
      repl.payload_json!==d.original_payload_json||repl.base_server_revision!==d.remote_revision||repl.created_at_utc!==d.decided_at_utc)throw Error('requeued snapshot changed');
   } else {
    const ack=find(acks,'mutation_id',d.replacement_mutation_id,d.profile_id);
    if(ack){
      const expected=request(d,true);
      expected.mutation=d.replacement_mutation_id;
      expected.baseRevision=d.remote_revision;
      expected.createdAt=d.decided_at_utc;
      if(ack.entity_type!==d.entity_type||ack.entity_id!==d.entity_id)throw Error('ACK belongs to different subject');
      if(ack.request_fingerprint!==fingerprint(expected))throw Error('ACK fingerprint differs from archived replacement');
    }
    else {
      const chain=find(decisions,'original_mutation_id',d.replacement_mutation_id,d.profile_id);
      if(!chain)throw Error('orphan replacement');
      if(chain.entity_type!==d.entity_type||chain.entity_id!==d.entity_id||chain.original_operation!==d.original_operation||chain.original_payload_json!==d.original_payload_json||chain.original_base_server_revision!==d.remote_revision||chain.original_created_at_utc!==d.decided_at_utc)throw Error('inconsistent decision chain');
    }
   }
  }
  db.exec('COMMIT');return {outbox_rows:outbox.length,acknowledgements:acks.length,decision_rows:decisions.length};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
test('synthetic conflicted pending snapshot audits read-only',()=>{const db=open();try{assert.deepEqual(audit(db),{outbox_rows:1,acknowledgements:0,decision_rows:0});assert.equal(db.prepare('SELECT state FROM local_outbox').get().state,'conflict');}finally{db.close();}});
test('keep-local replacement and immutable archive audit together',()=>{const db=open();try{keepLocal(db);assert.deepEqual(audit(db),{outbox_rows:1,acknowledgements:0,decision_rows:1});assert.equal(db.prepare('SELECT state FROM local_outbox').get().state,'pending');}finally{db.close();}});
test('forged archived fingerprint is detected without modifying history',()=>{const db=open();try{keepLocal(db);db.prepare("INSERT INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,original_operation,original_payload_json,original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc) VALUES (?,?,?,'subject',?,'upsert',?,?,?,'rev-fake','keep_local',?)").run(PROFILE,'synthetic-forged','0'.repeat(64),ENTITY,DATA,START,'synthetic-orphan',DECIDED);assert.throws(()=>audit(db),/archived fingerprint mismatch/);}finally{db.close();}});
test('orphan replacement with otherwise valid old fingerprint is detected',()=>{const db=open();try{keepLocal(db);const prior={profile:PROFILE,mutation:'synthetic-fake',entityType:'subject',entity:ENTITY,operation:'upsert',baseRevision:null,createdAt:START,payload:JSON.parse(DATA)};db.prepare("INSERT INTO local_conflict_decisions(profile_id,original_mutation_id,original_fingerprint,entity_type,entity_id,original_operation,original_payload_json,original_created_at_utc,replacement_mutation_id,remote_revision,choice,decided_at_utc) VALUES (?,?,?,'subject',?,'upsert',?,?,?,'rev-fake','keep_local',?)").run(PROFILE,'synthetic-fake',fingerprint(prior),ENTITY,DATA,START,'synthetic-orphan',DECIDED);assert.throws(()=>audit(db),/orphan replacement/);}finally{db.close();}});
test('valid JSON with unsupported decimal cannot pass synthetic audit',()=>{const db=open();try{db.prepare('UPDATE local_outbox SET payload_json=?').run('{"angle":12.5}');assert.throws(()=>audit(db),/unsupported/);}finally{db.close();}});
test('ACK and outbox sharing same mutation ID is caught',()=>{const db=open();try{db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?, 'subject',?,?, 'accepted','rev-x',?)").run(PROFILE,OLD,ENTITY,'0'.repeat(64),DECIDED);assert.throws(()=>audit(db),/overlapping mutation/);}finally{db.close();}});
test('changing replacement base revision after decision is caught',()=>{const db=open();try{keepLocal(db);db.prepare('UPDATE local_outbox SET base_server_revision=? WHERE mutation_id=?').run('rev-forged',NEW);assert.throws(()=>audit(db),/requeued snapshot changed/);}finally{db.close();}});
test('v3 SQL rejects UPDATE reusing a retired original mutation ID',()=>{const db=open();try{keepLocal(db);assert.throws(()=>db.prepare('UPDATE local_outbox SET mutation_id=? WHERE mutation_id=?').run(OLD,NEW),/queued mutation identity is immutable/);assert.deepEqual(audit(db),{outbox_rows:1,acknowledgements:0,decision_rows:1});}finally{db.close();}});
test('ACKed replacement is valid terminal and audit returns counts',()=>{const db=open();try{keepLocal(db);const expected={profile:PROFILE,mutation:NEW,entityType:'subject',entity:ENTITY,operation:'upsert',baseRevision:'rev-remote',createdAt:DECIDED,payload:JSON.parse(DATA)};db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(NEW);db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?, 'subject',?,?, 'accepted','rev-final',?)").run(PROFILE,NEW,ENTITY,fingerprint(expected),DECIDED);assert.deepEqual(audit(db),{outbox_rows:0,acknowledgements:1,decision_rows:1});}finally{db.close();}});
test('ACK for same entity but different payload fingerprint cannot pass',()=>{const db=open();try{keepLocal(db);const forged={profile:PROFILE,mutation:NEW,entityType:'subject',entity:ENTITY,operation:'upsert',baseRevision:'rev-remote',createdAt:DECIDED,payload:{label:'Forged'}};db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(NEW);db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?, 'subject',?,?, 'accepted','rev-final',?)").run(PROFILE,NEW,ENTITY,fingerprint(forged),DECIDED);assert.throws(()=>audit(db),/ACK fingerprint differs from archived replacement/);}finally{db.close();}});
test('retired original ID cannot simultaneously be acknowledged',()=>{const db=open();try{keepLocal(db);db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?, 'subject',?,?, 'accepted','rev-forged',?)").run(PROFILE,OLD,ENTITY,'a'.repeat(64),DECIDED);assert.throws(()=>audit(db),/retired original is still active/);}finally{db.close();}});
test('acked replacement cannot point to a different entity',()=>{const db=open();try{keepLocal(db);db.prepare('DELETE FROM local_outbox WHERE mutation_id=?').run(NEW);db.prepare("INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc) VALUES (?,?, 'subject',?,?, 'accepted','rev-forged',?)").run(PROFILE,NEW,'synthetic-other','a'.repeat(64),DECIDED);assert.throws(()=>audit(db),/ACK belongs to different subject/);}finally{db.close();}});
test('bounds prevent silently partial audit',()=>{const db=open();try{assert.throws(()=>audit(db,0),/over limit/);}finally{db.close();}});
