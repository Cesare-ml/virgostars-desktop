import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const slicer = fileURLToPath(new URL('../scripts/ephemeris/slice-de441.mjs', import.meta.url));

for (const [step, sourceRecords, expectedRecords] of [[366, 2, 1], [32, 13, 12]]) {
  test(`slice excludes records beginning at or after the exclusive end (step ${step})`, () => {
    const dir = mkdtempSync(join(tmpdir(), 'vs-de441-slice-'));
    const source = join(dir, 'source.eph');
    const output = join(dir, 'slice.eph');
    try {
      const recordSize = 2856;
      const start = 2451544.5; // 2000-01-01 00:00 TDB
      const buffer = Buffer.alloc((sourceRecords + 2) * recordSize);
      buffer.write('JPL Planetary Ephemeris DE441', 0, 'latin1');
      buffer.writeDoubleLE(start, 2652);
      buffer.writeDoubleLE(start + sourceRecords * step, 2660);
      buffer.writeDoubleLE(step, 2668);
      buffer.writeInt32LE(441, 2840);
      writeFileSync(source, buffer);
      const summary = JSON.parse(execFileSync(process.execPath, [slicer, source, output, '2000', '2000'], { encoding: 'utf8' }));
      assert.equal(summary.records, expectedRecords);
      assert.equal(readFileSync(output).length, (expectedRecords + 2) * recordSize);
      const verification = JSON.parse(execFileSync(process.execPath, [slicer, '--verify', source, output], { encoding: 'utf8' }));
      assert.equal(verification.verified, true);
    } finally {
      if (existsSync(output)) unlinkSync(output);
      if (existsSync(source)) unlinkSync(source);
      rmdirSync(dir);
    }
  });
}
