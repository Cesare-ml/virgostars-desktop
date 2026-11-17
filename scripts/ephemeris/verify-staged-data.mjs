#!/usr/bin/env node
// Fails closed before an installer build: every staged data file must exist and match its manifest hash.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const stage = join(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), '.local', 'ephemeris');
const manifestPath = join(stage, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error('No staged ephemeris data. Run scripts/ephemeris/prepare-data-bundle.mjs first (see docs/EPHEMERIS_DATA_BUNDLE.md).');
  process.exit(1);
}
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const required = ['de441-slice.eph', 'usno/deltat.data', 'usno/historic_deltat.data', 'usno/deltat.preds', 'chiron.bsp'];
for (const name of required) if (!manifest.files.some(file => file.name === name)) { console.error(`manifest lacks ${name}`); process.exit(1); }
for (const file of manifest.files) {
  const path = join(stage, file.name);
  if (!existsSync(path)) { console.error(`staged file missing: ${file.name}`); process.exit(1); }
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (hash !== file.sha256) { console.error(`hash differs from the manifest: ${file.name}`); process.exit(1); }
}
if (!existsSync(join(stage, 'tauri-ephemeris.conf.json'))) { console.error('tauri-ephemeris.conf.json missing'); process.exit(1); }
console.log(`Staged ephemeris data verified (${manifest.files.length} files).`);
