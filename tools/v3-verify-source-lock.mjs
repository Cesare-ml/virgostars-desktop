/**
 * Offline, synthetic-only v3 source integrity preflight. This is a Git blob SHA-1
 * *consistency* lock, not a signature, server authentication or release approval.
 * The maintainer MUST review every manifest update alongside changed SQL/tests.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverV3Suites, REQUIRED_SQL_SCHEMAS } from './v3-sqlite-reference-gate.mjs';

export const V3_SOURCE_LOCK = 'contracts/sqlite/v3-reference-source-lock.json';
const SHA1 = /^[a-f0-9]{40}$/;

export function gitBlobSha1(bytes) {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`, 'utf8')
    .update(bytes)
    .digest('hex');
}

export function verifyV3SourceLock(root) {
  const base = resolve(root);
  const lockFile = join(base, ...V3_SOURCE_LOCK.split('/'));
  if (!existsSync(lockFile) || !statSync(lockFile).isFile()) {
    throw new Error(`Missing reviewed v3 source lock: ${V3_SOURCE_LOCK}`);
  }
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  if (lock?.format !== 'virgostars-v3-reference-git-blobs-v1' ||
      !lock.files || typeof lock.files !== 'object' || Array.isArray(lock.files)) {
    throw new Error('Invalid reviewed v3 source lock format');
  }
  const suites = discoverV3Suites(base);
  const expectedPaths = [
    ...REQUIRED_SQL_SCHEMAS.map((name) => `contracts/sqlite/${name}`),
    ...suites.map((path) => relative(base, path).split(sep).join('/')),
  ].sort();
  const declared = Object.keys(lock.files).sort();
  if (expectedPaths.length !== declared.length ||
      expectedPaths.some((path, index) => path !== declared[index])) {
    throw new Error('Reviewed v3 source lock does not cover exactly the tracked schemas and test suites');
  }
  for (const path of expectedPaths) {
    const expected = lock.files[path];
    if (typeof expected !== 'string' || !SHA1.test(expected)) {
      throw new Error(`Invalid v3 git blob fingerprint: ${path}`);
    }
    const localPath = join(base, ...path.split('/'));
    if (!statSync(localPath).isFile()) {
      throw new Error(`Expected reviewed v3 file: ${path}`);
    }
    const actual = gitBlobSha1(readFileSync(localPath));
    if (actual !== expected) {
      throw new Error(`v3 source drift from reviewed Git blob: ${path} (expected ${expected}, got ${actual})`);
    }
  }
  return { suites: suites.length, checked: expectedPaths.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
    const result = verifyV3SourceLock(root);
    console.log(`PASS: verified ${result.checked} exact Git blobs (${result.suites} synthetic SQLite v3 suites).`);
    console.log('This is a reviewed-source consistency check, NOT a digital signature or SQLCipher validation.');
  } catch (error) {
    console.error(`FAIL / NOT READY: ${error.message}`);
    process.exitCode = 1;
  }
}
