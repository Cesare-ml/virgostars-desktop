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
