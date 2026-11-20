// Validate the separate, locally staged development resources before use.
import {createHash} from 'node:crypto';
import {closeSync, existsSync, openSync, readFileSync, readSync, statSync} from 'node:fs';
import {join} from 'node:path';
import {RELEASE_CATALOG_NAME, RELEASE_CATALOG_SHA256} from './release-catalog.mjs';

export function verifyDevResources(root, pin = RELEASE_CATALOG_SHA256) {
  const dir = join(root, 'ephemeris');
  const basePath = join(dir, 'de441-slice.eph');
  if (!existsSync(basePath)) return false;
  const catalogBytes = readFileSync(join(dir, RELEASE_CATALOG_NAME));
  if (createHash('sha256').update(catalogBytes).digest('hex') !== pin) throw new Error('Development DE441 catalog does not match the reviewed pin');
  const catalog = JSON.parse(catalogBytes);
  const required = catalog.packs.filter(pack => pack.required);
  if (required.length !== 1 || required[0].id !== 'desktop-core-1000-2200' || statSync(basePath).size !== required[0].bytes) throw new Error('Development DE441 base does not match the catalog');
  const hash = createHash('sha256');
  const file = openSync(basePath, 'r');
  try {
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let count;
    while ((count = readSync(file, buffer, 0, buffer.length, null)) !== 0) hash.update(buffer.subarray(0, count));
  } finally { closeSync(file); }
  if (hash.digest('hex') !== required[0].sha256) throw new Error('Development DE441 base hash mismatch');
  return true;
}
