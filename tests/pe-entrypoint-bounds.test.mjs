import test from 'node:test';
import assert from 'node:assert/strict';
import {isFileBackedPeEntryPoint} from '../scripts/pe-entrypoint-bounds.mjs';
import {inspectWindowsPeHeader} from '../scripts/verify-windows-pe.mjs';

test('PE entry point inside physically backed executable section passes', () => {
  assert.equal(isFileBackedPeEntryPoint(0x1000,0x1000,0x1000,0x200),true);
  assert.equal(isFileBackedPeEntryPoint(0x11ff,0x1000,0x1000,0x200),true);
});

test('PE entry point cannot target virtual zero-fill past SizeOfRawData', () => {
  assert.equal(isFileBackedPeEntryPoint(0x1200,0x1000,0x1000,0x200),false);
});

test('PE entry point cannot target raw alignment padding past VirtualSize', () => {
  assert.equal(isFileBackedPeEntryPoint(0x1080,0x1000,0x80,0x200),false);
  assert.equal(isFileBackedPeEntryPoint(0x107f,0x1000,0x80,0x200),true);
});

test('zero VirtualSize may still use backed raw bytes', () => {
  assert.equal(isFileBackedPeEntryPoint(0x10ff,0x1000,0,0x100),true);
  assert.equal(isFileBackedPeEntryPoint(0x1100,0x1000,0,0x100),false);
});

test('no raw data, out-of-section RVA and invalid fields fail closed', () => {
  assert.equal(isFileBackedPeEntryPoint(0x1000,0x1000,0x200,0),false);
  assert.equal(isFileBackedPeEntryPoint(0x0fff,0x1000,0x200,0x200),false);
  for(const invalid of [-1,NaN,Infinity,1.25,0x100000000]) {
    assert.equal(isFileBackedPeEntryPoint(invalid,0x1000,0x200,0x200),false);
  }
});

// Deliberately invented bytes: no copied binary, resource, executable or real data.
function syntheticPe({entryPoint=0x1000, virtualSize=0x1000, rawSize=0x200}={}) {
  const bytes=Buffer.alloc(1024);
  const pe=0x80, optional=pe+24, section=optional+0xf0;
  bytes.writeUInt16LE(0x5a4d,0);            // MZ
  bytes.writeUInt32LE(pe,0x3c);
  bytes.writeUInt32LE(0x00004550,pe);       // PE signature
  bytes.writeUInt16LE(0x8664,pe+4);         // AMD64
  bytes.writeUInt16LE(1,pe+6);              // sections
  bytes.writeUInt16LE(0xf0,pe+20);          // optional header size
  bytes.writeUInt16LE(0x0002,pe+22);        // executable image
  bytes.writeUInt16LE(0x020b,optional);     // PE32+
  bytes.writeUInt32LE(entryPoint,optional+16);
  bytes.writeUInt32LE(0x3000,optional+56);  // image size
  bytes.writeUInt32LE(0x200,optional+60);   // header size
  bytes.writeUInt16LE(2,optional+68);       // GUI subsystem
  bytes.writeUInt32LE(virtualSize,section+8);
  bytes.writeUInt32LE(0x1000,section+12);
  bytes.writeUInt32LE(rawSize,section+16);
  bytes.writeUInt32LE(0x200,section+20);
  bytes.writeUInt32LE(0x20000000,section+36); // executable
  return bytes;
}

test('full PE gate accepts a synthetically file-backed GUI entry point', () => {
  assert.equal(inspectWindowsPeHeader(syntheticPe()).kind,'windows_x64_gui');
  assert.equal(inspectWindowsPeHeader(syntheticPe({entryPoint:0x11ff})).kind,'windows_x64_gui');
});

test('full PE gate rejects entry point in executable virtual zero-fill', () => {
  assert.throws(() => inspectWindowsPeHeader(syntheticPe({entryPoint:0x1200})),
    /WINDOWS_PE_ENTRYPOINT_SECTION/);
});

test('full PE gate rejects entry point in executable raw alignment padding', () => {
  assert.throws(() => inspectWindowsPeHeader(syntheticPe({entryPoint:0x1080,virtualSize:0x80})),
    /WINDOWS_PE_ENTRYPOINT_SECTION/);
  assert.equal(inspectWindowsPeHeader(syntheticPe({entryPoint:0x107f,virtualSize:0x80})).kind,
    'windows_x64_gui');
});
