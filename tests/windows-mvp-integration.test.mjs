import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_UI_PREFERENCES, UI_PREFERENCES_KEY,
  loadUiPreferences, saveUiPreferences,
} from '../src/app/ui-preferences.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const json = path => JSON.parse(read(path));

test('both Angular build variants require local bundle and privacy verification', () => {
  const scripts = json('package.json').scripts;
  assert.match(scripts['build:ui'], /ng build desktop && npm run verify:bundle$/);
  assert.match(scripts['build:ui:private'], /ng build desktop --configuration private-artwork && npm run verify:bundle:private$/);
  assert.equal(scripts['verify:bundle'], 'node scripts/verify-offline-bundle.mjs && npm run verify:privacy');
  assert.equal(scripts['verify:bundle:private'], 'node scripts/verify-offline-bundle.mjs --private && npm run verify:privacy');
  assert.equal(scripts['verify:privacy'], 'node scripts/verify-build-privacy.mjs');
  assert.equal(scripts['verify:ipc'], 'node scripts/verify-native-ipc.mjs');
  assert.equal(scripts.check, 'npm run test && npm run verify:ipc && npm run build:ui');
  assert.match(read('scripts/verify-native-ipc.mjs'), /desktop_runtime_info/);
});

test('offline bundle verifier requires valid root, base, CSS, JS and exact synthetic assets', () => {
  const script = read('scripts/verify-offline-bundle.mjs');
  for (const helper of [
    'verifyDesktopAppRoot(html)',
    'verifyDesktopBaseHref(html)',
    'inspectDesktopStyles(bundle)',
    'inspectDesktopScripts(bundle)',
  ]) assert.ok(script.includes(helper), helper);
  const indexes = ['verifyDesktopAppRoot(html)', 'verifyDesktopBaseHref(html)',
    'inspectDesktopStyles(bundle)', 'inspectDesktopScripts(bundle)'].map(value => script.indexOf(value));
  assert.ok(indexes.every(index => index >= 0));
  assert.deepEqual([...indexes].sort((a,b) => a-b), indexes);
  assert.match(script, /createHash\('sha256'\)/);
  assert.match(script, /'Offline bundle contains unexpected or missing assets'/);
  const privateScript = read('scripts/verify-build-privacy.mjs');
  assert.match(privateScript, /DENIED_EXTENSION/);
  assert.match(privateScript, /auditBuildPrivacy/);
});

test('source Angular, global styles and native Tauri output target the same offline app', () => {
  const html = read('src/index.html');
  const angular = json('angular.json');
  const tauri = json('src-tauri/tauri.conf.json');
  assert.match(html, /<base href="\/"/);
  assert.match(html, /<vs-desktop-app><\/vs-desktop-app>/);
  assert.equal(angular.projects.desktop.architect.build.options.outputPath, 'dist/desktop');
  assert.equal(tauri.build.frontendDist, '../dist/desktop/browser');
  assert.equal(angular.projects.desktop.architect.build.options.optimization.styles.inlineCritical, false);
  assert.ok(angular.projects.desktop.architect.build.options.styles.includes('src/styles.css'));
  assert.match(read('src/styles.css'), /vs-desktop-app/);
  assert.equal(tauri.bundle.active, false);
  assert.ok(tauri.app.security.csp.includes("script-src 'self'"));
  assert.ok(!tauri.app.security.csp.includes("'unsafe-eval'"));
});

test('native IPC audit and current Rust protocol remain present alongside UI features', () => {
  const ipc = read('scripts/verify-native-ipc.mjs');
  const app = read('src/app/desktop-app.component.ts');
  assert.match(ipc, /search_offline_places/);
  assert.match(ipc, /desktop_runtime_info/);
  assert.match(app, /inspectDesktopRuntime\(\)/);
  assert.match(app, /OfflineCityPickerComponent/);
  assert.doesNotMatch(app, /\b(?:fetch|localStorage|sessionStorage)\s*\(/);
});

test('device-only preferences round-trip without recording any account or birth data', () => {
  let value = null;
  const store = {
    getItem(key) { assert.equal(key,UI_PREFERENCES_KEY); return value; },
    setItem(key,updated) { assert.equal(key,UI_PREFERENCES_KEY); value=updated; },
  };
  assert.deepEqual(loadUiPreferences(null),DEFAULT_UI_PREFERENCES);
  assert.equal(saveUiPreferences(store,{
    theme:'dark',locale:'en',birthDate:'1999-01-01',token:'do-not-store'
  }),true);
  assert.deepEqual(JSON.parse(value),{version:1,theme:'dark',locale:'en'});
  assert.deepEqual(loadUiPreferences(store),{theme:'dark',locale:'en'});
  value='{"version":999,"theme":"dark","locale":"en"}';
  assert.deepEqual(loadUiPreferences(store),DEFAULT_UI_PREFERENCES);
});

test('the composed Angular shell restores preferences and preserves hotkeys, localized errors and inspector', () => {
  const app = read('src/app/desktop-app.component.ts');
  assert.match(app, /browserUiPreferencesStorage\(\)/);
  assert.match(app, /loadUiPreferences\(this\.uiPreferencesStorage\)/);
  assert.match(app, /saveUiPreferences\(this\.uiPreferencesStorage/);
  assert.match(app, /theme: UiTheme = this\.initialUiPreferences\.theme/);
  assert.match(app, /locale: Locale = this\.initialUiPreferences\.locale/);
  assert.match(app, /document\.documentElement\.lang = this\.locale/);
  assert.ok((app.match(/this\.persistUiPreferences\(\);/g) ?? []).length >= 2);
  assert.match(app, /HostListener\('window:keydown'/);
  assert.match(app, /parseDesktopShortcut\(event\)/);
  assert.match(app, /formatEclipticLongitude\(value, this\.locale\)/);
  assert.match(app, /displayMessage\(this\.locale, this\.error\)/);
});

test('both safe fictional exports and required VirgoStars attribution remain visible in composed UI', () => {
  const app = read('src/app/desktop-app.component.ts');
  const template = read('src/app/desktop-app.component.html');
  const strings = read('src/app/translations.ts');
  const png = app.slice(app.indexOf('async exportPng()'),app.indexOf('exportSyntheticCsv():'));
  assert.match(png, /validatePngDataUrl\(png\)/);
  assert.match(png, /syntheticPngFilename\(exportMode,\s*exportTheme\)/);
  assert.match(png, /requestSyntheticPngDownload\(safePng,\s*safeFilename/);
  assert.match(app, /buildSyntheticChartCsv\(this\.planets, this\.houses\)/);
  assert.match(app, /createSyntheticCsvBrowserPort\(\{/);
  assert.match(template, /exportPng\(\)/);
  assert.match(template, /exportSyntheticCsv\(\)/);
  assert.match(template, /Powered by VirgoStars/);
  assert.match(template, /https:\/\/www\.virgostars\.it\//);
  assert.match(template, /csvStatusLabel/);
  assert.match(template, /t\('shortcuts\.title'\)/);
  assert.equal((strings.match(/"export\.csv":/g) ?? []).length,2);
  assert.equal((strings.match(/"settings\.help":/g) ?? []).length,2);
});

test('current CPAL notices and source publication gate are preserved', () => {
  const license = read('LICENSE');
  const notice = read('NOTICE');
  const policy = read('docs/LICENSING_AND_PUBLICATION.md');
  assert.match(license, /Common Public Attribution License/i);
  assert.match(notice, /VirgoStars/);
  assert.match(policy, /city|dataset|catalog/i);
  assert.match(read('AGENTS.md'), /CPAL-1\.0/);
});

test('native capability timeout must register outside Promise executor before IPC dispatch', () => {
  const runtime = read('src/app/native/runtime-protocol.ts');
  const regression = read('tests/native-runtime.test.mjs');
  const timerStart = runtime.indexOf('handle = timers.set(');
  const invocationStart = runtime.indexOf("const invocation = Promise.resolve().then(() => transport.invoke('desktop_runtime_info'))");
  assert.ok(timerStart >= 0 && invocationStart > timerStart,
    'timer must be registered before the native invocation microtask');
  assert.match(runtime, /if \(firedSynchronously\) throw new Error\('Native runtime probe timeout'\)/);
  assert.match(runtime, /void timeout\.catch\(\(\) => \{\}\)/);
  assert.match(regression, /deadline registration failure never starts an unbounded native IPC invocation/);
  assert.match(regression, /scheduler that invokes its callback and then throws never dispatches IPC/);
});
