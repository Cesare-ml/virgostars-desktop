import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');

test('house cusp grid tracks the active Desktop domification and never guesses spatial boundaries',()=>{
  const rust=read('src-tauri/src/sky_dome.rs');
  const viewer=read('src/app/sky-dome.component.ts');
  const html=read('src/app/sky-dome.component.html');
  const parent=read('src/app/desktop-app.component.html');
  const controller=read('src/app/desktop-app.component.ts');
  assert.match(rust,/fn house_grid\(/);
  assert.match(rust,/house\.cusps_deg\[index\]/);
  assert.match(rust,/let house_grids=chart\.houses\.iter\(\)\.filter_map/);
  assert.match(rust,/true_obliquity_deg,armc,latitude/);
  assert.match(viewer,/this\.data\?\.houseGrids\.find\(grid=>grid\.id===this\.houseSystem\)/);
  assert.match(viewer,/grid\.separators\[index\]/);
  assert.match(viewer,/grid\.labels\[index\]/);
  assert.match(viewer,/get cuspRows\(\)/);
  assert.match(viewer,/grid\.cuspLongitudesDeg\.map/);
  assert.match(viewer,/grid\.separators\[index\]\[4\]/);
  assert.match(viewer,/focusCusp\(index:number\):void/);
  assert.match(viewer,/this\.look\(row\.azimuth,row\.altitude\)/);
  assert.match(viewer,/this\.selectedCuspIndex=index/);
  assert.match(html,/\(click\)="focusCusp\(cusp\.index\)"/);
  assert.match(html,/word\('houseCusps'\)/);

  assert.match(html,/\(click\)="toggleLayer\('houses'\)"/);
  assert.match(html,/\(change\)="selectHouseSystem\(\$event\)"/);
  assert.match(html,/word\('houseNote'\)/);
  assert.match(parent,/\[houseSystem\]="houseSystem"/);
  assert.match(parent,/\(houseSystemSelected\)="setSkyHouseSystem\(\$event\)"/);
  assert.match(controller,/setSkyHouseSystem\(systemId:string\):void/);
  assert.match(controller,/this\.houseSystems\.includes\(system\)/);
  assert.doesNotMatch(viewer,/Math\.random\(|fakeHouseGrid|syntheticHouse/);
});

test('atmosphere can be disabled without changing astronomy or simulating new stars',()=>{
  const html=read('src/app/sky-dome.component.html');
  const css=read('src/app/sky-dome.component.css');
  const viewer=read('src/app/sky-dome.component.ts');
  assert.match(html,/\[class\.sky3d-no-atmosphere\]="!showAtmosphere"/);
  assert.match(html,/\(click\)="toggleLayer\('atmosphere'\)"/);
  assert.match(viewer,/case 'atmosphere':this\.showAtmosphere=!this\.showAtmosphere/);
  assert.match(css,/\.sky3d\.sky3d-no-atmosphere/);
  assert.match(css,/\.sky3d-no-atmosphere \.sky3d-vignette/);
  assert.match(viewer,/calculateSkyDome\(\{utcIso:this\.utcIso,latMicro:this\.latMicro,lngMicro:this\.lngMicro\}\)/);
});

test('object cards present provided astronomical values and skip missing fields',()=>{
  const html=read('src/app/sky-dome.component.html');
  const rust=read('src-tauri/src/sky_dome.rs');
  const contract=read('src/app/native/sky-dome-contract.ts');
  for(const key of [
    'eclipticLongitudeDeg','eclipticLatitudeDeg','rightAscensionDeg',
    'declinationDeg','distanceAu','longitudeSpeedDegPerDay',
    'constellation','catalogId','ephemerisSource',
  ]){
    assert.ok(contract.includes(key),key);
    assert.ok(html.includes('selection.point.'+key),key);
  }
  assert.match(rust,/Some\(body\.right_ascension_deg\)/);
  assert.match(rust,/Some\(body\.distance_au\)/);
  assert.match(rust,/constellation:s\.constellation/);
  assert.match(rust,/catalog_id:Some\(s\.id\)/);
  assert.match(html,/selectedSignImage/);
  assert.match(html,/word\('notAvailable'\)|word\('source'\)/);
});

test('settings are grouped into accessible collapsible sections and credit real maps',()=>{
  const html=read('src/app/sky-dome.component.html');
  const viewer=read('src/app/sky-dome.component.ts');
  const css=read('src/app/sky-dome.component.css');
  assert.match(html,/<details class="sky3d-accordion" open>/);
  assert.match(html,/<details class="sky3d-accordion sky3d-search-accordion">/);
  assert.match(html,/<summary>\{\{word\('geometry'\)\}\}<\/summary>/);
  assert.match(html,/<summary>\{\{word\('appearance'\)\}\}<\/summary>/);
  assert.match(html,/Solar System Scope · CC BY 4\.0/);
  assert.match(viewer,/REAL_PLANET_TEXTURES\[point\.id\]/);
  assert.match(viewer,/new THREE\.SphereGeometry\(spec\.diameter\*0\.5,36,24\)/);
  // Per-planet sunlight vector supersedes the old shared scene DirectionalLight.
  assert.match(viewer,/sunlitPlanetMaterial\(/);
  assert.doesNotMatch(viewer,/new THREE\.DirectionalLight/);
  assert.match(viewer,/globe\.visible=false/);
  assert.match(css,/\.sky3d-accordion summary:focus-visible/);
  assert.match(css,/\.sky3d-selection \{/);
});
