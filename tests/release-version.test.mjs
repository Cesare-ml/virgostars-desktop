import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {nextPatch,versionChanges} from '../scripts/updates/release-version.mjs';

test('release version increases a stable patch without accepting malformed versions',()=>{
  assert.equal(nextPatch('0.0.4'),'0.0.5');
  for (const value of ['v1.2.3','1.2.3-beta','1.02.3','1.2.999999']) assert.throws(()=>nextPatch(value));
});

test('version bump prepares every release identity and rejects inconsistent inputs before writing',()=>{
  const root=mkdtempSync(join(tmpdir(),'release-version-'));
  try {
    mkdirSync(join(root,'src-tauri'));mkdirSync(join(root,'scripts'));
    const files={
      'package.json':'{"version": "0.0.4"}',
      'package-lock.json':'{"version": "0.0.4", "packages": {"": {"version": "0.0.4"}}}',
      'src-tauri/Cargo.toml':'[package]\nversion = "0.0.4"\n',
      'src-tauri/Cargo.lock':'[[package]]\nname = "virgostars-desktop-spike"\nversion = "0.0.4"\n',
      'src-tauri/tauri.conf.json':'{"version": "0.0.4", "userAgent":"VirgoStarsDesktop/0.0.4 (+https://virgostars.it)"}',
      'scripts/verify-tauri-security-config.mjs':"const agent='VirgoStarsDesktop/0.0.4 (+https://virgostars.it)'"};
    for(const [path,value] of Object.entries(files)) writeFileSync(join(root,path),value);
    const changes=versionChanges(root,'0.0.4','0.0.5');
    assert.equal(changes.size,6);
    for(const value of changes.values()) { assert.match(value,/0\.0\.5/); assert.doesNotMatch(value,/0\.0\.4/); }
    assert.throws(()=>versionChanges(root,'0.0.4','0.0.6'));
    writeFileSync(join(root,'scripts/verify-tauri-security-config.mjs'),'unexpected');
    assert.throws(()=>versionChanges(root,'0.0.4','0.0.5'));
  } finally {rmSync(root,{recursive:true,force:true});}
});
