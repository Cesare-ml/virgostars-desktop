import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { prepareSyntheticAssets } from '../scripts/prepare-synthetic-frontend.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'virgostars-synthetic-assets-'));
  const charts = join(root, 'astrological-charts');
  const frontend = join(root, 'desktop-stage');
  const assets = join(charts, '.local/demo-pack/public/assets');
  const manifestPath = join(charts, '.local/demo-pack/manifests/approved-assets.json');
  mkdirSync(join(assets, 'img'), {recursive:true});
  mkdirSync(dirname(manifestPath), {recursive:true});
  const data = Buffer.from('original synthetic checkerboard fixture');
  const record = (path, bytes=data) => ({
    path, bytes:bytes.length, sha256:createHash('sha256').update(bytes).digest('hex'),
    rightsHolder:'Astrological Charts synthetic test fixture',
    permissionBasis:'Original synthetic checkerboard data generated locally; not VirgoStars artwork',
    approvalEvidence:'scripts/generate-demo-pack.mjs (automatically generated development fixture)'
  });
  const manifest = {
    schemaVersion:1,
    source:{repository:'synthetic-local-fixtures',commit:'none',assetRoot:'public/assets'},
    assets:[record('img/sample.png')]
  };
  const asset=(path,bytes=data)=>{
    const output=join(assets,...path.split('/'));
    mkdirSync(dirname(output),{recursive:true});
    writeFileSync(output,bytes);
  };
  asset('img/sample.png');
  const save=()=>writeFileSync(manifestPath,JSON.stringify(manifest));
  save();
  return {charts,frontend,assets,manifest,save,asset,data,cleanup:()=>rmSync(root,{recursive:true,force:true})};
}
function withFixture(run) {
  const f=fixture();
  try {run(f);} finally {f.cleanup();}
}

test('asset staging contains ONLY synthetic images and a development manifest, not demo code',()=>withFixture(f=>{
  const result=prepareSyntheticAssets(f.charts,f.frontend);
  assert.equal(result.count,1);
  assert.equal(result.reused,false);
  assert.deepEqual(readdirSync(f.frontend).sort(), ['assets','synthetic-assets-manifest.json']);
  assert.deepEqual(readFileSync(join(f.frontend,'assets/img/sample.png')),f.data);
  assert.ok(!existsSync(join(f.frontend,'index.html')));
  assert.ok(!existsSync(join(f.frontend,'main.js')));
}));

test('same verified content can be reused safely without deletion or overwriting',()=>withFixture(f=>{
  prepareSyntheticAssets(f.charts,f.frontend);
  const result=prepareSyntheticAssets(f.charts,f.frontend);
  assert.equal(result.reused,true);
  assert.equal(result.count,1);
}));

test('changed source or staged image is rejected rather than silently overwritten',()=>withFixture(f=>{
  prepareSyntheticAssets(f.charts,f.frontend);
  writeFileSync(join(f.frontend,'assets/img/sample.png'),'replaced');
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Existing synthetic asset stage is modified/);
}));

test('rejects private/unauthorized manifest and unapproved rights',()=>withFixture(f=>{
  f.manifest.source.repository='private-artwork';f.save();
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Only the charts locally generated synthetic manifest/);
  f.manifest.source.repository='synthetic-local-fixtures';
  f.manifest.assets[0].rightsHolder='other';f.save();
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Unapproved rights provenance/);
}));

test('detects tampered bytes by SHA-256 before creating output',()=>withFixture(f=>{
  writeFileSync(join(f.assets,'img/sample.png'),'tampered');
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Tampered synthetic asset/);
  assert.equal(existsSync(f.frontend),false);
}));

test('rejects traversal, Windows-reserved punctuation and unsupported file types',()=>withFixture(f=>{
  for(const name of ['img/../secret.png','img/C:/foo.png','img/planet.svg','img/..\\evil.png']){
    f.manifest.assets[0].path=name;f.save();
    assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Invalid synthetic asset path|Unsafe synthetic asset path|Unapproved synthetic file type/);
  }
}));

test('rejects symlinks in asset chain and link files',()=>withFixture(f=>{
  rmSync(join(f.assets,'img/sample.png'));
  symlinkSync(join(f.charts,'.local/demo-pack/manifests/approved-assets.json'),join(f.assets,'img/sample.png'));
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Unsafe or invalid file/);
}));

test('supports spaces in actual synthetic renderer filenames',()=>withFixture(f=>{
  f.asset('img/true node.png');
  f.manifest.assets[0].path='img/true node.png';f.save();
  prepareSyntheticAssets(f.charts,f.frontend);
  assert.deepEqual(readFileSync(join(f.frontend,'assets/img/true node.png')),f.data);
}));

test('rejects case-insensitive path collisions before writing anything',()=>withFixture(f=>{
  f.manifest.assets.push({...f.manifest.assets[0],path:'img/SAMPLE.png'});f.save();
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Case-insensitive duplicate/);
  assert.equal(existsSync(f.frontend),false);
}));

test('fails closed on unexpected output files and legacy demo staging',()=>withFixture(f=>{
  prepareSyntheticAssets(f.charts,f.frontend);
  writeFileSync(join(f.frontend,'index.html'),'Old HTML');
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/non-asset material/);
}));

test('rejects inconsistent manifest byte metadata',()=>withFixture(f=>{
  prepareSyntheticAssets(f.charts,f.frontend);
  f.manifest.assets[0].bytes=12;f.save();
  assert.throws(()=>prepareSyntheticAssets(f.charts,f.frontend),/Tampered synthetic asset/);
}));
