#!/usr/bin/env node
// Local owner builds use the approved private catalogue when present. The
// public/synthetic build remains possible without that separate data file.
import {spawnSync} from 'node:child_process';
import {existsSync, readFileSync, statSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = join(root,'.local','ephemeris','fixed-stars.json');
const env = {...process.env};
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
const result=spawnSync(process.execPath,[join(root,'node_modules','@tauri-apps','cli','tauri.js'),...process.argv.slice(2)],{cwd:root,env,stdio:'inherit'});
if (result.error) throw result.error;
process.exitCode=result.status ?? 1;
