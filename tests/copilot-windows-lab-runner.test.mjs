import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = name => readFileSync(new URL('../' + name, import.meta.url), 'utf8');
const runner = read('scripts/run-copilot-staging-lab.ps1');
const fixture = read('scripts/copilot-staging-fixture.mjs');
const cargo = read('src-tauri/Cargo.toml');
const lib = read('src-tauri/src/lib.rs');
const packageJson = JSON.parse(read('package.json'));

test('synthetic Windows lab requires explicit opt-in and never uses the production Tauri build entrypoint', () => {
  assert.match(runner, /\[switch\] \$SyntheticOnly/);
  assert.match(runner, /if \(-not \$SyntheticOnly\)/);
  assert.match(runner, /OSVersion\.Platform -ne \[System\.PlatformID\]::Win32NT/);
  assert.match(runner, /& \$tauri dev --features copilot-staging/);
  assert.doesNotMatch(runner, /npm\.cmd.*tauri:build|& \$tauri build/);
  assert.match(cargo, /copilot-staging = \["dep:reqwest"\]/);
  assert.match(lib, /cfg\(all\(debug_assertions, feature = "copilot-staging"\)\)/);
});

test('lab refuses inherited credentials and never puts its generated token on command arguments', () => {
  assert.match(runner, /foreach \(\$key in \$labEnvKeys\)/);
  assert.match(runner, /if \(Test-Path -Path \("Env:" \+ \$key\)\)/);
  assert.match(runner, /Refusing to overwrite pre-existing AI staging environment variables/);
  assert.match(runner, /randomBytes\(24\)\.toString\('base64url'\)/);
  assert.match(runner, /\$env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER = \$testBearer/);
  assert.match(runner, /Authorization = "Bearer \$testBearer"/);
  assert.doesNotMatch(runner, /-ArgumentList[^\n]*\$testBearer/);
  assert.doesNotMatch(runner, /Write-Host[^\n]*(?:\$testBearer|Authorization|\$env:VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER)/);
});

test('Angular dev server is started before fictional bearer exists and cannot inherit it', () => {
  const frontend = runner.indexOf("$frontendProcess = Start-Process -FilePath 'npm.cmd'");
  const token = runner.indexOf('$testBearer = (& node -e');
  assert.ok(frontend > 0 && frontend < token);
  assert.match(runner, /Wait-ForHttp -Url \$frontend/);
  assert.match(runner, /Test-PortAvailable 4200/);
  assert.match(runner, /Test-PortAvailable \$BackendPort/);
});

test('local HTTP readiness checks synthetic-only capabilities before Tauri starts', () => {
  const check = runner.indexOf('$capabilities = Wait-ForHttp');
  const startTauri = runner.indexOf('& $tauri dev --features copilot-staging');
  assert.ok(check > 0 && check < startTauri);
  for (const field of [
    "VirgoStarsCopilotPreviewCapabilities", "STAGING_SYNTHETIC",
    '$capabilities.providerEnabled -ne $false',
    '$capabilities.modelSelectorAvailable -ne $false',
  ]) assert.ok(runner.includes(field));
  assert.match(fixture, /server\.listen\(port, HOST, resolve\)/);
  assert.match(fixture, /const HOST = '127\.0\.0\.1'/);
});

test('cleanup shuts down only children started by this lab and drops temporary environment variables', () => {
  assert.match(runner, /finally \{\s*Stop-ChildTree \$fixture\s*Stop-ChildTree \$frontendProcess/);
  assert.match(runner, /& taskkill\.exe \/PID \$Child\.Id \/T \/F/);
  assert.match(runner, /Remove-Item -Path \("Env:" \+ \$key\)/);
  assert.match(runner, /Remove-Variable -Name testBearer/);
  assert.match(runner, /Pop-Location/);
});

test('lab HTTP probes bypass proxies, reject redirects and bound authenticated JSON', () => {
  assert.match(runner, /\$request\.Proxy = \$null/);
  assert.match(runner, /\$request\.AllowAutoRedirect = \$false/);
  assert.match(runner, /\$request\.Timeout = 2000/);
  assert.match(runner, /\$request\.ReadWriteTimeout = 2000/);
  assert.doesNotMatch(runner, /Invoke-RestMethod|Invoke-WebRequest/);
  assert.match(runner, /\$uri\.Host -ne '127\.0\.0\.1'/);
  assert.match(runner, /\$uri\.AbsolutePath -ne '\/api\/v1\/ai\/copilot-preview\/capabilities'/);
  assert.match(runner, /\$response\.ContentLength -gt 8192/);
  assert.match(runner, /\$memory\.Length \+ \$read -gt 8192/);
  assert.match(runner, /ConvertFrom-Json -InputObject \$content -ErrorAction Stop/);
  assert.match(runner, /-ExpectJson -Headers @\{/);
});

test('port preflight binds exclusively instead of contacting an arbitrary existing listener', () => {
  assert.match(runner, /\[System\.Net\.Sockets\.TcpListener\]::new\(/);
  assert.match(runner, /\$listener\.ExclusiveAddressUse = \$true/);
  assert.match(runner, /\$listener\.Start\(\)/);
  assert.match(runner, /\$listener\.Stop\(\)/);
  assert.doesNotMatch(runner, /TcpClient|BeginConnect|EndConnect/);
});

test('runner requires a fresh cryptographic session challenge before Tauri starts', () => {
  assert.match(runner, /'VIRGOSTARS_COPILOT_FIXTURE_SESSION'/);
  assert.match(runner, /randomBytes\(16\)\.toString\('hex'\)/);
  assert.match(runner, /\$labSession -notmatch '\^\[a-f0-9\]\{32\}\$'/);
  assert.match(runner, /\$env:VIRGOSTARS_COPILOT_FIXTURE_SESSION = \$labSession/);
  assert.match(runner, /\$capabilities\.labSession -cne \$labSession/);
  assert.match(runner, /Remove-Variable -Name labSession -ErrorAction SilentlyContinue/);
  const bind = runner.indexOf('$capabilities.labSession -cne $labSession');
  const run = runner.indexOf('& $tauri dev --features copilot-staging');
  assert.ok(bind > 0 && bind < run);
  assert.doesNotMatch(runner, /Write-Host[^\n]*\$labSession/);
  assert.doesNotMatch(runner, /-ArgumentList[^\n]*\$labSession/);
});

test('loopback fixture returns its required launch session ID only in mock capabilities', () => {
  assert.match(fixture, /typeof labSession !== 'string'/);
  assert.match(fixture, /labSession, actions: \['describe_focus'\]/);
  assert.match(fixture, /labSession: process\.env\.VIRGOSTARS_COPILOT_FIXTURE_SESSION/);
  assert.match(fixture, /JWT authentication mechanism/);
});

test('preflight validates Rust dev and release configurations before exposing a fictional test token', () => {
  const preflight = runner.indexOf("Invoke-Checked 'Rust formatting'");
  const tests = runner.indexOf("Invoke-Checked 'Rust debug staging feature tests'");
  const release = runner.indexOf("Invoke-Checked 'Rust release compilation");
  const bearer = runner.indexOf('$testBearer = (& node -e');
  assert.ok(preflight > 0 && preflight < tests && tests < release && release < bearer);
  assert.match(runner, /'cargo' @\('test', '--features', 'copilot-staging'\)/);
  assert.match(runner, /'cargo' @\('check', '--release', '--features', 'copilot-staging'\)/);
  assert.match(runner, /'npm\.cmd' @\('run', 'test:ai:fixture'\)/);
  assert.match(packageJson.scripts['test:ai:fixture'], /--experimental-strip-types/);
});
