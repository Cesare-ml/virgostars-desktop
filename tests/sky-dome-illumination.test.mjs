import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('Solar geometry comes from the native Sun and individual planet vectors',()=>{
  const rust=read('src-tauri/src/sky_dome.rs');
  assert.match(rust,/fn geocentric_vector\(/);
  assert.match(rust,/fn geometric_illumination\(/);
  assert.match(rust,/fn body_sunlight\(/);
  assert.match(rust,/sunlight=\[/);
  assert.match(rust,/sun_xyz\[0\]-body_xyz\[0\]/);
  assert.match(rust,/let earthward=\[-body_xyz\[0\]/);
  assert.match(rust,/let fraction=\(1\.0\+cosine\)\*0\.5/);
  assert.match(rust,/let sun_body=chart\.bodies\.iter\(\)\.find\(\|body\|body\.id=="Sun"\)\.cloned\(\)/);
  assert.match(rust,/body_sunlight\(sun,&body,armc,latitude\)/);
  assert.match(rust,/sunlight_direction:sunlight\.map\(\|\(_,direction\)\|direction\)/);
  assert.match(rust,/sunlight_direction:None/);
  assert.match(rust,/fn venus_phases_depend_on_observer_relative_position_to_sun/);
  assert.match(rust,/fn lunar_fraction_matches_new_full_and_quarter_geometry/);
});

test('Each photo sphere uses the native Sun direction and a stable shader key',()=>{
  const component=read('src/app/sky-dome.component.ts');
  const shader=read('src/app/sky-dome-solar-material.ts');
  assert.match(component,/const light=point\.sunlightDirection/);
  assert.match(component,/skyWorldVector\(\s*light\.azimuthNorthEastDeg,light\.altitudeDeg,1/);
  assert.match(component,/sunlitPlanetMaterial\(new THREE\.Vector3\(/);
  assert.match(shader,/onBeforeCompile/);
  assert.match(shader,/customProgramCacheKey/);
  assert.match(shader,/vSkyWorldNormal = normalize\(mat3\(modelMatrix\) \* normal\)/);
  assert.match(shader,/float solarIncidence = dot\(normalize\(vSkyWorldNormal\),normalize\(uSkySunDir\)\)/);
  assert.match(shader,/diffuseColor\.rgb \*= mix\(0\.065,1\.0,daySide\)/);
  assert.doesNotMatch(component,/new THREE\.DirectionalLight\(/);
});

test('The IPC validates the illuminated fraction and sun direction as one pair',()=>{
  const contract=read('src/app/native/sky-dome-contract.ts');
  const template=read('src/app/sky-dome.component.html');
  const component=read('src/app/sky-dome.component.ts');
  assert.match(contract,/illuminatedFraction:number\|null/);
  assert.match(contract,/sunlightDirection:SkyDomeDirection\|null/);
  assert.match(contract,/optionalNum\(v,'illuminatedFraction',0,1\)/);
  assert.match(contract,/sunField===undefined\|\|sunField===null\?null:direction\(sunField\)/);
  assert.match(contract,/\(star\|\|v\['id'\]==='Sun'\)/);
  assert.match(template,/\*ngIf="selection\.point\.illuminatedFraction!==null"/);
  assert.match(template,/percentText\(selection\.point\.illuminatedFraction\)/);
  assert.match(component,/illuminatedFraction:'Superficie illuminata'/);
  assert.match(component,/illuminatedFraction:'Illuminated surface'/);
  assert.match(component,/illuminatedFractionNote:/);
});
