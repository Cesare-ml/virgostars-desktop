import test from 'node:test';
import assert from 'node:assert/strict';
import {copyFileSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EVENT_ARCHIVE_NAME,EVENT_ARCHIVE_SHA256,EVENT_OVERRIDE,prepareEventArchive} from '../scripts/prepare-local-event-archive.mjs';
import {stageLocalEventResource} from '../scripts/stage-local-event-resource.mjs';

test('a changed local archive fails before packaging and stays untouched',async()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-event-test-'));
  try {
    const folder=join(root,'.local','event-ephemeris');mkdirSync(folder,{recursive:true});
    const path=join(folder,EVENT_ARCHIVE_NAME);writeFileSync(path,'invalid');
    await assert.rejects(prepareEventArchive(root,()=>{throw Error('unexpected download');}),/left untouched/);
    assert.equal(readFileSync(path,'utf8'),'invalid');
    assert.equal(existsSync(join(folder,'tauri-events.conf.json')),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('unknown downloaded bytes fail before the archive is written',async()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-event-test-'));
  try {
    await assert.rejects(prepareEventArchive(root,async()=>[Buffer.from('a'),Buffer.from('b'),Buffer.from('c')]),/pinned snapshot/);
    assert.equal(existsSync(join(root,'.local','event-ephemeris',EVENT_ARCHIVE_NAME)),false);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('Windows and macOS installer entrypoints prepare and include the event resource',()=>{
  for (const path of ['scripts/ephemeris/build-installer.mjs','scripts/mac/build.mjs']) {
    const script=readFileSync(path,'utf8');
    assert.match(script,/prepareEventArchive|prepare-local-event-archive\.mjs/);
    assert.match(script,/\.local\/event-ephemeris\/tauri-events\.conf\.json/);
  }
  const scripts=JSON.parse(readFileSync('package.json','utf8')).scripts;
  assert.match(scripts['build:local'],/stage-local-event-resource\.mjs/);
  assert.match(scripts['tauri:dev'],/events:prepare:local/);
});

const staged=join(process.cwd(),'.local','event-ephemeris',EVENT_ARCHIVE_NAME);
test('the pinned local archive generates the exact installer resource overlay',{skip:!existsSync(staged)},async()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-event-test-'));
  try {
    const folder=join(root,'.local','event-ephemeris');mkdirSync(folder,{recursive:true});
    copyFileSync(staged,join(folder,EVENT_ARCHIVE_NAME));
    const result=await prepareEventArchive(root,()=>{throw Error('unexpected download');});
    assert.equal(result.sha256,EVENT_ARCHIVE_SHA256);
    assert.equal(readFileSync(join(folder,'tauri-events.conf.json'),'utf8'),JSON.stringify(EVENT_OVERRIDE,null,2)+'\n');
    assert.equal(EVENT_OVERRIDE.bundle.resources[`../.local/event-ephemeris/${EVENT_ARCHIVE_NAME}`],`ephemeris/events/${EVENT_ARCHIVE_NAME}`);
  } finally {rmSync(root,{recursive:true,force:true});}
});

test('a local executable receives the verified resource and refuses to overwrite a modified one',{skip:!existsSync(staged)},async()=>{
  const root=mkdtempSync(join(tmpdir(),'vs-event-test-'));
  try {
    const folder=join(root,'.local','event-ephemeris'), release=join(root,'src-tauri','target','release');
    mkdirSync(folder,{recursive:true});mkdirSync(release,{recursive:true});
    copyFileSync(staged,join(folder,EVENT_ARCHIVE_NAME));
    writeFileSync(join(release,process.platform==='win32'?'virgostars-desktop-spike.exe':'virgostars-desktop-spike'),'fixture');
    const resource=join(release,'ephemeris','events',EVENT_ARCHIVE_NAME);
    await stageLocalEventResource(root);
    assert.equal(readFileSync(resource).length,readFileSync(staged).length);
    writeFileSync(resource,'modified');
    await assert.rejects(stageLocalEventResource(root),/left untouched/);
    assert.equal(readFileSync(resource,'utf8'),'modified');
  } finally {rmSync(root,{recursive:true,force:true});}
});
