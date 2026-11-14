/**
 * Read the two known Angular CSS gate inputs without unbounded file reads.
 * This is a source-artifact check, not an OS-level atomic snapshot guarantee.
 */
import {constants, closeSync, fstatSync, lstatSync, openSync, readSync} from 'node:fs';

export const MAX_BUNDLED_HTML_BYTES = 2 * 1024 * 1024;
export const MAX_BUNDLED_CSS_BYTES = 32 * 1024 * 1024;
const CHUNK_BYTES = 64 * 1024;

function reject(kind, reason) {
  // Keep filesystem paths and OS exception details out of output.
  throw new Error('DESKTOP CSS BUNDLE: ' + kind + ' ' + reason);
}

/**
 * Check one descriptor's identity, bytes and change metadata after streaming.
 * A restored mtime alone must not hide a same-length rewrite where ctime
 * changes (some filesystems, especially Windows, offer weaker ctime signals).
 * This is not an atomic/adversarial filesystem snapshot guarantee.
 */
export function hasStableReadMetadata(before, after, readBytes) {
  if (before === null || typeof before !== 'object' ||
      after === null || typeof after !== 'object' ||
      !Number.isSafeInteger(readBytes) || readBytes < 0) return false;
  const keys = ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'];
  return keys.every(key =>
    typeof before[key] === 'number' && Number.isFinite(before[key]) &&
    typeof after[key] === 'number' && Number.isFinite(after[key]) &&
    before[key] === after[key]
  ) && Number.isSafeInteger(before.size) && readBytes === before.size;
}

/**
 * Fixed purpose and limits. This never creates files or follows a final
 * component symlink; O_NOFOLLOW is applied where the platform supports it.
 */
export function readBoundedUiText(path, kind) {
  const limit = kind === 'HTML' ? MAX_BUNDLED_HTML_BYTES :
    kind === 'CSS' ? MAX_BUNDLED_CSS_BYTES : null;
  if (limit === null) reject('input', 'unsupported text kind');

  let prior;
  try { prior = lstatSync(path); }
  catch { reject(kind, 'missing or inaccessible'); }
  if (!prior.isFile() || prior.isSymbolicLink()) reject(kind, 'not a regular file');
  if (!Number.isSafeInteger(prior.size) || prior.size > limit) reject(kind, 'exceeds byte limit');

  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const before = fstatSync(fd);
    if (!before.isFile() || before.dev !== prior.dev || before.ino !== prior.ino ||
        !hasStableReadMetadata(prior, before, prior.size)) {
      // Closing the lstat-to-open race matters too: a same-inode rewrite
      // between these calls could otherwise escape the post-read check.
      reject(kind, 'changed before read');
    }
    if (!Number.isSafeInteger(before.size) || before.size > limit) {
      reject(kind, 'exceeds byte limit');
    }

    const scratch = Buffer.allocUnsafe(CHUNK_BYTES);
    const chunks = [];
    let total = 0;
    while (true) {
      // Read one sentinel byte past the cap to catch concurrent file growth.
      const n = readSync(fd, scratch, 0, Math.min(CHUNK_BYTES, limit + 1 - total), null);
      if (n === 0) break;
      total += n;
      if (total > limit) reject(kind, 'exceeds byte limit');
      // Angular's generated HTML/CSS is text, not a binary payload.
      // Preserve HTML/CSS ASCII whitespace (TAB, LF, FF, CR); fail closed
      // on NUL, other C0 control bytes and DEL before UTF-8 decoding.
      for (let i = 0; i < n; i++) {
        const byte = scratch[i];
        if ((byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0c && byte !== 0x0d) || byte === 0x7f) {
          reject(kind, byte === 0 ? 'contains NUL byte' : 'contains forbidden control byte');
        }
      }
      chunks.push(Buffer.from(scratch.subarray(0, n)));
    }

    const after = fstatSync(fd);
    if (!hasStableReadMetadata(before, after, total)) {
      reject(kind, 'changed during read');
    }

    try {
      return new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks, total));
    } catch {
      reject(kind, 'invalid UTF-8');
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('DESKTOP CSS BUNDLE: ')) throw error;
    reject(kind, 'cannot safely read');
  } finally {
    if (fd !== undefined) {
      try { closeSync(fd); } catch { /* File descriptor is not retained. */ }
    }
  }
}
