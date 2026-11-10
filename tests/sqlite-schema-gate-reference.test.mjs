// VirgoStars Desktop: synthetic in-memory SQLite catalog reference tests.
// These check schema logic only, NOT SQLCipher, Rust compilation, auth or storage encryption.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const schema = readFileSync(new URL('../contracts/sqlite/0001_local_outbox.sql', import.meta.url), 'utf8');
const catalogSql = `SELECT type, name, sql FROM sqlite_master
  WHERE type IN ('table','index','trigger','view')
    AND name NOT GLOB 'sqlite_*'
  ORDER BY type, name`;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON;');
  db.exec(schema);
  return db;
}
function schemaMatches(expected, db) {
  // Mirrors the Rust validation contract. No user data is stored, only synthetic DDL.
  if (db.prepare('PRAGMA user_version').get().user_version !== 1) return false;
  const expectedCatalog = expected.prepare(catalogSql).all();
  const actualCatalog = db.prepare(catalogSql).all();
  if (!isEqual(expectedCatalog, actualCatalog)) return false;
  return !db.prepare('SELECT "table" FROM pragma_foreign_key_check LIMIT 1').get();
}
function isEqual(a, b) {
  return JSON.stringify(a.map(({type, name, sql}) => [type,name,sql])) ===
         JSON.stringify(b.map(({type, name, sql}) => [type,name,sql]));
}
function compareEdited(edit) {
  const template = fixture();
  const db = fixture();
  try {
    edit(db);
    return schemaMatches(template, db);
  } finally {
    template.close();
    db.close();
  }
}

test('canonical reference schema is accepted (same SQLite engine)', () => {
  assert.equal(compareEdited(() => {}), true);
});
test('tampered FIFO index is rejected even though all four tables remain', () => {
  assert.equal(compareEdited(db => db.exec(`
    DROP INDEX local_outbox_profile_fifo;
    CREATE INDEX local_outbox_profile_fifo ON local_outbox(mutation_id);
  `)), false);
});
test('weakened table definition or unexpected column is rejected', () => {
  assert.equal(compareEdited(db => db.exec(
    'ALTER TABLE local_entities ADD COLUMN unapproved TEXT'
  )), false);
});
test('extra table, view or trigger fail closed rather than being silently accepted', () => {
  for (const ddl of [
    'CREATE TABLE unapproved_table(x TEXT) STRICT;',
    'CREATE VIEW unapproved_view AS SELECT profile_id FROM local_profiles;',
    `CREATE TRIGGER unapproved_trigger AFTER INSERT ON local_profiles
      BEGIN SELECT 1; END;`,
  ]) {
    assert.equal(compareEdited(db => db.exec(ddl)), false, ddl);
  }
});
test('same DDL with newer unapproved user_version is rejected', () => {
  assert.equal(compareEdited(db => db.exec('PRAGMA user_version=2;')), false);
});
test('orphan mutation created with FK checks disabled is rejected on reopen', () => {
  assert.equal(compareEdited(db => {
    db.exec('INSERT INTO local_profiles(profile_id) VALUES (\'synthetic-a\');');
    db.exec('PRAGMA foreign_keys=OFF;');
    db.prepare(`INSERT INTO local_outbox(
      profile_id,mutation_id,entity_type,entity_id,operation,payload_json,created_at_utc
    ) VALUES (?,?,?,?,?,?,?)`).run(
      'synthetic-a', 'synthetic-missing', 'subject', 'synthetic-missing-entity',
      'upsert', '{}', '2026-11-10T19:00:00Z'
    );
  }), false);
});
test('the catalog contains both required FIFO indexes and no personal data', () => {
  const db = fixture();
  try {
    const names = db.prepare(catalogSql).all().map(row => row.name);
    assert.ok(names.includes('local_outbox_profile_fifo'));
    assert.ok(names.includes('local_outbox_entity_fifo'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM local_profiles').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM local_outbox').get().n, 0);
  } finally { db.close(); }
});
