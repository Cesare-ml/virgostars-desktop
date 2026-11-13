import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const cmd = read('scripts/build-windows.cmd');
const powershell = read('scripts/build-windows-spike.ps1');
const scripts = JSON.parse(read('package.json')).scripts;

const REQUIRED_CMD_STAGES = Object.freeze([
  'call npm.cmd test',
  'call npm.cmd run verify:ipc',
  'call npm.cmd run doctor:build',
  'call npm.cmd run build:ui',
  'call npm.cmd run verify:css',
  'call npm.cmd run prepare:icon',
  'cargo test',
  'call npm.cmd exec --offline -- tauri build',
  'call npm.cmd run doctor:verify',
  'node scripts\\verify-windows-pe.mjs',
]);

function assertCmdGates(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n').map(line => line.trim());
  let previous = -1;
  for (const stage of REQUIRED_CMD_STAGES) {
    const hits = lines.flatMap((line, i) => line.toLowerCase() === stage.toLowerCase() ? [i] : []);
    assert.equal(hits.length, 1, 'missing/duplicated Windows CMD gate: ' + stage);
    const at = hits[0];
    assert.ok(at > previous, 'Windows CMD gate out of order: ' + stage);
    assert.equal(lines[at + 1].toLowerCase(), 'if errorlevel 1 goto :failed',
      'Windows CMD build must stop immediately on failure: ' + stage);
    previous = at;
  }
  assert.doesNotMatch(text, /^\s*call\s+npm\.cmd\s+run\s+tauri:build\b/im,
    'rebuilding Angular after CSS validation invalidates the checked bundle');
}

test('CMD native build audits IPC, Angular assets and CSS in a strict fail-closed order', () => {
  assertCmdGates(cmd);
});

test('both Windows build launchers package the audited frontend only once', () => {
  assert.match(cmd, /call npm\.cmd exec --offline -- tauri build/);
  assert.match(powershell,
    /Invoke-Step 'Compile previously verified Angular\/Tauri prototype' 'npm\.cmd' @\('exec', '--offline', '--', 'tauri', 'build'\)/);
  assert.match(scripts['tauri:build'], /npm run build:ui/); // Unsafe to use after standalone CSS verification.
  assert.doesNotMatch(cmd, /^\s*call npm\.cmd run tauri:build\b/im);
  assert.doesNotMatch(powershell, /Invoke-Step[^\n]*'run', 'tauri:build'/);
});

test('PowerShell applies IPC and CSS checks before invoking Tauri, like the CMD script', () => {
  const stages = [
    "Invoke-Step 'Run all available Node test files'",
    "Invoke-Step 'Audit native IPC commands and Tauri capabilities'",
    "Invoke-Step 'Check compiled library and synthetic pack prerequisites'",
    "Invoke-Step 'Build Angular and validate the offline assets'",
    "Invoke-Step 'Check standalone local CSS before Tauri packaging'",
    "Invoke-Step 'Generate temporary development icon'",
    "Invoke-Step 'Run Rust unit tests'",
    "Invoke-Step 'Compile previously verified Angular/Tauri prototype'",
    "Invoke-Step 'Verify generated Angular files and prototype executable exist'",
    "Invoke-Step 'Verify Windows x64 PE header'",
  ];
  const offsets = stages.map(stage => powershell.indexOf(stage));
  assert.ok(offsets.every(index => index >= 0));
  assert.deepEqual(offsets, [...offsets].sort((a,b) => a-b));
});

test('missing IPC audit fails the CMD contract instead of silently skipping native checks', () => {
  const candidate = cmd.replace('call npm.cmd run verify:ipc', 'rem omitted unsafe IPC check');
  assert.notEqual(candidate, cmd);
  assert.throws(() => assertCmdGates(candidate), /missing\/duplicated Windows CMD gate/);
});

test('missing CSS check or moving it after packaging fails the CMD contract', () => {
  const missing = cmd.replace('call npm.cmd run verify:css', 'rem removed CSS verification');
  assert.notEqual(missing, cmd);
  assert.throws(() => assertCmdGates(missing), /missing\/duplicated Windows CMD gate/);
  const moved = cmd.replace('call npm.cmd run verify:css\nif errorlevel 1 goto :failed\n', '')
    .replace('call npm.cmd exec --offline -- tauri build\nif errorlevel 1 goto :failed',
      'call npm.cmd exec --offline -- tauri build\nif errorlevel 1 goto :failed\ncall npm.cmd run verify:css\nif errorlevel 1 goto :failed');
  assert.notEqual(moved, cmd);
  assert.throws(() => assertCmdGates(moved), /out of order/);
});

test('reintroducing tauri:build or dropping a fail-closed error branch fails the CMD contract', () => {
  const rebuild = cmd.replace('call npm.cmd exec --offline -- tauri build',
    'call npm.cmd run tauri:build');
  assert.notEqual(rebuild, cmd);
  assert.throws(() => assertCmdGates(rebuild));
  const unchecked = cmd.replace('call npm.cmd run verify:ipc\nif errorlevel 1 goto :failed',
    'call npm.cmd run verify:ipc\nrem ignore errors');
  assert.notEqual(unchecked, cmd);
  assert.throws(() => assertCmdGates(unchecked), /stop immediately/);
});

test('both launchers validate the native PE after the build and doctor stage', () => {
  assert.match(cmd,
    /call npm\.cmd run doctor:verify\s*\r?\nif errorlevel 1 goto :failed\s*\r?\nnode scripts\\verify-windows-pe\.mjs\s*\r?\nif errorlevel 1 goto :failed/);
  assert.match(powershell,
    /Invoke-Step 'Verify generated Angular files and prototype executable exist'[\s\S]*Invoke-Step 'Verify Windows x64 PE header'/);
});

test('Windows build never disables security, deploys, publishes or runs a network fallback', () => {
  for (const source of [cmd, powershell]) {
    assert.doesNotMatch(source, /--disable-web-security|--no-verify|--unsafe-eval|github\s+actions|git\s+push|npm\s+publish|curl\s+https?:|wget\s+https?:/i);
  }
  assert.equal(scripts['verify:ipc'], 'node scripts/verify-native-ipc.mjs');
  assert.equal(scripts['verify:css'], 'node scripts/verify-bundled-css.mjs');
  assert.equal(scripts['verify:bundle'], 'node scripts/verify-offline-bundle.mjs && npm run verify:privacy');
});
