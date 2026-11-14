import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {auditPrivateStorageBoundary} from '../scripts/verify-private-storage-boundary.mjs';

const hostCargo=`[package]\nname = "synthetic-host"\n[dependencies]\nrusqlite = { version = "0.32", features = ["bundled"] }\n`;
const isolatedCargo=`[package]\nname = "synthetic-sqlcipher-spike"\nversion = "0.0.1"\npublish = false\n[dependencies]\nrusqlite = { version = "=0.41.1", default-features = false, features = ["bundled-sqlcipher-vendored-openssl"] }\n[workspace]\n`;

function fixture(work) {
  const root=mkdtempSync(join(tmpdir(),'vs-private-boundary-fictional-'));
  const put=(path,body)=>{
    const dest=join(root,path);
    mkdirSync(dirname(dest),{recursive:true});
    writeFileSync(dest,body);
  };
  const code={
    'src-tauri/Cargo.toml':hostCargo,
    'src-tauri/src/lib.rs':'mod runtime_probe;\nmod offline_places;\n',
    'src-tauri/src/main.rs':'fn main() {}\n',
    'src-tauri/src/runtime_probe.rs':'pub fn probe() {}\n',
    'src-tauri/src/offline_places.rs':'use rusqlite::Connection; // packaged public city catalogue only\n',
  };
  for (const [path,body] of Object.entries(code)) put(path,body);
  try { return work({root,put}); }
  finally { rmSync(root,{recursive:true,force:true}); }
}

test('current host remains city-catalog-only, not falsely advertised as encrypted',()=>fixture(({root})=>{
  assert.deepEqual(auditPrivateStorageBoundary(root),{
    mode:'city-catalog-only',privateStorageAvailable:false,
  });
}));

test('standalone reviewed SQLCipher prototype remains isolated and unavailable to end users',()=>fixture(({root,put})=>{
  put('crates/encrypted-outbox-spike/Cargo.toml',isolatedCargo);
  assert.deepEqual(auditPrivateStorageBoundary(root),{
    mode:'isolated-synthetic-sqlcipher-spike',privateStorageAvailable:false,
  });
}));

test('plaintext or mixed SQLite fallback features fail the isolated crate audit',()=>fixture(({root,put})=>{
  for(const features of ['["bundled"]','["bundled", "bundled-sqlcipher-vendored-openssl"]','["sqlcipher"]']) {
    put('crates/encrypted-outbox-spike/Cargo.toml', isolatedCargo.replace('["bundled-sqlcipher-vendored-openssl"]',features));
    assert.throws(()=>auditPrivateStorageBoundary(root),/Plain SQLite or unreviewed SQLCipher feature/);
  }
}));

test('isolated crate must pin dependency, disable defaults, remain private and keep independent workspace',()=>fixture(({root,put})=>{
  for(const altered of [
    isolatedCargo.replace('version = "=0.41.1"','version = "0.41.1"'),
    isolatedCargo.replace('default-features = false, ','') ,
    isolatedCargo.replace('publish = false','publish = true'),
    isolatedCargo.replace('[workspace]','[not-workspace]'),
  ]) {
    put('crates/encrypted-outbox-spike/Cargo.toml',altered);
    assert.throws(()=>auditPrivateStorageBoundary(root));
  }
}));

test('new native modules or registrations cannot bypass reviewed surface',()=>fixture(({root,put})=>{
  put('src-tauri/src/private_records.rs','pub fn persist() {}');
  assert.throws(()=>auditPrivateStorageBoundary(root),/Unreviewed native Rust module/);
  put('src-tauri/src/lib.rs','mod runtime_probe;\nmod offline_places;\nmod private_records;\n');
  assert.throws(()=>auditPrivateStorageBoundary(root),/Unreviewed native Rust module/);
}));

test('plaintext database access outside packaged city reader is rejected',()=>fixture(({root,put})=>{
  put('src-tauri/src/runtime_probe.rs', 'use rusqlite::Connection;\nfn storage() { let _=Connection::open("private.db"); }');
  assert.throws(()=>auditPrivateStorageBoundary(root),/database access outside city catalogue/);
}));

test('native Cargo linking the experimental crate requires explicit review',()=>fixture(({root,put})=>{
  put('crates/encrypted-outbox-spike/Cargo.toml',isolatedCargo);
  put('src-tauri/Cargo.toml',hostCargo+'encrypted-outbox-spike = { path = "../crates/encrypted-outbox-spike" }\n');
  assert.throws(()=>auditPrivateStorageBoundary(root),/cannot be linked/);
}));

test('changes to native bundled-SQLite policy do not pass silently',()=>fixture(({root,put})=>{
  put('src-tauri/Cargo.toml',hostCargo.replace('features = ["bundled"]','features = ["bundled-sqlcipher"]'));
  assert.throws(()=>auditPrivateStorageBoundary(root),/Native SQLite dependency changed/);
}));

test('actual main checkout passes the safe prototype boundary (when checkout is present)',
  {skip: !existsSync(new URL('../src-tauri/Cargo.toml',import.meta.url))},()=>{
  const root=fileURLToPath(new URL('../',import.meta.url));
  assert.equal(auditPrivateStorageBoundary(root).privateStorageAvailable,false);
  const host=readFileSync(new URL('../src-tauri/Cargo.toml',import.meta.url),'utf8');
  assert.match(host,/features = \["bundled"\]/);
});

test('no synthetic fixture may be interpreted as proof of a functioning private vault',()=>fixture(({root})=>{
  const report=auditPrivateStorageBoundary(root);
  assert.equal(report.privateStorageAvailable,false);
  assert.equal(Object.isFrozen(report),true);
}));
