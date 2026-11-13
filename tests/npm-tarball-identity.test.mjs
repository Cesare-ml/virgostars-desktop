import test from 'node:test';
import assert from 'node:assert/strict';
import {assertNpmTarballIdentity} from '../scripts/verify-npm-tarball.mjs';

const url=path=>new URL('https://registry.npmjs.org'+path);
const entry=(version='1.2.3',name)=>({...name?{name}:{},version});
function check(lockPath,info,packages,path){
  assert.doesNotThrow(()=>assertNpmTarballIdentity(lockPath,info,packages,url(path)));
}
function reject(lockPath,info,packages,path){
  assert.throws(()=>assertNpmTarballIdentity(lockPath,info,packages,url(path)),
    /npm (tarball|package|installed)|Undeclared/);
}

test('accepts conventional, scoped and nested registry package tarballs',()=>{
  check('node_modules/three',entry('0.170.0'),{},
    '/three/-/three-0.170.0.tgz');
  check('node_modules/@angular/core',entry('20.3.35'),{},
    '/@angular/core/-/core-20.3.35.tgz');
  check('node_modules/app/node_modules/@scope/pkg',entry('1.0.0-beta.2'),{},
    '/@scope/pkg/-/pkg-1.0.0-beta.2.tgz');
});

test('requires the precise package AND version on the expected registry path',()=>{
  for(const path of [
    '/other/-/other-0.170.0.tgz',
    '/three/-/three-0.170.1.tgz',
    '/three/-/wrong-0.170.0.tgz',
    '/three/-/three-0.170.0.tgz/extra',
    '/three/-/three-0.170.0.TGZ',
    '/three/../other/-/three-0.170.0.tgz',
    '/%74hree/-/three-0.170.0.tgz',
  ])reject('node_modules/three',entry('0.170.0'),{},path);
});

test('allows explicit npm aliases declared by installed parent package',()=>{
  const aliases=[
    ['string-width-cjs','string-width','4.2.3'],
    ['strip-ansi-cjs','strip-ansi','6.0.1'],
    ['wrap-ansi-cjs','wrap-ansi','7.0.0'],
  ];
  const parent={dependencies:Object.fromEntries(aliases.map(([installed,source,version])=>
    [installed,'npm:'+source+'@^'+version]))};
  const packages={'node_modules/@isaacs/cliui':parent};
  for(const [installed,source,version] of aliases){
    check('node_modules/'+installed,entry(version,source),packages,
      '/'+source+'/-/'+source+'-'+version+'.tgz');
  }
});

test('rejects undeclared, empty and spoofed alias metadata',()=>{
  reject('node_modules/wrap-ansi-cjs',entry('7.0.0','wrap-ansi'),{},
    '/wrap-ansi/-/wrap-ansi-7.0.0.tgz');
  reject('node_modules/wrap-ansi-cjs',entry('7.0.0','wrap-ansi'),
    {'node_modules/parent':{dependencies:{'wrap-ansi-cjs':'npm:another@^7.0.0'}}},
    '/wrap-ansi/-/wrap-ansi-7.0.0.tgz');
  reject('node_modules/wrap-ansi-cjs',entry('7.0.0','wrap-ansi'),
    {'node_modules/parent':{dependencies:{'wrap-ansi-cjs':'npm:wrap-ansi@'}}},
    '/wrap-ansi/-/wrap-ansi-7.0.0.tgz');
  reject('node_modules/wrap-ansi-cjs',entry('7.0.0','wrap-ansi'),
    {'node_modules/wrap-ansi-cjs':{dependencies:{'wrap-ansi-cjs':'npm:wrap-ansi@^7.0.0'}}},
    '/wrap-ansi/-/wrap-ansi-7.0.0.tgz');
});

test('rejects invalid installed keys, injected identities and versions',()=>{
  for(const installed of [
    'node_modules/../three',
    'node_modules/@scope/',
    'node_modules/three/nested',
    'node_modules/three/node_modules/../bar',
  ])reject(installed,entry('1.2.3'),{},'/three/-/three-1.2.3.tgz');
  for(const invalid of [
    {name:'../three',version:'1.2.3'},
    {name:[],version:'1.2.3'},
    {version:'1.2.3/../../../other'},
    {version:'latest'},
    {version:null},
  ])reject('node_modules/three',invalid,{},'/three/-/three-1.2.3.tgz');
});
