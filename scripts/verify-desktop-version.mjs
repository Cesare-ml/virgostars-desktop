#!/usr/bin/env node
/** Offline, read-only release-identity preflight for the experimental Desktop. */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = /^(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)(?:-(?:0|[1-9][0-9]*|[A-Za-z-][A-Za-z0-9-]*)(?:\.(?:0|[1-9][0-9]*|[A-Za-z-][A-Za-z0-9-]*))*)?$/;
const RUST_NAME = /^[a-z][a-z0-9_-]{0,79}$/;

function parseJson(source, label) {
  try {
    const value = JSON.parse(source);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  } catch { /* No filenames or raw parser errors in release diagnostics. */ }
  throw new Error('Invalid ' + label + ' JSON');
}

function cargoManifestPackage(source) {
  let inPackage = false;
  let sections = 0;
  const values = {};
  for (const line of source.split(/\r?\n/)) {
    const heading = /^\s*\[([^\]]+)\]\s*(?:#.*)?$/.exec(line);
    if (heading) {
      inPackage = heading[1] === 'package';
      if (inPackage) sections++;
      continue;
    }
    if (!inPackage || /^\s*(?:#|$)/.test(line)) continue;
    if (!/^\s*(?:name|version)\s*=/.test(line)) continue;
    const entry = /^\s*(name|version)\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/.exec(line);
    if (!entry || Object.hasOwn(values, entry[1])) throw new Error('Invalid or duplicate Cargo package identity');
    values[entry[1]] = entry[2];
  }
  if (sections !== 1 || !RUST_NAME.test(values.name ?? '') || !VERSION.test(values.version ?? '')) {
    throw new Error('Missing or invalid Cargo package identity');
  }
  return values;
}

function lockedCargoVersion(source, packageName) {
  let current = null;
  let matches = [];
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === '[[package]]') {
      current = {};
      matches.push(current);
      continue;
    }
    if (trimmed.startsWith('[')) { current = null; continue; }
    if (!current || /^\s*(?:#|$)/.test(line)) continue;
    if (!/^(?:name|version)\s*=/.test(trimmed)) continue;
    const entry = /^(name|version)\s*=\s*"([^"\r\n]+)"\s*(?:#.*)?$/.exec(trimmed);
    if (!entry || Object.hasOwn(current, entry[1])) throw new Error('Invalid or duplicate Cargo.lock package identity');
    current[entry[1]] = entry[2];
  }
  matches = matches.filter(item => item.name === packageName);
  if (matches.length !== 1 || !VERSION.test(matches[0].version ?? '')) {
    throw new Error('Cargo.lock must contain exactly one matching Desktop package version');
  }
  return matches[0].version;
}

/** Inject text sources for deterministic tests; no network, writes or child processes. */
export function verifyDesktopVersions({
  root = ROOT,
  readText = (path) => readFileSync(join(root, path), 'utf8'),
} = {}) {
  const load = (path, label) => {
    try { return readText(path); }
    catch { throw new Error('Cannot read ' + label + ' version manifest'); }
  };
  const npm = parseJson(load('package.json', 'npm'), 'npm package');
  // Both npm lock v3 root identities are authoritative inputs to npm ci.
  // The standalone Tauri entrypoints run this gate without the deeper npm audit.
  const npmLockText = load('package-lock.json', 'npm lock');
  if (typeof npmLockText !== 'string' || npmLockText.length > 4_000_000) {
    throw new Error('Invalid npm lock size');
  }
  const npmLock = parseJson(npmLockText, 'npm lock');
  const npmRoot = npmLock.packages?.[''];
  if (npmLock.lockfileVersion !== 3 ||
      !npmRoot || typeof npmRoot !== 'object' || Array.isArray(npmRoot) ||
      typeof npm.name !== 'string' || !/^[a-z0-9][a-z0-9-]{0,99}$/.test(npm.name) ||
      npmLock.name !== npm.name || npmRoot.name !== npm.name) {
    throw new Error('Invalid npm lock package identity');
  }
  const tauri = parseJson(load('src-tauri/tauri.conf.json', 'Tauri'), 'Tauri');
  const cargo = cargoManifestPackage(load('src-tauri/Cargo.toml', 'Cargo'));
  const locked = lockedCargoVersion(load('src-tauri/Cargo.lock', 'Cargo.lock'), cargo.name);
  const versions = [npm.version, npmLock.version, npmRoot.version, tauri.version, cargo.version, locked];
  if (!versions.every(v => typeof v === 'string' && v.length <= 80 && VERSION.test(v))) {
    throw new Error('Invalid Desktop version: expected canonical SemVer without build metadata');
  }
  if (!versions.every(v => v === versions[0])) {
    throw new Error('Desktop version mismatch across npm, npm lock, Tauri, Cargo.toml and Cargo.lock');
  }
  return Object.freeze({version: versions[0], checkedManifests: 5});
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = verifyDesktopVersions();
    console.log('Desktop version preflight OK: ' + result.version + ' (' + result.checkedManifests + ' manifests)');
  } catch (error) {
    console.error('Desktop version preflight BLOCKED: ' + error.message);
    process.exitCode = 1;
  }
}
