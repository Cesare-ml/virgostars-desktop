import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectWindowsPeHeader} from '../scripts/verify-windows-pe.mjs';

// All bytes are fictional. Exercise the real integrated parser, not a second
// implementation of its section/entrypoint checks.
function fictionalPe() {
  const bytes = Buffer.alloc(2048);
  const pe = 0x80, optional = 0x98, firstSection = 0x188;
  bytes.writeUInt16LE(0x5a4d, 0);
  bytes.writeUInt32LE(pe, 0x3c);
  bytes.writeUInt32LE(0x4550, pe);
  bytes.writeUInt16LE(0x8664, pe + 4); // AMD64
  bytes.writeUInt16LE(2, pe + 6);
  bytes.writeUInt16LE(240, pe + 20);
  bytes.writeUInt16LE(0x22, pe + 22);
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeUInt32LE(0x107f, optional + 16); // last meaningful .text byte
  bytes.writeUInt32LE(0x1000, optional + 32); // section alignment
  bytes.writeUInt32LE(0x200, optional + 36); // file alignment
  bytes.writeUInt32LE(0x3000, optional + 56); // image size
  bytes.writeUInt32LE(0x200, optional + 60); // header size
  bytes.writeUInt16LE(2, optional + 68); // GUI subsystem
  for (let i = 0; i < 2; i++) {
    const section = firstSection + i * 40;
    bytes.writeUInt32LE(i ? 0x200 : 0x80, section + 8); // virtual size
    bytes.writeUInt32LE(0x1000 + i * 0x1000, section + 12);
    bytes.writeUInt32LE(0x200, section + 16); // raw size
    bytes.writeUInt32LE(0x200 + i * 0x200, section + 20);
    bytes.writeUInt32LE(i ? 0x40000040 : 0x60000020, section + 36);
  }
  return bytes;
}

test('integrated PE gate accepts two disjoint, aligned sections with last meaningful code byte', () => {
  assert.equal(inspectWindowsPeHeader(fictionalPe()).kind, 'windows_x64_gui');
});

test('integrated gate rejects entry RVA in raw padding even if both sections are aligned', () => {
  const bytes = fictionalPe();
  bytes.writeUInt32LE(0x1080, 0x98 + 16);
  assert.throws(() => inspectWindowsPeHeader(bytes), /WINDOWS_PE_ENTRYPOINT_SECTION/);
});

test('integrated gate preserves virtual and raw overlap rejection with a valid entry RVA', () => {
  const virtualOverlap = fictionalPe();
  virtualOverlap.writeUInt32LE(0x1200, 0x188 + 8); // reaches into .rdata at RVA 0x2000
  assert.throws(() => inspectWindowsPeHeader(virtualOverlap), /WINDOWS_PE_SECTION_VIRTUAL_OVERLAP/);

  const rawOverlap = fictionalPe();
  rawOverlap.writeUInt32LE(0x200, 0x188 + 40 + 20); // aliases .text raw bytes
  assert.throws(() => inspectWindowsPeHeader(rawOverlap), /WINDOWS_PE_SECTION_RAW_OVERLAP/);
});

test('integrated gate rejects unaligned raw offset before accepting section layout', () => {
  const bytes = fictionalPe();
  bytes.writeUInt32LE(0x201, 0x188 + 40 + 20);
  assert.throws(() => inspectWindowsPeHeader(bytes), /WINDOWS_PE_SECTION_RAW_ALIGNMENT/);
});
