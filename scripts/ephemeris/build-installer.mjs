// VirgoStars Desktop original source, CPAL-1.0. See LICENSE and NOTICE.
// Compile the reviewed digest into the private installer; it is never read
// from the downloaded catalog or from an untrusted runtime environment.
import { spawnSync } from 'node:child_process';
import { RELEASE_CATALOG_SHA256 } from './release-catalog.mjs';
import { installerArguments } from './installer-arguments.mjs';

const args = installerArguments(process.argv.slice(2));

const notices = spawnSync(process.execPath, ['scripts/ephemeris/prepare-release-notices.mjs'], {stdio:'inherit'});
if (notices.error) throw notices.error;
if (notices.status !== 0) process.exit(notices.status ?? 1);

const result = spawnSync(process.execPath, [
  'scripts/run-tauri-with-local-stars.mjs', ...args,
], { stdio: 'inherit', env: { ...process.env, VIRGOSTARS_DE441_CATALOG_SHA256: RELEASE_CATALOG_SHA256 } });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
