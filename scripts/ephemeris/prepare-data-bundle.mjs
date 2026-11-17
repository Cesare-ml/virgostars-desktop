#!/usr/bin/env node
// Stages the astronomical data that an installer ships, from files the maintainer supplies locally.
// Output (git-ignored): .local/ephemeris/{de441-slice.eph, usno/*, chiron.bsp, manifest.json,
// tauri-ephemeris.conf.json}. Nothing is downloaded and nothing is committed.
//
// Usage: node scripts/ephemeris/prepare-data-bundle.mjs <full-de441.eph> <usno-dir> <chiron.bsp> [firstYear lastYear]
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [fullDe441, usnoDir, chiron, firstYear = '1890', lastYear = '2110'] = process.argv.slice(2);
if (!fullDe441 || !usnoDir || !chiron) {
  console.error('usage: prepare-data-bundle.mjs <full-de441.eph> <usno-dir> <chiron.bsp> [firstYear lastYear]');
  process.exit(2);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const stage = join(root, '.local', 'ephemeris');
const usnoFiles = ['deltat.data', 'historic_deltat.data', 'deltat.preds'];
for (const name of usnoFiles) if (!existsSync(join(usnoDir, name))) throw new Error(`missing ${name} in the USNO folder`);
mkdirSync(join(stage, 'usno'), { recursive: true });

const sliceOutput = join(stage, 'de441-slice.eph');
execFileSync(process.execPath, [join(root, 'scripts', 'ephemeris', 'slice-de441.mjs'), fullDe441, sliceOutput, firstYear, lastYear], { stdio: 'inherit' });
execFileSync(process.execPath, [join(root, 'scripts', 'ephemeris', 'slice-de441.mjs'), '--verify', fullDe441, sliceOutput], { stdio: 'inherit' });
for (const name of usnoFiles) copyFileSync(join(usnoDir, name), join(stage, 'usno', name));
copyFileSync(chiron, join(stage, 'chiron.bsp'));

const files = ['de441-slice.eph', ...usnoFiles.map(name => `usno/${name}`), 'chiron.bsp'];
const manifest = {
  note: 'Local staging manifest. Hashes identify the files that were shipped; no personal data.',
  files: files.map(name => {
    const path = join(stage, name);
    return { name, bytes: statSync(path).size, sha256: createHash('sha256').update(readFileSync(path)).digest('hex') };
  }),
};
writeFileSync(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const resources = Object.fromEntries([...files, 'manifest.json'].map(name => [`../.local/ephemeris/${name}`, `ephemeris/${name}`]));
writeFileSync(join(stage, 'tauri-ephemeris.conf.json'), JSON.stringify({ bundle: { active: true, resources } }, null, 2) + '\n');
console.log(`staged ${files.length} data files in ${stage}`);
