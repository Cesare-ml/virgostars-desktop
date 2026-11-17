import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {STRINGS} from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const html = read('src/app/desktop-app.component.html');
const component = read('src/app/desktop-app.component.ts');
const css = read('src/app/desktop-app.component.css');
const panel = html.match(/<div class="navigator"[\s\S]*?<div \*ngIf="inspectorTab==='aspects' && activeChart">/)?.[0] ?? '';

test('"Naviga cielo" is a left-menu button that opens a panel on the right', () => {
  const nav = html.match(/<nav class="sidebar"[\s\S]*?<\/nav>/)?.[0] ?? '';
  assert.match(nav, /toggleInspectorTab\('navigate'\)/);
  assert.match(nav, /\[disabled\]="!activeChart"/);
  assert.match(html, /\{\{t\(inspectorTitleKey\)\}\}/);
  assert.match(component, /this\.inspectorTab === 'planets' \? 'nav\.planets' : this\.inspectorTab === 'aspects' \? 'tab\.aspects' : 'nav\.title'/);
  assert.ok(panel.length > 800);
});

test('the panel has the date and time fields with arrows, back/forward, the step grid and the five actions', () => {
  for (const piece of ['adjustNav(field.key, 1)', 'adjustNav(field.key, -1)', 'stepNav(-1)', 'stepNav(1)',
    'selectStep(row.unit, value)', 'navNow()', 'toggleCityChange()', 'askNavSave()', 'navRestore()', 'openElective()']) {
    assert.ok(panel.includes(piece), piece);
  }
  assert.match(panel, /<vs-offline-city-picker \*ngIf="cityChangeOpen"/);
  for (const key of ['nav.back', 'nav.forward', 'nav.now', 'nav.city', 'nav.save', 'nav.restore', 'nav.elective']) {
    assert.ok(panel.includes(`t('${key}')`), key);
  }
});

test('the chart is redrawn as the clock moves, only the latest request is shown', () => {
  assert.match(component, /NAV_RECOMPUTE_MS = 70/);
  assert.match(component, /const ticket = \+\+this\.navTicket;/);
  assert.match(component, /if \(this\.destroyed \|\| ticket !== this\.navTicket \|\| this\.nav\?\.chartId !== chart\.id\) return;/);
  // The moved chart keeps its identity and every cache that depends on it is dropped.
  assert.match(component, /\{\.\.\.next, id:chart\.id\}/);
  for (const cache of ['this.rowsCache = null;', 'this.aspectCache = null;', 'this.crossAspectCache = null;']) {
    assert.ok(component.slice(component.indexOf('private async recomputeNav')).includes(cache), cache);
  }
  // A move that cannot be shown leaves the chart as it was.
  assert.match(component, /this\.navStatus = next;/);
});

test('opening the navigator stops the sky from refreshing itself, and nothing moves it meanwhile', () => {
  assert.match(component, /if \(tab === 'navigate'\) \{[\s\S]*?this\.skyLive = false;[\s\S]*?this\.initNav\(\);/);
  assert.match(component, /if \(this\.nav && this\.inspectorTab === 'navigate' && !this\.inspectorCollapsed\) return;/);
  // It follows the chart on screen.
  assert.match(component, /if \(this\.inspectorTab === 'navigate' && !this\.inspectorCollapsed\) this\.initNav\(\);/);
});

test('Salva exists only for a subject\'s chart and overwrites only after a confirmation', () => {
  assert.match(panel, /\*ngIf="activeChart\.kind === 'chart'"[^>]*\[disabled\]="archiveBusy \|\| \(!navDirty && activeChart\.archiveId !== null\)"/);
  const ask = component.match(/askNavSave\(\): void \{[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(ask, /chart\.kind !== 'chart'/);
  assert.match(ask, /chart\.archiveId === null\) \{ void this\.confirmNavSave\(\); return; \}/);
  assert.match(ask, /this\.navConfirmSave = true;/);
  const confirm = component.match(/async confirmNavSave\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(confirm, /chart\.kind !== 'chart'/);
  assert.match(confirm, /const archiveId = chart\.archiveId \?\? newChartId\(\);/, 'same identity: the saved chart is overwritten in place');
  assert.match(confirm, /this\.nav = \{\.\.\.this\.nav, base:this\.nav\.current\}/, 'Ripristina then returns to what was saved');
  assert.match(panel, /confirmNavSave\(\)/);
});

test('Ripristina returns to the starting point and a city change keeps the right thing fixed', () => {
  assert.match(component, /navRestore\(\): void \{[\s\S]*?this\.nav = \{\.\.\.nav, current:nav\.base\};/);
  const city = component.match(/onNavCitySelected\([\s\S]*?\n  \}/)?.[0] ?? '';
  // A subject's chart keeps its local time; the sky keeps its instant.
  assert.match(city, /chart\.kind === 'chart' && timeZone !== nav\.current\.timeZone/);
  assert.match(city, /utcFromLocal\(wall, timeZone\)/);
});

test('Erigi elettiva asks for a name in an overlay and saves a new chart under it', () => {
  const overlay = html.match(/<div class="overlay"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)?.[0] ?? '';
  assert.match(overlay, /\*ngIf="electiveOpen"/);
  assert.match(overlay, /\(keydown\.enter\)="confirmElective\(\)"/);
  assert.match(overlay, /\(keydown\.escape\)="cancelElective\(\)"/);
  assert.match(overlay, /class="overlay-ok"/);
  assert.match(overlay, /class="overlay-cancel"/);
  const confirm = component.match(/async confirmElective\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  assert.match(confirm, /id:newChartId\(\)/, 'a new chart, never an overwrite');
  assert.match(confirm, /!record\.name \|\| !validChartRecord\(record\)/);
  assert.match(confirm, /runArchive\(\{operation:'save', chart:record\}, 'nav\.elective\.saved'\)/);
  assert.match(css, /\.overlay-ok \{ background:#3FA34D; \}/);
  assert.match(css, /\.overlay-cancel \{ background:#E5483D; \}/);
});

test('every label of the panel exists in both languages', () => {
  const keys = [...(html + component).matchAll(/'(nav\.[a-z.]+|sky\.navigated)'/g)].map(match => match[1]);
  assert.ok(keys.length > 20);
  for (const key of new Set(keys)) {
    for (const locale of ['it', 'en']) assert.ok(STRINGS[locale][key]?.trim(), `${locale}:${key}`);
  }
  assert.equal(STRINGS.it['nav.back'], 'Indietro');
  assert.equal(STRINGS.it['nav.forward'], 'Avanti');
  assert.equal(STRINGS.it['nav.elective'], 'Erigi elettiva');
});
