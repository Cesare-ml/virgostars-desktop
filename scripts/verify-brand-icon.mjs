import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const files = [
  ['32x32.png', 32],
  ['128x128.png', 128],
  ['128x128@2x.png', 256],
  ['icon.png', 512],
];

// The first pixel of a PNG scanline has no left neighbour; on the first
// scanline it also has no upper neighbour, regardless of the PNG filter.
function verifyTransparentCorner(bytes, name) {
  if (bytes[24] !== 8 || bytes[25] !== 6 || bytes[28] !== 0) {
    throw new Error(`Expected non-interlaced 8-bit RGBA icon: ${name}`);
  }
  const data = [];
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) throw new Error(`Invalid PNG chunk: ${name}`);
    if (bytes.toString('ascii', offset + 4, offset + 8) === 'IDAT') {
      data.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset = end;
  }
  const pixels = inflateSync(Buffer.concat(data));
  if (pixels.length < 5 || pixels[4] !== 0) {
    throw new Error(`Icon background must be transparent: ${name}`);
  }
}

for (const [name, size] of files) {
  const bytes = readFileSync(resolve(root, 'src-tauri/icons', name));
  if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
      bytes.readUInt32BE(16) !== size || bytes.readUInt32BE(20) !== size) {
    throw new Error(`Invalid VirgoStars PNG icon: ${name}`);
  }
  verifyTransparentCorner(bytes, name);
}

const ico = readFileSync(resolve(root, 'src-tauri/icons/icon.ico'));
if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || ico.readUInt16LE(4) < 4) {
  throw new Error('Invalid multi-resolution Windows ICO');
}
for (let i = 0; i < ico.readUInt16LE(4); i++) {
  const entry = 6 + i * 16;
  if (entry + 16 > ico.length) throw new Error('Invalid Windows ICO directory');
  const length = ico.readUInt32LE(entry + 8);
  const start = ico.readUInt32LE(entry + 12);
  if (start + length > ico.length || length < 33 ||
      !ico.subarray(start, start + 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    throw new Error('Invalid Windows ICO PNG payload');
  }
  verifyTransparentCorner(ico.subarray(start, start + length), `ICO image ${i}`);
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
  verifyTransparentCorner(icns.subarray(offset + 8, offset + length), type);
  offset += length;
}
if (offset !== icns.length) throw new Error('Invalid macOS ICNS trailing data');

console.log('VirgoStars native brand icons verified (PNG, ICO, ICNS).');
