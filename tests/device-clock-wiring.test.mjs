import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { STRINGS } from '../src/app/translations.ts';

const read = path => readFileSync(new URL('../'+path, import.meta.url), 'utf8');

test('the clock is mounted and disposed with the Angular workstation lifecycle', () => {
  const app = read('src/app/desktop-app.component.ts');
  assert.match(app, /private readonly deviceClock = new DeviceClock\(\)/);
  assert.match(app, /this\.deviceClock\.start\(/);
  assert.match(app, /this\.deviceClock\.dispose\(\)/);
  assert.match(app, /formatDeviceClock\(this\.deviceClock\.timestamp, this\.locale/);
  assert.match(app, /if \(!this\.destroyed\) this\.cd\.markForCheck\(\)/);
  const start = app.indexOf('this.deviceClock.start(');
  const after = app.indexOf('\n    // Read-only capability check', start);
  assert.ok(after > start);
  assert.doesNotMatch(app.slice(start, after), /this\.draw\(|this\.renderer\./);
});

test('clock has a semantic time element and explicitly device-only UI label', () => {
  const html = read('src/app/desktop-app.component.html');
  const css = read('src/app/desktop-app.component.css');
  assert.match(html, /role="group" \[attr\.aria-label\]="t\('clock.label'\)"/);
  assert.match(html, /<time class="device-clock-reading" \[attr\.datetime\]="clockInstantIso">/);
  assert.match(html, /\{\{clockText\}\}/);
  assert.match(html, /\{\{clockCompactText\}\}/);
  assert.match(css, /\.clock-compact \{ display:none; \}/);
  assert.match(css, /@media \(max-width:960px\)/);
});

test('Now device-local labels have parallel Italian and English keys', () => {
  assert.deepEqual(Object.keys(STRINGS.it).sort(), Object.keys(STRINGS.en).sort());
  for (const locale of ['it','en']) {
    for (const key of ['clock.now', 'clock.label', 'clock.note']) {
      assert.ok(STRINGS[locale][key]?.trim());
    }
  }
  assert.match(STRINGS.it['clock.note'], /non aggiorna il grafico/);
  assert.match(STRINGS.en['clock.note'], /does not update/);
});
