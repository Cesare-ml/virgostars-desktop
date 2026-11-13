/**
 * Read-only, bounded PE32+ x64 structure probe for the local Tauri smoke binary.
 * This is not a signature, provenance, freshness, malware, or runtime validation.
 */
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync} from 'node:fs';

const MAX_PE_OFFSET = 1024 * 1024;
const DOS_BYTES = 64;
const NT_BYTES = 26;

/** Inspect minimal DOS, PE/COFF and optional-header fields from captured bytes. */
export function validateWindowsPeX64(dos, nt, fileSize) {
  if (!Buffer.isBuffer(dos) || dos.length !== DOS_BYTES ||
      !Buffer.isBuffer(nt) || nt.length !== NT_BYTES ||
      !Number.isSafeInteger(fileSize) || fileSize < DOS_BYTES) {
    throw new Error('Invalid PE header');
  }
  if (dos.toString('ascii', 0, 2) !== 'MZ') throw new Error('Missing DOS header');
  const peOffset = dos.readUInt32LE(0x3c);
  if (peOffset < DOS_BYTES || peOffset > MAX_PE_OFFSET || peOffset + NT_BYTES > fileSize) {
    throw new Error('Invalid PE offset');
  }
  if (nt.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error('Missing PE signature');
  const machine = nt.readUInt16LE(4);
  const sections = nt.readUInt16LE(6);
  const optionalSize = nt.readUInt16LE(20);
  const characteristics = nt.readUInt16LE(22);
  const magic = nt.readUInt16LE(24);
  if (machine !== 0x8664 || magic !== 0x20b || !(characteristics & 0x0002) ||
      sections < 1 || sections > 96 || optionalSize < 0xf0 ||
      peOffset + 24 + optionalSize + sections * 40 > fileSize) {
    throw new Error('Unsupported PE32+ x64 executable');
  }
  return Object.freeze({format: 'PE32+', machine: 'AMD64'});
}

function regular(stat) { return stat.isFile() && !stat.isSymbolicLink(); }
function sameFile(a, b) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

/** Read only 90 bytes of a regular local file, refusing observed file swaps. */
export function inspectWindowsExecutable(file) {
  const before = lstatSync(file);
  if (!regular(before)) throw new Error('Not a regular executable file');
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) |
      (constants.O_NONBLOCK ?? 0));
    const opened = fstatSync(fd);
    if (!regular(opened) || !sameFile(before, opened)) throw new Error('Executable changed');
    const dos = Buffer.alloc(DOS_BYTES);
    if (readSync(fd, dos, 0, DOS_BYTES, 0) !== DOS_BYTES) throw new Error('Truncated DOS header');
    const offset = dos.readUInt32LE(0x3c);
    if (offset < DOS_BYTES || offset > MAX_PE_OFFSET || offset + NT_BYTES > opened.size) {
      throw new Error('Invalid PE offset');
    }
    const nt = Buffer.alloc(NT_BYTES);
    if (readSync(fd, nt, 0, NT_BYTES, offset) !== NT_BYTES) {
      throw new Error('Truncated PE header');
    }
    const result = validateWindowsPeX64(dos, nt, opened.size);
    if (!sameFile(opened, fstatSync(fd)) || !sameFile(before, lstatSync(file))) {
      throw new Error('Executable changed');
    }
    return result;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
