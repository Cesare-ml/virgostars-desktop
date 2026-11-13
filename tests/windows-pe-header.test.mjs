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
  const b = Buffer.alloc(2048);
  b.writeUInt16LE(0x5a4d, 0);
  b.writeUInt32LE(0x80, 0x3c);
  b.writeUInt32LE(0x4550, 0x80);
  b.writeUInt16LE(0x8664, 0x84);
  b.writeUInt16LE(3, 0x86);
  b.writeUInt16LE(240, 0x94);
  b.writeUInt16LE(0x22, 0x96);
  b.writeUInt16LE(0x20b, 0x98);
  b.writeUInt16LE(2, 0x98 + 68);
  // Fictional but structurally consistent .text/.rdata/.data section layout.
  b.writeUInt32LE(0x1000, 0x98 + 16); // AddressOfEntryPoint in .text
  b.writeUInt32LE(0x4000, 0x98 + 56); // SizeOfImage
  b.writeUInt32LE(0x200, 0x98 + 60); // SizeOfHeaders
  for (let i = 0; i < 3; i++) {
    const section = 0x188 + i * 40;
    b.writeUInt32LE(0x200, section + 8); // VirtualSize
    b.writeUInt32LE(0x1000 + i * 0x1000, section + 12); // VirtualAddress
    b.writeUInt32LE(0x200, section + 16); // SizeOfRawData
    b.writeUInt32LE(0x200 + i * 0x200, section + 20); // PointerToRawData
    b.writeUInt32LE(i === 0 ? 0x60000020 : 0x40000040, section + 36);
  }
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

test('rejects missing executable section contents and inconsistent PE image layout', () => {
  const failures = [
    [0x98 + 60, 0x100, /HEADERS_LAYOUT/], // headers do not cover section table
    [0x98 + 60, 4096, /HEADERS_LAYOUT/], // header bytes larger than file
    [0x98 + 56, 128, /HEADERS_LAYOUT/], // SizeOfImage smaller than headers
    [0x98 + 16, 0, /ENTRYPOINT/], // no entrypoint
    [0x98 + 16, 0x2800, /ENTRYPOINT_SECTION/], // entrypoint in no section
    [0x188 + 36, 0x40000040, /ENTRYPOINT_SECTION/], // .text not executable
    [0x188 + 20, 64, /SECTION_RAW_BOUNDS/], // overlaps header
    [0x188 + 20, 2048, /SECTION_RAW_BOUNDS/], // truncated executable section
    [0x188 + 40 + 12, 0x3f00, /SECTION_IMAGE_BOUNDS/], // section past image
    [0x188 + 80 + 12, 0x100, /SECTION_HEADER_OVERLAP/], // section aliases PE headers
  ];
  for (const [offset, value, reason] of failures) {
    const bad = pe();
    bad.writeUInt32LE(value, offset);
    assert.throws(() => inspectWindowsPeHeader(bad), reason, String(offset));
  }
  const withoutRaw = pe({patch:[
    [0x188 + 16, 0, 4], [0x188 + 40 + 16, 0, 4], [0x188 + 80 + 16, 0, 4]
  ]});
  assert.throws(() => inspectWindowsPeHeader(withoutRaw), /NO_RAW_SECTION/);
});

test('rejects overlapping PE image and raw section ranges, but accepts adjacent ranges', () => {
  // Individually valid extents must not alias bytes belonging to other sections.
  const virtualOverlap = pe({patch:[[0x188 + 40 + 12, 0x1100, 4]]});
  assert.throws(() => inspectWindowsPeHeader(virtualOverlap), /SECTION_VIRTUAL_OVERLAP/);
  const rawOverlap = pe({patch:[[0x188 + 40 + 20, 0x300, 4]]});
  assert.throws(() => inspectWindowsPeHeader(rawOverlap), /SECTION_RAW_OVERLAP/);
  // Default fixture has touching raw sections: [0x200,0x400), [0x400,0x600).
  assert.equal(inspectWindowsPeHeader(pe()).kind, 'windows_x64_gui');
  const virtualAdjacent = pe({patch:[[0x188 + 40 + 12, 0x1200, 4]]});
  assert.equal(inspectWindowsPeHeader(virtualAdjacent).kind, 'windows_x64_gui');
});

test('entrypoint must be backed by executable file bytes, not just a virtual tail', () => {
  const virtualTail = pe({patch:[
    [0x188 + 8, 0x400, 4], // VirtualSize extends beyond .text raw bytes
    [0x98 + 16, 0x1200, 4], // First byte beyond its [0x1000, 0x1200) raw backing
  ]});
  assert.throws(() => inspectWindowsPeHeader(virtualTail), /ENTRYPOINT_SECTION/);
  const lastBackedByte = pe({patch:[
    [0x188 + 8, 0x400, 4], [0x98 + 16, 0x11ff, 4],
  ]});
  assert.equal(inspectWindowsPeHeader(lastBackedByte).kind, 'windows_x64_gui');
});

test('rejects wrong on-disk length while supporting bounded header reads and Uint8Array offsets', () => {
  const bytes = pe();
  assert.throws(() => inspectWindowsPeHeader(bytes, 128n), /FILE_LENGTH/);
  assert.equal(inspectWindowsPeHeader(bytes, 100000n).kind, 'windows_x64_gui');
  // DataView must use the offset of the supplied Uint8Array, not its whole buffer.
  const padded = Buffer.concat([Buffer.from([7]), bytes, Buffer.from([9])]);
  assert.equal(inspectWindowsPeHeader(padded.subarray(1, padded.length - 1)).kind, 'windows_x64_gui');
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
