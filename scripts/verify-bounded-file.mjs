/**
 * Read or hash a bounded regular build artifact from one file descriptor.
 * This is a local package-integrity check; it never follows application URLs.
 */
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync} from 'node:fs';

const CHUNK_BYTES = 64 * 1024;
const invalid = () => { throw new Error('Unsafe or changed desktop build file'); };

function sameFile(left, right) {
  return !!left && !!right && left.isFile() && right.isFile() &&
    !left.isSymbolicLink() && !right.isSymbolicLink() &&
    left.dev === right.dev && left.ino === right.ino &&
    left.size === right.size && left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function consumeFile(path, maxBytes, expectedBytes, acceptChunk) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 ||
      (expectedBytes !== null && (!Number.isSafeInteger(expectedBytes) ||
        expectedBytes < 0 || expectedBytes > maxBytes))) invalid();
  let fd;
  try {
    const original = lstatSync(path, {throwIfNoEntry:false});
    if (!original || original.isSymbolicLink() || !original.isFile() ||
        original.size < 0 || original.size > maxBytes ||
        (expectedBytes !== null && original.size !== expectedBytes)) invalid();
    // O_NOFOLLOW blocks symlink replacement on supporting platforms. Compare
    // descriptor identity with lstat before/after on all platforms as well.
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd);
    if (!sameFile(original, opened)) invalid();
    const chunk = Buffer.allocUnsafe(CHUNK_BYTES);
    let remaining = opened.size;
    while (remaining > 0) {
      const count = readSync(fd, chunk, 0, Math.min(chunk.length, remaining), null);
      if (count <= 0) invalid();
      acceptChunk(chunk.subarray(0, count));
      remaining -= count;
    }
    // Detect an append since the initial fstat without allocating extra data.
    if (readSync(fd, chunk, 0, 1, null) !== 0) invalid();
    if (!sameFile(opened, fstatSync(fd)) ||
        !sameFile(opened, lstatSync(path, {throwIfNoEntry:false}))) invalid();
    return opened.size;
  } catch {
    invalid();
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { invalid(); }
    }
  }
}

/** Only small manifests are materialized; bytes are captured from one fd. */
export function readBoundedBuildFile(path, maxBytes) {
  const chunks = [];
  const total = consumeFile(path, maxBytes, null,
    chunk => chunks.push(Buffer.from(chunk)));
  return Buffer.concat(chunks, total);
}

/** Image contents are streamed into SHA-256 without an image-sized buffer. */
export function hashBoundedBuildFile(path, expectedBytes, maxBytes) {
  const hash = createHash('sha256');
  consumeFile(path, maxBytes, expectedBytes, chunk => hash.update(chunk));
  return hash.digest('hex');
}
