import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {SOLAR_SHADER_KEY,sunlitPlanetMaterial} from '../src/app/sky-dome-solar-material.ts';

test('Sun-oriented globe shader has stable program key and normalizes the native direction',()=>{
  const material=sunlitPlanetMaterial(new THREE.Vector3(3,4,0));
  try{
    assert.equal(material.customProgramCacheKey(),SOLAR_SHADER_KEY);
    const shader={
      uniforms:{},
      vertexShader:'#include <common>\nvoid main() {\n#include <begin_vertex>\n}',
      fragmentShader:'#include <common>\nvoid main() {\n#include <color_fragment>\n}',
    };
    material.onBeforeCompile(shader,{});
    assert.match(shader.vertexShader,/varying vec3 vSkyWorldNormal;/);
    assert.match(shader.vertexShader,/mat3\(modelMatrix\) \* normal/);
    assert.match(shader.fragmentShader,/uniform vec3 uSkySunDir;/);
    assert.match(shader.fragmentShader,/solarIncidence = dot/);
    assert.match(shader.fragmentShader,/diffuseColor\.rgb \*= mix\(0\.065,1\.0,daySide\)/);
    const dir=shader.uniforms.uSkySunDir.value;
    assert.ok(dir instanceof THREE.Vector3);
    assert.ok(Math.abs(dir.length()-1)<1e-12);
    assert.ok(Math.abs(dir.x-0.6)<1e-12);
    assert.ok(Math.abs(dir.y-0.8)<1e-12);
    assert.equal(material.type,'MeshBasicMaterial');
  }finally{material.dispose();}
});

test('Each independent body material captures its own direction, not a global light',()=>{
  const a=sunlitPlanetMaterial(new THREE.Vector3(1,0,0));
  const b=sunlitPlanetMaterial(new THREE.Vector3(-1,0,0));
  try{
    const sample=material=>{
      const shader={
        uniforms:{},
        vertexShader:'#include <common>\n#include <begin_vertex>',
        fragmentShader:'#include <common>\n#include <color_fragment>',
      };
      material.onBeforeCompile(shader,{});
      return shader.uniforms.uSkySunDir.value;
    };
    const left=sample(a),right=sample(b);
    assert.ok(left.dot(right)<-0.999999);
    assert.equal(a.customProgramCacheKey(),b.customProgramCacheKey());
  }finally{a.dispose();b.dispose();}
});

test('Missing, invalid or zero sunlight direction fails without consuming GPU resources',()=>{
  for(const direction of [
    new THREE.Vector3(0,0,0),
    new THREE.Vector3(Number.NaN,0,0),
    new THREE.Vector3(0,Infinity,0),
  ])assert.throws(()=>sunlitPlanetMaterial(direction),/Invalid native sunlight direction/);
});
