import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planetAccent,skyLightFromSun,starAppearance} from '../src/app/sky-dome-visuals.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('illustrative atmosphere uses the computed Sun altitude but never alters astronomy',()=>{
  assert.equal(skyLightFromSun(35),'day');
  assert.equal(skyLightFromSun(0),'day');
  assert.equal(skyLightFromSun(-0.1),'twilight');
  assert.equal(skyLightFromSun(-11.9),'twilight');
  assert.equal(skyLightFromSun(-12),'twilight');
  assert.equal(skyLightFromSun(-12.1),'night');
  assert.equal(skyLightFromSun(null),'night');
  assert.equal(skyLightFromSun(Number.NaN),'night');
  assert.equal(skyLightFromSun(Infinity),'night');
});

test('stellar magnitudes have clear, bounded visual hierarchy',()=>{
  const bright=starAppearance(-1.46);
  const medium=starAppearance(2.0);
  const faint=starAppearance(6.0);
  const unknown=starAppearance(null);
  assert.equal(bright.bin,0);
  assert.equal(faint.bin,3);
  assert.ok(bright.sizePx>medium.sizePx && medium.sizePx>faint.sizePx);
  assert.ok(bright.opacity>medium.opacity && medium.opacity>faint.opacity);
  assert.deepEqual(unknown,faint);
  for(let mag=-10;mag<=20;mag+=.25){
    const v=starAppearance(mag);
    assert.ok(v.sizePx>=6 && v.sizePx<=16);
    assert.ok(v.opacity>=.62 && v.opacity<=.96);
  }
});

test('planet colors are presentation-only and never substitutes for official glyphs',()=>{
  for(const id of ['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','Chiron']){
    assert.match(planetAccent(id),/^#[\da-f]{6}$/i);
  }
  assert.equal(planetAccent('unknown'),'#d5dbea');
  const viewer=read('src/app/sky-dome.component.ts');
  assert.match(viewer,/celestialGlyphUrl\(point\.id\)/);
  assert.match(viewer,/zodiacGlyphUrl\(sign\.signIndex\)/);
  assert.match(viewer,/data\.stars\.filter\(star=>starAppearance\(star\.magnitude\)\.bin===bin\)/);
  assert.doesNotMatch(viewer,/Math\.random\(|syntheticStar|fakeStar|placeholderStar/);
});

test('3D sky has a responsive HUD, real native sky, keyboard controls and no invented planet data',()=>{
  const html=read('src/app/sky-dome.component.html');
  const ts=read('src/app/sky-dome.component.ts');
  const css=read('src/app/sky-dome.component.css');
  const contract=read('src/app/native/sky-dome-contract.ts');
  assert.match(html,/class="sky3d-planet-dock" \*ngIf="status==='ready' && showPlanets"/);
  assert.match(html,/\(click\)="focusPlanet\(planet\.id\)"/);
  assert.match(html,/\(keydown\)="onKeyDown\(\$event\)"/);
  assert.match(html,/\(click\)="resetView\(\)"/);
  assert.match(html,/\(click\)="clearSelection\(\)"/);
  assert.match(html,/\(click\)="close\(\)"/);
  const parent=read('src/app/desktop-app.component.html');
  assert.match(parent,/\(closed\)="toggleSkyDome\(\)"/);
  assert.match(parent,/\[hidden\]="view!=='chart' \|\| chartPresentation==='sky3d'"/);
  assert.match(ts,/focusPlanet\(id:string\):void/);
  assert.match(ts,/this\.data\?\.planets\.find\(body=>body\.id===id\)/);
  assert.match(ts,/this\.renderer=new THREE\.WebGLRenderer\(\{antialias:true,alpha:true/);
  assert.match(ts,/this\.renderer\.setClearColor\(0x000000,0\)/);
  assert.match(css,/\.sky3d\.sky3d-daylight/);
  assert.match(css,/\.sky3d\.sky3d-twilight/);
  assert.match(css,/\.sky3d-planet-dock/);
  assert.match(contract,/zodiacSegments: readonly SkyZodiacSegment\[\]/);
  assert.match(contract,/angles: readonly SkyAngle\[\]/);
});

test('every copy key referenced by the planetarium template exists in both locales',()=>{
  const ts=read('src/app/sky-dome.component.ts');
  const html=read('src/app/sky-dome.component.html');
  const it=ts.match(/\bit:\{([\s\S]*?)\n  \},\n  en:/)?.[1]??'';
  const en=ts.match(/\ben:\{([\s\S]*?)\n  \},\n\} as const;/)?.[1]??'';
  const keys=[...html.matchAll(/word\('([^']+)'\)/g)].map(match=>match[1]);
  assert.ok(keys.length>=10);
  for(const key of keys){
    assert.match(it,new RegExp('\\b'+key+':'));
    assert.match(en,new RegExp('\\b'+key+':'));
  }
});
