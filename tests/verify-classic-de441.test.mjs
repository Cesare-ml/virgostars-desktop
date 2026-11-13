import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyClassicDe441, parseKernelArgs } from '../scripts/ephemeris/verify-classic-de441.mjs';

async function fixture(run, size = 4096) {
  const folder = await mkdtemp(join(tmpdir(), 'vs-classic-de441-'));
  const file = join(folder, 'fictional-de441.bin');
  const bytes = Buffer.alloc(size);
  bytes.write('JPL Planetary Ephemeris DE441', 0, 'ascii');
  bytes.writeInt32LE(441, 2840);
  await writeFile(file, bytes);
  const expected = {bytes:size, sha256:createHash('sha256').update(bytes).digest('hex')};
  try { await run({file, folder, bytes, expected}); }
  finally { await rm(folder, {recursive:true, force:true}); }
}

test('accepts operator-pinned fictional header and SHA without copying it', async () => fixture(async f => {
  const before = await readFile(f.file);
  const report = await verifyClassicDe441(f.file, f.expected);
  assert.deepEqual(report, {format:'JPL_DE441_CLASSIC_LE', ...f.expected});
  assert.deepEqual(await readFile(f.file), before);
  assert.equal(JSON.stringify(report).includes(f.folder), false);
}));
test('verifies files over 1MiB using bounded streaming blocks', async () => fixture(async f => {
  assert.equal((await verifyClassicDe441(f.file, f.expected)).bytes, 1024 * 1024 + 39);
}, 1024 * 1024 + 39));
test('refuses wrong digest even when the header is plausible', async () => fixture(async f => {
  await assert.rejects(verifyClassicDe441(f.file, {...f.expected, sha256:'0'.repeat(64)}), /SHA-256/);
}));
test('refuses changed payload while the pinned digest is unchanged', async () => fixture(async f => {
  f.bytes[3000] = 1;
  await writeFile(f.file, f.bytes);
  await assert.rejects(verifyClassicDe441(f.file, f.expected), /SHA-256/);
}));
test('rejects non-DE441 header and wrong little-endian ephemeris number', async () => fixture(async f => {
  f.bytes[0] = 0;
  await writeFile(f.file, f.bytes);
  await assert.rejects(verifyClassicDe441(f.file, f.expected), /header/);
  f.bytes[0] = 'J'.charCodeAt(0);
  f.bytes.writeInt32BE(441, 2840);
  await writeFile(f.file, f.bytes);
  await assert.rejects(verifyClassicDe441(f.file, f.expected), /header/);
}));
test('rejects missing and truncated kernel files', async () => fixture(async f => {
  await assert.rejects(verifyClassicDe441(join(f.folder, 'absent.bin'), f.expected), /unavailable/);
  await truncate(f.file, 3000);
  await assert.rejects(verifyClassicDe441(f.file, f.expected), /size differs/);
}));
test('rejects symlinks and directories as inputs', async () => fixture(async f => {
  const link=join(f.folder,'linked.bin');
  await symlink(f.file, link);
  await assert.rejects(verifyClassicDe441(link, f.expected), /symlink/);
  const directory=join(f.folder,'directory');
  await mkdir(directory);
  await assert.rejects(verifyClassicDe441(directory, f.expected), /regular file/);
}));
test('rejects malformed hash and bounds without accessing file', async () => fixture(async f => {
  for (const value of [undefined, '', 'A'.repeat(64), 'g'.repeat(64), '0'.repeat(63)]) {
    await assert.rejects(verifyClassicDe441(f.file, {...f.expected,sha256:value}), /invalid expected/);
  }
  for (const bytes of [0, 1, 2843, 1.5, -1, Number.MAX_SAFE_INTEGER]) {
    await assert.rejects(verifyClassicDe441(f.file, {...f.expected,bytes}), /invalid expected/);
  }
}));
test('rejects altered declared byte length even with correct hash', async () => fixture(async f => {
  await assert.rejects(verifyClassicDe441(f.file, {...f.expected,bytes:4097}), /size differs/);
}));
test('parses exact offline CLI arguments in any order', () => {
  const hash='a'.repeat(64);
  assert.deepEqual(parseKernelArgs(['--sha256',hash,'--file','sample.eph','--bytes','4096']),
    {file:'sample.eph',expected:{bytes:4096,sha256:hash}});
});
test('rejects unexpected, duplicate and ambiguous CLI switches', () => {
  for (const args of [[], ['--file','sample','--bytes','4096','--bad','anything'],
    ['--file','sample','--file','other','--sha256','a'.repeat(64)],
    ['--file','--bad','--bytes','4096','--sha256','a'.repeat(64)],
    ['--file','sample','--bytes','4.0','--sha256','a'.repeat(64)]]) {
    assert.throws(() => parseKernelArgs(args), /CLI arguments|expected/);
  }
});
