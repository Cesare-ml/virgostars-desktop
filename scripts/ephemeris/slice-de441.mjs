#!/usr/bin/env node
// Cuts a classic little-endian JPL DE441 binary down to a range of years.
//
// The file is a header record, a constants record and fixed-size coefficient records of 32 days each.
// A slice keeps the first two records, a contiguous run of coefficient records and rewrites only the
// start and end dates in the header, so the VirgoStars-Ephemeris reader opens it as a normal, smaller file.
// No astronomy is done here: coefficients are copied byte for byte. Verify the result with
// `--verify` (compares the copied bytes) and with the application's own tests against the full file.
//
// Usage: node scripts/ephemeris/slice-de441.mjs <full-de441.eph> <out.eph> [firstYear lastYear]
//        node scripts/ephemeris/slice-de441.mjs --verify <full-de441.eph> <slice.eph>
import { closeSync, createWriteStream, fstatSync, openSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';

const HEADER_BYTES = 2856;
const OFF_START = 2652, OFF_END = 2660, OFF_STEP = 2668;
const record = (fd, size, index) => {
  const buffer = Buffer.alloc(size);
  if (readSync(fd, buffer, 0, size, index * size) !== size) throw new Error(`short read at record ${index}`);
  return buffer;
};

function describe(fd) {
  const head = Buffer.alloc(HEADER_BYTES);
  readSync(fd, head, 0, HEADER_BYTES, 0);
  if (!head.subarray(0, 29).toString('latin1').startsWith('JPL Planetary Ephemeris DE441') || head.readInt32LE(2840) !== 441) {
    throw new Error('not a classic little-endian DE441 binary');
  }
  const start = head.readDoubleLE(OFF_START), end = head.readDoubleLE(OFF_END), step = head.readDoubleLE(OFF_STEP);
  const count = (end - start) / step;
  const total = fstatSync(fd).size;
  if (!Number.isInteger(count) || count < 1 || total % (count + 2) !== 0) throw new Error('inconsistent header and file length');
  return { start, end, step, count, size: total / (count + 2), total };
}

// Julian day number of 1 January 00:00 of a Gregorian year (the .5 convention of a JD at midnight).
const jdOfYear = year => {
  const a = Math.floor((14 - 1) / 12), y = year + 4800 - a, m = 1 + 12 * a - 3;
  return 1 + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045 - 0.5;
};

async function slice(input, output, firstYear, lastYear) {
  const fd = openSync(input, 'r');
  const info = describe(fd);
  const first = Math.max(0, Math.floor((jdOfYear(firstYear) - info.start) / info.step));
  const last = Math.min(info.count - 1, Math.ceil((jdOfYear(lastYear + 1) - info.start) / info.step));
  if (first > last) throw new Error('empty range');
  const count = last - first + 1;
  const header = record(fd, info.size, 0);
  header.writeDoubleLE(info.start + first * info.step, OFF_START);
  header.writeDoubleLE(info.start + (last + 1) * info.step, OFF_END);
  const out = createWriteStream(output);
  const hash = createHash('sha256');
  const write = chunk => new Promise((resolve, reject) => { hash.update(chunk); out.write(chunk, error => (error ? reject(error) : resolve())); });
  await write(header);
  await write(record(fd, info.size, 1));
  for (let index = first; index <= last; index++) await write(record(fd, info.size, index + 2));
  await new Promise(resolve => out.end(resolve));
  closeSync(fd);
  console.log(JSON.stringify({ output, records: count, recordBytes: info.size, bytes: (count + 2) * info.size, sha256: hash.digest('hex'),
    coversJdTdb: [info.start + first * info.step, info.start + (last + 1) * info.step] }));
}

function verify(fullPath, slicePath) {
  const full = openSync(fullPath, 'r'), part = openSync(slicePath, 'r');
  const a = describe(full), b = describe(part);
  if (a.size !== b.size || a.step !== b.step) throw new Error('record size or step differ');
  const first = Math.round((b.start - a.start) / a.step);
  if (a.start + first * a.step !== b.start) throw new Error('slice does not start on a record boundary');
  for (let index = 0; index < b.count; index++) {
    if (!record(full, a.size, first + index + 2).equals(record(part, b.size, index + 2))) throw new Error(`record ${index} differs`);
  }
  if (!record(full, a.size, 1).equals(record(part, b.size, 1))) throw new Error('constants record differs');
  closeSync(full); closeSync(part);
  console.log(JSON.stringify({ verified: true, records: b.count, firstRecordInFull: first }));
}

const args = process.argv.slice(2);
if (args[0] === '--verify' && args.length === 3) verify(args[1], args[2]);
else if (args.length === 2 || args.length === 4) await slice(args[0], args[1], Number(args[2] ?? 1890), Number(args[3] ?? 2110));
else { console.error('usage: slice-de441.mjs <full.eph> <out.eph> [firstYear lastYear] | --verify <full.eph> <slice.eph>'); process.exit(2); }
