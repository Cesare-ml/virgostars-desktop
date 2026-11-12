import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const sql = readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql', import.meta.url), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'virgostars-fictional-sqlite-'));
const file = join(dir, 'fictional-only.sqlite');
const profile = 'fictional-profile-a';
const otherProfile = 'fictional-profile-b';
const payload = (label) => JSON.stringify({ label: 'Synthetic ' + label });
const now = '2026-11-10T19:00:00Z';

function open(path = file) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=1000; PRAGMA journal_mode=WAL;');
  if (!db.prepare('PRAGMA foreign_keys').get().foreign_keys) throw new Error('FK enforcement not enabled');
  db.exec(sql);
  return db;
}
function transaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try { const result = work(); db.exec('COMMIT'); return result; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
function addProfile(db, id) {
  db.prepare('INSERT INTO local_profiles(profile_id) VALUES (?)').run(id);
}
function queueEdit(db, { profileId = profile, entityId = 'fictional-1', mutationId = 'm-1', operation = 'upsert', data = payload('A') } = {}) {
  transaction(db, () => {
    // The persisted row AND its pending outbox intent are a single unit.
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,locally_deleted,local_revision)
      VALUES (?,'subject',?,?,?,1)
      ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET
      payload_json=excluded.payload_json, locally_deleted=excluded.locally_deleted,
      local_revision=local_entities.local_revision+1`)
      .run(profileId, entityId, operation === 'delete' ? null : data, operation === 'delete' ? 1 : 0);
    db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
      VALUES (?,?,'subject',?,?,?,?)`)
      .run(profileId, mutationId, entityId, operation, operation === 'delete' ? null : data, now);
  });
}
function listOutbox(db, id = profile) {
  return db.prepare('SELECT mutation_id,state,operation,entity_id,conflict_server_revision FROM local_outbox WHERE profile_id=? ORDER BY sequence').all(id);
}
function nextBatch(db, id = profile, max = 50) {
  if (!Number.isSafeInteger(max) || max < 1 || max > 500) throw new RangeError('Invalid limit');
  return db.prepare(`SELECT o.mutation_id, o.entity_id FROM local_outbox o
    WHERE o.profile_id=? AND o.state='pending' AND NOT EXISTS (
      SELECT 1 FROM local_outbox older WHERE older.profile_id=o.profile_id
      AND older.entity_type=o.entity_type AND older.entity_id=o.entity_id AND older.sequence<o.sequence)
    ORDER BY o.sequence LIMIT ?`).all(id, max);
}
function receipt(db, id, mutationId, result, serverRevision) {
  transaction(db, () => {
    const m = db.prepare(`SELECT sequence,entity_type,entity_id,state FROM local_outbox
      WHERE profile_id=? AND mutation_id=?`).get(id, mutationId);
    if (!m || m.state !== 'pending') throw new Error('Unexpected receipt');
    const oldest = db.prepare(`SELECT MIN(sequence) AS first FROM local_outbox
      WHERE profile_id=? AND entity_type=? AND entity_id=?`).get(id,m.entity_type,m.entity_id).first;
    if (oldest !== m.sequence) throw new Error('Out-of-order receipt');
    if (result === 'conflict') {
      db.prepare(`UPDATE local_outbox SET state='conflict', conflict_server_revision=? WHERE profile_id=? AND mutation_id=?`)
        .run(serverRevision,id,mutationId);
    } else if (result === 'accepted' || result === 'already_applied') {
      if (!serverRevision) throw new Error('Missing server revision');
      // ACK and revision must become durable together.
      db.prepare(`UPDATE local_entities SET server_revision=?
        WHERE profile_id=? AND entity_type=? AND entity_id=?`)
        .run(serverRevision,id,m.entity_type,m.entity_id);
      db.prepare('DELETE FROM local_outbox WHERE profile_id=? AND mutation_id=?').run(id,mutationId);
    } else throw new Error('Unsupported receipt');
  });
}
function applyPulledPage(db, id, { entityId, data, cursor, throwBeforeCommit = false }) {
  transaction(db, () => {
    // Fail-closed: do not overwrite local changes that are still unacknowledged.
    const pending = db.prepare(`SELECT 1 AS yes FROM local_outbox
      WHERE profile_id=? AND entity_type='subject' AND entity_id=? LIMIT 1`).get(id,entityId);
    if (pending) throw new Error('Local unsynced changes');
    db.prepare(`INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json,server_revision)
      VALUES (?,'subject',?,?,'remote-fixture-1')
      ON CONFLICT(profile_id,entity_type,entity_id) DO UPDATE SET payload_json=excluded.payload_json,server_revision=excluded.server_revision`)
      .run(id,entityId,data);
    db.prepare(`INSERT INTO local_sync_cursors(profile_id,cursor_token) VALUES (?,?)
      ON CONFLICT(profile_id) DO UPDATE SET cursor_token=excluded.cursor_token`).run(id,cursor);
    if (throwBeforeCommit) throw new Error('Simulated crash before commit');
  });
}

test('schema has integrity guards, profile-scoped foreign keys and migration version', () => {
  const db = open();
  try {
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 1);
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode.toLowerCase(), 'wal');
    assert.equal(db.prepare('PRAGMA cipher_version').all().length, 0, 'local test MUST NOT claim encryption');
    assert.throws(()=>db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,created_at_utc)
      VALUES ('unknown','mut','subject','unknown','delete',?)`).run(now), /constraint/i);
  } finally { db.close(); }
});

test('reopening a real temporary SQLite file retains local edit and outbox together', () => {
  let db = open(); addProfile(db,profile); addProfile(db,otherProfile); queueEdit(db);
  db.close();
  db = open();
  try {
    assert.equal(db.prepare(`SELECT payload_json FROM local_entities WHERE profile_id=? AND entity_id='fictional-1'`).get(profile).payload_json,payload('A'));
    assert.deepEqual(listOutbox(db).map(x=>x.mutation_id),['m-1']);
    assert.deepEqual(nextBatch(db).map(x=>x.mutation_id),['m-1']);
  } finally { db.close(); }
});

test('duplicate mutation ID rolls back entity update, preserving original edit', () => {
  const db = open();
  try {
    assert.throws(()=>queueEdit(db,{mutationId:'m-1',data:payload('ShouldRollback')}),/UNIQUE|constraint/i);
    assert.equal(db.prepare(`SELECT payload_json FROM local_entities WHERE profile_id=? AND entity_id='fictional-1'`).get(profile).payload_json,payload('A'));
    assert.equal(listOutbox(db).length,1);
  } finally { db.close(); }
});

test('profile separation prevents cross-profile outbox or revision leakage', () => {
  const db = open();
  try {
    queueEdit(db,{profileId:otherProfile,entityId:'fictional-1',mutationId:'m-1',data:payload('B')});
    assert.equal(listOutbox(db,profile).length,1);
    assert.equal(listOutbox(db,otherProfile).length,1);
    receipt(db,otherProfile,'m-1','accepted','other-rev-1');
    assert.equal(db.prepare(`SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_id=?`).get(profile,'fictional-1').server_revision,null);
    assert.equal(db.prepare(`SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_id=?`).get(otherProfile,'fictional-1').server_revision,'other-rev-1');
  } finally { db.close(); }
});

test('ACK and revision are atomic and invalid receipts cannot delete a pending edit', () => {
  const db=open();
  try {
    assert.throws(()=>receipt(db,profile,'m-1','accepted',''),/Missing server revision/);
    assert.equal(listOutbox(db).length,1);
    receipt(db,profile,'m-1','accepted','rev-1');
    assert.equal(listOutbox(db).length,0);
    assert.equal(db.prepare(`SELECT server_revision FROM local_entities WHERE profile_id=? AND entity_id='fictional-1'`).get(profile).server_revision,'rev-1');
  } finally { db.close(); }
});

test('only oldest same-entity pending mutation is eligible, FIFO across entities', () => {
  const db=open();
  try {
    queueEdit(db,{entityId:'fictional-1',mutationId:'m-2',data:payload('A2')});
    queueEdit(db,{entityId:'fictional-2',mutationId:'m-3',data:payload('C')});
    assert.deepEqual(nextBatch(db).map(x=>x.mutation_id),['m-2','m-3']);
    assert.throws(()=>nextBatch(db,profile,0),RangeError);
    assert.throws(()=>nextBatch(db,profile,501),RangeError);
    assert.throws(()=>receipt(db,profile,'m-3','accepted',null),/Missing server revision/);
    receipt(db,profile,'m-2','conflict','remote-rev');
    assert.deepEqual(nextBatch(db).map(x=>x.mutation_id),['m-3']);
    assert.equal(listOutbox(db).find(x=>x.mutation_id==='m-2').state,'conflict');
  } finally { db.close(); }
});

test('delete tombstone survives process reopening until explicit ACK', () => {
  let db=open();
  queueEdit(db,{entityId:'fictional-3',mutationId:'m-delete',operation:'delete'});
  db.close(); db=open();
  try {
    assert.equal(db.prepare(`SELECT locally_deleted FROM local_entities WHERE profile_id=? AND entity_id='fictional-3'`).get(profile).locally_deleted,1);
    assert.equal(listOutbox(db).find(x=>x.mutation_id==='m-delete').operation,'delete');
    receipt(db,profile,'m-delete','accepted','rev-delete');
    assert.equal(db.prepare(`SELECT locally_deleted FROM local_entities WHERE profile_id=? AND entity_id='fictional-3'`).get(profile).locally_deleted,1);
  } finally {db.close();}
});

test('pull cursor changes only after a fully durable page, never over local edits', () => {
  const db=open();
  try {
    assert.throws(()=>applyPulledPage(db,profile,{entityId:'fictional-1',data:payload('Remote'),cursor:'page1'}),/Local unsynced changes|./);
    assert.equal(db.prepare(`SELECT cursor_token FROM local_sync_cursors WHERE profile_id=?`).get(profile),undefined);
    assert.throws(()=>applyPulledPage(db,profile,{entityId:'fictional-4',data:payload('D'),cursor:'page2',throwBeforeCommit:true}),/Simulated crash/);
    assert.equal(db.prepare(`SELECT entity_id FROM local_entities WHERE profile_id=? AND entity_id='fictional-4'`).get(profile),undefined);
    assert.equal(db.prepare(`SELECT cursor_token FROM local_sync_cursors WHERE profile_id=?`).get(profile),undefined);
    applyPulledPage(db,profile,{entityId:'fictional-4',data:payload('D'),cursor:'page2'});
    assert.equal(db.prepare('SELECT cursor_token FROM local_sync_cursors WHERE profile_id=?').get(profile).cursor_token,'page2');
  } finally {db.close();}
});

test('strict SQLite constraints reject malformed JSON and impossible operation/payload combinations', () => {
  const db=open();
  try {
    assert.throws(()=>queueEdit(db,{entityId:'fictional-invalid',mutationId:'m-invalid',data:'{broken'}),/constraint/i);
    assert.equal(db.prepare(`SELECT entity_id FROM local_entities WHERE entity_id='fictional-invalid'`).get(),undefined);
    assert.throws(()=>db.prepare(`INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc)
      VALUES (?,?, 'subject',?, 'delete',?,?)`).run(profile,'m-invalid','fictional-1',payload('disallowed'),now),/constraint/i);
  } finally {db.close();}
});

test('abrupt subprocess termination rolls back uncommitted entity and mutation writes', () => {
  const code = `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; BEGIN IMMEDIATE;');
    db.prepare("INSERT INTO local_entities(profile_id,entity_type,entity_id,payload_json) VALUES (?, 'subject', ?, ?)")
      .run('fictional-profile-a','uncommitted-crash','{"label":"Synthetic crash"}');
    db.prepare("INSERT INTO local_outbox(profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc) VALUES (?, ?, 'subject', ?, 'upsert', ?, ?)")
      .run('fictional-profile-a','crash-mutation','uncommitted-crash','{"label":"Synthetic crash"}','2026-11-10T19:00:00Z');
    require('node:fs').writeSync(1, 'transaction-open');
    process.kill(process.pid, 'SIGKILL');
  `;
  const child = spawnSync(process.execPath,['--experimental-sqlite','-e',code,file],{encoding:'utf8'});
  assert.equal(child.stdout, 'transaction-open', child.stderr);
  if (process.platform === 'win32') {
    assert.notEqual(child.status, 0, child.stderr);
  } else {
    assert.equal(child.signal, 'SIGKILL', child.stderr);
  }
  const db = open();
  try {
    assert.equal(db.prepare("SELECT entity_id FROM local_entities WHERE entity_id='uncommitted-crash'").get(),undefined);
    assert.equal(db.prepare("SELECT mutation_id FROM local_outbox WHERE mutation_id='crash-mutation'").get(),undefined);
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  } finally { db.close(); }
});

test.after(()=>rmSync(dir,{recursive:true,force:true}));
