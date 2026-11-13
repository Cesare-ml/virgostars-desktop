import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const bootstrap = read('scripts/build-windows-spike.ps1');
const scripts = JSON.parse(read('package.json')).scripts;

function orderedSteps(source) {
  // Source-level contract only; the PowerShell script is executed on Windows.
  return [...source.matchAll(/Invoke-Step\s+'([^']+)'\s+'([^']+)'\s+@\(([^)]*)\)/g)]
    .map(([,description,binary,argumentsText])=>({description,binary,argumentsText}));
}

function indexOfStep(steps, binary, argumentsText) {
  return steps.findIndex(step => step.binary===binary && step.argumentsText===argumentsText);
}

test('bootstrap runs native IPC audit after tests and before any native build',()=>{
  const steps=orderedSteps(bootstrap);
  const stages=[
    ["'test'","npm.cmd"],
    ["'run', 'verify:ipc'","npm.cmd"],
    ["'run', 'doctor:build'","npm.cmd"],
    ["'run', 'build:ui'","npm.cmd"],
    ["'run', 'verify:css'","npm.cmd"],
    ["'run', 'prepare:icon'","npm.cmd"],
    ["'test'","cargo"],
    ["'exec', '--offline', '--', 'tauri', 'build'","npm.cmd"],
    ["'run', 'doctor:verify'","npm.cmd"],
  ];
  const positions=stages.map(([args,binary])=>indexOfStep(steps,binary,args));
  assert.ok(positions.every(x=>x>=0),'missing required native acceptance stage');
  assert.deepEqual(positions,[...positions].sort((a,b)=>a-b),
    'native audit or CSS check moved after packaging');
  assert.equal(new Set(positions).size,positions.length,'duplicate acceptance stage');
});

test('native IPC and CSS audit scripts are real, local-only npm commands',()=>{
  assert.equal(scripts['verify:ipc'],'node scripts/verify-native-ipc.mjs');
  assert.equal(scripts['verify:css'],'node scripts/verify-bundled-css.mjs');
  assert.equal((bootstrap.match(/@\( 'run', 'verify:ipc' \)/g)||[]).length,0);
  assert.equal((bootstrap.match(/@\( 'run', 'verify:css' \)/g)||[]).length,0);
  assert.equal((bootstrap.match(/'run', 'verify:ipc'/g)||[]).length,1);
  assert.equal((bootstrap.match(/'run', 'verify:css'/g)||[]).length,1);
  assert.doesNotMatch(bootstrap,/--config|capabilities\s*=\s*\[|--disable-web-security/);
});

test('PowerShell script retains strict failure handling and clean location restoration',()=>{
  assert.match(bootstrap,/Set-StrictMode -Version Latest/);
  assert.match(bootstrap,/\$ErrorActionPreference\s*=\s*'Stop'/);
  assert.match(bootstrap,/if\s*\(\$LASTEXITCODE\s+-ne\s+0\)\s*\{/);
  assert.match(bootstrap,/throw "\$Description failed/);
  const pushes=(bootstrap.match(/\bPush-Location\b/g)||[]).length;
  const pops=(bootstrap.match(/\bPop-Location\b/g)||[]).length;
  assert.equal(pushes,pops);
  assert.ok(pushes>=4);
});

test('a missing or misordered native audit fails the acceptance stage contract',()=>{
  const stages=orderedSteps(bootstrap);
  const expectSequence=source=>{
    const items=orderedSteps(source);
    const testIndex=indexOfStep(items,'npm.cmd',"'test'");
    const auditIndex=indexOfStep(items,'npm.cmd',"'run', 'verify:ipc'");
    const rustIndex=indexOfStep(items,'cargo',"'test'");
    assert.ok(testIndex>=0 && auditIndex>testIndex && rustIndex>auditIndex);
  };
  expectSequence(bootstrap);
  assert.throws(()=>expectSequence(bootstrap.replace("'run', 'verify:ipc'","'run', 'doctor'")));
  assert.throws(()=>expectSequence(bootstrap.replace(
    "    Invoke-Step 'Audit native IPC commands and Tauri capabilities' 'npm.cmd' @('run', 'verify:ipc')\n",
    ""
  )));
});

test('Windows build instructions explicitly require native and CSS source gates',()=>{
  const docs=read('docs/WINDOWS_BUILD_GATE.md');
  assert.match(docs,/npm\.cmd run verify:ipc/);
  assert.match(docs,/npm\.cmd run verify:css/);
  assert.match(docs,/does not prove|not prove|not a native runtime check/i);
});


test('bootstrap packages the exact validated Angular bundle without a second UI build',()=>{
  const steps=orderedSteps(bootstrap);
  const ui=indexOfStep(steps,'npm.cmd',"'run', 'build:ui'");
  const css=indexOfStep(steps,'npm.cmd',"'run', 'verify:css'");
  const tauri=indexOfStep(steps,'npm.cmd',"'exec', '--offline', '--', 'tauri', 'build'");
  assert.ok(ui >= 0 && css > ui && tauri > css,
    'Tauri must package the existing validated frontend');
  assert.equal(steps.filter(step=>step.argumentsText==="'run', 'build:ui'").length,1);
  assert.equal(steps.filter(step=>step.argumentsText==="'run', 'tauri:build'").length,0,
    'npm run tauri:build would rebuild Angular after CSS validation');
  assert.equal(steps.filter(step=>step.argumentsText==="'exec', '--offline', '--', 'tauri', 'build'").length,1);
  // The existing general-purpose npm script intentionally rebuilds Angular.
  // It must not be used here after the independent bundle checks.
  assert.ok(scripts['tauri:build'].includes('npm run build:ui'));
  const tauriConfig=JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.equal(tauriConfig.build.frontendDist,'../dist/desktop/browser');
  assert.ok(!tauriConfig.build.beforeBuildCommand,
    'a Tauri beforeBuildCommand would rebuild or change the verified frontend');
});

test('a command replacing the offline Tauri CLI fails the single-build gate',()=>{
  const candidate=bootstrap.replace(
    "Invoke-Step 'Compile previously verified Angular/Tauri prototype' 'npm.cmd' @('exec', '--offline', '--', 'tauri', 'build')",
    "Invoke-Step 'Compile and verify Angular/Tauri prototype' 'npm.cmd' @('run', 'tauri:build')"
  );
  assert.notEqual(candidate,bootstrap);
  const steps=orderedSteps(candidate);
  assert.equal(indexOfStep(steps,'npm.cmd',"'exec', '--offline', '--', 'tauri', 'build'"),-1);
  assert.ok(indexOfStep(steps,'npm.cmd',"'run', 'tauri:build'")>=0);
});
