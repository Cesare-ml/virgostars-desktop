import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const files = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
];

for (const [name, size] of files) {
  const bytes = readFileSync(resolve(root, 'src-tauri/icons', name));
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
    throw new Error(`Invalid VirgoStars PNG icon: ${name}`);
  }
}

const ico = readFileSync(resolve(root, 'src-tauri/icons/icon.ico'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 4) {
  throw new Error('Invalid multi-resolution Windows ICO');
}

const icns = readFileSync(resolve(root, 'src-tauri/icons/icon.icns'));
if (icns.toString('ascii', 0, 4) !== 'icns' || icns.readUInt32BE(4) !== icns.length) {
  throw new Error('Invalid macOS ICNS');
}
const reviewedIcnsChunks = ['icp5', 'ic07', 'ic08', 'ic09'];
let offset = 8;
for (const type of reviewedIcnsChunks) {
  if (offset + 8 > icns.length || icns.toString('ascii', offset, offset + 4) !== type) {
    throw new Error('Invalid macOS ICNS chunk: ' + type);
  }
  const length = icns.readUInt32BE(offset + 4);
  if (length < 8 || offset + length > icns.length ||
      !icns.subarray(offset + 8, offset + 16).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Invalid macOS ICNS PNG payload: ' + type);
  }
  offset += length;
}
if (offset !== icns.length) throw new Error('Invalid macOS ICNS trailing data');

console.log('VirgoStars native brand icons verified (PNG, ICO, ICNS).');
