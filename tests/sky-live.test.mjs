import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {CHART_MARGIN_PX, SKY_REFRESH_MS, chartSide} from '../src/app/workspace-state.ts';
import {STRINGS} from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const component = read('src/app/desktop-app.component.ts');
const html = read('src/app/desktop-app.component.html');
const css = read('src/app/desktop-app.component.css');

test('the sky of the moment refreshes every 33 seconds', () => {
  assert.equal(SKY_REFRESH_MS, 33_000);
  assert.match(component, /setInterval\(\(\) => \{ void this\.skyTick\(\); \}, SKY_REFRESH_MS\)/);
  assert.match(component, /if \(this\.skyTimer !== null\) clearInterval\(this\.skyTimer\);/);
  assert.match(component, /skyLive = true;/, 'it runs from the start');
});

test('a refresh only touches a running, idle sky and never overrides the user', () => {
  const tick = component.match(/private async skyTick\(\)[\s\S]*?\n  \}/)?.[0] ?? '';
  for (const guard of ['!this.skyLive', '!this.isSkyActive', "this.mode !== 'natal'", 'this.calcBusy', 'this.busy', 'this.exporting', 'this.skyRefreshing']) {
    assert.ok(tick.includes(guard), guard);
  }
  // A silent refresh keeps the current ticket, so any request made meanwhile wins, and it shows no message.
  assert.match(component, /const ticket = silent \? this\.calcTicket : \+\+this\.calcTicket;/);
  assert.match(component, /if \(silent && \(!this\.isSkyActive \|\| this\.mode !== 'natal' \|\| this\.ascensionsOpen \|\| this\.radixSynodsOpen \|\| this\.seasonsOpen \|\| this\.apogeeOpen\)\) return;/);
  assert.match(component, /if \(!silent\) this\.calcMessage = chart;/);
});

test('one play/pause button replaces "refresh sky": green while running, yellow while paused', () => {
  assert.doesNotMatch(html, /sky\.refresh/);
  assert.match(html, /class="toolbar-button sky-live"[^>]*\[class\.live\]="skyLive"/);
  assert.match(html, /\(click\)="toggleSkyLive\(\)"/);
  assert.match(css, /\.sky-dot \{[^}]*background:#E0A800/);
  assert.match(css, /\.sky-live\.live \.sky-dot \{[^}]*background:#1FAE55/);
  for (const locale of ['it', 'en']) {
    assert.match(STRINGS[locale]['sky.live.running'], /33/);
    assert.notEqual(STRINGS[locale]['sky.live.running'], STRINGS[locale]['sky.live.paused']);
  }
});

test('the wheel keeps a small margin to the window edge, and is still almost the full height', () => {
  assert.ok(CHART_MARGIN_PX >= 8 && CHART_MARGIN_PX <= 16);
  for (const height of [720, 880, 1080]) {
    const share = chartSide(5000, height, CHART_MARGIN_PX) / height;
    assert.ok(share >= 0.95 && share < 1, height + ': ' + share);
  }
});
