import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, copyFileSync, realpathSync, existsSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'vs-local-library-test-'));
  const scripts = join(root, 'scripts');
  const modules = join(root, 'node_modules');
  const functions = join(root, 'functions');
  const chartsRoot = join(root, 'charts');
  const charts = join(chartsRoot, 'dist', 'grafici-astrologici');
  for (const path of [scripts, modules, functions, join(charts, 'fesm2022')]) mkdirSync(path, {recursive:true});
  copyFileSync(resolve('scripts/link-local-astrology-libraries.mjs'), join(scripts, 'link-local-astrology-libraries.mjs'));
  writeFileSync(join(functions, 'package.json'), JSON.stringify({name:'astrological-functions', exports:{
    './regolo-directions':{}, './regolo-arabic-parts':{}, './virgostars-kleroi':{}, './virgostars-star-contacts':{},
  }}));
  writeFileSync(join(charts, 'package.json'), JSON.stringify({name:'grafici-astrologici'}));
  writeFileSync(join(charts, 'fesm2022', 'grafici-astrologici.mjs'), 'SYNASTRY_DEFLECTION_VERSION REGOLO_DIRECTIONS_RENDER_VERSION');
  const run = () => spawnSync(process.execPath, [join(scripts, 'link-local-astrology-libraries.mjs'), functions, chartsRoot], {encoding:'utf8'});
  return {root, modules, functions, charts, run};
}

test('local links survive a dependency reinstall by being explicitly restored', t => {
  const f = fixture();
  t.after(() => rmSync(f.root, {recursive:true, force:true}));
  const old = join(f.root, 'old'); mkdirSync(old);
  try {
    symlinkSync(old, join(f.modules, 'astrological-functions'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('filesystem does not permit link creation'); return; }
    throw error;
  }
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(realpathSync(join(f.modules, 'astrological-functions')), realpathSync(f.functions));
  assert.equal(realpathSync(join(f.modules, 'grafici-astrologici')), realpathSync(f.charts));
  assert.equal(existsSync(join(f.modules, 'astrological-functions.desktop-link-backup')), false);
  assert.equal(f.run().status, 0);
});

test('the linker refuses to replace an actual package directory', t => {
  const f = fixture();
  t.after(() => rmSync(f.root, {recursive:true, force:true}));
  const original = join(f.modules, 'astrological-functions'); mkdirSync(original);
  writeFileSync(join(original, 'keep'), 'untouched');
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.equal(existsSync(join(original, 'keep')), true);
  assert.equal(existsSync(join(f.modules, 'grafici-astrologici')), false);
});
