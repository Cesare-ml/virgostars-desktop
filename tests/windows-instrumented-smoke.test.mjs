import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {evaluateSmoke, DEVTOOLS_PORT} from '../scripts/smoke-windows-instrumented.mjs';

const source = readFileSync(new URL('../scripts/smoke-windows-instrumented.mjs', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const good = () => ({
  styleSheets: [{href: '/styles.css', rules: 8}, {href: 'inline', rules: 109}],
  layout: {sidebar: {w: 60, h: 880}, inspector: {w: 344, h: 880}, canvas: {w: 872, h: 872}},
  webgl: {ok: true, lost: false},
  startupTitle: 'Cielo del momento',
  requests: ['http://tauri.localhost/', 'http://tauri.localhost/main.js', 'http://ipc.localhost/desktop_runtime_info'],
  exceptions: [],
  console: [],
  resize: {
    '1280x720': {stage: [540, 720], canvas: [524, 524], overflowX: false, overflowY: false},
    '1920x1080': {stage: [1032, 1080], canvas: [1016, 1016], overflowX: false, overflowY: false}
  },
  runtimeInfo: {protocolVersion: 1, fixtureKind: 'synthetic_demo', accountConnected: false, cloudSyncAvailable: false},
  calculation: {status: 'provider_unavailable', provider: null, chart: null},
  invalidCalculation: {status: 'invalid_request'},
  png: {bytes: 304_200, signatureOk: true},
  contextLoss: {lostAfterLose: true, lostAfterRestore: false}
});

test('a healthy synthetic default build passes with no failures', () => {
  assert.deepEqual(evaluateSmoke(good()), {failures: [], warnings: []});
});

test('each observable regression is reported by a stable identifier', () => {
  const cases = [
    ['CSS_NOT_APPLIED', o => { o.styleSheets = [{href: 'inline', rules: 109}]; }],
    ['LAYOUT_COLLAPSED', o => { o.layout.canvas = {w: 0, h: 0}; }],
    ['WEBGL_UNAVAILABLE', o => { o.webgl = {ok: false}; }],
    ['STARTUP_SKY_MISSING', o => { o.calculation = {status: 'ok', provider: {name: 'x'}, chart: {}}; o.startupTitle = 'Tema natale'; }],
    ['EXTERNAL_REQUEST', o => { o.requests.push('https://example.com/x.css'); }],
    ['PAGE_EXCEPTION', o => { o.exceptions.push('boom'); }],
    ['RESIZE_1280x720', o => { o.resize['1280x720'].overflowX = true; }],
    [['RESIZE_1920x1080', 'CHART_NOT_TALL_1920x1080'], o => { delete o.resize['1920x1080']; }],
    ['CHART_NOT_TALL_1280x720', o => { o.resize['1280x720'].canvas = [450, 450]; }],
    ['CHART_NOT_TALL_1280x720', o => { delete o.resize['1280x720'].stage; }],
    ['IPC_RUNTIME_INFO', o => { o.runtimeInfo = null; }],
    ['IPC_INVALID_REQUEST_ACCEPTED', o => { o.invalidCalculation = {status: 'ok'}; }],
    ['PNG_EXPORT', o => { o.calculation = {status: 'ok', provider: {name: 'x'}, chart: {}}; o.png = {bytes: 12, signatureOk: false}; }],
    ['WEBGL_CONTEXT_NOT_RECOVERED', o => { o.contextLoss = {lostAfterLose: true, lostAfterRestore: true}; }]
  ];
  for (const [id, mutate] of cases) {
    const observed = good();
    mutate(observed);
    assert.deepEqual(evaluateSmoke(observed).failures, [].concat(id), String(id));
  }
});

test('a calculation answer is truthful only when it is explicit unavailability or a real provider chart', () => {
  const fabricated = good();
  fabricated.calculation = {status: 'ok', provider: null, chart: {bodies: []}};
  assert.deepEqual(evaluateSmoke(fabricated).failures, ['IPC_CALCULATION_NOT_TRUTHFUL']);
  const real = good();
  real.calculation = {status: 'ok', provider: {name: 'local'}, chart: {bodies: []}};
  real.calculated = true;
  assert.deepEqual(evaluateSmoke(real).failures, []);
});

test('the blocked ipc.localhost fallback is a visible warning, not a silent pass or a failure', () => {
  const observed = good();
  observed.console = ['error: Connecting to http://ipc.localhost/chart_archive violates connect-src'];
  const {failures, warnings} = evaluateSmoke(observed);
  assert.deepEqual(failures, []);
  assert.match(warnings[0], /^IPC_CSP_FALLBACK/);
});

test('the instrumented smoke stays local, Windows-only and temporary', () => {
  assert.equal(Number.isInteger(DEVTOOLS_PORT), true);
  assert.match(source, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(source, /process\.platform !== 'win32'/);
  assert.match(source, /'src-tauri', 'target', 'release', 'virgostars-desktop-spike\.exe'/);
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\)/);
  assert.match(source, /rmSync\(work, \{recursive: true, force: true\}\)/);
  assert.match(source, /child\.kill\(\)/);
  assert.doesNotMatch(source, /captureScreenshot/);
  assert.doesNotMatch(source, /chart_archive/);
  assert.doesNotMatch(source, /fetch\(['"`]https?:\/\/(?!127\.0\.0\.1)/);
  assert.doesNotMatch(source, /process\.argv\[[2-9]\]/, 'no caller-supplied executable path');
});

test('npm exposes the instrumented smoke without making it part of the default checks', () => {
  assert.equal(pkg.scripts['smoke:native'], 'node scripts/smoke-windows-instrumented.mjs');
  assert.doesNotMatch(pkg.scripts.check, /smoke/);
  assert.doesNotMatch(pkg.scripts.test, /smoke-windows-instrumented/);
});
