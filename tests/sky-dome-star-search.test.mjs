import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {findSkyStars} from '../src/app/sky-dome-star-search.ts';

const star=(id,magnitude,altitudeDeg=18)=>({
  id,magnitude,altitudeDeg,azimuthNorthEastDeg:175,approximate:false,
});
const catalog=[
  star('Sirius',-1.44),star('Sirius B',8.4),
  star('Spica',0.97),star('Aldebaran',0.85),star('Altair',0.76),
  star('Vega',0.03),star('Acrux',0.76),
  star('Ankaa',2.37),star('Rigel',0.13),star('Betelgeuse',0.42),
  star('Capella',0.08),star('São Test',4.3),
  star('Sirius',-1.4),
];

test('search only returns catalogue entries and ranks exact/prefix above substrings',()=>{
  const result=findSkyStars(catalog,'sir');
  assert.ok(result.length>=2);
  assert.equal(result[0].id,'Sirius');
  assert.ok(result.every(item=>catalog.includes(item)));
  const exact=findSkyStars(catalog,'SIRIUS');
  assert.equal(exact[0].id,'Sirius');
  assert.deepEqual(findSkyStars(catalog,'TRI'),[]);
  assert.equal(findSkyStars(catalog,'ika',8).length,1);
});

test('diacritic-tolerant case folding is bounded and search cannot create a star',()=>{
  assert.equal(findSkyStars(catalog,'sao')[0].id,'São Test');
  assert.deepEqual(findSkyStars(catalog,''),[]);
  assert.deepEqual(findSkyStars(catalog,'S'),[]);
  assert.deepEqual(findSkyStars(catalog,'a'.repeat(81)),[]);
  assert.deepEqual(findSkyStars(catalog,'ve',0),[]);
  assert.deepEqual(findSkyStars(catalog,'ve',100),[]);
  assert.deepEqual(findSkyStars([], 'sir'),[]);
  assert.deepEqual(findSkyStars(catalog,'made-up-star'),[]);
  const s=star('Sirius',-1.44);
  assert.equal(findSkyStars([s],'si')[0],s);
});

test('the Cielo 3D search stays offline and uses only native ephemeris stars',()=>{
  const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
  const controller=read('src/app/sky-dome.component.ts');
  const ui=read('src/app/sky-dome.component.html');
  const search=read('src/app/sky-dome-star-search.ts');
  assert.match(controller,/findSkyStars\(this\.data\?\.stars\?\?\[\],this\.starQuery,7\)/);
  assert.match(controller,/this\.data\?\.stars\.includes\(point\)/);
  assert.match(controller,/focusStar\(point:SkyDomePoint\):void/);
  assert.match(ui,/\(input\)="onStarQuery\(\$event\)"/);
  assert.match(ui,/\(click\)="focusStar\(star\)"/);
  assert.match(ui,/\(keydown\)="onStarSearchKey\(\$event\)"/);
  assert.match(ui,/word\('belowHorizon'\)/);
  assert.doesNotMatch(search,/fetch\(|https?:\/\/|Math\.random|localStorage/);
});
