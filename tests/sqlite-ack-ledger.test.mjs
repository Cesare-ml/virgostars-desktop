import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Synthetic reference only: NOT Rust/SQLCipher, production sync or crypto authentication.
const v1 = readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql', import.meta.url),'utf8');
const v2 = readFileSync(new URL('../contracts/sqlite/0002_ack_ledger.sql', import.meta.url),'utf8');
const PROFILE_A='synthetic-owner-a', PROFILE_B='synthetic-owner-b';
const CLOCK='2026-11-11T16:00:00Z';
const dir=mkdtempSync(join(tmpdir(),'virgostars-ack-ledger-fixture-'));
const file=join(dir,'fictional-ack.db');
function tx(db,work){ db.exec('BEGIN IMMEDIATE'); try {const r=work();db.exec('COMMIT');return r;}catch(e){db.exec('ROLLBACK');throw e;} }
function canonical(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
function digest(request){return createHash('sha256').update(canonical(request),'utf8').digest('hex');}
function open(path=':memory:'){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON;');
  const version=db.prepare('PRAGMA user_version').get().user_version;
  if(version===0){db.exec(v1);}else if(version!==1&&version!==2){db.close();throw Error('Unexpected schema');}
  if(db.prepare('PRAGMA user_version').get().user_version===1){
    tx(db,()=>{db.exec(v2);});
  }
  if(db.prepare('PRAGMA user_version').get().user_version!==2)throw Error('Unexpected v2');
  for(const profile of [PROFILE_A,PROFILE_B]){
    db.prepare('INSERT OR IGNORE INTO local_profiles(profile_id) VALUES (?)').run(profile);
  }
  return db;
}
function request(profile,mutation,entity,payload={label:'Fictional birth chart'}){
  return {profile,mutation,entityType:'subject',entity,operation:'upsert',baseRevision:null,createdAt:CLOCK,payload};
}
function stage(db,q){
  const hash=digest(q);
  return tx(db,()=>{
    const acknowledged=db.prepare('SELECT request_fingerprint FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?').get(q.profile,q.mutation);
    if(acknowledged){
      if(acknowledged.request_fingerprint===hash)return 'already-acknowledged';
      throw Error('Mutation ID previously acknowledged with different request');
    }
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,local_revision)
      VALUES (?,'subject',?,?,1)
      ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET payload_json=excluded.payload_json,
      local_revision=local_revision+1`).run(q.profile,q.entity,JSON.stringify(q.payload));
    const revision=db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_type=? AND entity_id=?').get(q.profile,q.entityType,q.entity).server_revision;
    if(revision!==q.baseRevision)throw Error('Stale base revision');
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc)
      VALUES (?,?,'subject',?,'upsert',?,?,?)`).run(q.profile,q.mutation,q.entity,JSON.stringify(q.payload),q.baseRevision,q.createdAt);
    return 'queued';
  });
}
function acknowledge(db,q,result='accepted',revision='rev-1',fail=false){
  const hash=digest(q);
  return tx(db,()=>{
    const seen=db.prepare('SELECT request_fingerprint,result,server_revision FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?').get(q.profile,q.mutation);
    if(seen){
      if(seen.request_fingerprint===hash&&seen.result===result&&seen.server_revision===revision)return 'replayed';
      throw Error('Conflicting or reused ACK');
    }
    const pending=db.prepare('SELECT * FROM local_outbox WHERE profile_id=? AND mutation_id=?').get(q.profile,q.mutation);
    if(!pending||pending.entity_id!==q.entity||pending.entity_type!==q.entityType)throw Error('Unknown ACK');
    const persisted={profile:pending.profile_id,mutation:pending.mutation_id,
      entityType:pending.entity_type,entity:pending.entity_id,operation:pending.operation,
      baseRevision:pending.base_server_revision,createdAt:pending.created_at_utc,
      payload:pending.payload_json===null?undefined:JSON.parse(pending.payload_json)};
    if(digest(persisted)!==hash)throw Error('ACK request differs from queued snapshot');
    const oldest=db.prepare(`SELECT MIN(sequence) AS first FROM local_outbox
      WHERE profile_id=? AND entity_type=? AND entity_id=?`).get(q.profile,q.entityType,q.entity).first;
    if(oldest!==pending.sequence)throw Error('Out of order ACK');
    db.prepare(`INSERT INTO local_ack_ledger
      (profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc)
      VALUES (?,?,?,?,?,?,?,?)`).run(q.profile,q.mutation,q.entityType,q.entity,hash,result,revision,CLOCK);
    db.prepare('UPDATE local_entities SET server_revision=? WHERE profile_id=? AND entity_type=? AND entity_id=?')
      .run(revision,q.profile,q.entityType,q.entity);
    db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(q.profile,q.mutation);
    if(fail)throw Error('Simulated crash before COMMIT');
    return 'acknowledged';
  });
}
function counts(db,profile=PROFILE_A){
  return {
    pending:db.prepare('SELECT COUNT(*) AS n FROM local_outbox WHERE profile_id=?').get(profile).n,
    ack:db.prepare('SELECT COUNT(*) AS n FROM local_ack_ledger WHERE profile_id=?').get(profile).n,
  };
}

test('v2 migration preserves referential integrity and expected version',()=>{
  const db=open();try{
    assert.equal(db.prepare('PRAGMA user_version').get().user_version,2);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0);
    assert.equal(db.prepare('PRAGMA table_info(local_ack_ledger)').all().length,8);
  }finally{db.close();}
});
test('fingerprint is stable across JSON object key order yet changes with content',()=>{
  const a=request(PROFILE_A,'synthetic-m1','synthetic-e1',{z:1,a:{b:2,c:3}});
  const b=request(PROFILE_A,'synthetic-m1','synthetic-e1',{a:{c:3,b:2},z:1});
  assert.equal(digest(a),digest(b));
  assert.notEqual(digest(a),digest({...a,payload:{z:2,a:{b:2,c:3}}}));
  assert.match(digest(a),/^[a-f0-9]{64}$/);
});
test('ACK, revision and durable receipt are committed in one transaction',()=>{
  const db=open();try{
    const q=request(PROFILE_A,'synthetic-m1','synthetic-e1');
    assert.equal(stage(db,q),'queued');
    assert.equal(acknowledge(db,q),'acknowledged');
    assert.deepEqual(counts(db),{pending:0,ack:1});
    assert.equal(db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=?').get(PROFILE_A).server_revision,'rev-1');
  }finally{db.close();}
});
test('identical ACK replay is idempotent; mismatched body or revision is rejected',()=>{
  const db=open();try{
    const q=request(PROFILE_A,'synthetic-m1','synthetic-e1'); stage(db,q); acknowledge(db,q);
    assert.equal(acknowledge(db,q),'replayed');
    assert.throws(()=>acknowledge(db,{...q,payload:{label:'Changed'}}),/Conflicting/);
    assert.throws(()=>acknowledge(db,q,'accepted','different-revision'),/Conflicting/);
    assert.deepEqual(counts(db),{pending:0,ack:1});
  }finally{db.close();}
});
test('mutation ID reuse after ACK fails without changing entity data',()=>{
  const db=open();try{
    const q=request(PROFILE_A,'synthetic-m1','synthetic-e1');stage(db,q);acknowledge(db,q);
    const another=request(PROFILE_A,'synthetic-m1','synthetic-e1',{label:'Bad rewrite'});
    assert.throws(()=>stage(db,another),/previously acknowledged/);
    assert.equal(stage(db,q),'already-acknowledged');
    assert.equal(db.prepare('SELECT payload_json FROM local_entities WHERE profile_id=?').get(PROFILE_A).payload_json,JSON.stringify(q.payload));
  }finally{db.close();}
});
test('ACK cannot confirm a divergent payload or a stale base revision',()=>{
  const db=open();try{
    const q=request(PROFILE_A,'synthetic-m1','synthetic-e1');stage(db,q);
    assert.throws(()=>acknowledge(db,{...q,payload:{label:'Wrong data'}}),/differs from queued/);
    assert.deepEqual(counts(db),{pending:1,ack:0});
    const stale=request(PROFILE_A,'synthetic-m2','synthetic-e1',{label:'Another fictional sample'});
    stale.baseRevision='an-incorrect-revision';
    assert.throws(()=>stage(db,stale),/Stale base revision/);
    assert.deepEqual(counts(db),{pending:1,ack:0});
  }finally{db.close();}
});
test('same mutation ID is isolated by profile',()=>{
  const db=open();try{
    const a=request(PROFILE_A,'synthetic-m1','synthetic-e1');
    const b=request(PROFILE_B,'synthetic-m1','synthetic-e1',{label:'Fictional B'});
    stage(db,a);stage(db,b);acknowledge(db,b);
    assert.deepEqual(counts(db,PROFILE_A),{pending:1,ack:0});
    assert.deepEqual(counts(db,PROFILE_B),{pending:0,ack:1});
  }finally{db.close();}
});
test('failed ACK rolls back ledger, server revision and pending mutation',()=>{
  const db=open();try{
    const q=request(PROFILE_A,'synthetic-m1','synthetic-e1'); stage(db,q);
    assert.throws(()=>acknowledge(db,q,'accepted','rev-1',true),/Simulated crash/);
    assert.deepEqual(counts(db),{pending:1,ack:0});
    assert.equal(db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=?').get(PROFILE_A).server_revision,null);
  }finally{db.close();}
});
test('foreign-key and fingerprint constraints reject malformed ledger rows',()=>{
  const db=open();try{
    const sql=`INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc)
      VALUES (?,?,?,?,?,?,?,?)`;
    assert.throws(()=>db.prepare(sql).run('unknown-profile','m1','subject','e1','a'.repeat(64),'accepted','rev1',CLOCK),/constraint/i);
    assert.throws(()=>db.prepare(sql).run(PROFILE_A,'m1','subject','e1','not-a-sha','accepted','rev1',CLOCK),/constraint/i);
  }finally{db.close();}
});
test('ack ledger survives process reopening and still blocks divergent ID replay',()=>{
  let db=open(file);
  const q=request(PROFILE_A,'synthetic-m1','synthetic-e1');
  stage(db,q);acknowledge(db,q);db.close();
  db=open(file);
  try{
    assert.deepEqual(counts(db),{pending:0,ack:1});
    assert.equal(acknowledge(db,q),'replayed');
    assert.throws(()=>stage(db,{...q,payload:{label:'A different fictional subject'}}),/previously acknowledged/);
  }finally{db.close();}
});
test.after(()=>rmSync(dir,{force:true,recursive:true}));
