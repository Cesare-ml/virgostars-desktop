import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseDesktopShortcut} from '../src/app/desktop-shortcuts.ts';
import {formatEclipticLongitude} from '../src/app/format-longitude.ts';
import {buildFictionalAngles} from '../src/app/fictional-geometry.ts';
import {buildSyntheticChartCsv, SYNTHETIC_DATA_STATUS} from '../src/app/synthetic-csv-export.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const event = code => ({
  code, altKey:true, shiftKey:true, ctrlKey:false, metaKey:false, repeat:false,
  target:{tagName:'BUTTON', closest:()=>null},
});

test('chart shortcuts choose only synthetic views; they cannot export files', () => {
  const expected = ['natal','transits','synastry','latitude'];
  expected.forEach((mode,i) => assert.deepEqual(parseDesktopShortcut(event('Digit'+(i+1))),{kind:'mode',mode}));
  assert.deepEqual(parseDesktopShortcut(event('Digit0')),{kind:'fit'});
  assert.equal(parseDesktopShortcut(event('Digit5')),null);
  for(const i of [0,1,2,3,4]) assert.ok(!Object.hasOwn(parseDesktopShortcut(event('Digit'+i)), 'export'));
});

test('typing a real city in an input cannot activate chart keys or change the fixture', () => {
  const original=buildFictionalAngles(0);
  for(const code of ['Digit0','Digit1','Digit2','Digit3','Digit4']) {
    assert.equal(parseDesktopShortcut({...event(code),target:{tagName:'INPUT'}}),null);
  }
  assert.deepEqual(buildFictionalAngles(0),original);
});

test('shortcut parser and bilingual coordinate formatting preserve the same 22 fictional CSV positions', () => {
  const base=buildFictionalAngles(0);
  const names=['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'];
  const planets=names.map((name,i)=>({name,longitude:base.planetLongitudes[i]}));
  const houses=base.houseCusps.map((longitude,i)=>({number:i+1,longitude}));
  const csv=buildSyntheticChartCsv(planets,houses);
  assert.equal(csv.trimEnd().split('\r\n').length,23);
  for (const longitude of [...base.planetLongitudes,...base.houseCusps]) {
    const english=formatEclipticLongitude(longitude,'en');
    const italian=formatEclipticLongitude(longitude,'it');
    assert.equal(italian.replace(',','.'),english);
  }
  assert.ok(csv.includes('planet,Sun,19.3,'+SYNTHETIC_DATA_STATUS));
  assert.deepEqual(parseDesktopShortcut(event('Digit3')),{kind:'mode',mode:'synastry'});
  assert.equal(buildSyntheticChartCsv(planets,houses),csv);
});

test('merged component retains guarded shortcut handler and existing CSV port and inspector locale', () => {
  const app=read('src/app/desktop-app.component.ts');
  assert.match(app, /HostListener\('window:keydown', \['\$event'\]\)/);
  assert.match(app, /parseDesktopShortcut\(event\)/);
  assert.match(app, /this\.setMode\(action\.mode\)/);
  assert.match(app, /this\.fitChart\(\)/);
  assert.match(app, /this\.destroyed \|\| this\.exporting/);
  assert.match(app, /formatEclipticLongitude\(value, this\.locale\)/);
  assert.match(app, /createSyntheticCsvBrowserPort/);
  assert.match(app, /buildSyntheticChartCsv\(this\.planets, this\.houses\)/);
});

test('merged Angular template and translations retain keyboard help, CSV button and both inspector tables', () => {
  const html=read('src/app/desktop-app.component.html');
  const dictionary=read('src/app/translations.ts');
  assert.match(html, /t\('shortcuts\.title'\)/);
  assert.match(html, /t\('shortcuts\.help'\)/);
  assert.match(html, /formatDegrees\(planet\.longitude\)/);
  assert.match(html, /formatDegrees\(house\.longitude\)/);
  assert.match(html, /exportSyntheticCsv\(\)/);
  assert.equal((dictionary.match(/"shortcuts\.title":/g)??[]).length,2);
  assert.equal((dictionary.match(/"shortcuts\.help":/g)??[]).length,2);
});
