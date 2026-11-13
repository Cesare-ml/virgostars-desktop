import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const cmd = read('scripts/build-windows.cmd');
const ps = read('scripts/build-windows-spike.ps1');

function operationalLines(source) {
  return source.replaceAll('\r\n', '\n').split('\n')
    .map(line => line.trim()).filter(line => line && !/^rem(?:\s|$)/i.test(line));
}

const SYSTEM_HOST = 'set "VS_SYSTEM_POWERSHELL=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"';
const INVOKE = '"%VS_SYSTEM_POWERSHELL%" -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"';

function assertDelegation(source) {
  const lines = operationalLines(source);
  for (const required of [
    'setlocal EnableExtensions DisableDelayedExpansion',
    SYSTEM_HOST, 'if not exist "%VS_SYSTEM_POWERSHELL%" (',
    INVOKE, 'set "VS_BUILD_EXIT=%ERRORLEVEL%"', 'exit /b %VS_BUILD_EXIT%'
  ]) assert.equal(lines.filter(line => line === required).length, 1, 'missing/duplicate CMD line: ' + required);
  assert.ok(lines.indexOf(SYSTEM_HOST) < lines.indexOf('if not exist "%VS_SYSTEM_POWERSHELL%" ('));
  assert.ok(lines.indexOf('if not exist "%VS_SYSTEM_POWERSHELL%" (') < lines.indexOf(INVOKE));
  assert.ok(lines.indexOf(INVOKE) < lines.indexOf('set "VS_BUILD_EXIT=%ERRORLEVEL%"'));
  assert.ok(lines.indexOf('set "VS_BUILD_EXIT=%ERRORLEVEL%"') < lines.indexOf('exit /b %VS_BUILD_EXIT%'));
  assert.match(source, /if not exist "%VS_SYSTEM_POWERSHELL%" \(\s*\r?\n\s*echo BUILD STOPPED:[^\r\n]*\r?\n\s*exit \/b 1\s*\r?\n\)/);
  const invokes = lines.filter(line => /powershell\.exe\s+-|"%VS_SYSTEM_POWERSHELL%"\s+-/i.test(line));
  assert.deepEqual(invokes, [INVOKE], 'one exact reviewed bootstrap invocation only');
  assert.doesNotMatch(lines.join('\n'), /^\s*where\s+powershell(?:\.exe)?\b/im);
  assert.doesNotMatch(lines.join('\n'), /^\s*(?:call\s+)?(?:npm(?:\.cmd)?|cargo|tauri|node)\s+/im);
}

test('CMD invokes only Windows system PowerShell, not PATH/current-directory executables', () => {
  assertDelegation(cmd);
});

test('system PowerShell path is quoted and script path is relative to the launcher itself', () => {
  assert.match(cmd, /set "VS_SYSTEM_POWERSHELL=%SystemRoot%\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe"/);
  assert.ok(cmd.includes(INVOKE));
  assert.doesNotMatch(operationalLines(cmd).join('\n'), /(?:-ExecutionPolicy|Set-ExecutionPolicy|--disable-web-security)/i);
});

test('missing Windows-supplied PowerShell fails closed without invoking another executable', () => {
  const lines = operationalLines(cmd);
  const missing = lines.indexOf('if not exist "%VS_SYSTEM_POWERSHELL%" (');
  assert.ok(missing >= 0);
  assert.ok(missing < lines.indexOf(INVOKE));
  assert.ok(lines.indexOf('exit /b 1') > missing);
  assert.ok(lines.indexOf('exit /b 1') < lines.indexOf(INVOKE));
});

test('CMD returns exactly the delegated PowerShell process exit code', () => {
  const lines = operationalLines(cmd);
  assert.equal(lines.at(-2), 'set "VS_BUILD_EXIT=%ERRORLEVEL%"');
  assert.equal(lines.at(-1), 'exit /b %VS_BUILD_EXIT%');
});

test('PATH-based PowerShell fallback and unquoted executable are rejected', () => {
  const unqualified = cmd.replace(INVOKE,
    'powershell.exe -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"');
  assert.notEqual(unqualified, cmd);
  assert.throws(() => assertDelegation(unqualified));
  const unquoted = cmd.replace(INVOKE,
    '%VS_SYSTEM_POWERSHELL% -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"');
  assert.notEqual(unquoted, cmd);
  assert.throws(() => assertDelegation(unquoted));
});

test('skipping the existence guard or losing the subprocess exit code is rejected', () => {
  const noGuard = cmd.replace('if not exist "%VS_SYSTEM_POWERSHELL%" (', 'if exist "%VS_SYSTEM_POWERSHELL%" (');
  assert.notEqual(noGuard, cmd);
  assert.throws(() => assertDelegation(noGuard));
  const noExit = cmd.replace('exit /b %VS_BUILD_EXIT%', 'exit /b 0');
  assert.notEqual(noExit, cmd);
  assert.throws(() => assertDelegation(noExit));
});

test('the single PowerShell bootstrap still audits IPC, CSS and native executable after a locked build', () => {
  const stages = [
    "'npm.cmd' @('ci')",
    "'npm.cmd' @('test')",
    "'npm.cmd' @('run', 'verify:ipc')",
    "'npm.cmd' @('run', 'doctor:build')",
    "'npm.cmd' @('run', 'build:ui')",
    "'npm.cmd' @('run', 'verify:css')",
    "'cargo' @('test', '--locked')",
    "'npm.cmd' @('exec', '--offline', '--', 'tauri', 'build')",
    "'npm.cmd' @('run', 'doctor:verify')",
    "'node' @('scripts/verify-windows-pe.mjs')",
  ];
  const at = stages.map(stage => ps.indexOf(stage));
  assert.ok(at.every(x => x >= 0), 'a required PowerShell gate is absent');
  assert.deepEqual(at, [...at].sort((a,b) => a-b), 'PowerShell safety gates moved out of order');
  assert.match(ps, /if \(\$LASTEXITCODE -ne 0\) \{/);
  assert.doesNotMatch(ps, /Invoke-Step[^\r\n]*'run', 'tauri:build'/);
});
