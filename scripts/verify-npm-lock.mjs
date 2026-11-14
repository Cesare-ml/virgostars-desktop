#!/usr/bin/env node
/** Read-only, dependency-free provenance audit of the committed npm lockfile. */
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNpmTarballIdentity} from './verify-npm-tarball.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const LOCAL_TARGET='../astrological-charts/dist/grafici-astrologici';
const LOCAL_LINK='node_modules/grafici-astrologici';
const isRecord=x=>x!==null && typeof x==='object' && !Array.isArray(x);
const assert=(condition,message)=>{if(!condition)throw new Error(message)};
const canonical=x=>JSON.stringify(Object.entries(x).sort(([a],[b])=>a.localeCompare(b)));

// SRI for SHA-512 must contain exactly 64 digest bytes in canonical padded Base64.
// A loose "sha512-" prefix is not sufficient to establish usable npm integrity.
function canonicalSha512Integrity(value) {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return false;
  const encoded=value.slice('sha512-'.length);
  const digest=Buffer.from(encoded,'base64');
  return digest.length===64 && digest.toString('base64')===encoded;
}

export function auditNpmLock(manifest,lock) {
  assert(isRecord(manifest) && isRecord(lock) && lock.lockfileVersion===3 &&
    isRecord(lock.packages) && isRecord(lock.packages['']), 'Invalid npm lock structure');
  const root=lock.packages[''];
  assert(root.name===manifest.name && root.version===manifest.version &&
    canonical(root.dependencies??{})===canonical(manifest.dependencies??{}) &&
    canonical(root.devDependencies??{})===canonical(manifest.devDependencies??{}) &&
    canonical(root.engines??{})===canonical(manifest.engines??{}),
    'npm lock root differs from package manifest');
  assert(manifest.dependencies?.['grafici-astrologici']==='file:'+LOCAL_TARGET,
    'Unreviewed local Charts package source');
  assert(isRecord(lock.packages[LOCAL_TARGET]) &&
    typeof lock.packages[LOCAL_TARGET].version==='string' &&
    !Object.hasOwn(lock.packages[LOCAL_TARGET],'resolved') &&
    !Object.hasOwn(lock.packages[LOCAL_TARGET],'integrity'),
    'Invalid local Charts package metadata');
  const link=lock.packages[LOCAL_LINK];
  assert(isRecord(link) && link.link===true && link.resolved===LOCAL_TARGET &&
    Object.keys(link).length===2, 'Unreviewed local npm link');
  const entries=Object.entries(lock.packages).filter(([name])=>name!=='');
  assert(entries.length>=3 && entries.length<=10000, 'Unexpected npm lock package count');
  let registryPackages=0;
  for(const [name,entry] of entries) {
    if(name===LOCAL_TARGET || name===LOCAL_LINK)continue;
    assert(name.startsWith('node_modules/') && !name.split('/').includes('..') &&
      isRecord(entry) && entry.link!==true, 'Unreviewed npm package path or link');
    assert(typeof entry.resolved==='string' && canonicalSha512Integrity(entry.integrity),
      'Missing verified npm package origin or SHA-512 integrity');
    let url;
    try {url=new URL(entry.resolved)}catch{throw new Error('Invalid npm package URL')}
    assert(url.protocol==='https:' && url.hostname==='registry.npmjs.org' &&
      url.port==='' && url.username==='' && url.password==='' &&
      url.search==='' && url.hash==='' && url.pathname.endsWith('.tgz'),
      'Unreviewed npm package registry origin');
    assertNpmTarballIdentity(name, entry, lock.packages, url);
    registryPackages++;
  }
  assert(registryPackages>0, 'No verified npm registry dependencies');
  return Object.freeze({registryPackages,localLinks:1});
}

export function auditNpmLockCheckout(root=ROOT) {
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  const lockfile=readFileSync(join(root,'package-lock.json'),'utf8');
  assert(lockfile.length<4_000_000, 'Unexpected npm lockfile size');
  return auditNpmLock(manifest,JSON.parse(lockfile));
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    if(process.argv.length!==2)throw new Error('No CLI arguments allowed');
    const result=auditNpmLockCheckout();
    console.log('Verified '+result.registryPackages+' pinned npm registry packages and one public Charts link.');
  } catch {
    console.error('NPM LOCK PROVENANCE CHECK FAILED. Review package-lock.json before installing.');
    process.exitCode=1;
  }
}
