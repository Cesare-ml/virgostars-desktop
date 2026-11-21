import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {skyStarPickThreshold as pickWithLens} from '../src/app/sky-dome-star-picking.ts';
import {skyLensTheta} from '../src/app/sky-dome-projection.ts';

const skyStarPickThreshold=(fov,height,radius,skyRadius=100,targetRadiusPx=6)=>
  pickWithLens(fov,height,radius,skyLensTheta,skyRadius,targetRadiusPx);

test('star hit target grows with FOV instead of remaining a fixed 3D radius',()=>{
  const narrow=skyStarPickThreshold(28,800,0.5);
  const normal=skyStarPickThreshold(85,800,0.5);
  const fisheye=skyStarPickThreshold(180,800,0.5);
  assert.ok(narrow!==null&&normal!==null&&fisheye!==null);
  assert.ok(narrow<normal&&normal<fisheye,
    `angular thresholds did not grow with zoom: ${narrow}, ${normal}, ${fisheye}`);
  assert.ok(narrow<0.6,'narrow zoom must not use the old 1.6 world-unit hit target');
  assert.ok(fisheye>1,'wide views must remain easy to select');
});

test('a smaller canvas gives a wider world-space target for the same CSS pixels',()=>{
  const small=skyStarPickThreshold(100,480,0.5);
  const big=skyStarPickThreshold(100,1200,0.5);
  assert.ok(small!==null&&big!==null&&small>big);
});

test('picking handles fisheye rims, ground-looking views and 220° clipping',()=>{
  for(const fov of [28,60,84.99,85,100,120,150,179.999,180,180.001,200,220]){
    for(const radius of [0,0.02,0.25,0.5,1,1.2]){
      const threshold=skyStarPickThreshold(fov,800,radius);
      assert.ok(threshold!==null,`unexpectedly missing threshold for ${fov}°, r=${radius}`);
      assert.ok(threshold>=0.2&&threshold<=3.25);
      assert.ok(Number.isFinite(threshold));
    }
  }
  // Angular lens exposes no unique sky ray beyond 180° from the centre.
  assert.equal(skyStarPickThreshold(220,800,3),null);
});

test('invalid or extreme user viewport values are rejected',()=>{
  for(const args of [
    [220,0,0],[180,NaN,0],[180,800,-1],[180,800,Infinity],
    [180,800,0,0],[180,800,0,100,0],[180,800,0,100,100],
  ])assert.equal(skyStarPickThreshold(...args),null);
});

test('the marker raycaster uses the same lens and viewport as the renderer',()=>{
  const src=readFileSync(new URL('../src/app/sky-dome.component.ts',import.meta.url),'utf8');
  const start=src.indexOf('  private pick(event:PointerEvent):void {');
  const end=src.indexOf('\n  }',start)+4;
  const pick=src.slice(start,end);
  assert.match(pick,/const radialScreenDistance=Math\.hypot\(ndc\.x\*this\.camera\.aspect,ndc\.y\)/);
  assert.match(pick,/skyStarPickThreshold\(\s*this\.camera\.fov,bounds\.height,radialScreenDistance/);
  assert.match(pick,/ray\.params\.Points\.threshold=pointThreshold/);
  assert.match(pick,/skyFisheyeWorldRay\(ndc\.x,ndc\.y/);
  assert.doesNotMatch(pick,/ray\.params\.Points\.threshold=1\.6/);
});
