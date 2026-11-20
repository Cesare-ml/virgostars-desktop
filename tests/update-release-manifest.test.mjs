import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync,rmdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyDesktopVersions} from '../scripts/verify-desktop-version.mjs';

test('manual manifest uses the selected channel and refuses a mismatched signed version',()=>{
  const dir=mkdtempSync(join(tmpdir(),'virgostars-update-fixture-'));
  try {
    const installer=join(dir,'Fixture Desktop-setup.exe'), sig=join(dir,'fixture.sig'), notes=join(dir,'notes.txt'), out=join(dir,'latest.json');
    writeFileSync(installer,'synthetic non-executable fixture');writeFileSync(notes,'Test release');
    const version=verifyDesktopVersions().version;
    const run=()=>spawnSync(process.execPath,['scripts/updates/prepare-manifest.mjs','--channel','stable','--installer',installer,'--signature',sig,'--notes',notes,'--output',out],{encoding:'utf8'});
    writeFileSync(sig,Buffer.from('trusted comment: version:9.9.9\n').toString('base64'));
    assert.notEqual(run().status,0);
    writeFileSync(sig,Buffer.from(`trusted comment: version:${version}\n`).toString('base64'));
    assert.equal(run().status,0);
    const manifest=JSON.parse(readFileSync(out,'utf8'));assert.equal(manifest.version,version);
    assert.match(manifest.platforms['windows-x86_64'].url,/\/releases\/download\/v/);
    assert.ok(manifest.platforms['windows-x86_64'].url.endsWith('/Fixture.Desktop-setup.exe'), 'manifest uses the asset name GitHub serves');
    assert.notEqual(run().status,0,'existing manifest must never be overwritten');
    rmSync(out);
    const testing=spawnSync(process.execPath,['scripts/updates/prepare-manifest.mjs','--channel','testing','--installer',installer,'--signature',sig,'--notes',notes,'--output',out],{encoding:'utf8'});
    assert.equal(testing.status,0);
    assert.match(JSON.parse(readFileSync(out,'utf8')).platforms['windows-x86_64'].url,/\/releases\/download\/test-v/);
  } finally {for (const name of ['Fixture Desktop-setup.exe','fixture.sig','notes.txt','latest.json']) rmSync(join(dir,name),{force:true});rmdirSync(dir);}
});
