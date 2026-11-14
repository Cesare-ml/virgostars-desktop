import test from 'node:test';
import assert from 'node:assert/strict';
import {auditChartsNpmLock} from '../scripts/verify-charts-npm-lock.mjs';

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
