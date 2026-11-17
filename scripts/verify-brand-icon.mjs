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

console.log('VirgoStars native brand icons verified (PNG, ICO, ICNS).');
