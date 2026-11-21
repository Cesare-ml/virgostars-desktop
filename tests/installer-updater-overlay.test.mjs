import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {installerArguments} from '../scripts/ephemeris/installer-arguments.mjs';

test('the installer includes only the updater overlay bound to its signing public key',()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-installer-overlay-'));
  try {
    const folder=join(root,'.local','updater');mkdirSync(folder,{recursive:true});
    const path=join(folder,'tauri-release.conf.json'),args=['--config','.local/updater/tauri-release.conf.json'];
    const config={bundle:{createUpdaterArtifacts:true},plugins:{updater:{pubkey:'test-public-key'}}};
    writeFileSync(path,JSON.stringify(config));
    assert.deepEqual(installerArguments([],root,{}),[]);
    assert.deepEqual(installerArguments(args,root,{VIRGOSTARS_UPDATER_PUBLIC_KEY:'test-public-key'}),args);
    assert.throws(()=>installerArguments(args,root,{VIRGOSTARS_UPDATER_PUBLIC_KEY:'different-key'}));
    assert.throws(()=>installerArguments(['--config','unreviewed.json'],root,{}));
    config.bundle.resources={'unknown':'unknown'};writeFileSync(path,JSON.stringify(config));
    assert.throws(()=>installerArguments(args,root,{VIRGOSTARS_UPDATER_PUBLIC_KEY:'test-public-key'}));
  } finally {rmSync(root,{recursive:true,force:true});}
});
