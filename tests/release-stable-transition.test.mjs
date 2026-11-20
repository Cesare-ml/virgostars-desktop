import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('stable manifest swap recovers from upload failure and detects concurrent changes', {skip:process.platform!=='win32'}, () => {
  const source=readFileSync(new URL('../scripts/updates/publish-release.ps1',import.meta.url),'utf8');
  const block=source.split('# BEGIN TESTABLE STABLE MANIFEST TRANSITION')[1]?.split('# END TESTABLE STABLE MANIFEST TRANSITION')[0];
  assert.ok(block);
  const dir=mkdtempSync(join(tmpdir(),'release-transition-'));
  try {
    const fixture=join(dir,'latest.json'), script=join(dir,'test.ps1');
    writeFileSync(fixture,'synthetic manifest');
    const digest=createHash('sha256').update('synthetic manifest').digest('hex');
    const harness=`$ErrorActionPreference='Stop'
$api='https://fake.invalid'; $repository='test/repo'; $manifestPath=$env:FIXTURE_PATH
$state=[pscustomobject]@{phase='updater-publishing';oldStableId=1;manifestHash=$env:FIXTURE_HASH}
$script:assets=[Collections.ArrayList]::new(); $script:uploads=0
if ($env:FIXTURE_MODE -eq 'already') {
  [void]$script:assets.Add([pscustomobject]@{id=1;name='latest-backup-1.json';digest='sha256:old'})
  [void]$script:assets.Add([pscustomobject]@{id=2;name='latest.json';digest="sha256:$($state.manifestHash)"})
} elseif ($env:FIXTURE_MODE -eq 'conflict') {
  [void]$script:assets.Add([pscustomobject]@{id=3;name='latest.json';digest='sha256:other'})
} else { [void]$script:assets.Add([pscustomobject]@{id=1;name='latest.json';digest='sha256:old'}) }
function Save-State($value) {}
function Github([string]$method,[string]$url,$body=$null,[string]$file='') {
  if ($method -eq 'GET') { return [pscustomobject]@{id=44;assets=@($script:assets)} }
  if ($url -notmatch '/assets/(\\d+)$') { throw 'Unexpected mock URL' }
  $id=[int]$Matches[1]; $asset=@($script:assets | Where-Object { $_.id -eq $id })[0]
  if (-not $asset) { throw 'Missing mock asset' }
  if ($method -eq 'PATCH') { $asset.name=$body.name; return $asset }
  if ($method -eq 'DELETE') { $script:assets.Remove($asset); return }
  throw 'Unexpected mock request'
}
function Upload([long]$releaseId,[string]$path,[string]$name) {
  $script:uploads++
  if ($env:FIXTURE_MODE -eq 'failure') { throw 'Mock upload failed' }
  $asset=[pscustomobject]@{id=2;name=$name;digest="sha256:$($state.manifestHash)"}
  [void]$script:assets.Add($asset); return $asset
}
$failure=$false
try { ${block} } catch { $failure=$true }
@{failed=$failure;phase=$state.phase;uploads=$script:uploads;names=@($script:assets | ForEach-Object {$_.name})} | ConvertTo-Json -Compress
`;
    writeFileSync(script,'\uFEFF'+harness,'utf8');
    function run(mode) {
      const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script],{encoding:'utf8',env:{...process.env,FIXTURE_PATH:fixture,FIXTURE_HASH:digest,FIXTURE_MODE:mode}});
      assert.equal(result.status,0,result.stderr);
      return JSON.parse(result.stdout.trim());
    }
    const success=run('success');
    assert.equal(success.failed,false);assert.equal(success.phase,'updater-published');
    assert.deepEqual([...success.names].sort(),['latest-backup-1.json','latest.json']);
    const failure=run('failure');
    assert.equal(failure.failed,true);assert.equal(failure.phase,'updater-publishing');assert.deepEqual(failure.names,['latest.json']);
    const conflict=run('conflict');
    assert.equal(conflict.failed,true);assert.equal(conflict.uploads,0);assert.deepEqual(conflict.names,['latest.json']);
    const already=run('already');
    assert.equal(already.failed,false);assert.equal(already.phase,'updater-published');assert.equal(already.uploads,0);
  } finally {rmSync(dir,{recursive:true,force:true});}
});
