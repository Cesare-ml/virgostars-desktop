// Synthetic-only plaintext SQLite contract tests, NOT SQLCipher or authenticated IPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const DDL = [
  '0001_local_outbox.sql', '0002_ack_ledger.sql', '0003_conflict_decisions.sql',
].map(name => readFileSync(new URL(`../contracts/sqlite/${name}`, import.meta.url), 'utf8'));
const A = 'synthetic-a', B = 'synthetic-b';
const CREATED = '2026-11-11T21:30:00Z';
const sid = value => typeof value === 'string' && value.length <= 128 && /^synthetic-[A-Za-z0-9_-]+$/.test(value);
function canonical(value) {
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) throw Error('bad canonical number'); return JSON.stringify(value); }
  if (typeof value === 'string') { if (!/^[\x20-\x7e]*$/.test(value)) throw Error('bad canonical string'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (!value || typeof value !== 'object') throw Error('bad canonical value');
  return '{' + Object.keys(value).sort().map(k => canonical(k) + ':' + canonical(value[k])).join(',') + '}';
}
function hashRequest(row) {
  if (!sid(row.profile_id) || !sid(row.mutation_id) || !sid(row.entity_id)) throw Error('invalid synthetic IDs');
  const req = { profile: row.profile_id, mutation: row.mutation_id, entityType: row.entity_type,
    entity: row.entity_id, operation: row.operation, baseRevision: row.base_server_revision,
    createdAt: row.created_at_utc };
  if (row.operation === 'upsert' && row.payload_json !== null) req.payload = JSON.parse(row.payload_json);
  else if (row.operation !== 'delete' || row.payload_json !== null) throw Error('invalid payload');
  if (req.entityType !== 'subject') throw Error('unsupported entity');
  return createHash('sha256').update('virgostars-ack-fp-001\n' + canonical(req)).digest('hex');
}
function setup() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  for (const ddl of DDL) db.exec(ddl);
  for (const profile of [A, B]) db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(profile);
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 3);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  return db;
}
function stage(db, {profile=A, entity='synthetic-e1', mutation='synthetic-m1', label='Fictional',
                    operation='upsert', state='conflict', remote='rev-remote'} = {}) {
  const payload = operation === 'delete' ? null : JSON.stringify({ label });
  db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision) VALUES (?,'subject',?,?,?,1) ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET payload_json=excluded.payload_json,locally_deleted=excluded.locally_deleted,local_revision=local_entities.local_revision+1")
    .run(profile, entity, payload, Number(operation === 'delete'));
  db.prepare('INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,base_server_revision,created_at_utc,state,conflict_server_revision) VALUES (?, ?,\'subject\',?,?,?,?,?,?,?)')
    .run(profile, mutation, entity, operation, payload, null, CREATED, state, state === 'conflict' ? remote : null);
}
function previews(db, profile, limit) {
  if (!sid(profile) || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid selection');
  if (db.prepare('PRAGMA user_version').get().user_version !== 3) throw Error('wrong schema');
  db.exec('BEGIN');
  try {
    const rows = db.prepare("SELECT * FROM local_outbox WHERE profile_id=? AND entity_type='subject' AND state='conflict' ORDER BY sequence LIMIT ?").all(profile,limit);
    const result = rows.map(row => {
      if (!row.conflict_server_revision || row.conflict_server_revision.length > 128 ||
          !/^[\x20-\x7e]+$/.test(row.conflict_server_revision) ||
          row.base_server_revision === row.conflict_server_revision) throw Error('bad conflict');
      const digest = hashRequest(row);
      const count = db.prepare("SELECT count(*) AS n FROM local_outbox WHERE profile_id=? AND entity_type='subject' AND entity_id=?").get(profile,row.entity_id).n;
      const local = db.prepare("SELECT payload_json,server_revision,locally_deleted FROM local_entities WHERE profile_id=? AND entity_type='subject' AND entity_id=?").get(profile,row.entity_id);
      return {mutation_id:row.mutation_id,entity_id:row.entity_id,
        remote_revision:row.conflict_server_revision,original_fingerprint:digest,
        can_keep_local:count === 1 && local?.payload_json === row.payload_json &&
          local.server_revision === row.base_server_revision && local.locally_deleted === Number(row.operation === 'delete')};
    });
    db.exec('COMMIT'); return result;
  } catch (err) { db.exec('ROLLBACK'); throw err; }
}
test('v3 conflict metadata and original hash, but never payload, are returned', () => {
  const db=setup();try { stage(db); const items=previews(db,A,10);assert.equal(items.length,1);
    assert.deepEqual(Object.keys(items[0]),['mutation_id','entity_id','remote_revision','original_fingerprint','can_keep_local']);
    assert.equal(items[0].can_keep_local,true);assert.match(items[0].original_fingerprint,/^[0-9a-f]{64}$/);
  } finally { db.close(); }
});
test('profile isolation and zero conflicts in another profile', () => {
  const db=setup();try { stage(db);assert.deepEqual(previews(db,B,10),[]); } finally { db.close(); }
});
test('two pending edits on the conflicted entity require manual review', () => {
  const db=setup();try { stage(db);stage(db,{mutation:'synthetic-m2',state:'pending',label:'Second'});
    assert.equal(previews(db,A,10)[0].can_keep_local,false); } finally { db.close(); }
});
test('modified local payload without queued edit blocks one-click resolution', () => {
  const db=setup();try { stage(db);db.prepare('UPDATE local_entities SET payload_json=? WHERE profile_id=?').run('{"label":"Changed"}',A);
    assert.equal(previews(db,A,10)[0].can_keep_local,false); } finally { db.close(); }
});
test('local tombstone mismatch blocks one-click resolution', () => {
  const db=setup();try { stage(db);db.prepare('UPDATE local_entities SET locally_deleted=1 WHERE profile_id=?').run(A);
    assert.equal(previews(db,A,10)[0].can_keep_local,false); } finally { db.close(); }
});
test('legitimate conflicted deletion can be reviewed without fabricated payload', () => {
  const db=setup();try { stage(db,{operation:'delete'});assert.equal(previews(db,A,10)[0].can_keep_local,true); } finally { db.close(); }
});
test('limit and profile ID restrictions are enforced', () => {
  const db=setup();try { stage(db);for (const [p,l] of [[A,0],[A,101],['user',10]]) assert.throws(()=>previews(db,p,l));
    assert.equal(previews(db,A,1).length,1); } finally { db.close(); }
});
test('noncanonical fractional fictional payload fails closed', () => {
  const db=setup();try { stage(db);db.prepare("UPDATE local_outbox SET payload_json='{\"angle\":1.5}'").run();assert.throws(()=>previews(db,A,10),/canonical number/); } finally { db.close(); }
});
test('resolved conflict is no longer listed', () => {
  const db=setup();try { stage(db);db.prepare("UPDATE local_outbox SET state='pending',conflict_server_revision=NULL").run();assert.deepEqual(previews(db,A,10),[]); } finally { db.close(); }
});
test('bounded FIFO across two conflicted entities', () => {
  const db=setup();try { stage(db,{mutation:'synthetic-m1',entity:'synthetic-e1'});stage(db,{mutation:'synthetic-m2',entity:'synthetic-e2'});
    assert.deepEqual(previews(db,A,1).map(x=>x.mutation_id),['synthetic-m1']);
    assert.deepEqual(previews(db,A,2).map(x=>x.mutation_id),['synthetic-m1','synthetic-m2']);
  } finally { db.close(); }
});
