import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planetPortraitSpec} from '../src/app/sky-dome-planet-portraits.ts';
import {labeledCatalogStars} from '../src/app/sky-dome-visuals.ts';

const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('all native physical bodies have a bounded offline portrait and a genuinely small official glyph',()=>{
  const ids=['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','Chiron'];
  for(const id of ids){
    const spec=planetPortraitSpec(id);
    assert.ok(spec,id);
    assert.equal(spec.id,id);
    assert.ok(spec.diameter>=6 && spec.diameter<=15);
    assert.ok(spec.labelDiameter>=2 && spec.labelDiameter<=3.1);
    assert.ok(spec.labelDiameter<spec.diameter/2,id);
    assert.match(spec.accent,/^#[a-f\d]{6}$/i);
    assert.ok(Object.isFrozen(spec));
  }
  assert.equal(planetPortraitSpec('Earth'),null,'earth is the observing origin, not a plotted planet');
  assert.equal(planetPortraitSpec('not-a-body'),null);
});

test('star labels come only from actual bright stars in the local provider response',()=>{
  const catalog=[
    {id:'Sirius',magnitude:-1.46},
    {id:'Vega',magnitude:0.03},
    {id:'Faint object',magnitude:7.4},
    {id:'Sirius',magnitude:-1.4},
    {id:'Unknown',magnitude:null},
    {id:'Deneb',magnitude:1.25},
  ];
  const labels=labeledCatalogStars(catalog);
  assert.deepEqual(labels.map(x=>x.id),['Sirius','Vega','Deneb']);
  assert.deepEqual(labeledCatalogStars(catalog,2).map(x=>x.id),['Sirius','Vega']);
  assert.deepEqual(labeledCatalogStars(catalog,0),[]);
  assert.deepEqual(labeledCatalogStars(catalog,-2),[]);
  assert.deepEqual(labeledCatalogStars([{id:' ',magnitude:1}],26),[]);
});

test('3D markers use generated portraits without placing glyph badges over planets',()=>{
  const source=read('src/app/sky-dome.component.ts');
  const visuals=read('src/app/sky-dome-planet-portraits.ts');
  const html=read('src/app/sky-dome.component.html');
  const rust=read('src-tauri/src/sky_dome.rs');
  assert.match(source,/const portrait=this\.portraitTexture\(point\.id\)/);
  assert.match(source,/createPlanetPortrait\(id\)/);
  assert.doesNotMatch(source,/celestialGlyphUrl\(point\.id\)/);
  assert.match(source,/skyFacingPlane\(portrait/);
  assert.match(source,/this\.vec\(star\.azimuthNorthEastDeg,star\.altitudeDeg,99\.2\)/);
  assert.match(source,/skyFacingPlane\(texture/);
  assert.match(html,/toggleLayer\('starLabels'\)/);
  assert.match(html,/toggleLayer\('zodiacGrid'\)/);
  assert.match(rust,/zodiac_latitude_direction/);
  assert.match(rust,/pub struct SkyZodiacGridV1/);
  assert.match(rust,/decade_ticks/);
  assert.match(visuals,/ctx\.ellipse/);
  assert.match(visuals,/id==='Saturn'\)ring\(ctx,true\)/);
  assert.doesNotMatch(visuals,/https?:\/\/|Math\.random|fetch\(/);
});

test('illustrative body textures and caches are disposed when the sky component unmounts',()=>{
  const viewer=read('src/app/sky-dome.component.ts');
  assert.match(viewer,/for\(const texture of this\.portraitTextures\.values\(\)\)texture\.dispose\(\)/);
  assert.match(viewer,/this\.portraitTextures\.clear\(\)/);
  assert.match(viewer,/this\.markerTextures=\[\]/);
  assert.match(viewer,/this\.skyLens\?\.dispose\(\)/);
  assert.match(viewer,/this\.renderer\?\.forceContextLoss\(\)/);
});
