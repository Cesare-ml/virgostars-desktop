import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const app = read('src/app/desktop-app.component.ts');
const template = read('src/app/desktop-app.component.html');
const translations = read('src/app/translations.ts');
const clock = read('src/app/device-clock.ts');
const runtime = read('src/app/native/runtime-check-controller.ts');

const occurrences = (source, term) => source.split(term).length - 1;

function sourceBetween(start, end) {
  const begin = app.indexOf(start);
  const finish = app.indexOf(end, begin + start.length);
  assert.ok(begin >= 0 && finish > begin, 'Angular lifecycle methods must be present');
  return app.slice(begin, finish);
}

test('the integrated startup owns both the clock listener and read-only native probe', () => {
  const startup = sourceBetween('ngAfterViewInit(): void {', '  checkRuntime(): void {');
  assert.match(startup, /document\.addEventListener\('visibilitychange', this\.onVisibilityChange\)/);
  assert.match(startup, /this\.onVisibilityChange\(\)/);
  assert.match(startup, /this\.checkRuntime\(\)/);
  assert.equal(occurrences(app, "document.addEventListener('visibilitychange'"), 1);
  assert.equal(occurrences(app, 'new DeviceClock()'), 1);
  assert.equal(occurrences(app, 'new RuntimeCheckController('), 1);
});

test('teardown removes clock listener and disposes both independent services', () => {
  const teardown = sourceBetween('ngOnDestroy(): void {', '  private fitStage(): void {');
  assert.match(teardown, /this\.destroyed = true;/);
  assert.match(teardown, /document\.removeEventListener\('visibilitychange', this\.onVisibilityChange\)/);
  assert.match(teardown, /this\.deviceClock\.dispose\(\)/);
  assert.match(teardown, /this\.runtimeCheck\.dispose\(\)/);
  assert.equal(occurrences(app, "document.removeEventListener('visibilitychange'"), 1);
});

test('a hidden WebView pauses only the device timer and a visible one resamples wall time', () => {
  const visibility = sourceBetween('private readonly onVisibilityChange =', '  readonly artworkStatus:');
  assert.match(visibility, /if \(this\.destroyed\) return;/);
  assert.match(visibility, /document\.visibilityState === 'hidden'/);
  assert.match(visibility, /this\.deviceClock\.pause\(\)/);
  assert.match(visibility, /this\.deviceClock\.start\(this\.onClockChanged\)/);
  assert.match(clock, /if \(generation === this\.generation\) this\.invalidateTime\(changed\);/);
});

test('runtime retry remains single-flight, bilingual and button-disabled when pending', () => {
  const check = sourceBetween('checkRuntime(): void {', '  ngOnDestroy(): void {');
  assert.match(check, /if \(this\.destroyed\) return;/);
  assert.match(check, /this\.runtimeCheck\.check\(\)/);
  assert.match(runtime, /if \(this\.disposed \|\| this\.checking\) return;/);
  assert.match(template, /\[disabled\]="runtimeChecking"/);
  assert.match(template, /\(click\)="checkRuntime\(\)"/);
  assert.match(template, /\[attr\.aria-label\]="t\('runtime\.retry'\)"/);
  assert.equal(occurrences(translations, '"runtime.label":'), 2);
  assert.equal(occurrences(translations, '"runtime.retry":'), 2);
});

test('integration does not introduce hidden network fallback or claim astronomy readiness', () => {
  assert.match(app, /\(\) => inspectDesktopRuntime\(\)/);
  assert.match(template, /t\('fixture'\)/);
  assert.match(runtime, /result\.kind === 'desktop_demo'/);
  assert.doesNotMatch(runtime, /\bfetch\(|\bXMLHttpRequest\b|\blocalStorage\b/);
  assert.doesNotMatch(app, /\binvoke\(['"]desktop_runtime_info/);
});
