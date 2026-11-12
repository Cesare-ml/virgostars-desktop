/**
 * Explicit local-only smoke validation. Not run by npm test, not a Tauri IPC.
 * Usage: node --experimental-strip-types scripts/verify-de441-json-bridge.mjs
 *        <external-de441-file> <canonical-UTC-ISO> <latMicro> <lngMicro> <heightMeters>
 * Never prints a user's kernel path, birth place, date or stdout on errors.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isExperimentalSkySnapshotV1 } from '../src/app/native/experimental-sky-contract.ts';

const args = process.argv.slice(2);
function error(code) {
  process.stderr.write('DE441_SMOKE:'+code+'\n');
  process.exitCode = 1;
}
if (args.length !== 5) {
  error('ARGUMENTS_REQUIRED');
} else {
  const [kernel, utcIso, rawLat, rawLng, rawHeight] = args;
  const latMicro = Number(rawLat);
  const lngMicro = Number(rawLng);
  const heightMeters = Number(rawHeight);
  const request = { utcIso, latMicro, lngMicro };
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(utcIso) ||
      Number.isNaN(Date.parse(utcIso)) ||
      !Number.isSafeInteger(latMicro) || !Number.isSafeInteger(lngMicro) ||
      Math.abs(latMicro) > 90_000_000 || Math.abs(lngMicro) > 180_000_000 ||
      !Number.isFinite(heightMeters) || heightMeters < -12000 || heightMeters > 100000) {
    error('INVALID_INPUT');
  } else {
    const manifest = fileURLToPath(new URL('../experiments/de441-json-bridge/Cargo.toml', import.meta.url));
    const result = spawnSync('cargo', [
      'run', '--quiet', '--manifest-path', manifest, '--', kernel, utcIso,
      String(latMicro), String(lngMicro), String(heightMeters),
    ], {encoding:'utf8',shell:false,windowsHide:true,maxBuffer:1024*1024});
    if (result.error || result.status !== 0 || !result.stdout) {
      error('NATIVE_UNAVAILABLE');
    } else {
      let payload = null;
      try { payload = JSON.parse(result.stdout); } catch { /* no raw payload leak */ }
      if (!isExperimentalSkySnapshotV1(payload, request) || payload.heightMeters !== heightMeters) {
        error('INVALID_SCIENTIFIC_CONTRACT');
      } else {
        process.stdout.write('DE441_SMOKE:SHAPE_VALID_EXPERIMENTAL_UNVERIFIED\n');
        process.stdout.write('Scientific numerical accuracy, provenance rights and Tauri IPC remain unverified.\n');
      }
    }
  }
}
