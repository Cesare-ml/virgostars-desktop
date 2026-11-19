// VirgoStars Desktop original source, CPAL-1.0. See LICENSE and NOTICE.
// Compile the reviewed digest into the private installer; it is never read
// from the downloaded catalog or from an untrusted runtime environment.
import { spawnSync } from 'node:child_process';
import { RELEASE_CATALOG_SHA256 } from './release-catalog.mjs';

const result = spawnSync(process.execPath, [
  'node_modules/@tauri-apps/cli/tauri.js', 'build', '--bundles', 'nsis',
  '--config', '.local/places/tauri-places.conf.json',
  '--config', '.local/ephemeris/tauri-ephemeris.conf.json',
], { stdio: 'inherit', env: { ...process.env, VIRGOSTARS_DE441_CATALOG_SHA256: RELEASE_CATALOG_SHA256 } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
