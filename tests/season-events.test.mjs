import test from 'node:test';
import assert from 'node:assert/strict';
import {findSeasonIngress} from '../src/app/astro/season-events.ts';

test('finds each solar ingress including the longitude wrap',async () => {
  for (let season=0;season<4;season++) {
    const expected=Date.UTC(2026,2+season*3,20,9,30);
    const sample=async instant=>((season*90+(instant-expected)/86400000+360)%360);
    const found=await findSeasonIngress(sample,2026,season);
    assert.ok(Math.abs(found-expected)<=1000);
  }
});

test('rejects an unavailable crossing',async () => {
  await assert.rejects(findSeasonIngress(async()=>180,2026,0));
});
