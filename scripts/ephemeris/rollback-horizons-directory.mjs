/**
 * Conservative cleanup for an explicit, manual Horizons acquisition.
 * This never recursively removes an output directory and never deletes a file
 * whose inode / metadata differs from the file that this run created.
 * This is best-effort local cleanup, NOT an atomic filesystem transaction.
 */
import { lstat, readdir, rmdir, unlink, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';

const RESPONSE = /^horizons-[a-z_]+\.txt$/;
const validName = name => typeof name === 'string' &&
  (name === 'response-manifest.json' || RESPONSE.test(name));
const sameNode = (a, b) => a && b && a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b) => sameNode(a, b) && a.isFile() && !a.isSymbolicLink() &&
  a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

export async function recordNewDirectory(path) {
  const stat = await lstat(path, { bigint:true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw Error('UNSAFE_OUTPUT_DIRECTORY');
  return Object.freeze({dev:stat.dev,ino:stat.ino});
}

/** Call only after a successful exclusive-create write of this file. */
export async function recordCreatedFile(directory, name) {
  if (!validName(name)) throw Error('UNSAFE_OUTPUT_FILENAME');
  const stat = await lstat(join(directory,name), {bigint:true});
  if (!stat.isFile() || stat.isSymbolicLink()) throw Error('UNSAFE_OUTPUT_FILE');
  return Object.freeze({name,dev:stat.dev,ino:stat.ino,
    size:stat.size,mtimeNs:stat.mtimeNs,ctimeNs:stat.ctimeNs});
}

/**
 * Create an owned file exclusively and capture ownership from the *opened
 * descriptor*, never by trusting a path lookup performed after a write.
 * A concurrent path substitution makes this function reject the write and
 * leaves an unowned partial directory for manual review.
 */
export async function writeOwnedFileOnce(directory, directoryIdentity, name, data) {
  if (!validName(name) || !directoryIdentity) throw Error('UNSAFE_OUTPUT_FILENAME');
  if (!Buffer.isBuffer(data) && typeof data !== 'string' && !(data instanceof Uint8Array))
    throw Error('UNSAFE_OUTPUT_CONTENT');
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  const limit = name === 'response-manifest.json' ? 64 * 1024 : 512 * 1024;
  if (bytes.length === 0 || bytes.length > limit) throw Error('UNSAFE_OUTPUT_CONTENT');
  const before = await lstat(directory, {bigint:true});
  if (!before.isDirectory() || before.isSymbolicLink() ||
      !sameNode(before,directoryIdentity)) throw Error('UNSAFE_OUTPUT_DIRECTORY');
  const filePath = join(directory,name);
  const handle = await open(filePath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0),
    0o600);
  let created;
  try {
    await handle.writeFile(bytes);
    created = await handle.stat({bigint:true});
    if (!created.isFile() || created.isSymbolicLink() || created.size !== BigInt(bytes.length))
      throw Error('UNSAFE_OUTPUT_FILE');
  } finally {
    await handle.close();
  }
  // Verify both directory and file still point to the newly opened objects.
  const [directoryAfter,fileAfter] = await Promise.all([
    lstat(directory,{bigint:true}),lstat(filePath,{bigint:true}),
  ]);
  if (!directoryAfter.isDirectory() || directoryAfter.isSymbolicLink() ||
      !sameNode(directoryAfter,directoryIdentity) || !sameFile(fileAfter,created))
    throw Error('UNSAFE_OUTPUT_FILE');
  return Object.freeze({name,dev:created.dev,ino:created.ino,
    size:created.size,mtimeNs:created.mtimeNs,ctimeNs:created.ctimeNs});
}

/**
 * Return false (preserving the whole folder for manual review) if even one
 * unexpected or modified entry is present. No recursive rm, no force flags.
 */
export async function cleanupOnlyOwnedFiles(directory, directoryIdentity, ownedFiles) {
  if (typeof directory !== 'string' || !directory ||
      !directoryIdentity || !Array.isArray(ownedFiles)) return false;
  try {
    const dir = await lstat(directory,{bigint:true});
    if (!dir.isDirectory() || dir.isSymbolicLink() || !sameNode(dir,directoryIdentity)) return false;
    const names = await readdir(directory);
    if (names.length !== ownedFiles.length || new Set(names).size !== names.length ||
        new Set(ownedFiles.map(file=>file?.name)).size !== ownedFiles.length ||
        ownedFiles.some(file=>!validName(file?.name) || !names.includes(file.name))) return false;
    // Complete preflight: do not remove anything unless every entry is owned.
    for (const file of ownedFiles) {
      const stat = await lstat(join(directory,file.name),{bigint:true});
      if (!sameFile(stat,file)) return false;
    }
    for (const file of ownedFiles) {
      // A second check narrows, but cannot remove, a concurrent replacement race.
      const stat = await lstat(join(directory,file.name),{bigint:true});
      if (!sameFile(stat,file)) return false;
      await unlink(join(directory,file.name));
    }
    await rmdir(directory); // Succeeds only if still empty.
    return true;
  } catch {
    return false;
  }
}
