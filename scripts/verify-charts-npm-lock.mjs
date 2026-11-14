#!/usr/bin/env node
/** Offline, read-only provenance preflight for the sibling Charts npm ci. */
import {lstatSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertNpmTarballIdentity} from './verify-npm-tarball.mjs';

const DESKTOP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHARTS = resolve(DESKTOP, '../astrological-charts');
const isRecord = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const requireThat = (ok, message) => { if (!ok) throw new Error(message); };
const canonical = x => JSON.stringify(Object.entries(x ?? {}).sort(([a], [b]) => a.localeCompare(b)));

function canonicalSha512(value) {
  if (typeof value !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(value)) return false;
  const encoded = value.slice(7);
  const digest = Buffer.from(encoded, 'base64');
  return digest.length === 64 && digest.toString('base64') === encoded;
}

/** No local package links, alternate registries or unpinned archives. */
export function auditChartsNpmLock(manifest, lock) {
  requireThat(isRecord(manifest) && manifest.name === 'grafici-astrologici' &&
    isRecord(lock) && lock.lockfileVersion === 3 &&
    lock.name === manifest.name && lock.version === manifest.version &&
    isRecord(lock.packages) && isRecord(lock.packages['']),
    'Invalid Charts npm lockfile root');
  const root = lock.packages[''];
  requireThat(root.name === manifest.name && root.version === manifest.version &&
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'engines']
      .every(key => canonical(root[key]) === canonical(manifest[key])),
    'Charts lockfile differs from its package.json');
  const packages = Object.entries(lock.packages).filter(([name]) => name !== '');
  requireThat(packages.length >= 1 && packages.length <= 15000,
    'Unexpected Charts npm lock package count');
  for (const [name, entry] of packages) {
    requireThat(name.startsWith('node_modules/') && !name.split('/').includes('..') &&
      isRecord(entry) && entry.link !== true &&
      typeof entry.resolved === 'string' && canonicalSha512(entry.integrity),
      'Unreviewed Charts package path, local link, or integrity');
    let url;
    try { url = new URL(entry.resolved); }
    catch { throw new Error('Invalid Charts npm tarball URL'); }
    requireThat(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' &&
      url.port === '' && url.username === '' && url.password === '' &&
      url.search === '' && url.hash === '',
      'Unreviewed Charts npm registry origin');
    assertNpmTarballIdentity(name, entry, lock.packages, url);
  }
  return Object.freeze({registryPackages: packages.length, localLinks: 0});
}

export function auditChartsCheckout(charts = CHARTS) {
  const manifestPath = join(charts, 'package.json');
  const lockPath = join(charts, 'package-lock.json');
  // Fail before reading symlinks, special files or oversized checkout metadata.
  // Enforce byte limits, not UTF-16 string lengths, and reject malformed UTF-8.
  for (const [path, directory, limit] of [
    [charts, true, 0], [manifestPath, false, 1000000],
    [lockPath, false, 4000000],
  ]) {
    const stat = lstatSync(path);
    requireThat(!stat.isSymbolicLink() &&
      (directory ? stat.isDirectory() : stat.isFile()),
    'Charts lockfile path is not a regular checkout entry');
    if (!directory) requireThat(stat.size < limit,
      'Charts npm manifest or lockfile exceeds audit size limits');
  }
  const manifestBytes = readFileSync(manifestPath);
  const lockBytes = readFileSync(lockPath);
  requireThat(manifestBytes.length < 1000000 && lockBytes.length < 4000000,
    'Charts npm manifest or lockfile exceeds audit size limits');
  const decode = bytes => new TextDecoder('utf-8', {fatal:true}).decode(bytes);
  return auditChartsNpmLock(JSON.parse(decode(manifestBytes)), JSON.parse(decode(lockBytes)));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('No CLI arguments allowed');
    const report = auditChartsCheckout();
    console.log('Verified ' + report.registryPackages + ' Charts npm registry packages and no local links.');
  } catch {
    // Do not leak local checkout paths, package URLs or user data in build logs.
    console.error('CHARTS NPM LOCK PROVENANCE FAILED. Review sibling package-lock.json before npm ci.');
    process.exitCode = 1;
  }
}
