// Synthetic, standalone Node SQLite reference for ACKed replacement lineage.
// This tests the fingerprint invariant, NOT SQLCipher or the full v3 schema.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const original = Object.freeze({
  profile: 'synthetic-a', mutation: 'synthetic-old', entityType: 'subject',
  entity: 'synthetic-e1', operation: 'upsert', baseRevision: null,
  createdAt: '2026-11-10T19:00:00Z', payload: { label: 'Fictional' },
});
const decision = Object.freeze({
  original_mutation_id: 'synthetic-old', replacement_mutation_id: 'synthetic-new',
  remote_revision: 'rev-remote', decided_at_utc: '2026-11-11T21:30:00Z',
});
function canonical(v) {
  if (Array.isArray(v)) return '[' + v.map(canonical).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + canonical(v[k])).join(',') + '}';
  return JSON.stringify(v);
}
function hash(r) {
  return createHash('sha256').update('virgostars-ack-fp-001\n' + canonical(r), 'utf8').digest('hex');
}
function db() {
  const conn = new DatabaseSync(':memory:');
  conn.exec(`CREATE TABLE history (
    profile_id TEXT, original_mutation_id TEXT, replacement_mutation_id TEXT,
    original_operation TEXT, original_payload_json TEXT, entity_type TEXT,
    entity_id TEXT, remote_revision TEXT, decided_at_utc TEXT);
  CREATE TABLE acknowledgements (
    profile_id TEXT, mutation_id TEXT, entity_type TEXT, entity_id TEXT,
    request_fingerprint TEXT);`);
  conn.prepare('INSERT INTO history VALUES (?,?,?,?,?,?,?,?,?)').run(
    original.profile, decision.original_mutation_id, decision.replacement_mutation_id,
    original.operation, JSON.stringify(original.payload), original.entityType,
    original.entity, decision.remote_revision, decision.decided_at_utc,
  );
  return conn;
}
function expectedReplacement(h) {
  return {
    profile: h.profile_id, mutation: h.replacement_mutation_id,
    entityType: h.entity_type, entity: h.entity_id,
    operation: h.original_operation, baseRevision: h.remote_revision,
    createdAt: h.decided_at_utc, payload: JSON.parse(h.original_payload_json),
  };
}
function audit(conn) {
  const h = conn.prepare('SELECT * FROM history').get();
  const a = conn.prepare('SELECT * FROM acknowledgements WHERE profile_id=? AND mutation_id=?').get(h.profile_id, h.replacement_mutation_id);
  if (!a) throw Error('missing acknowledgement');
  if (a.entity_type !== h.entity_type || a.entity_id !== h.entity_id) throw Error('wrong entity');
  if (a.request_fingerprint !== hash(expectedReplacement(h))) throw Error('wrong fingerprint');
  return true;
}
function accepted(conn, digest, entity = original.entity) {
  conn.prepare('INSERT INTO acknowledgements VALUES (?,?,?,?,?)').run(original.profile, decision.replacement_mutation_id, 'subject', entity, digest);
}
test('exact reconstructed replacement ACK passes', () => {
  const conn = db(); try {
    accepted(conn, hash(expectedReplacement(conn.prepare('SELECT * FROM history').get())));
    assert.equal(audit(conn), true);
  } finally { conn.close(); }
});
test('ACK for same subject but other payload is rejected', () => {
  const conn = db(); try {
    accepted(conn, hash({ ...expectedReplacement(conn.prepare('SELECT * FROM history').get()), payload: { label: 'Forger' } }));
    assert.throws(() => audit(conn), /wrong fingerprint/);
  } finally { conn.close(); }
});
test('ACK using stale base revision is rejected', () => {
  const conn = db(); try {
    accepted(conn, hash({ ...expectedReplacement(conn.prepare('SELECT * FROM history').get()), baseRevision: null }));
    assert.throws(() => audit(conn), /wrong fingerprint/);
  } finally { conn.close(); }
});
test('ACK with incorrect replacement timestamp is rejected', () => {
  const conn = db(); try {
    accepted(conn, hash({ ...expectedReplacement(conn.prepare('SELECT * FROM history').get()), createdAt: original.createdAt }));
    assert.throws(() => audit(conn), /wrong fingerprint/);
  } finally { conn.close(); }
});
test('ACK for a different subject is rejected even with correct digest', () => {
  const conn = db(); try {
    accepted(conn, hash(expectedReplacement(conn.prepare('SELECT * FROM history').get())), 'synthetic-other');
    assert.throws(() => audit(conn), /wrong entity/);
  } finally { conn.close(); }
});
