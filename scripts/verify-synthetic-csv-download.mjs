#!/usr/bin/env node
/**
 * Optional, local-only acceptance check for an actual WebView2-downloaded
 * fictional CSV. Never upload, print, or parse a person's birth records.
 */
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFictionalAngles } from '../src/app/fictional-geometry.ts';
import { buildSyntheticChartCsv } from '../src/app/synthetic-csv-export.ts';

// These fixed labels are the fictional fixture's ten identifiers, not user names.
const FIXTURE_PLANETS = Object.freeze([
  'Sun', 'Moon', 'Mercury', 'Venus', 'Mars',
  'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto',
]);

export function expectedFictionalCsvBytes() {
  const geometry = buildFictionalAngles(0);
  const planets = FIXTURE_PLANETS.map((name, index) => ({
    name, longitude: geometry.planetLongitudes[index],
  }));
  const houses = geometry.houseCusps.map((longitude, index) => ({
    number: index + 1, longitude,
  }));
  return Buffer.from(buildSyntheticChartCsv(planets, houses), 'utf8');
}

/**
 * Check a user-selected file without reading unbounded content or echoing it.
 * Final-path symlinks/non-regular files are rejected; no file is modified.
 */
export function verifySyntheticCsvDownload(file, expected = expectedFictionalCsvBytes()) {
  if (typeof file !== 'string' || !file || !Buffer.isBuffer(expected) || !expected.length) {
    return false;
  }
  let descriptor;
  try {
    const metadata = lstatSync(file);
    if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size !== expected.length) {
      return false;
    }
    descriptor = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.size !== expected.length) return false;
    const bytes = Buffer.alloc(expected.length);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count <= 0) return false;
      offset += count;
    }
    // Refuse append-only changes made while the file was being checked.
    const after = fstatSync(descriptor);
    return after.size === expected.length && bytes.equals(expected);
  } catch {
    // Missing files, denied access, malformed paths and I/O errors are failures.
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--file' || !args[1] || args[1].startsWith('-')) {
    console.error('Usage: node --experimental-strip-types scripts/verify-synthetic-csv-download.mjs --file <local-csv-path>');
    process.exitCode = 2;
  } else if (verifySyntheticCsvDownload(args[1])) {
    console.log('PASS: local file exactly matches the fictional VirgoStars Desktop CSV fixture.');
  } else {
    // Never echo paths, contents, user names, downloaded filenames or file sizes.
    console.error('FAIL: local file does not match the expected fictional demo CSV.');
    process.exitCode = 1;
  }
}
