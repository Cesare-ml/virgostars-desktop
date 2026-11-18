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
  assert.match(source,/PRIVATE_ARTWORK/);
  assert.match(source,/simboli\/elementi-celesti/);
  assert.match(source,/simboli\/segni/);
  assert.match(read('package.json'),/"start:private"/);
});
