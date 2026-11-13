import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const cmd = read('scripts/build-windows.cmd');
const ps1 = read('scripts/build-windows-spike.ps1');
const manifest = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));

function stages() {
  return [...ps1.matchAll(/Invoke-Step\s+'([^']+)'\s+'([^']+)'\s+@\(([^)]*)\)/g)]
    .map(([,description, binary, args]) => ({description,binary,args}));
}

test('committed npm lockfile has the exact root dependencies and scripts-compatible engines',()=>{
  assert.equal(lock.lockfileVersion,3);
  assert.equal(lock.name,manifest.name);
  assert.equal(lock.version,manifest.version);
  assert.deepEqual(lock.packages[''].dependencies,manifest.dependencies);
  assert.deepEqual(lock.packages[''].devDependencies,manifest.devDependencies);
  assert.deepEqual(lock.packages[''].engines,manifest.engines);
});

test('the CMD entrypoint delegates only to the reviewed PowerShell script',()=>{
  assert.match(cmd,/^@echo off\r?\n/);
  const launches=cmd.split(/\r?\n/).filter(line=>/^\s*powershell\.exe\s+/.test(line));
  assert.deepEqual(launches,
    ['powershell.exe -NoProfile -NonInteractive -File "%~dp0build-windows-spike.ps1"']);
  assert.match(cmd,/where powershell\.exe >nul 2>nul/);
  assert.match(cmd,/if errorlevel 1 \(/);
  assert.doesNotMatch(cmd,/\b(?:npm(?:\.cmd)?|cargo|rustc|tauri(?:\.exe)?)\b/i);
  assert.doesNotMatch(cmd,/(?:ExecutionPolicy|Invoke-WebRequest|Start-Process|curl\.exe)/i);
});

test('CMD returns the real PowerShell exit code rather than reporting false success',()=>{
  const invoke=cmd.indexOf('powershell.exe -NoProfile -NonInteractive -File');
  const record=cmd.indexOf('set "VS_BUILD_EXIT=%ERRORLEVEL%"');
  const finish=cmd.indexOf('exit /b %VS_BUILD_EXIT%');
  assert.ok(invoke>=0 && record>invoke && finish>record);
  assert.equal((cmd.match(/exit \/b %VS_BUILD_EXIT%/g)||[]).length,1);
  assert.equal((cmd.match(/powershell\.exe -NoProfile -NonInteractive -File/g)||[]).length,1);
});

test('the single Windows bootstrap uses npm ci for both public source trees',()=>{
  const steps=stages();
  const installSteps=steps.filter(x=>x.binary==='npm.cmd' &&
    (x.args==="'ci'" || x.args==="'install'"));
  assert.equal(installSteps.length,2);
  assert.ok(installSteps.every(x=>x.args==="'ci'"));
  assert.match(installSteps[0].description,/Charts dependencies/);
  assert.match(installSteps[1].description,/pinned Desktop dependencies/);
  assert.doesNotMatch(ps1,/\bnpm\.cmd' @\('install'\)|npm\.cmd install/);
  assert.ok(steps.findIndex(x=>x.args==="'run', 'build:ui'") >
    steps.findIndex(x=>x.args==="'ci'" && /pinned Desktop/.test(x.description)));
});

test('Cargo unit tests use --locked and run before one checked Tauri build',()=>{
  const steps=stages();
  const rust=steps.findIndex(x=>x.binary==='cargo');
  const tauri=steps.findIndex(x=>x.binary==='npm.cmd' &&
    x.args==="'exec', '--offline', '--', 'tauri', 'build'");
  assert.ok(rust>=0 && tauri>rust);
  assert.equal(steps[rust].args,"'test', '--locked'");
  assert.equal(steps.filter(x=>x.binary==='cargo').length,1);
  assert.equal(steps.filter(x=>x.args==="'run', 'build:ui'").length,1);
  assert.equal(steps.filter(x=>x.args==="'run', 'tauri:build'").length,0);
});

test('Windows contributor guide documents both equivalent entrypoints and locked installs',()=>{
  const guide=read('docs/WINDOWS_BUILD_GATE.md');
  assert.match(guide,/scripts\\build-windows\.cmd/);
  assert.match(guide,/scripts\\build-windows-spike\.ps1/);
  assert.match(guide,/npm\.cmd ci/);
  assert.match(guide,/cargo test --locked/);
  assert.match(guide,/already committed|committed lockfile|committed and reviewed/i);
  assert.doesNotMatch(guide,/npm\.cmd install|first real install\/build should create/i);
});
