import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Elementi swaps central presentation without destroying the existing canvas',()=>{
  const html=read('src/app/desktop-app.component.html');
  const source=read('src/app/desktop-app.component.ts');
  assert.match(html, /<canvas #canvas class="chart-canvas"/);
  assert.match(html, /<vs-elements-view \*ngIf="view==='chart' && activeChart && chartPresentation==='elements'"/);
  assert.match(html, /\(click\)="toggleElements\(\)"/);
  assert.match(html, /\[attr\.aria-pressed\]="chartPresentation==='elements'"/);
  assert.match(source, /chartPresentation: 'wheel' \| 'elements' = 'wheel'/);
  assert.match(source, /this\.chartPresentation = this\.chartPresentation === 'wheel' \? 'elements' : 'wheel'/);
});

test('dodecatemoria second lines use the existing computed data and house selection',()=>{
  const html=read('src/app/elements-view.component.html');
  const source=read('src/app/elements-view.component.ts');
  const desktop=read('src/app/desktop-app.component.html');
  assert.match(desktop,/\[data\]="activeChart.data" \[houseSystem\]="houseSystem" \[locale\]="locale"/);
  assert.match(desktop,/\[showDodecatemoria\]="showDodecatemoria"/);
  assert.match(html,/row\.houseDodecatemoria/);
  assert.match(html,/row\.signDodecatemoria/);
  assert.match(html,/\*ngIf="showDodecatemoria"/);
  assert.match(html,/\[attr\.aria-pressed\]="showDodecatemoria"/);
  assert.match(source,/houseDisplay\(house\)\?\.element/);
});

test('elemental axis arrows live in their element rows; modalities and aspect matrix share chart data',()=>{
  const html=read('src/app/elements-view.component.html');
  const source=read('src/app/elements-view.component.ts');
  const desktop=read('src/app/desktop-app.component.html');
  assert.match(html,/model\.ascElement===row\.id/);
  assert.match(html,/model\.dsElement===row\.id/);
  assert.match(html,/class="axis-arrow asc-arrow"/);
  assert.match(html,/class="axis-arrow ds-arrow"/);
  assert.match(html,/model\.modalities/);
  assert.match(html,/class="aspect-matrix"/);
  assert.match(html,/matrixAspect\(planet,other\)/);
  assert.match(desktop,/\[theme\]="theme" \[aspects\]="aspectRows"/);
  assert.match(source,/MAJOR_ASPECTS/);
  assert.match(source,/planetImageUrl\(name:string,retrograde=false\)/);
  assert.match(source,/simboli-bianchi\/elementi-celesti/);
  assert.match(source,/simboli-bianchi\/segni/);
  assert.match(read('package.json'),/"start:private"/);
});

test('all planetary marks including both matrix axes use artwork glyphs; element chips are white-on-color',()=>{
  const html=read('src/app/elements-view.component.html');
  const css=read('src/app/elements-view.component.css');
  const source=read('src/app/elements-view.component.ts');
  assert.doesNotMatch(html,/element-count/);
  assert.doesNotMatch(html,/matrix-planet|planetLabel\(planet\)\.slice/);
  assert.match(html,/scope="col" \*ngFor="let planet of planets[\s\S]*?ngTemplateOutlet\]="planetMark"/);
  assert.match(html,/scope="row" \[attr.title\]="planetLabel\(planet\)"[\s\S]*?ngTemplateOutlet\]="planetMark"/);
  assert.match(html,/let-name let-retrograde="retrograde" let-white="white"/);
  assert.match(html,/\[src\]="planetImageUrl\(name,retrograde\)"/);
  assert.match(source,/simboli-bianchi\/elementi-celesti/);
  assert.match(css,/\.asset-on-light \.asset-glyph\.asset-verified \{filter:brightness\(0\);\}/);
  assert.match(css,/background:color-mix\(in srgb,var\(--element-color\) 76%,#171820\);color:#fff/);
  assert.match(css,/\.placement-datum \{font-size:12px;color:#fff/);
  assert.match(html,/\[attr.data-element\]="signElement\(item.sign\)"/);
});
