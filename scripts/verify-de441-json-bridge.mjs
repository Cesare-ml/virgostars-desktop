/**
 * Explicit local-only DE441 shape smoke; no production Tauri IPC or astronomy.
 * Usage: node --experimental-strip-types scripts/verify-de441-json-bridge.mjs
 *   <external-DE441-file> <canonical-UTC-ISO-ms> <latMicro> <lngMicro> <heightMeters>
 * Do not print kernel paths, birth instants, coordinates, stderr or raw JSON.
 */
import { fileURLToPath } from 'node:url';
import { parseDe441SmokeArgs, runDe441CargoSmoke } from './de441-smoke-runner.mjs';
import { isExperimentalSkySnapshotV1 } from '../src/app/native/experimental-sky-contract.ts';

const input = parseDe441SmokeArgs(process.argv.slice(2));
const code = input.kind !== 'VALID' ? input.kind : runDe441CargoSmoke(
  input,
  fileURLToPath(new URL('../experiments/de441-json-bridge/Cargo.toml', import.meta.url)),
  isExperimentalSkySnapshotV1,
);
if (code !== 'SHAPE_VALID_EXPERIMENTAL_UNVERIFIED') {
  process.stderr.write('DE441_SMOKE:' + code + '\n');
  process.exitCode = 1;
} else {
  process.stdout.write('DE441_SMOKE:SHAPE_VALID_EXPERIMENTAL_UNVERIFIED\n');
  process.stdout.write('Scientific numerical accuracy, provenance rights and Tauri IPC remain unverified.\n');
}
