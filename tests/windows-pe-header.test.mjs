import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {inspectWindowsPeHeader, verifyWindowsExecutable} from '../scripts/verify-windows-pe.mjs';

const pe = (opts = {}) => {
  const b = Buffer.alloc(512);
  b.writeUInt16LE(0x5a4d, 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x8664, 0x84);
  b.writeUInt16LE(3, 0x86);
  b.writeUInt16LE(240, 0x94);
  b.writeUInt16LE(0x22, 0x96);
  b.writeUInt16LE(0x20b, 0x98);
  b.writeUInt16LE(2, 0x98 + 68);
  for (const [offset, value, size] of opts.patch || []) {
    if (size === 4) b.writeUInt32LE(value, offset);
    else b.writeUInt16LE(value, offset);
  }
  return b;
};
const fixture = action => {
  const dir = mkdtempSync(join(tmpdir(), 'virgostars-pe-fixture-'));
  const file = join(dir, 'prototype.exe');
  try { return action({dir, file}); }
  finally { rmSync(dir, {recursive:true, force:true}); }
};

test('accepts synthetic AMD64 PE32+ GUI executable header only', () => {
  assert.deepEqual(inspectWindowsPeHeader(pe()), {
    kind:'windows_x64_gui', machine:'AMD64', peFormat:'PE32+', sections:3,
  });
});

test('rejects forged, truncated and incompatible PE headers', () => {
  const invalid = [
    [Buffer.alloc(0), /TRUNCATED/],
    [pe({patch:[[0,0,2]]}), /DOS_SIGNATURE/],
    [pe({patch:[[0x3c,4097,4]]}), /HEADER_OFFSET/],
    [pe({patch:[[0x80,0,4]]}), /PE_SIGNATURE/],
    [pe({patch:[[0x84,0x14c,2]]}), /MACHINE_NOT_AMD64/],
    [pe({patch:[[0x84,0xaa64,2]]}), /MACHINE_NOT_AMD64/],
    [pe({patch:[[0x86,0,2]]}), /SECTION_COUNT/],
    [pe({patch:[[0x86,97,2]]}), /SECTION_COUNT/],
    [pe({patch:[[0x96,0,2]]}), /NOT_EXECUTABLE/],
    [pe({patch:[[0x96,0x2022,2]]}), /NOT_EXECUTABLE/],
    [pe({patch:[[0x94,0,2]]}), /OPTIONAL_LENGTH/],
    [pe({patch:[[0x94,1025,2]]}), /OPTIONAL_LENGTH/],
    [pe().subarray(0,160), /TRUNCATED/],
    [pe().subarray(0,500), /TRUNCATED/],
    [pe({patch:[[0x98,0x10b,2]]}), /NOT_PE32_PLUS/],
    [pe({patch:[[0x98 + 68,3,2]]}), /NOT_GUI_SUBSYSTEM/],
  ];
  for (const [bytes, match] of invalid) assert.throws(() => inspectWindowsPeHeader(bytes), match);
});

test('on-disk bounded structural preflight detects wrong architecture and regular-file replacement', () => fixture(({file}) => {
  writeFileSync(file, pe());
  assert.equal(verifyWindowsExecutable(file).kind, 'windows_x64_gui');
  writeFileSync(file, pe({patch:[[0x84,0xaa64,2]]}));
  assert.throws(() => verifyWindowsExecutable(file), /MACHINE_NOT_AMD64/);
}));

test('missing files, directories and symlinks fail closed without disclosing paths', () => fixture(({dir,file}) => {
  assert.throws(() => verifyWindowsExecutable(file), /^Error: WINDOWS_PE_UNREADABLE$/);
  assert.throws(() => verifyWindowsExecutable(dir), /WINDOWS_PE_UNSAFE_FILE/);
  const link = join(dir, 'shortcut.exe');
  try {
    writeFileSync(file, pe());
    symlinkSync(file, link);
    assert.throws(() => verifyWindowsExecutable(link), /WINDOWS_PE_UNSAFE_FILE/);
  } catch (failure) {
    if (failure?.code !== 'EPERM') throw failure; // Windows test runners may lack symlink privilege.
  }
}));

test('CLI is fixed-path only and never logs a missing local absolute executable path', () => {
  const script = new URL('../scripts/verify-windows-pe.mjs', import.meta.url);
  const denied = spawnSync(process.execPath, [fileURLToPath(script), 'C:/private/file.exe'], {encoding:'utf8'});
  assert.equal(denied.status, 2);
  assert.match(denied.stderr, /Usage: node scripts\/verify-windows-pe.mjs/);
  assert.doesNotMatch(denied.stderr, /private|C:\\/);
});

test('Windows build launchers invoke the standalone read-only validator after the native build', () => {
  const read = name => readFileSync(new URL('../scripts/'+name, import.meta.url), 'utf8');
  assert.match(read('build-windows.cmd'), /node scripts\\verify-windows-pe\.mjs\s*\r?\nif errorlevel 1 goto :failed/);
  assert.match(read('build-windows-spike.ps1'), /Invoke-Step 'Verify Windows x64 PE header' 'node' @\('scripts\/verify-windows-pe.mjs'\)/);
});
