import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url),'utf8');

test('all seven traditional hour rulers are one-click native buttons with a clear solar-input mode', () => {
  const html = read('src/app/desktop-app.component.html');
  const ts = read('src/app/desktop-app.component.ts');
  assert.match(html, /class="monomeric-planet-grid" role="group"/);
  assert.match(html, /<button \*ngFor="let planet of hourRulerOptions" type="button" class="monomeric-planet-button"/);
  assert.match(html, /\[attr\.aria-pressed\]="manualHourRuler === planet"/);
  assert.match(html, /\(click\)="chooseCrossHourRuler\(planet\)"/);
  assert.match(html, /\{\{hourRulerGlyph\[planet\]\}\}/);
  assert.match(html, /class="monomeric-from-solar"/);
  assert.match(html, /\(click\)="chooseCrossHourRuler\(''\)"/);
  assert.match(html, /\[attr\.aria-pressed\]="manualHourRuler === ''"/);
  assert.doesNotMatch(html, /setManualHourRuler\(\$event\)/);
  assert.match(ts, /chooseCrossHourRuler\(value: TraditionalPlanet \| ''\): void/);
  assert.match(ts, /if \(value !== '' && !this\.hourRulerOptions\.includes\(value\)\) return;/);
  assert.match(ts, /this\.manualHourRuler = value;/);
  for (const symbol of ['☉','☽','☿','♀','♂','♃','♄']) assert.ok(ts.includes(symbol));
});

test('the picker uses adaptive chart-column width, theme tokens and keyboard focus', () => {
  const css = read('src/app/desktop-app.component.css');
  assert.match(css, /\.monomeric-stage \{[^}]*container-type:inline-size;/);
  assert.match(css, /@container \(max-width:850px\)/);
  assert.match(css, /\.monomeric-planet-button\.selected \{[^}]*var\(--vs-accent\)/);
  assert.match(css, /\.monomeric-planet-button:focus-visible/);
  assert.match(css, /@media \(prefers-reduced-motion:reduce\)/);
});
