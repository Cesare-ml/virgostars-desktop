import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {auditChartsNpmLock,auditChartsCheckout} from '../scripts/verify-charts-npm-lock.mjs';

const sri = 'sha512-' + Buffer.alloc(64).toString('base64');
const manifest = Object.freeze({
  name: 'grafici-astrologici', version: '0.0.1',
  dependencies: {tslib:'^2.3.0'}, devDependencies: {typescript:'5.8.3'},
  peerDependencies: {three:'^0.170.0'}, engines: {node:'^22.12.0'},
});
const valid = () => ({
  name: 'grafici-astrologici', version: '0.0.1', lockfileVersion: 3,
  packages: {
    '': structuredClone(manifest),
    'node_modules/tslib': {
      version:'2.3.0',
      resolved:'https://registry.npmjs.org/tslib/-/tslib-2.3.0.tgz',
      integrity:sri,
    },
  },
});
const rejects = (edit, label) => {
  const lock = valid();
  edit(lock);
  assert.throws(() => auditChartsNpmLock(manifest, lock), Error, label);
};

test('accepts only pinned registry packages and exact root contract', () => {
  assert.deepEqual(auditChartsNpmLock(manifest,valid()), {
    registryPackages:1,localLinks:0,
  });
});

test('rejects changed dependency or peer root declarations', () => {
  rejects(lock => {lock.packages[''].dependencies.tslib='*';}, 'root dependencies');
  rejects(lock => {lock.packages[''].peerDependencies.three='*';}, 'root peer dependencies');
  rejects(lock => {lock.version='0.0.2';}, 'lock top-level version');
  rejects(lock => {lock.lockfileVersion=2;}, 'unsupported npm lock format');
  rejects(lock => {delete lock.packages[''];}, 'missing root');
});

test('rejects alternate registry URLs and unpinned resolved metadata', () => {
  for (const value of [
    'http://registry.npmjs.org/tslib/-/tslib-2.3.0.tgz',
    'https://evil.example/tslib/-/tslib-2.3.0.tgz',
    'https://registry.npmjs.org/tslib/-/tslib-2.3.0.tgz?source=other',
    'https://registry.npmjs.org/tslib/-/tslib-2.3.0.tgz#fragment',
    'file:../staged.tgz',
  ]) rejects(lock => {lock.packages['node_modules/tslib'].resolved=value;},value);
  rejects(lock => {delete lock.packages['node_modules/tslib'].resolved;}, 'missing resolved');
});

test('rejects corrupted digest, local links and package identity mismatches', () => {
  rejects(lock => {lock.packages['node_modules/tslib'].integrity='sha512-not-base64';},
    'invalid digest');
  rejects(lock => {lock.packages['node_modules/tslib'].link=true;}, 'unreviewed npm link');
  rejects(lock => {lock.packages['node_modules/tslib'].version='9.9.9';},
    'mismatched tarball version');
  rejects(lock => {lock.packages['node_modules/tslib'].name='other-package';},
    'unreviewed alias');
  rejects(lock => {lock.packages['node_modules/../escape']={
    version:'2.3.0',resolved:'https://registry.npmjs.org/tslib/-/tslib-2.3.0.tgz',
    integrity:sri,
  };}, 'parent package path');
});

test('rejects empty package sets and unexpected package count', () => {
  const lock=valid();
  delete lock.packages['node_modules/tslib'];
  assert.throws(() => auditChartsNpmLock(manifest,lock));
});

test('does not accept incidental extra manifest root changes', () => {
  assert.throws(() => auditChartsNpmLock({...manifest,name:'wrong-project'},valid()));
  assert.throws(() => auditChartsNpmLock(null,valid()));
  assert.throws(() => auditChartsNpmLock(manifest,null));
});

test('Windows bootstrap audits both lockfiles before first Charts npm ci', () => {
  const bootstrap=readFileSync(new URL('../scripts/build-windows-spike.ps1',import.meta.url),'utf8');
  const packageJson=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  const desktopAudit=bootstrap.indexOf("'scripts/verify-npm-lock.mjs'");
  const chartsAudit=bootstrap.indexOf("'scripts/verify-charts-npm-lock.mjs'");
  const firstNpmCi=bootstrap.indexOf("'npm.cmd' @('ci')");
  assert.ok(desktopAudit>=0 && chartsAudit>desktopAudit && firstNpmCi>chartsAudit,
    'both offline preflights must run before Charts installation');
  assert.equal(packageJson.scripts['verify:charts-lock'],'node scripts/verify-charts-npm-lock.mjs');
});

function withCheckout(t) {
  const charts = mkdtempSync(join(tmpdir(), 'vs-charts-lock-'));
  t.after(() => rmSync(charts, {recursive:true,force:true}));
  writeFileSync(join(charts,'package.json'),JSON.stringify(manifest));
  writeFileSync(join(charts,'package-lock.json'),JSON.stringify(valid()));
  return charts;
}

test('checkout reader accepts only regular synthetic manifest and lockfile',t=>{
  const charts=withCheckout(t);
  assert.deepEqual(auditChartsCheckout(charts),{registryPackages:1,localLinks:0});
  rmSync(join(charts,'package-lock.json'));
  mkdirSync(join(charts,'package-lock.json'));
  assert.throws(()=>auditChartsCheckout(charts),/regular checkout entry/);
});

test('checkout reader rejects invalid UTF-8 that JSON.parse would silently replace',t=>{
  const charts=withCheckout(t);
  const corrupt=Buffer.concat([
    Buffer.from(JSON.stringify(manifest).replace(/}$/,',"extra":"')),
    Buffer.from([0xff]),Buffer.from('"}')
  ]);
  assert.doesNotThrow(()=>JSON.parse(corrupt.toString('utf8')));
  writeFileSync(join(charts,'package.json'),corrupt);
  assert.throws(()=>auditChartsCheckout(charts),/encoded data|UTF-8/i);
  writeFileSync(join(charts,'package.json'),JSON.stringify(manifest));
  const corruptLock=Buffer.concat([
    Buffer.from(JSON.stringify(valid()).replace(/}$/,',"extra":"')),
    Buffer.from([0xff]),Buffer.from('"}')
  ]);
  assert.doesNotThrow(()=>JSON.parse(corruptLock.toString('utf8')));
  writeFileSync(join(charts,'package-lock.json'),corruptLock);
  assert.throws(()=>auditChartsCheckout(charts),/encoded data|UTF-8/i);
});

test('checkout reader rejects oversized metadata before reading it',t=>{
  const charts=withCheckout(t);
  writeFileSync(join(charts,'package.json'),Buffer.alloc(1000000,65));
  assert.throws(()=>auditChartsCheckout(charts),/size limits/);
});

test('checkout reader rejects symlinked manifests and locks', {skip:process.platform==='win32'},t=>{
  const charts=withCheckout(t);
  for (const name of ['package.json','package-lock.json']) {
    const path=join(charts,name), target=join(charts,name+'.regular');
    writeFileSync(target,name==='package.json'?JSON.stringify(manifest):JSON.stringify(valid()));
    rmSync(path);symlinkSync(target,path);
    assert.throws(()=>auditChartsCheckout(charts),/regular checkout entry/);
    rmSync(path);writeFileSync(path,name==='package.json'?JSON.stringify(manifest):JSON.stringify(valid()));
  }
});
