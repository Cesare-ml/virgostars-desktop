/**
 * Conservative cleanup for an explicit, manual Horizons acquisition.
 * This never recursively removes an output directory and never deletes a file
 * whose inode / metadata differs from the file that this run created.
 * This is best-effort local cleanup, NOT an atomic filesystem transaction.
 */
import { lstat, readdir, rmdir, unlink } from 'node:fs/promises';
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
