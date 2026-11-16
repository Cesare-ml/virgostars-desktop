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
  assert.match(app, /this\.deviceClock\.start\(\(\) => \{\s*if \(this\.destroyed\) return;\s*this\.updateCityClock\(\);\s*this\.cd\.markForCheck\(\);/);
  const start = app.indexOf('this.deviceClock.start(');
  const after = app.indexOf('\n    // Read-only capability check', start);
  assert.ok(after > start);
  assert.doesNotMatch(app.slice(start, after), /this\.draw\(|this\.renderer\./);
});

test('clock has a semantic time element and explicitly device-only UI label', () => {
  const html = read('src/app/desktop-app.component.html');
  const css = read('src/app/desktop-app.component.css');
  assert.match(html, /role="group" \[attr\.aria-label\]="t\('clock.label'\)"/);
  assert.match(html, /<time class="device-clock-reading" \[attr\.datetime\]="clockInstantIso" aria-live="off">/);
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

test('both changing clock readings are passive screen-reader content',()=>{
  const html=read('src/app/desktop-app.component.html');
  const tags=html.match(/<time\b[^>]*>/g)??[];
  assert.equal(tags.length,2);
  for(const tag of tags){
    assert.match(tag,/aria-live="off"/);
    assert.match(tag,/\[attr\.datetime\]="clockInstantIso"/);
    assert.doesNotMatch(tag,/role="(?:alert|status)"/);
  }
  assert.match(html,/\*ngIf="cityClock\.kind === 'ready'"/);
  assert.match(html,/\*ngIf="cityClock\.kind !== 'ready'"/);
});

test('late city and language events are ignored after component teardown',()=>{
  const app=read('src/app/desktop-app.component.ts');
  assert.match(app,/onCitySelected\(place: OfflinePlaceV1\): void \{\s*if \(this\.destroyed\) return;\s*this\.selectedCity = place;/);
  assert.match(app,/onCityEdited\(\): void \{\s*if \(this\.destroyed\) return;\s*this\.selectedCity = null;/);
  assert.match(app,/toggleLanguage\(\): void \{\s*if \(this\.destroyed\) return;\s*this\.locale = this\.locale === 'it'/);
  assert.match(app,/ngOnDestroy\(\): void \{\s*this\.destroyed = true;\s*this\.deviceClock\.dispose\(\);/);
});

test('device tick and city edits do not redraw synthetic chart',()=>{
  const app=read('src/app/desktop-app.component.ts');
  const start=app.indexOf('this.deviceClock.start('),end=app.indexOf('    // Read-only capability check',start);
  assert.ok(start>=0&&end>start);
  const tick=app.slice(start,end);
  assert.match(tick,/this\.updateCityClock\(\)/);
  assert.doesNotMatch(tick,/this\.draw\(|this\.renderer\.|fetch\(/);
  const from=app.indexOf('  onCitySelected('),to=app.indexOf('  get clockInstantIso',from);
  assert.ok(from>=0&&to>from);
  assert.match(app.slice(from,to),/this\.updateCityClock\(\)/);
  assert.doesNotMatch(app.slice(from,to),/this\.draw\(|this\.renderer\.|fetch\(/);
});
