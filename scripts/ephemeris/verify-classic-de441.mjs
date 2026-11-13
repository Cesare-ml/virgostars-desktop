/** Offline-only, read-only classic DE441 integrity preflight for an operator-owned file. */
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED_HEADER = Buffer.from('JPL Planetary Ephemeris DE441', 'ascii');
const HEADER_BYTES = 2844;
const BLOCK_BYTES = 1024 * 1024;
const MAX_BYTES = 16n * 1024n * 1024n * 1024n;
function fail(message) { throw new Error('DE441 PREFLIGHT: ' + message); }

/**
 * Validate the source file without copying, modifying, or bundling it.
 * A matching operator-provided digest establishes byte identity ONLY: it is
 * not a NASA provenance certificate or a scientific numerical validation.
 */
export async function verifyClassicDe441(filePath, expected) {
  if (typeof filePath !== 'string' || filePath.length === 0 || !expected ||
      typeof expected !== 'object' || !/^[a-f0-9]{64}$/.test(expected.sha256) ||
      !Number.isSafeInteger(expected.bytes) || expected.bytes < HEADER_BYTES ||
      BigInt(expected.bytes) > MAX_BYTES) fail('invalid expected byte count or SHA-256');
  let link;
  try { link = await lstat(filePath, { bigint: true }); }
  catch { fail('source file is unavailable'); }
  if (!link.isFile() || link.isSymbolicLink()) fail('source must be a regular file, not a symlink');
  // O_NOFOLLOW is available on some operating systems; lstat plus the
  // opened-file identity check is also used when the flag is unsupported.
  let file;
  try { file = await open(filePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); }
  catch { fail('cannot open source safely'); }
  try {
    const first = await file.stat({ bigint: true });
    if (!first.isFile() || first.dev !== link.dev || first.ino !== link.ino ||
        first.size !== link.size || first.size !== BigInt(expected.bytes)) {
      fail('file identity or size differs from expected');
    }
    const header = Buffer.alloc(HEADER_BYTES);
    const initial = await file.read(header, 0, HEADER_BYTES, 0);
    if (initial.bytesRead !== HEADER_BYTES ||
        !header.subarray(0, EXPECTED_HEADER.length).equals(EXPECTED_HEADER) ||
        header.readInt32LE(2840) !== 441) fail('not a classic little-endian DE441 header');
    const digest = createHash('sha256');
    const block = Buffer.allocUnsafe(BLOCK_BYTES);
    let offset = 0;
    while (offset < expected.bytes) {
      const length = Math.min(BLOCK_BYTES, expected.bytes - offset);
      const { bytesRead } = await file.read(block, 0, length, offset);
      if (bytesRead <= 0) fail('source truncated while verifying');
      digest.update(block.subarray(0, bytesRead));
      offset += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (after.size !== first.size || after.mtimeNs !== first.mtimeNs ||
        after.ctimeNs !== first.ctimeNs) fail('source changed during verification');
    const actual = digest.digest('hex');
    if (actual !== expected.sha256) fail('SHA-256 does not match expected bytes');
    return Object.freeze({ format: 'JPL_DE441_CLASSIC_LE', bytes: expected.bytes, sha256: actual });
  } finally {
    await file.close();
  }
}

export function parseKernelArgs(args) {
  if (args.length !== 6) fail('expected --file PATH --bytes INTEGER --sha256 HEX');
  const values = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--file', '--bytes', '--sha256'].includes(key) ||
        Object.hasOwn(values, key) || args[i + 1]?.startsWith('--')) fail('invalid CLI arguments');
    values[key] = args[i + 1];
  }
  if (!values['--file'] || !/^[0-9]+$/.test(values['--bytes'] ?? '')) {
    fail('invalid CLI arguments');
  }
  const bytes = Number(values['--bytes']);
  return { file: values['--file'], expected: { bytes, sha256: values['--sha256'] } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const {file, expected} = parseKernelArgs(process.argv.slice(2));
    const result = await verifyClassicDe441(file, expected);
    console.log('DE441 PREFLIGHT PASS: ' + result.format + '; ' + result.bytes + ' bytes; SHA-256 ' + result.sha256 + '.');
    console.log('Byte/header check only; NO scientific validation or bundle authorization.');
  } catch (error) {
    // Do not print source path or OS error messages from an operator's machine.
    console.error(error instanceof Error && error.message.startsWith('DE441 PREFLIGHT:')
      ? error.message : 'DE441 PREFLIGHT: verification failed');
    process.exitCode = 1;
  }
}
