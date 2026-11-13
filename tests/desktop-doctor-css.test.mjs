import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {diagnoseEnvironment, formatReport} from '../scripts/desktop-doctor.mjs';

// Synthetic dependencies: never read user files or call a native toolchain.
const root = '/fictional/desktop';
const charts = '/fictional/astrological-charts';
const index = join(root, 'dist', 'desktop', 'browser', 'index.html');
const bundle = join(root, 'dist', 'desktop', 'browser');
function run(stage, {html = true, cssInspector = () => ({stylesheets: 1})} = {}) {
  return diagnoseEnvironment({
    root, charts, stage, platform: 'linux', nodeVersion: 'v22.16.0',
    exists: path => html && path === index,
    json: () => null, command: () => null, cssInspector,
  });
}
const check = (report, id) => report.checks.find(item => item.id === id);

test('verify checks exactly the built CSS bundle after finding index.html', () => {
  const paths = [];
  const report = run('verify', {cssInspector: path => {
    paths.push(path);
    return {stylesheets: 1, files: ['styles-demo.css']};
  }});
  assert.deepEqual(paths, [bundle]);
  assert.equal(check(report, 'angular-bundle').status, 'pass');
  assert.equal(check(report, 'angular-css').status, 'pass');
});

test('missing HTML blocks CSS verification without inspecting files', () => {
  let calls = 0;
  const report = run('verify', {html: false, cssInspector: () => {
    calls++;
    throw Error('must not inspect missing bundle');
  }});
  assert.equal(calls, 0);
  assert.equal(check(report, 'angular-bundle').status, 'blocked');
  assert.equal(check(report, 'angular-css').status, 'blocked');
});

test('invalid or empty stylesheet verification fails closed', () => {
  for (const result of [{stylesheets: 0}, {stylesheets: -1}, {stylesheets: 1.5}, null, {}]) {
    const report = run('verify', {cssInspector: () => result});
    assert.equal(check(report, 'angular-css').status, 'blocked');
  }
});

test('inspector failure never prints local paths or exception details', () => {
  const secret = 'C:\\Users\\PrivateAccount\\birth-data.sqlite';
  const report = run('verify', {cssInspector: () => { throw Error(secret); }});
  assert.equal(check(report, 'angular-css').status, 'blocked');
  const readable = formatReport(report);
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(readable, /PrivateAccount|birth-data/);
  assert.doesNotMatch(serialized, /PrivateAccount|birth-data/);
});

test('setup and build stages do not read compiled CSS', () => {
  for (const stage of ['setup', 'build']) {
    const report = run(stage, {cssInspector: () => { throw Error('unexpected CSS access'); }});
    assert.equal(check(report, 'angular-css'), undefined);
  }
});
