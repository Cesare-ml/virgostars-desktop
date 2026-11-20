import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {readFileSync} from 'node:fs';
import {skyFacingPlane} from '../src/app/sky-dome-billboard.ts';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} not equal to ${b}`);
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('every celestial label faces the same central observer, including cube-face seams',()=>{
  const points=[
    [0,0,-100],[100,0,0],[0,0,100],[-100,0,0],[0,100,0],[0,-100,0],
    [71,47,50],[10,99,1],[-3,-98,9],
  ];
  for(const p of points){
    const position=new THREE.Vector3(...p);
    const plane=skyFacingPlane(null,position,10,6);
    const facing=new THREE.Vector3(0,0,1).applyQuaternion(plane.quaternion);
    near(facing.dot(position.clone().normalize()),-1);
    near(plane.position.distanceTo(position),0);
    near(plane.quaternion.length(),1);
    near(plane.geometry.attributes.position.count,4);
    assert.equal(plane.material.depthWrite,false);
    plane.geometry.dispose();plane.material.dispose();
  }
});

test('the tiny glyph anchor places it beside the centre of the planet',()=>{
  const position=new THREE.Vector3(0,20,-100);
  const plane=skyFacingPlane(null,position,3,3,{anchorX:0.1,anchorY:0.1,opacity:0.7,renderOrder:2});
  plane.geometry.computeBoundingBox();
  const box=plane.geometry.boundingBox;
  assert.ok(Math.abs((box.min.x+box.max.x)/2-1.2)<1e-6);
  assert.ok(Math.abs((box.min.y+box.max.y)/2-1.2)<1e-6);
  assert.equal(plane.material.opacity,0.7);
  assert.equal(plane.renderOrder,2);
  plane.geometry.dispose();plane.material.dispose();
});

test('bad geometry or anchors never produce unbounded GPU surfaces',()=>{
  for(const bad of [
    [new THREE.Vector3(0,0,0),3,3,{}],
    [new THREE.Vector3(NaN,1,0),3,3,{}],
    [new THREE.Vector3(0,1,0),-1,3,{}],
    [new THREE.Vector3(0,1,0),2,0,{}],
    [new THREE.Vector3(0,1,0),2,3,{anchorX:-1}],
    [new THREE.Vector3(0,1,0),2,3,{anchorY:2}],
  ])assert.throws(()=>skyFacingPlane(null,...bad),/Invalid sky billboard/);
});

test('fisheye marker rendering avoids Sprite orientation seams',()=>{
  const viewer=read('src/app/sky-dome.component.ts');
  const helper=read('src/app/sky-dome-billboard.ts');
  assert.match(helper,/makeBasis\(right,up,normal\)/);
  assert.match(viewer,/skyFacingPlane\(portrait/);
  assert.match(viewer,/skyFacingPlane\(texture/);
  assert.doesNotMatch(viewer,/new THREE\.Sprite\(/);
  assert.match(viewer,/this\.selectionRing\.geometry\.dispose\(\)/);
});
