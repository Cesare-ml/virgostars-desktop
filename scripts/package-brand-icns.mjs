/**
 * Repackage the maintainer-approved PNG icon variants for macOS without
 * changing the artwork. Run manually when updating the committed brand icon;
 * this script is intentionally not part of npm prepare:icon.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../src-tauri/icons/', import.meta.url)));
const sources = [
  ['icp5', '32x32.png'],
  ['ic07', '128x128.png'],
  ['ic08', '128x128@2x.png'],
  ['ic09', 'icon.png'],
];

const chunks = sources.map(([type, filename]) => {
  const image = readFileSync(resolve(root, filename));
  if (!image.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Invalid approved PNG source: ' + filename);
  }
  const header = Buffer.alloc(8);
  header.write(type, 0, 4, 'ascii');
  header.writeUInt32BE(8 + image.length, 4);
  return Buffer.concat([header, image]);
});

const header = Buffer.alloc(8);
header.write('icns', 0, 4, 'ascii');
header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
writeFileSync(resolve(root, 'icon.icns'), Buffer.concat([header, ...chunks]));
