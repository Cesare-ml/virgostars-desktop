/** Opt-in offline scientific-difference audit. Never approves production readiness. */
import { openSync, readSync, closeSync, fstatSync } from 'node:fs';
import { compareExperimentalToReference } from './de441-reference-check.mjs';

const LIMIT = 256 * 1024;
function readBoundedJson(path) {
  let fd;
  try {
    fd = openSync(path, 'r');
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size < 2 || stat.size > LIMIT) return null;
    const buf = Buffer.alloc(stat.size + 1);
    let n = 0;
    while (n < buf.length) {
      const count = readSync(fd, buf, n, buf.length - n, null);
      if (count === 0) break;
      n += count;
    }
    if (n !== stat.size) return null;
    return JSON.parse(buf.subarray(0,n).toString('utf8'));
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
