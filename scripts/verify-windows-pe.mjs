#!/usr/bin/env node
/**
 * Read-only structural preflight for the Windows x64 Tauri prototype executable.
 * This is NOT Authenticode verification, malware analysis or proof it can launch.
 */
import {constants, closeSync, fstatSync, lstatSync, openSync, readSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isFileBackedPeEntryPoint} from './pe-entrypoint-bounds.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAX_HEADER_BYTES = 8192;
const MAX_PE_OFFSET = 4096;
const error = code => { throw new Error('WINDOWS_PE_' + code); };

/** Parse only header structure, from synthetic fixtures or a bounded file read. */
export function inspectWindowsPeHeader(bytes, fileBytes = BigInt(bytes?.byteLength ?? 0)) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 64) error('TRUNCATED');
  if (typeof fileBytes !== 'bigint' || fileBytes < BigInt(bytes.byteLength)) error('FILE_LENGTH');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = offset => view.getUint16(offset, true);
  const u32 = offset => view.getUint32(offset, true);
  if (u16(0) !== 0x5a4d) error('DOS_SIGNATURE');
  const peOffset = u32(0x3c);
  if (peOffset < 64 || peOffset > MAX_PE_OFFSET) error('HEADER_OFFSET');
  if (bytes.byteLength < peOffset + 26) error('TRUNCATED');
  if (u32(peOffset) !== 0x00004550) error('PE_SIGNATURE');
  if (u16(peOffset + 4) !== 0x8664) error('MACHINE_NOT_AMD64');
  const sections = u16(peOffset + 6);
  if (sections < 1 || sections > 96) error('SECTION_COUNT');
  const characteristics = u16(peOffset + 22);
  if ((characteristics & 0x0002) === 0 || (characteristics & 0x2000) !== 0) error('NOT_EXECUTABLE');
  const optionalLength = u16(peOffset + 20);
  if (optionalLength < 112 || optionalLength > 1024) error('OPTIONAL_LENGTH');
  const optionalStart = peOffset + 24;
  const tableStart = optionalStart + optionalLength;
  const tableEnd = tableStart + sections * 40;
  if (bytes.byteLength < tableEnd) error('TRUNCATED');
  if (u16(optionalStart) !== 0x020b) error('NOT_PE32_PLUS');
  if (u16(optionalStart + 68) !== 2) error('NOT_GUI_SUBSYSTEM');
  const entryPoint = u32(optionalStart + 16);
  const sectionAlignment = u32(optionalStart + 32);
  const fileAlignment = u32(optionalStart + 36);
  // This Windows x64/MSVC preflight intentionally accepts conventional
  // page-aligned images, not PE's exceptional sub-page-aligned formats.
  const powerOfTwo = value => value > 0 && (value & (value - 1)) === 0;
  if (!powerOfTwo(fileAlignment) || fileAlignment < 512 || fileAlignment > 65536 ||
      !powerOfTwo(sectionAlignment) || sectionAlignment < 4096 ||
      sectionAlignment < fileAlignment) error('ALIGNMENT_FIELDS');
  const imageSize = u32(optionalStart + 56);
  const headersSize = u32(optionalStart + 60);
  if (headersSize < tableEnd || imageSize < headersSize ||
      BigInt(headersSize) > fileBytes) error('HEADERS_LAYOUT');
  if (headersSize % fileAlignment !== 0 || imageSize % sectionAlignment !== 0) {
    error('IMAGE_ALIGNMENT');
  }
  if (!entryPoint || entryPoint >= imageSize) error('ENTRYPOINT');
  let hasRawSection = false;
  let executableEntry = false;
  const mappedRanges = [];
  const rawRanges = [];
  for (let i = 0; i < sections; i++) {
    const section = tableStart + i * 40;
    const virtualSize = u32(section + 8);
    const virtualAddress = u32(section + 12);
    const rawSize = u32(section + 16);
    const rawPointer = u32(section + 20);
    const sectionFlags = u32(section + 36);
    const mappedSize = Math.max(virtualSize, rawSize);
    if (!mappedSize || virtualAddress >= imageSize ||
        virtualAddress + mappedSize > imageSize) error('SECTION_IMAGE_BOUNDS');
    // Raw headers are mapped at the start of the image and cannot be owned by a section.
    if (virtualAddress < headersSize) error('SECTION_HEADER_OVERLAP');
    if (virtualAddress % sectionAlignment !== 0) error('SECTION_RVA_ALIGNMENT');
    mappedRanges.push([virtualAddress, virtualAddress + mappedSize]);
    if (rawSize) {
      if (rawPointer < headersSize ||
          BigInt(rawPointer) + BigInt(rawSize) > fileBytes) error('SECTION_RAW_BOUNDS');
      if (rawPointer % fileAlignment !== 0 || rawSize % fileAlignment !== 0) {
        error('SECTION_RAW_ALIGNMENT');
      }
      rawRanges.push([rawPointer, rawPointer + rawSize]);
      hasRawSection = true;
    }
    // The entry RVA must identify meaningful executable file bytes, not
    // zero-filled virtual memory or raw section alignment padding.
    if ((sectionFlags & 0x20000000) !== 0 &&
        isFileBackedPeEntryPoint(entryPoint, virtualAddress, virtualSize, rawSize)) {
      executableEntry = true;
    }
  }
  // A malformed binary can have individually in-bounds sections that alias
  // another section in memory or on disk. Adjacent non-overlapping ranges are fine.
  for (const [ranges, code] of [
    [mappedRanges, 'SECTION_VIRTUAL_OVERLAP'],
    [rawRanges, 'SECTION_RAW_OVERLAP'],
  ]) {
    ranges.sort((a, b) => a[0] - b[0]);
    for (let i = 1; i < ranges.length; i++) {
      if (ranges[i][0] < ranges[i - 1][1]) error(code);
    }
  }
  if (!hasRawSection) error('NO_RAW_SECTION');
  if (!executableEntry) error('ENTRYPOINT_SECTION');
  return Object.freeze({kind: 'windows_x64_gui', machine: 'AMD64', peFormat: 'PE32+', sections});
}

function identicalFile(a, b) {
  return a.isFile() && b.isFile() && a.dev === b.dev && a.ino === b.ino &&
    a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}

/** Fixed-path production CLI, explicit path parameter only for test-fixture use. */
export function verifyWindowsExecutable(file) {
  let fd;
  try {
    const before = lstatSync(file, {bigint: true});
    if (before.isSymbolicLink() || !before.isFile()) error('UNSAFE_FILE');
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd, {bigint: true});
    if (!identicalFile(before, opened)) error('CHANGED_FILE');
    if (opened.size < 64n) error('TRUNCATED');
    const length = Number(opened.size < BigInt(MAX_HEADER_BYTES) ? opened.size : BigInt(MAX_HEADER_BYTES));
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
      const count = readSync(fd, buffer, offset, length - offset, offset);
      if (count <= 0) error('TRUNCATED');
      offset += count;
    }
    const after = fstatSync(fd, {bigint: true});
    const pathAfter = lstatSync(file, {bigint: true});
    if (!identicalFile(opened, after) || !identicalFile(opened, pathAfter) || pathAfter.isSymbolicLink()) {
      error('CHANGED_FILE');
    }
    return inspectWindowsPeHeader(buffer, opened.size);
  } catch (failure) {
    if (failure instanceof Error && /^WINDOWS_PE_[A-Z0-9_]+$/.test(failure.message)) throw failure;
    // Do not print absolute paths or exception details on a shared diagnostic report.
    error('UNREADABLE');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  if (process.argv.length !== 2) {
    console.error('Usage: node scripts/verify-windows-pe.mjs');
    process.exitCode = 2;
  } else {
    try {
      verifyWindowsExecutable(join(ROOT, 'src-tauri', 'target', 'release', 'virgostars-desktop-spike.exe'));
      console.log('Verified Windows x64 PE32+ GUI header. Native startup, signing and offline behavior remain untested.');
    } catch (failure) {
      console.error('WINDOWS_PE_VERIFY_FAILED: ' + failure.message);
      process.exitCode = 1;
    }
  }
}
