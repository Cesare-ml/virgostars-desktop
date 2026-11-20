import test from 'node:test';
import assert from 'node:assert/strict';
import { temporaryIconPng, temporaryIconIco } from '../scripts/generate-spike-icon.mjs';

test('creates valid PNG headers for temporary icons',()=>{
  for(const size of [32,64,128]) {
    const png=temporaryIconPng(size);
    assert.equal(png.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
    assert.equal(png.readUInt32BE(16),size);
    assert.equal(png.readUInt32BE(20),size);
  }
});
test('creates ICO container with embedded PNG',()=>{
  const ico=temporaryIconIco();
  assert.equal(ico.readUInt16LE(2),1);
  assert.equal(ico.readUInt16LE(4),1);
  assert.equal(ico.readUInt32LE(14),ico.length-22);
  assert.equal(ico.subarray(22,30).toString('hex'),'89504e470d0a1a0a');
});

test('ICO directory matches the dimensions of every generated PNG variant',()=>{
  for (const size of [32,64,128]) {
    const png = temporaryIconPng(size);
    const ico = temporaryIconIco(png);
    assert.equal(ico.readUInt16LE(0),0);
    assert.equal(ico.readUInt16LE(2),1);
    assert.equal(ico.readUInt16LE(4),1);
    assert.equal(ico[6],size);
    assert.equal(ico[7],size);
    assert.equal(ico.readUInt16LE(10),1);
    assert.equal(ico.readUInt16LE(12),32);
    assert.equal(ico.readUInt32LE(14),png.length);
    assert.equal(ico.readUInt32LE(18),22);
    assert.deepEqual(ico.subarray(22),png);
  }
});

test('ICO generator rejects malformed and inconsistent PNG headers/trailers',()=>{
  const valid = temporaryIconPng(64);
  const mutate=(offset,value)=>{const copy=Buffer.from(valid);copy[offset]=value;return copy;};
  for (const invalid of [
    Buffer.alloc(0), Buffer.alloc(44), Buffer.alloc(1_048_577),
    mutate(0,0), mutate(12,0), mutate(19,32), mutate(23,32),
    mutate(24,16), mutate(25,2), mutate(26,1), mutate(29,0),
    mutate(valid.length-1,0), Buffer.concat([valid,Buffer.from([0])]),
  ]) {
    assert.throws(()=>temporaryIconIco(invalid),/Unsupported temporary icon PNG/);
  }
  assert.throws(()=>temporaryIconIco('not a buffer'),/Unsupported temporary icon PNG/);
  assert.throws(()=>temporaryIconIco(temporaryIconPng(64).subarray(0,40)),/Unsupported temporary icon PNG/);
});
