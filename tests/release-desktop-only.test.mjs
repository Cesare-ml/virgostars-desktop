import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

test('desktop-only release advances without site phases and full mode is unchanged',{skip:process.platform!=='win32'},()=>{
  const source=readFileSync(new URL('../scripts/updates/publish-release.ps1',import.meta.url),'utf8');
  const block=name=>source.split(`# BEGIN TESTABLE DESKTOP-ONLY ${name} TRANSITION`)[1]?.split(`# END TESTABLE DESKTOP-ONLY ${name} TRANSITION`)[0];
  const built=block('BUILT'),complete=block('COMPLETE');assert.ok(built && complete);
  const dir=mkdtempSync(join(tmpdir(),'vs-release-mode-'));
  try {
    const script=join(dir,'test.ps1');
    writeFileSync(script,`$ErrorActionPreference='Stop'
$DesktopOnly=$env:TEST_MODE -eq 'desktop'; $tag='v0.0.5'
$state=[pscustomobject]@{phase='built'}
function Save-State($value) {}
${built}
$first=$state.phase
$state.phase='updater-published'
${complete}
@{first=$first;final=$state.phase} | ConvertTo-Json -Compress
`);
    const run=mode=>{
      const r=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',env:{...process.env,TEST_MODE:mode}});
      assert.equal(r.status,0,r.stderr);return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
    };
    assert.deepEqual(run('desktop'),{first:'web-committed',final:'complete'});
    assert.deepEqual(run('full'),{first:'built',final:'updater-published'});
    assert.match(source,/\[bool\]\$state\.desktopOnly -ne \[bool\]\$DesktopOnly/);
    assert.match(source,/if \(\$PrepareOnly -and \$state\.phase -notin/);
    assert.match(source,/if \(-not \$DesktopOnly\) \{ Security-Preflight \}/);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
