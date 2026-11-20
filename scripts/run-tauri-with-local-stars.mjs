#!/usr/bin/env node
// Local owner builds use the approved private catalogue when present. The
// public/synthetic build remains possible without that separate data file.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withLocalOwnerFeatures} from './local-owner-features.mjs';
import {verifyDevResources} from './ephemeris/dev-resources.mjs';
import {RELEASE_CATALOG_SHA256} from './ephemeris/release-catalog.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = join(root,'.local','ephemeris','fixed-stars.json');
const env = {...process.env};
// Only the development launcher may select this separate resource folder.
delete env.VIRGOSTARS_DE441_DEV_RESOURCES;
if (process.argv[2] === 'dev') {
  const devResources = join(root, '.local', 'de441-dev');
  if (verifyDevResources(devResources)) {
    env.VIRGOSTARS_DE441_DEV_RESOURCES = devResources;
    env.VIRGOSTARS_DE441_CATALOG_SHA256 = RELEASE_CATALOG_SHA256;
    console.log('Using the verified DE441 development base and package catalog.');
  } else {
    console.log('DE441 development base not staged; optional date packages are unavailable.');
  }
}
if (existsSync(catalog)) {
  if (statSync(catalog).size > 8*1024*1024) throw new Error('Local fixed-star catalogue exceeds the size limit');
  const data=JSON.parse(readFileSync(catalog,'utf8'));
  if (data?.schema!=='virgostars-desktop-stars/1' || typeof data.provenance!=='string' || !data.provenance.trim() ||
      !Array.isArray(data.stars) || !data.stars.length || data.stars.length>2048) throw new Error('Invalid local fixed-star catalogue');
  env.VIRGOSTARS_EMBED_PRIVATE_STARS='1';
  console.log(`Including the local private stellar catalogue (${data.stars.length} entries).`);
} else {
  delete env.VIRGOSTARS_EMBED_PRIVATE_STARS;
  console.log('No local private stellar catalogue: using the synthetic Sirius fallback.');
}
// Local owner builds explicitly include the reviewed production account bridge.
// The public synthetic build retains the default-disabled native feature.
const args = withLocalOwnerFeatures(process.argv.slice(2));
const result=spawnSync(process.execPath,[join(root,'node_modules','@tauri-apps','cli','tauri.js'),...args],{cwd:root,env,stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode=result.status ?? 1;
