// Synthetic-only offline ACK integration reference. PLAIN SQLite in temp tests;
// NOT SQLCipher, a real account, an authenticated receipt, or production sync.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ackFingerprint001, canonicalAckRequest001 } from '../contracts/sync/ack-fingerprint-001.ts';

const v1=readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql',import.meta.url),'utf8');
const v2=readFileSync(new URL('../contracts/sqlite/0002_ack_ledger.sql',import.meta.url),'utf8');
const dir=mkdtempSync(join(tmpdir(),'virgostars-fictional-ack-fp-'));
const CLOCK='2026-11-11T19:00:00Z';
const A='synthetic-owner-a', B='synthetic-owner-b';
function tx(db,work){db.exec('BEGIN IMMEDIATE');try{const r=work();db.exec('COMMIT');return r;}catch(error){db.exec('ROLLBACK');throw error;}}
function open(path=':memory:'){
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON;');
  let version=db.prepare('PRAGMA user_version').get().user_version;
  if(version===0){db.exec(v1);version=1;}
  if(version===1){tx(db,()=>db.exec(v2));version=2;}
  if(version!==2)throw Error('Unsupported synthetic schema');
  for(const profile of [A,B]) db.prepare('INSERT OR IGNORE INTO local_profiles(profile_id) VALUES (?)').run(profile);
  return db;
}
function request(profile=A,mutation='synthetic-m1',entity='synthetic-e1',payload={label:'Fictional chart'}){
  return {profile,mutation,entityType:'subject',entity,operation:'upsert',baseRevision:null,createdAt:CLOCK,payload};
}
function persisted(row){
  const q={profile:row.profile_id,mutation:row.mutation_id,entityType:row.entity_type,
    entity:row.entity_id,operation:row.operation,baseRevision:row.base_server_revision,
    createdAt:row.created_at_utc};
  if(row.operation==='upsert')q.payload=JSON.parse(row.payload_json);
  return q;
}
function pending(db,profile,mutation){
  return db.prepare('SELECT * FROM local_outbox WHERE profile_id=? AND mutation_id=?').get(profile,mutation);
}
function counts(db,profile=A){return {
  queued:db.prepare('SELECT count(*) AS n FROM local_outbox WHERE profile_id=?').get(profile).n,
  acked:db.prepare('SELECT count(*) AS n FROM local_ack_ledger WHERE profile_id=?').get(profile).n,
};}
async function stage(db,q){
  const canonical=canonicalAckRequest001(q);
  const digest=await ackFingerprint001(q);
  return tx(db,()=>{
    const prior=db.prepare('SELECT request_fingerprint FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?').get(q.profile,q.mutation);
    if(prior){
      if(prior.request_fingerprint===digest)return 'already-acknowledged';
      throw Error('Reused acknowledged mutation ID');
    }
    if(pending(db,q.profile,q.mutation))throw Error('Duplicated pending mutation ID');
    const existing=db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_type=? AND entity_id=?').get(q.profile,q.entityType,q.entity);
    if((existing?.server_revision ?? null)!==q.baseRevision)throw Error('Stale base revision');
    const json=q.operation==='delete'?null:JSON.stringify(q.payload);
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision)
      VALUES (?,'subject',?,?,?,1)
      ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET
      payload_json=excluded.payload_json,locally_deleted=excluded.locally_deleted,
      local_revision=local_entities.local_revision+1`).run(q.profile,q.entity,json,q.operation==='delete'?1:0);
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc)
      VALUES (?,?,?,?,?,?,?,?)`).run(q.profile,q.mutation,q.entityType,q.entity,q.operation,json,q.baseRevision,q.createdAt);
    const durable=pending(db,q.profile,q.mutation);
    if(canonicalAckRequest001(persisted(durable))!==canonical)throw Error('Persisted request mismatch');
    return 'queued';
  });
}
async function acknowledge(db,{profile=A,mutation='synthetic-m1',result='accepted',revision='rev-1',expectedDigest,fail=false}){
  if(result!=='accepted'&&result!=='already_applied')throw Error('Unsupported receipt');
  if(typeof revision!=='string'||!revision.length||revision.length>128)throw Error('Invalid revision');
  // Await Web Crypto BEFORE taking a transaction: synchronous SQLite has no
  // async transaction and holding a lock over awaits would be unsafe.
  const before=pending(db,profile,mutation);
  const digest=before?await ackFingerprint001(persisted(before)):null;
  return tx(db,()=>{
    const seen=db.prepare('SELECT * FROM local_ack_ledger WHERE profile_id=? AND mutation_id=?').get(profile,mutation);
    if(seen){
      if(seen.request_fingerprint===expectedDigest && seen.result===result && seen.server_revision===revision)return 'replayed';
      throw Error('Inconsistent repeated receipt');
    }
    const row=pending(db,profile,mutation);
    if(!row||!before||row.sequence!==before.sequence||canonicalAckRequest001(persisted(row))!==canonicalAckRequest001(persisted(before)))throw Error('Pending snapshot changed');
    if(digest!==expectedDigest)throw Error('Receipt does not match durable request fingerprint');
    const first=db.prepare('SELECT MIN(sequence) AS seq FROM local_outbox WHERE profile_id=? AND entity_type=? AND entity_id=?')
      .get(profile,row.entity_type,row.entity_id).seq;
    if(first!==row.sequence||row.state!=='pending')throw Error('Out-of-order or conflicted receipt');
    const entity=db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_type=? AND entity_id=?')
      .get(profile,row.entity_type,row.entity_id);
    if(!entity || row.base_server_revision!==entity.server_revision)throw Error('Stale base revision');
    db.prepare(`INSERT INTO local_ack_ledger(profile_id,mutation_id,entity_type,entity_id,request_fingerprint,result,server_revision,acknowledged_at_utc)
      VALUES (?,?,?,?,?,?,?,?)`).run(profile,mutation,row.entity_type,row.entity_id,digest,result,revision,CLOCK);
    db.prepare('UPDATE local_entities SET server_revision=? WHERE profile_id=? AND entity_type=? AND entity_id=?')
      .run(revision,profile,row.entity_type,row.entity_id);
    db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(profile,mutation);
    if(fail)throw Error('Synthetic failure before commit');
    return 'acknowledged';
  });
}
function eligible(db,profile=A){return db.prepare(`SELECT o.mutation_id FROM local_outbox o JOIN local_entities e
  ON e.profile_id=o.profile_id AND e.entity_type=o.entity_type AND e.entity_id=o.entity_id
  WHERE o.profile_id=? AND o.state='pending' AND o.base_server_revision IS e.server_revision
  AND NOT EXISTS(SELECT 1 FROM local_outbox older WHERE older.profile_id=o.profile_id
    AND older.entity_type=o.entity_type AND older.entity_id=o.entity_id AND older.sequence<o.sequence)
  ORDER BY o.sequence LIMIT 50`).all(profile).map(r=>r.mutation_id);}

test('ACK-FP-001 digest is calculated from the actual persisted outbox snapshot',async()=>{
  const db=open();try{const q=request();assert.equal(await stage(db,q),'queued');
    assert.equal(await ackFingerprint001(persisted(pending(db,A,q.mutation))),await ackFingerprint001(q));
    assert.equal(await acknowledge(db,{expectedDigest:await ackFingerprint001(q)}),'acknowledged');
    assert.deepEqual(counts(db),{queued:0,acked:1});
  }finally{db.close();}
});
test('repeated ACK is idempotent only when digest, result and revision match',async()=>{
  const db=open();try{const q=request();await stage(db,q);const hash=await ackFingerprint001(q);
    await acknowledge(db,{expectedDigest:hash});
    assert.equal(await acknowledge(db,{expectedDigest:hash}),'replayed');
    await assert.rejects(acknowledge(db,{expectedDigest:hash,revision:'rev-2'}),/Inconsistent/);
    await assert.rejects(acknowledge(db,{expectedDigest:hash,result:'already_applied'}),/Inconsistent/);
    assert.deepEqual(counts(db),{queued:0,acked:1});
  }finally{db.close();}
});
test('untrusted payload supplied with a receipt cannot override queued snapshot',async()=>{
  const db=open();try{const q=request();await stage(db,q);
    const changed=await ackFingerprint001({...q,payload:{label:'Forged'}});
    await assert.rejects(acknowledge(db,{expectedDigest:changed}),/does not match/);
    assert.deepEqual(counts(db),{queued:1,acked:0});
  }finally{db.close();}
});
test('tampered persisted queued JSON does not match original expected digest',async()=>{
  const db=open();try{const q=request();await stage(db,q);
    db.prepare('UPDATE local_outbox SET payload_json=? WHERE profile_id=? AND mutation_id=?').run('{"label":"Tampered"}',A,q.mutation);
    await assert.rejects(acknowledge(db,{expectedDigest:await ackFingerprint001(q)}),/does not match/);
    assert.deepEqual(counts(db),{queued:1,acked:0});
  }finally{db.close();}
});
test('conflicts and dependent offline edits cannot be acknowledged out of order',async()=>{
  const db=open();try{const q=request();const second=request(A,'synthetic-m2');await stage(db,q);await stage(db,second);
    assert.deepEqual(eligible(db),['synthetic-m1']);
    await assert.rejects(acknowledge(db,{mutation:'synthetic-m2',expectedDigest:await ackFingerprint001(second)}),/Out-of-order/);
    await acknowledge(db,{expectedDigest:await ackFingerprint001(q)});
    assert.deepEqual(eligible(db),[]); // stale original baseRevision is held for rebasing
    await assert.rejects(acknowledge(db,{mutation:'synthetic-m2',expectedDigest:await ackFingerprint001(second)}),/Stale base revision/);
    assert.deepEqual(counts(db),{queued:1,acked:1});
  }finally{db.close();}
});
test('delete requires absent payload and its tombstone survives accepted ACK',async()=>{
  const db=open();try{const q={...request(),operation:'delete'};delete q.payload;
    await stage(db,q);assert.equal(pending(db,A,q.mutation).payload_json,null);
    await acknowledge(db,{expectedDigest:await ackFingerprint001(q)});
    const row=db.prepare('SELECT locally_deleted FROM local_entities WHERE profile_id=? AND entity_id=?').get(A,q.entity);
    assert.equal(row.locally_deleted,1);
  }finally{db.close();}
});
test('ACK and ledger insertion roll back together under injected failure',async()=>{
  const db=open();try{const q=request();await stage(db,q);
    await assert.rejects(acknowledge(db,{expectedDigest:await ackFingerprint001(q),fail:true}),/Synthetic failure/);
    assert.deepEqual(counts(db),{queued:1,acked:0});
    assert.equal(db.prepare('SELECT server_revision FROM local_entities WHERE profile_id=?').get(A).server_revision,null);
  }finally{db.close();}
});
test('mutation ID reuse is blocked after acknowledgement and cannot re-edit local entity',async()=>{
  const db=open();try{const q=request();await stage(db,q);await acknowledge(db,{expectedDigest:await ackFingerprint001(q)});
    assert.equal(await stage(db,q),'already-acknowledged');
    await assert.rejects(stage(db,{...q,payload:{label:'Different'}}),/Reused acknowledged/);
    assert.equal(db.prepare('SELECT payload_json FROM local_entities WHERE profile_id=?').get(A).payload_json,JSON.stringify(q.payload));
  }finally{db.close();}
});
test('same mutation ID is isolated between fictional profiles',async()=>{
  const db=open();try{const a=request(),b=request(B,'synthetic-m1','synthetic-e1',{label:'Fictional B'});
    await stage(db,a);await stage(db,b);await acknowledge(db,{profile:B,expectedDigest:await ackFingerprint001(b)});
    assert.deepEqual(counts(db,A),{queued:1,acked:0});assert.deepEqual(counts(db,B),{queued:0,acked:1});
  }finally{db.close();}
});
test('ledger persists after database close and prevents divergent replay',async()=>{
  const path=join(dir,'fictional-ack-fp001.db');let db=open(path);const q=request();
  await stage(db,q);await acknowledge(db,{expectedDigest:await ackFingerprint001(q)});db.close();db=open(path);
  try{assert.deepEqual(counts(db),{queued:0,acked:1});
    assert.equal(await acknowledge(db,{expectedDigest:await ackFingerprint001(q)}),'replayed');
    await assert.rejects(stage(db,{...q,payload:{label:'After restart'}}),/Reused acknowledged/);
  }finally{db.close();}
});
test.after(()=>rmSync(dir,{force:true,recursive:true}));
