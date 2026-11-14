import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source = readFileSync(new URL('../scripts/smoke-windows-native.ps1', import.meta.url), 'utf8');

test('GUI smoke is explicit, Windows-only and cannot accept an arbitrary executable path', () => {
  assert.match(source,/param\(\s*\[switch\] \$Interactive,\s*\[ValidateRange\(2, 30\)\] \[int\] \$WindowWaitSeconds = 15/s);
  assert.match(source,/\[System\.Environment\]::OSVersion\.Platform -ne \[System\.PlatformID\]::Win32NT/);
  assert.match(source,/src-tauri\\target\\release\\virgostars-desktop-spike\.exe/);
  assert.doesNotMatch(source,/\[string\]\s*\$Exe(?:cutable)?Path\b/);
});

test('all read-only gates run in strict order before launching the local binary', () => {
  const expected = [
    "Invoke-ReadOnlyGate 'VERSION' 'scripts/verify-desktop-version.mjs'",
    "Invoke-ReadOnlyGate 'TAURI_SECURITY' 'scripts/verify-tauri-security-config.mjs'",
    "Invoke-ReadOnlyGate 'NATIVE_IPC' 'scripts/verify-native-ipc.mjs'",
    "Invoke-ReadOnlyGate 'OFFLINE_BUNDLE' 'scripts/verify-offline-bundle.mjs'",
    "Invoke-ReadOnlyGate 'BUNDLED_CSS' 'scripts/verify-bundled-css.mjs'",
    "Invoke-ReadOnlyGate 'COMPONENT_STYLES' 'scripts/verify-component-styles.mjs'",
    "Invoke-ReadOnlyGate 'WINDOWS_PE' 'scripts/verify-windows-pe.mjs'",
    'Start-Process -FilePath $exe -WorkingDirectory $root -PassThru',
  ];
  let previous = -1;
  for (const step of expected) {
    const next = source.indexOf(step);
    assert.ok(next > previous, step);
    previous = next;
  }
  assert.match(source,/\$LASTEXITCODE -ne 0/);
  assert.match(source,/& node \$Path \*> \$null/);
  assert.match(source,/throw \('NATIVE_SMOKE_PREFLIGHT_FAILED_' \+ \$Label\)/);
});

test('process observation distinguishes a native GUI window from a merely present executable', () => {
  assert.match(source,/Start-Process[\s\S]*-PassThru/);
  assert.match(source,/System\.Diagnostics\.Stopwatch/);
  assert.match(source,/Start-Sleep -Milliseconds 250/);
  assert.match(source,/\.Refresh\(\)/);
  assert.match(source,/\.HasExited/);
  assert.match(source,/\.MainWindowHandle -ne \[IntPtr\]::Zero/);
  assert.match(source,/NATIVE_SMOKE_NO_MAIN_WINDOW/);
  assert.match(source,/NATIVE_SMOKE_WINDOW_DETECTED/);
});

test('manual visual acceptance cannot be inferred from detecting only a window handle', () => {
  assert.match(source,/NOT YET VERIFIED: visible UI/);
  assert.match(source,/if \(-not \$Interactive\)/);
  assert.match(source,/For a manual visual checklist, rerun with -Interactive/);
  for (const key of ['styles','chart','themes','modes','export','places','offline']) {
    assert.match(source,new RegExp("Key = '" + key + "'"));
  }
  assert.match(source,/Read-Host/);
  assert.match(source,/if \(\$failures\.Count -gt 0\)/);
  assert.match(source,/NATIVE_SMOKE_MANUAL_FAILED/);
  assert.match(source,/NATIVE_SMOKE_MANUAL_PASSED/);
});

test('smoke script leaves the app available for inspection and records no personal reports', () => {
  assert.doesNotMatch(source,/Stop-Process|Remove-Item|Out-File|Set-Content|Add-Content|Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|Start-Transcript/);
  assert.doesNotMatch(source,/https?:\/\/[^\s]+/);
  assert.match(source,/leaves the experimental app running/);
});

test('both successful and failing paths avoid exposing native OS exception details', () => {
  assert.match(source,/throw 'NATIVE_SMOKE_LAUNCH_FAILED'/);
  assert.match(source,/throw 'NATIVE_SMOKE_PROCESS_UNAVAILABLE'/);
  assert.match(source,/NATIVE_SMOKE_WINDOWS_ONLY/);
  assert.doesNotMatch(source,/Write-(?:Host|Error|Output)[^\n]*\$_\.Exception/);
});
