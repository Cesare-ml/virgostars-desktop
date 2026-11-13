import test from 'node:test';
import assert from 'node:assert/strict';
import {diagnoseEnvironment, formatReport} from '../scripts/desktop-doctor.mjs';

// Deliberately isolated synthetic fixtures; no compiler or native files are used.
function preflight({platform = 'win32', nodeArch = 'x64',
  rust = 'rustc 1.90.0\nhost: x86_64-pc-windows-msvc'} = {}) {
  return diagnoseEnvironment({
    stage: 'setup', platform, nodeArch, nodeVersion: 'v22.16.0',
    root: '/synthetic/desktop', charts: '/synthetic/charts',
    exists: () => false, json: () => null,
    command: name => name === 'rustc' ? rust : 'available',
  });
}
const get = (report, id) => report.checks.find(row => row.id === id);

test('Windows x64 Node and Rust MSVC host pass the architecture gates', () => {
  const report = preflight();
  assert.equal(get(report, 'windows-architecture').status, 'pass');
  assert.equal(get(report, 'rust-target').status, 'pass');
});

test('ARM64 and 32-bit Windows Node cannot silently pass an x64 preflight', () => {
  for (const nodeArch of ['arm64', 'ia32', 'unknown', '']) {
    const report = preflight({nodeArch});
    assert.equal(get(report, 'windows-architecture').status, 'blocked', nodeArch);
    assert.equal(get(report, 'rust-target').status, 'pass');
  }
});

test('Rust host must exactly match the x64 MSVC triple on Windows', () => {
  for (const rust of [
    'rustc 1.90.0\nhost: aarch64-pc-windows-msvc',
    'rustc 1.90.0\nhost: i686-pc-windows-msvc',
    'rustc 1.90.0\nhost: x86_64-unknown-linux-gnu',
    'rustc 1.90.0\nhost: x86_64-pc-windows-msvc-extra',
    'rustc 1.90.0',
    null,
  ]) {
    assert.equal(get(preflight({rust}), 'rust-target').status, 'blocked', String(rust));
  }
});

test('Windows Rust host check accepts standard CRLF output', () => {
  const report = preflight({rust: 'rustc 1.90.0 (stable)\r\nhost: x86_64-pc-windows-msvc\r\n'});
  assert.equal(get(report, 'rust-target').status, 'pass');
});

test('non-Windows platforms remain advisory, without an artificial x64 limitation', () => {
  const report = preflight({
    platform: 'darwin', nodeArch: 'arm64',
    rust: 'rustc 1.90.0\nhost: aarch64-apple-darwin',
  });
  assert.equal(get(report, 'windows-architecture'), undefined);
  assert.equal(get(report, 'host-platform').status, 'warning');
  assert.equal(get(report, 'rust-target').status, 'pass');
});

test('architecture diagnostic contains no local absolute user paths', () => {
  const report = preflight({nodeArch: 'arm64'});
  const human = formatReport(report);
  assert.match(human, /\[BLOCK\] windows-architecture/);
  assert.doesNotMatch(human, /\\Users\\|\/Users\/|\/home\//);
});
