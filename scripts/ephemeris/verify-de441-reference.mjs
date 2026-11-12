/** Opt-in offline scientific-difference audit. Never approves production readiness. */
import { openSync, readSync, closeSync, fstatSync, lstatSync, constants } from 'node:fs';
import { compareExperimentalToReference } from './de441-reference-check.mjs';

const LIMIT = 256 * 1024;
// No-follow prevents a link swap between lstat and open on POSIX; O_NONBLOCK
// prevents a swapped-in FIFO from hanging the CLI indefinitely.
const READ_FLAGS = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
  (constants.O_NONBLOCK ?? 0);

function sameFile(before, after) {
  return before.dev === after.dev && before.ino === after.ino &&
    before.size === after.size && before.mtimeNs === after.mtimeNs &&
    before.ctimeNs === after.ctimeNs;
}

function readBoundedJson(path) {
  let fd;
  try {
    // In particular, NEVER open a named pipe, socket, device or symlink.
    // Checking before open is necessary even on hosts without O_NOFOLLOW.
    const preflight = lstatSync(path, {bigint:true});
    if (!preflight.isFile() || preflight.size < 2n || preflight.size > BigInt(LIMIT)) return null;
    fd = openSync(path, READ_FLAGS);
    const before = fstatSync(fd, {bigint:true});
    if (!before.isFile() || !sameFile(preflight, before)) return null;
    const expected = Number(before.size);
    const buffer = Buffer.alloc(expected + 1);
    let n = 0;
    while (n < buffer.length) {
      const got = readSync(fd, buffer, n, buffer.length - n, null);
      if (got === 0) break;
      n += got;
    }
    // Detect shrink/growth or metadata changes during the read; the extra byte
    // detects a growing file even when the initial stat was just below the cap.
    const after = fstatSync(fd, {bigint:true});
    const pathAfter = lstatSync(path, {bigint:true});
    if (n !== expected || !sameFile(before, after) ||
        !pathAfter.isFile() || !sameFile(preflight, pathAfter)) return null;
    return JSON.parse(new TextDecoder('utf-8', {fatal:true})
      .decode(buffer.subarray(0,n)));
  } catch { return null; }
  finally { if (fd !== undefined) try { closeSync(fd); } catch {} }
}

const [a,b,...extra] = process.argv.slice(2);
if (!a || !b || extra.length) {
  process.stderr.write('DE441_REFERENCE:ARGUMENTS_REQUIRED\n');
  process.exitCode = 2;
} else {
  const snapshot = readBoundedJson(a);
  const reference = readBoundedJson(b);
  const result = compareExperimentalToReference(snapshot, reference);
  if (result.kind === 'invalid_input') {
    process.stderr.write('DE441_REFERENCE:INVALID_INPUT\n');
    process.exitCode = 2;
  } else if (result.kind === 'mismatch') {
    process.stderr.write('DE441_REFERENCE:MISMATCH count='+result.failures.length+'\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('DE441_REFERENCE:WITHIN_PROVISIONAL_LIMITS_REVIEW_ONLY\n');
    process.stdout.write('Independent provenance and scientific correctness are NOT certified.\n');
  }
}
