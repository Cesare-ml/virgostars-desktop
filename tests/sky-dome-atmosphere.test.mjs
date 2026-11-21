import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  skyAtmosphereStarTransmission,
  skyAtmosphereStarDotsVisible,
  skyAtmosphereStarNamesVisible,
} from '../src/app/sky-dome-atmosphere.ts';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('stellar attenuation uses the real Sun altitude and changes smoothly across twilight',()=>{
  assert.equal(skyAtmosphereStarTransmission(-18,true),1);
  assert.equal(skyAtmosphereStarTransmission(-12,true),1);
  assert.ok(Math.abs(skyAtmosphereStarTransmission(-6,true)-0.51)<1e-12);
  assert.ok(Math.abs(skyAtmosphereStarTransmission(0,true)-0.02)<1e-12);
  assert.equal(skyAtmosphereStarTransmission(20,true),0.02);
  let previous=1;
  for(let degrees=-12;degrees<=0;degrees+=0.1){
    const factor=skyAtmosphereStarTransmission(degrees,true);
    assert.ok(factor>=0.02-1e-12&&factor<=1);
    assert.ok(factor<=previous+1e-12,`Unexpected brightening at Sun altitude ${degrees}°`);
    previous=factor;
  }
});

test('turning the atmosphere off restores every star irrespective of the Sun position',()=>{
  for(const altitude of [-90,-20,-12,-6,-3,0,10,75]){
    assert.equal(skyAtmosphereStarTransmission(altitude,false),1);
  }
  assert.equal(skyAtmosphereStarTransmission(null,true),1);
  assert.equal(skyAtmosphereStarTransmission(NaN,true),1);
  assert.equal(skyAtmosphereStarTransmission(Infinity,true),1);
  assert.equal(skyAtmosphereStarTransmission(-Infinity,true),1);
});

test('no invisible stars or nameplates are hit by the mouse in daylight',()=>{
  assert.equal(skyAtmosphereStarDotsVisible(0.02),false);
  assert.equal(skyAtmosphereStarNamesVisible(0.02),false);
  assert.equal(skyAtmosphereStarDotsVisible(0.1),true);
  assert.equal(skyAtmosphereStarNamesVisible(0.1),false);
  assert.equal(skyAtmosphereStarDotsVisible(0.5),true);
  assert.equal(skyAtmosphereStarNamesVisible(0.5),true);
  assert.equal(skyAtmosphereStarNamesVisible(NaN),false);
  assert.equal(skyAtmosphereStarDotsVisible(Infinity),false);
});

test('atmosphere toggle does not rebuild planetary spheres or download new textures',()=>{
  const source=read('src/app/sky-dome.component.ts');
  const start=source.indexOf("      case 'atmosphere':");
  const end=source.indexOf("      case 'signs':",start);
  assert.ok(start>=0&&end>start);
  const atmosphere=source.slice(start,end);
  assert.match(atmosphere,/this\.applyAtmosphericStarlight\(\)/);
  assert.doesNotMatch(atmosphere,/this\.buildMarkers\(\)|TextureLoader|REAL_PLANET_TEXTURES/);
  assert.match(source,/this\.data\?\.planets\.find\(point=>point\.id==='Sun'\)/);
  assert.match(source,/skyAtmosphereStarTransmission\(sun\?\.altitudeDeg\?\?null,this\.showAtmosphere\)/);
  assert.match(source,/point\.material\.opacity=starAppearance\(stars\[0\]\.magnitude\)\.opacity\*factor/);
  assert.match(source,/plate\.material\.opacity=0\.89\*factor/);
  assert.match(source,/const visibility=this\.markerVisibility\(\)/);
  assert.match(source,/canPickSkyMarker\(pickedKind,obj\.parent===this\.starLabelGroup,visibility\)/);
});

test('daylight UI note is available in both locales and only shown when relevant',()=>{
  const component=read('src/app/sky-dome.component.ts');
  const template=read('src/app/sky-dome.component.html');
  const css=read('src/app/sky-dome.component.css');
  const it=component.match(/\bit:\{([\s\S]*?)\r?\n  \},\r?\n  en:/)?.[1]??'';
  const en=component.match(/\ben:\{([\s\S]*?)\r?\n  \},\r?\n\} as const;/)?.[1]??'';
  assert.match(it,/daylightStarsNote:/);
  assert.match(en,/daylightStarsNote:/);
  assert.match(template,/showAtmosphere && light==='day' && status==='ready'/);
  assert.match(template,/word\('daylightStarsNote'\)/);
  assert.match(css,/\.sky3d-atmosphere-note/);
});
