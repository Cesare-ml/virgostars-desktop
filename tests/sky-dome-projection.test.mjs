import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  clampedSkyFov,fisheyeBlend,normalizePitch,
  skyCameraFrame,skyFisheyeWorldRay,skyLensTheta,skyWorldVector,
  SKY_FISHEYE_START_DEG,SKY_FOV_MIN_DEG,SKY_FOV_MAX_DEG,
} from '../src/app/sky-dome-projection.ts';

const near=(v,w,tolerance=1e-10)=>
  assert.ok(Math.abs(v-w)<=tolerance,`expected ${v} ~ ${w} (tolerance ${tolerance})`);
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const cross=(a,b)=>({
  x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x,
});
const length=v=>Math.hypot(v.x,v.y,v.z);
const source=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('Three sky is right-handed: North faces -Z, East +X, South +Z, West -X',()=>{
  const n=skyWorldVector(0,0),e=skyWorldVector(90,0),s=skyWorldVector(180,0),w=skyWorldVector(270,0);
  near(n.x,0);near(n.z,-1);
  near(e.x,1);near(e.z,0);
  near(s.z,1);near(w.x,-1);
  near(skyWorldVector(30,90).y,1);
  near(skyWorldVector(30,-90).y,-1);
  assert.equal(skyWorldVector(0,91),null);
  assert.equal(skyWorldVector(0,0,0),null);
});

test('camera basis is right-handed and remains stable through zenith and nadir',()=>{
  for(const yaw of [0,45,90,180,270,359.99]){
    for(const pitch of [-180,-120,-90,-45,0,45,89.99,90,90.01,135,180]){
      const frame=skyCameraFrame(yaw,pitch);
      assert.ok(frame);
      near(length(frame.right),1);
      near(length(frame.up),1);
      near(length(frame.back),1);
      near(dot(frame.right,frame.up),0);
      near(dot(frame.back,frame.up),0);
      near(dot(frame.back,frame.right),0);
      near(dot(cross(frame.right,frame.up),frame.back),1);
    }
  }
  near(skyCameraFrame(0,0).back.z,1);
  near(skyCameraFrame(0,90).back.y,-1);
  near(skyCameraFrame(0,-90).back.y,1);
  near(skyCameraFrame(0,120).headingDeg,180);
  near(skyCameraFrame(0,120).altitudeDeg,60);
  near(normalizePitch(360),0);
  near(normalizePitch(270),-90);
  assert.equal(skyCameraFrame(NaN,0),null);
});

test('fisheye lens matches perspective at 85° then transitions smoothly to >180°',()=>{
  assert.equal(SKY_FISHEYE_START_DEG,85);
  assert.equal(SKY_FOV_MIN_DEG,28);
  assert.equal(SKY_FOV_MAX_DEG,220);
  near(fisheyeBlend(85),0);
  near(fisheyeBlend(120),1);
  near(fisheyeBlend(102.5),.5);
  const r=.65, half=85*Math.PI/360;
  near(skyLensTheta(r,85),Math.atan(r*Math.tan(half)));
  // A 220° lens extends 20° behind the observer at its vertical rim.
  near(skyLensTheta(1,220),110*Math.PI/180);
  // More than 180° away from the center is outside a unique sampling direction.
  assert.equal(skyLensTheta(2,220),null);
  assert.equal(skyLensTheta(-1,100),null);
  assert.equal(skyLensTheta(1,221),null);
  assert.equal(clampedSkyFov(200),200);
  assert.equal(clampedSkyFov(-100),SKY_FOV_MIN_DEG);
  assert.equal(clampedSkyFov(400),SKY_FOV_MAX_DEG);
});

test('fisheye pick rays agree with compass and survive the poles',()=>{
  const north=skyCameraFrame(0,0);
  const center=skyFisheyeWorldRay(0,0,1.5,200,north);
  near(center.x,0);near(center.y,0);near(center.z,-1);
  const right=skyFisheyeWorldRay(1,0,1,180,north);
  near(right.x,1);near(right.y,0);near(right.z,0);
  const zenith=skyFisheyeWorldRay(0,0,1,200,skyCameraFrame(210,90));
  near(zenith.y,1);
  const nadir=skyFisheyeWorldRay(0,0,1,200,skyCameraFrame(210,-90));
  near(nadir.y,-1);
  // A 220° look near the zenith also sees past the horizon.
  const past=skyFisheyeWorldRay(0,1,1,220,skyCameraFrame(0,90));
  assert.ok(past.y<0);
  assert.equal(skyFisheyeWorldRay(2,2,1,220,north),null);
});

test('3D renderer uses one cached cubemap and a coherent fisheye pick ray',()=>{
  const lens=source('src/app/sky-dome-fisheye.ts');
  const viewer=source('src/app/sky-dome.component.ts');
  const html=source('src/app/sky-dome.component.html');
  assert.match(lens,/THREE\.WebGLCubeRenderTarget/);
  assert.match(lens,/THREE\.CubeCamera/);
  assert.match(lens,/if\(this\.dirty\)/);
  assert.match(lens,/this\.dirty=false/);
  assert.match(lens,/mix\(perspective,equidistant,uBlend\)/);
  assert.match(viewer,/skyFisheyeWorldRay\(ndc\.x,ndc\.y/);
  assert.match(viewer,/this\.skyLens\.render\(this\.renderer,this\.scene,this\.camera\)/);
  assert.match(viewer,/normalizePitch\(alt\)/);
  assert.match(viewer,/skyWorldVector\(az,alt,r\)/);
  assert.match(viewer,/this\.skyLens\?\.dispose\(\)/);
  assert.match(lens,/constructor\(size:256\|512\|1024=1024\)/);
  assert.match(viewer,/MAX_CUBE_MAP_TEXTURE_SIZE/);
  assert.match(viewer,/this\.fisheyeUnavailable=true/);
  assert.match(html,/word\('lensUnavailable'\)/);
  assert.match(html,/word\(isSpherical \? 'spherical' : 'perspective'\)/);
  assert.match(html,/\(click\)="look\(180,-90\)"/);
  assert.match(html,/\(click\)="zoomSky\(10\)"/);
  assert.match(html,/\(click\)="showAllSky\(\)"/);
  assert.match(viewer,/this\.camera\.fov=200/);
  assert.match(viewer,/underground\.computeLineDistances\(\)/);
  assert.doesNotMatch(viewer,/Math\.random|fakeStar|syntheticStar/);
});
