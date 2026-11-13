import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, symlinkSync, readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {APPROVED_PLACES_OVERRIDE, verifyPlacesTauriOverride} from '../scripts/verify-places-tauri-override.mjs';

const canonical = () => JSON.stringify(APPROVED_PLACES_OVERRIDE, null, 2) + '\n';
function withFile(contents, callback) {
  const dir=mkdtempSync(join(tmpdir(),'vs-city-override-'));
  const path=join(dir,'tauri-places.conf.json');
  try {
    if (contents !== null) writeFileSync(path,contents);
    callback(path,dir);
  } finally { rmSync(dir,{recursive:true,force:true}); }
}

test('accepts only the exact Python-generated resource-only override',()=>withFile(canonical(), path=>{
  assert.deepEqual(verifyPlacesTauriOverride(path),{approvedResources:2});
  assert.equal(APPROVED_PLACES_OVERRIDE.bundle.resources['../.local/places/world-cities.sqlite'],
    'places/world-cities.sqlite');
}));

test('accepts Windows CRLF translation without accepting other changes',()=>withFile(canonical().replace(/\n/g,'\r\n'),path=>{
  assert.equal(verifyPlacesTauriOverride(path).approvedResources,2);
}));

test('rejects added capability or security overrides',()=>{
  for (const injected of [
    {app:{security:{capabilities:['fs:default']}}},
    {plugins:{fs:{scope:['/**']}}},
    {build:{devUrl:'https://malicious.invalid'}},
  ]) withFile(JSON.stringify({...APPROVED_PLACES_OVERRIDE,...injected},null,2)+'\n',path=>{
    assert.throws(()=>verifyPlacesTauriOverride(path),/differs/);
  });
});

test('rejects extra resources, absolute paths and changed bundle options',()=>{
  const configs=[
    {bundle:{...APPROVED_PLACES_OVERRIDE.bundle,resources:{...APPROVED_PLACES_OVERRIDE.bundle.resources,
      '../../.local/private-data.sqlite':'private.sqlite'}}},
    {bundle:{...APPROVED_PLACES_OVERRIDE.bundle,resources:{'C:/private.sqlite':'places/world-cities.sqlite'}}},
    {bundle:{...APPROVED_PLACES_OVERRIDE.bundle,active:false}},
    {bundle:{...APPROVED_PLACES_OVERRIDE.bundle,icon:['untrusted.ico']}},
  ];
  for(const config of configs) withFile(JSON.stringify(config,null,2)+'\n',path=>{
    assert.throws(()=>verifyPlacesTauriOverride(path),/differs/);
  });
});

test('rejects duplicate JSON keys rather than relying on last-key-wins parsing',()=>{
  const raw='{"app":{"security":{"capabilities":["fs:default"]}},"bundle":'+
    JSON.stringify(APPROVED_PLACES_OVERRIDE.bundle)+',"app":{}}';
  assert.deepEqual(JSON.parse(raw).app,{}); // The dangerous duplicate was lost.
  withFile(raw,path=>assert.throws(()=>verifyPlacesTauriOverride(path),/differs/));
});

test('rejects empty, malformed, reordered and noncanonical output',()=>{
  for(const raw of ['', '{}', '[]', 'null', '{"bundle":',
    JSON.stringify(APPROVED_PLACES_OVERRIDE),
    '\ufeff'+canonical(),
    canonical()+'\n']) withFile(raw,path=>{
      assert.throws(()=>verifyPlacesTauriOverride(path),/differs/);
    });
});

test('rejects missing and oversized overrides and directory paths',()=>{
  withFile(null,path=>assert.throws(()=>verifyPlacesTauriOverride(path),/ENOENT/));
  withFile('x'.repeat(4097),path=>assert.throws(()=>verifyPlacesTauriOverride(path),/Unapproved/));
  withFile(canonical(),(_path,dir)=>assert.throws(()=>verifyPlacesTauriOverride(dir),/Unapproved/));
});

test('rejects symlinks to an otherwise approved file',()=>withFile(canonical(),(path,dir)=>{
  const link=join(dir,'override-link.json');
  symlinkSync(path,link);
  assert.throws(()=>verifyPlacesTauriOverride(link),/Unapproved/);
}));

test('both Windows city build scripts verify native and override config before packaging',()=>{
  const scripts=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
  assert.equal(scripts['verify:places-override'],'node scripts/verify-places-tauri-override.mjs');
  for (const [key,ui] of [
    ['tauri:build:places:windows','npm run build:ui'],
    ['tauri:build:places:private:windows','npm run build:ui:private'],
  ]) {
    const parts=scripts[key].split(' && ');
    const generate=parts.indexOf('py -3 scripts/places/prepare_tauri_bundle.py');
    assert.ok(generate >= 0,key);
    assert.equal(parts[generate+1],'npm run verify:ipc',key);
    assert.equal(parts[generate+2],'npm run verify:places-override',key);
    assert.equal(parts[generate+3],ui,key);
    assert.equal(parts.at(-1),'tauri build --config .local/places/tauri-places.conf.json',key);
  }
});
