import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const layoutProbe = readFileSync(new URL('../src/app/desktop-layout-probe.ts', import.meta.url), 'utf8');
const template = readFileSync(new URL('../src/app/desktop-app.component.html', import.meta.url), 'utf8');
const translations = readFileSync(new URL('../src/app/translations.ts', import.meta.url), 'utf8');

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
    "Invoke-ReadOnlyGate 'BUNDLE_FRESHNESS' 'scripts/verify-native-bundle-freshness.mjs'",
    'Start-Process -FilePath $exe -WorkingDirectory $root -PassThru',
  ];
  let previous = -1;
  for (const step of expected) {
    const next = source.indexOf(step);
    assert.ok(next > previous, step);
    previous = next;
  }
  assert.match(source,/\$LASTEXITCODE -ne 0/);
  assert.match(source,/& \$nodeExe \$Path \*> \$null/);
  assert.match(source,/throw \('NATIVE_SMOKE_PREFLIGHT_FAILED_' \+ \$Label\)/);
});

test('preflight uses an application node.exe, not a PowerShell alias or script', () => {
  assert.match(source,/Get-Command -Name 'node\.exe' -CommandType Application -ErrorAction SilentlyContinue/);
  assert.match(source,/\$nodeExe = \$nodeCommand\.Source/);
  assert.match(source,/\[System\.IO\.Path\]::IsPathRooted\(\$nodeCommand\.Source\)/);
  assert.match(source,/throw 'NATIVE_SMOKE_NODE_REQUIRED'/);
  assert.match(source,/& \$nodeExe \$Path \*> \$null/);
  assert.doesNotMatch(source,/& node \$Path/);
});

test('native preflight invocation errors are redacted and fail closed', () => {
  const start = source.indexOf('function Invoke-ReadOnlyGate {');
  const end = source.indexOf('Push-Location $root', start);
  assert.ok(start >= 0 && end > start);
  const gate = source.slice(start, end);
  assert.match(gate,/try \{\s*& \$nodeExe \$Path \*> \$null\s*\}\s*catch \{\s*throw \('NATIVE_SMOKE_PREFLIGHT_FAILED_' \+ \$Label\)\s*\}/);
  assert.match(gate,/if \(\$LASTEXITCODE -ne 0\) \{\s*throw \('NATIVE_SMOKE_PREFLIGHT_FAILED_' \+ \$Label\)/);
  assert.doesNotMatch(gate,/\$ErrorActionPreference\s*=\s*['"]Continue['"]/);
  assert.doesNotMatch(gate,/Write-(?:Host|Error|Output)[^\n]*\$_/);
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

test('a transient window handle must survive a second observation before success', () => {
  const first = source.indexOf('if ($appProcess.MainWindowHandle -ne [IntPtr]::Zero)');
  const second = source.indexOf('if ($foundWindow) {', first);
  const cleanup = source.indexOf('if (-not $foundWindow) {', second);
  const success = source.indexOf("Write-Host 'NATIVE_SMOKE_WINDOW_DETECTED");
  assert.ok(first > 0 && second > first && cleanup > second && success > cleanup);
  const recheck = source.slice(second, cleanup);
  assert.match(recheck,/Start-Sleep -Milliseconds 250/);
  assert.match(recheck,/\$appProcess\.Refresh\(\)/);
  assert.match(recheck,/if \(\$appProcess\.HasExited\)/);
  assert.match(recheck,/elseif \(\$appProcess\.MainWindowHandle -eq \[IntPtr\]::Zero\)/);
  assert.match(recheck,/\$windowFailure = 'NATIVE_SMOKE_WINDOW_DISAPPEARED'/);
  assert.match(recheck,/\$foundWindow = \$false/);
  assert.match(recheck,/NATIVE_SMOKE_PROCESS_UNAVAILABLE/);
});

test('failed native window detection stops only its own launched process', () => {
  // A startup failure must not leave an unresponsive experimental process
  // running, but a successful GUI remains available for manual inspection.
  const failedWindow = source.indexOf('if (-not $foundWindow) {');
  const reportedSuccess = source.indexOf("Write-Host 'NATIVE_SMOKE_WINDOW_DETECTED");
  assert.ok(failedWindow > source.indexOf('Start-Process -FilePath $exe'));
  assert.ok(reportedSuccess > failedWindow);
  const failureBlock = source.slice(failedWindow, reportedSuccess);
  assert.match(failureBlock,/\$appProcess\.Refresh\(\)/);
  assert.match(failureBlock,/if \(-not \$appProcess\.HasExited\)/);
  assert.match(failureBlock,/\$appProcess\.Kill\(\)/);
  assert.match(failureBlock,/\[void\]\$appProcess\.WaitForExit\(2000\)/);
  assert.match(failureBlock,/throw \$windowFailure/);
  assert.match(source,/\$windowFailure = 'NATIVE_SMOKE_NO_MAIN_WINDOW'/);
  assert.match(source,/\$windowFailure = 'NATIVE_SMOKE_EARLY_EXIT'/);
  assert.match(source,/\$windowFailure = 'NATIVE_SMOKE_PROCESS_UNAVAILABLE'/);
  assert.doesNotMatch(source,/Stop-Process|Get-Process|taskkill(?:\.exe)?/i,
    'no unscoped process lookup or kill by name');
});

test('manual visual acceptance cannot be inferred from detecting only a window handle', () => {
  assert.match(source,/NOT YET VERIFIED: visible UI/);
  assert.match(source,/if \(-not \$Interactive\)/);
  assert.match(source,/For a manual visual checklist, rerun with -Interactive/);
  for (const key of ['styles','layout','chart','themes','modes','export','places','offline']) {
    assert.match(source,new RegExp("Key = '" + key + "'"));
  }
  assert.match(source,/Read-Host/);
  assert.match(source,/if \(\$failures\.Count -gt 0\)/);
  assert.match(source,/NATIVE_SMOKE_MANUAL_FAILED/);
  assert.match(source,/NATIVE_SMOKE_MANUAL_PASSED/);
});

test('manual GUI acceptance requires a live native main window before and after every answer', () => {
  const helper = source.slice(
    source.indexOf('function Test-SmokeMainWindowAlive {'),
    source.indexOf('# Intentionally no automation of keyboard/mouse'),
  );
  assert.match(helper,/param\(\[System\.Diagnostics\.Process\] \$Process\)/);
  assert.match(helper,/\$Process\.Refresh\(\)/);
  assert.match(helper,/-not \$Process\.HasExited -and \$Process\.MainWindowHandle -ne \[IntPtr\]::Zero/);
  assert.match(helper,/catch \{\s*return \$false/);

  const manual = source.slice(source.indexOf('foreach ($check in $checks) {'),
    source.indexOf('if ($failures.Count -gt 0)'));
  const before = manual.indexOf('if (-not (Test-SmokeMainWindowAlive -Process $appProcess))');
  const answer = manual.indexOf('$reply = Read-Host');
  const after = manual.indexOf('if (-not (Test-SmokeMainWindowAlive -Process $appProcess))', answer);
  assert.ok(before >= 0 && answer > before && after > answer,
    'each prompt must be surrounded by main-window liveness checks');
  assert.equal((manual.match(/Test-SmokeMainWindowAlive -Process \$appProcess/g) ?? []).length, 2);
  assert.equal((manual.match(/NATIVE_SMOKE_MANUAL_WINDOW_LOST/g) ?? []).length, 2);
  assert.match(manual,/try \{\s*\$reply = Read-Host[\s\S]*?catch \{\s*[\s\S]*?NATIVE_SMOKE_MANUAL_INPUT_UNAVAILABLE/);
  assert.ok(source.indexOf('NATIVE_SMOKE_MANUAL_PASSED') > source.indexOf('if ($failures.Count -gt 0)'));
  assert.doesNotMatch(helper,/Get-Process|Stop-Process|Write-(?:Host|Error|Output)[^\n]*\$_/);
});


test('manual CSS checkpoint is connected to the live computed-layout probe', () => {
  const line = source.split(/\r?\n/).find(line => line.includes("Key = 'layout'"));
  assert.ok(line, 'explicit layout checkpoint required');
  assert.match(line,/Layout diagnostics \/ Diagnostica layout/);
  assert.match(line,/Recheck styles \/ Ricontrolla stili/);
  assert.match(line,/Interface grid detected \/ Griglia dell\{0\}interfaccia rilevata/);
  assert.match(layoutProbe,/export type DesktopLayoutStatus = 'active' \| 'missing' \| 'hidden' \| 'collapsed' \| 'unavailable'/);
  assert.match(template,/\{\{t\(styleStatusKey\)\}\}/);
  assert.match(template,/\(click\)="checkStyles\(\)"/);
  assert.match(translations,/"styles\.active":"Griglia dell.interfaccia rilevata"/);
  assert.match(translations,/"styles\.active":"Interface grid detected"/);
  assert.match(translations,/"styles\.retry":"Ricontrolla stili"/);
  assert.match(translations,/"styles\.retry":"Recheck styles"/);
  assert.match(source,/all eight visual observations confirmed/);
});

test('Windows PowerShell 5.1 can parse ASCII-only source without an UTF-8 BOM', () => {
  // Windows PowerShell 5.1 may decode UTF-8 without a BOM as an ANSI code page.
  // Encode the curly apostrophe and accented reply using ASCII source only.
  assert.ok([...source].every(ch => ch.codePointAt(0) < 128), 'native smoke PS1 source must be ASCII');
  assert.match(source,/Griglia dell\{0\}interfaccia rilevata\?' -f \[char\]0x2019/);
  assert.match(source,/\$reply -notin @\('y', 'yes', 's', 'si', \('s' \+ \[char\]0x00EC\)\)/);
  assert.ok(translations.includes('Griglia dell' + String.fromCharCode(0x2019) + 'interfaccia rilevata'));
  assert.equal('s' + String.fromCharCode(0x00EC), 'sì');
});


test('smoke script leaves the app available for inspection and records no personal reports', () => {
  assert.doesNotMatch(source,/Stop-Process|Remove-Item|Out-File|Set-Content|Add-Content|Invoke-WebRequest|Invoke-RestMethod|Start-BitsTransfer|Start-Transcript/);
  assert.doesNotMatch(source,/https?:\/\/[^\s]+/);
  assert.match(source,/leaves the experimental app running/);
});

test('both successful and failing paths avoid exposing native OS exception details', () => {
  assert.match(source,/throw 'NATIVE_SMOKE_LAUNCH_FAILED'/);
  assert.match(source,/\$windowFailure = 'NATIVE_SMOKE_PROCESS_UNAVAILABLE'/);
  assert.match(source,/throw \$windowFailure/);
  assert.match(source,/NATIVE_SMOKE_WINDOWS_ONLY/);
  assert.doesNotMatch(source,/Write-(?:Host|Error|Output)[^\n]*\$_\.Exception/);
});
