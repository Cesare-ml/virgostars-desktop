import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {FUNCTION_CATALOG, functionMenu, pendingSettings, SETTINGS_GROUP_ID} from '../src/app/function-catalog.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('src/app/desktop-app.component.html');
const settingsHtml = read('src/app/chart-settings.component.html');
const css = read('src/app/desktop-app.component.css');
const settingsCss = read('src/app/chart-settings.component.css');

test('the Functions drawer does not repeat what the left menu already offers', () => {
  const menu = functionMenu();
  const listed = [...menu.active, ...menu.pending].flatMap(group => group.entries);
  const repeated = ['new-chart', 'session-charts', 'archive', 'natal', 'latitudes', 'synastry', 'real-time', 'transits'];
  for (const id of repeated) assert.ok(!listed.some(entry => entry.id === id), id);
  // The remaining tools include returns and the optional private Monomeri view.
  assert.deepEqual(listed.filter(entry => entry.status === 'available').map(entry => entry.id).sort(),
    ['lunar-return', 'monomoiria', 'solar-return']);
});

test('settings are not in the Functions drawer, and nothing out of scope is shown anywhere', () => {
  const menu = functionMenu();
  const groups = [...menu.active, ...menu.pending];
  assert.ok(!groups.some(group => group.id === SETTINGS_GROUP_ID));
  assert.ok(!groups.some(group => group.id === 'excluded'));
  assert.ok(groups.every(group => group.entries.every(entry => entry.status !== 'excluded')));
  // Active groups have something to run; pending groups have nothing.
  assert.ok(menu.active.every(group => group.entries.some(entry => entry.status === 'available')));
  assert.ok(menu.pending.every(group => group.entries.every(entry => entry.status !== 'available')));
  assert.ok(Object.isFrozen(menu) && Object.isFrozen(menu.active) && Object.isFrozen(menu.pending));
});

test('the settings of the old menu that are not built yet are listed for the Settings drawer, disabled', () => {
  const pending = pendingSettings();
  assert.deepEqual(pending.map(entry => entry.id).sort(),
    ['applications', 'aspect-focus', 'austral-inversion', 'planet-of-year', 'transsaturnians']);
  assert.ok(pending.every(entry => entry.status === 'planned' && entry.action === undefined));
  const everySetting = FUNCTION_CATALOG.find(group => group.id === SETTINGS_GROUP_ID).entries;
  assert.ok(everySetting.length > pending.length, 'the settings that work are in the drawer as real controls');
});

test('the right panel has no tab strip: the left menu chooses what it shows', () => {
  const inspector = html.match(/<aside class="inspector"[\s\S]*?<\/aside>/)?.[0] ?? '';
  assert.ok(inspector.length > 500);
  assert.doesNotMatch(inspector, /role="tab"|role="tablist"|inspector-tabs|id="tab-/);
  assert.match(inspector, /class="inspector-title"/);
  assert.doesNotMatch(inspector, /houses\.system|setHouseSystem/, 'the house system is a setting now');
});

test('every setting has a spoiler of its own, titles aligned to the left', () => {
  const settings = html.match(/<section class="drawer" \*ngIf="view==='settings'"[\s\S]*?<\/section>/)?.[0] ?? '';
  const titles = [...settings.matchAll(/<summary>\{\{t\('([a-z.]+)'\)\}\}<\/summary>/g)].map(match => match[1]);
  // The house system is first and has no spoiler; language and theme live in the main menu only.
  assert.deepEqual(titles, ['startup.title', 'functions.soon']);
  assert.ok(settings.indexOf('class="settings-top"') < settings.indexOf('<details'), 'house system comes first');
  assert.doesNotMatch(settings, /settings\.appearance|toggleLanguage|toggleTheme/);
  assert.match(settings, /<vs-chart-settings /);
  // Aspects and celestial elements are two spoilers of their own, not one.
  const spoilers = [...settingsHtml.matchAll(/<details class="settings-section">\s*<summary>\{\{t\('([a-z.]+)'\)\}\}/g)].map(match => match[1]);
  assert.deepEqual(spoilers, ['settings.aspects', 'settings.points']);
  assert.doesNotMatch(settingsHtml, /settings-group|chartsettings\.title/);
  // No title is pushed to the right.
  assert.match(css, /\.settings-section > summary \{ display:flex; justify-content:flex-start;/);
  assert.match(settingsCss, /\.settings-section > summary \{ display:flex; justify-content:flex-start;/);
  assert.doesNotMatch(css + settingsCss, /summary[^{]*\{[^}]*justify-content:\s*(space-between|flex-end)/);
});

test('no setting is offered twice', () => {
  const settings = html.match(/<section class="drawer" \*ngIf="view==='settings'"[\s\S]*?<\/section>/)?.[0] ?? '';
  const drawer = html.match(/<section class="drawer" \*ngIf="view==='functions'"[\s\S]*?<\/section>/)?.[0] ?? '';
  assert.doesNotMatch(drawer, /vs-chart-settings|setHouseSystem|startup/);
  assert.equal((settings.match(/setHouseSystem/g) ?? []).length, 1);
  assert.equal((html.match(/<vs-chart-settings /g) ?? []).length, 1);
});
