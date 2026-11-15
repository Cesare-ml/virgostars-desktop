#!/usr/bin/env node
/** Read-only, dependency-free provenance audit of the committed npm lockfile. */
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNpmTarballIdentity} from './verify-npm-tarball.mjs';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
// Sibling checkouts linked by path. Anything else must come from the npm registry.
const LOCAL_PACKAGES=Object.freeze([
  Object.freeze({name:'grafici-astrologici',target:'../astrological-charts/dist/grafici-astrologici',label:'Charts'}),
  Object.freeze({name:'astrological-functions',target:'../astrological-functions',label:'Functions'}),
]);
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
  const localEntries=new Set();
  for(const {name,target,label} of LOCAL_PACKAGES) {
    assert(manifest.dependencies?.[name]==='file:'+target,
      'Unreviewed local '+label+' package source');
    assert(isRecord(lock.packages[target]) &&
      typeof lock.packages[target].version==='string' &&
      !Object.hasOwn(lock.packages[target],'resolved') &&
      !Object.hasOwn(lock.packages[target],'integrity'),
      'Invalid local '+label+' package metadata');
    const link=lock.packages['node_modules/'+name];
    assert(isRecord(link) && link.link===true && link.resolved===target &&
      Object.keys(link).length===2, 'Unreviewed local npm link');
    localEntries.add(target).add('node_modules/'+name);
  }
  const entries=Object.entries(lock.packages).filter(([name])=>name!=='');
  assert(entries.length>localEntries.size && entries.length<=10000, 'Unexpected npm lock package count');
  let registryPackages=0;
  for(const [name,entry] of entries) {
    if(localEntries.has(name))continue;
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
  return Object.freeze({registryPackages,localLinks:LOCAL_PACKAGES.length});
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
    console.log('Verified '+result.registryPackages+' pinned npm registry packages and '+result.localLinks+' reviewed sibling links.');
  } catch {
    console.error('NPM LOCK PROVENANCE CHECK FAILED. Review package-lock.json before installing.');
    process.exitCode=1;
  }
}
