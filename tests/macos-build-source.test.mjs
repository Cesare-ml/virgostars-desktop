import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Mac bundle is isolated from the Windows default, with app + dmg and ICNS',()=>{
  const base=JSON.parse(read('src-tauri/tauri.conf.json'));
  const mac=JSON.parse(read('src-tauri/tauri.macos.conf.json'));
  assert.equal(base.bundle.active,false);
  assert.equal(mac.bundle.active,true);
  assert.deepEqual(mac.bundle.targets,['app','dmg']);
  assert.ok(base.bundle.icon.includes('icons/icon.icns'));
  assert.match(mac.bundle.macOS.minimumSystemVersion,/^\d+\.\d+$/);
});
test('Mac entrypoint remains an explicit local build, never automatic publishing',()=>{
  const build=read('scripts/mac/build.mjs'), publish=read('scripts/mac/publish.mjs');
  assert.match(build,/process\.platform==='darwin'/);
  assert.match(build,/prepare-public-data\.mjs/);
  assert.match(build,/--bundles','app,dmg'/);
  assert.match(build,/stapler','validate'/);
  assert.doesNotMatch(build,/release','upload'/);
  assert.match(publish,/verifyReport/);
  assert.match(publish,/release','upload'/);
  assert.doesNotMatch(publish,/release','create'/);
  assert.doesNotMatch(publish,/--clobber/);
});
test('Public datasets are independently authenticated and archive path supported',()=>{
  const data=read('scripts/mac/prepare-public-data.mjs');
  const city=read('scripts/places/fetch_catalog.py');
  assert.match(data,/DOWNLOADS\.cities\.sha256/);
  assert.match(data,/DOWNLOADS\.de441\.sha256/);
  assert.match(data,/catalog\.packs\?\.filter\(pack=>pack\.required\)/);
  assert.match(city,/parser\.add_argument\("--archive"/);
});
test('Windows license inventory remains the default, native Mac target is opt-in',()=>{
  const notices=read('scripts/ephemeris/prepare-release-notices.mjs');
  assert.match(notices,/target = namedTarget \?\? 'x86_64-pc-windows-msvc'/);
  assert.match(notices,/aarch64-apple-darwin/);
  assert.match(notices,/x86_64-apple-darwin/);
});
