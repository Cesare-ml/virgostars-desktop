import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('lunar illumination is computed in native Rust from real Sun and Moon vectors',()=>{
  const rust=read('src-tauri/src/sky_dome.rs');
  assert.match(rust,/fn geocentric_vector\(/);
  assert.match(rust,/fn lunar_illumination_fraction\(/);
  assert.match(rust,/let from_moon_to_sun=\[s\[0\]-m\[0\]/);
  assert.match(rust,/let from_moon_to_earth=\[-m\[0\]/);
  assert.match(rust,/let fraction=\(1\.0\+cos_phase\)\*0\.5/);
  assert.match(rust,/chart\.bodies\.iter\(\)\.find\(\|body\|body\.id=="Sun"\)/);
  assert.match(rust,/chart\.bodies\.iter\(\)\.find\(\|body\|body\.id=="Moon"\)/);
  assert.match(rust,/illuminated_fraction:if body\.id=="Moon"\{lunar_fraction\}else\{None\}/);
  assert.match(rust,/illuminated_fraction:None/);
  assert.match(rust,/fn lunar_fraction_matches_new_full_and_quarter_geometry/);
});

test('the sky uses the actual host-calculated Sun direction to light spherical images',()=>{
  const source=read('src/app/sky-dome.component.ts');
  assert.match(source,/private sunLight:THREE\.DirectionalLight\|null=null/);
  assert.match(source,/new THREE\.DirectionalLight\(0xfff7ea,2\.4\)/);
  assert.match(source,/this\.sunLight\.position\.copy\(/);
  assert.match(source,/this\.vec\(sun\.azimuthNorthEastDeg,sun\.altitudeDeg,70\)/);
  assert.match(source,/this\.sunLight\.visible=true/);
  assert.match(source,/this\.sunLight\.visible=false/);
  assert.match(source,/this\.updateSunLighting\(\)/);
  assert.doesNotMatch(source,/planetLight\.position\.set\(-45,65,-40\)/);
  // No lunar phase is recalculated or invented in TypeScript.
  assert.doesNotMatch(source,/lunar_illumination_fraction|moonPhaseAngle|fakeMoonPhase/);
});

test('the type-safe IPC reports only bounded lunar illumination and UI labels it',()=>{
  const contract=read('src/app/native/sky-dome-contract.ts');
  const html=read('src/app/sky-dome.component.html');
  const viewer=read('src/app/sky-dome.component.ts');
  assert.match(contract,/illuminatedFraction:number\|null/);
  assert.match(contract,/optionalNum\(v,'illuminatedFraction',0,1\)/);
  assert.match(contract,/illuminatedFraction!==null&&\(star\|\|v\['id'\]!=='Moon'\)/);
  assert.match(html,/\*ngIf="selection\.point\.illuminatedFraction!==null"/);
  assert.match(html,/percentText\(selection\.point\.illuminatedFraction\)/);
  assert.match(viewer,/illuminatedFraction:'Luna illuminata'/);
  assert.match(viewer,/illuminatedFraction:'Illuminated Moon'/);
  assert.match(viewer,/illuminatedFractionNote:/);
});
