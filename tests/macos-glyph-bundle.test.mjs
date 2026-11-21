import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {REQUIRED_MAC_GLYPHS, verifyMacGlyphBundle} from '../scripts/mac/verify-glyph-bundle.mjs';

const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/tbcAAAAASUVORK5CYII=', 'base64');
function fixture(fn) {
  const root=mkdtempSync(join(tmpdir(),'virgostars-mac-glyphs-'));
  const first=join(root,'assets/img/simboli-bianchi',REQUIRED_MAC_GLYPHS[0]);
  try {
    for(const glyph of REQUIRED_MAC_GLYPHS) {
      const file=join(root,'assets/img/simboli-bianchi',glyph);
      mkdirSync(dirname(file),{recursive:true});
      writeFileSync(file,image);
    }
    fn({root,first});
  } finally { rmSync(root,{recursive:true,force:true}); }
}

test('Mac original-artwork gate requires complete zodiac, planets, nodes and angle glyphs', () => {
  assert.equal(REQUIRED_MAC_GLYPHS.filter(x=>x.startsWith('segni/')).length,12);
  assert.ok(REQUIRED_MAC_GLYPHS.includes('elementi-celesti/Sun.png'));
  assert.ok(REQUIRED_MAC_GLYPHS.includes('elementi-celesti/true Node Sud-r.png'));
  assert.equal(new Set(REQUIRED_MAC_GLYPHS).size,REQUIRED_MAC_GLYPHS.length);
  fixture(({root})=>assert.equal(verifyMacGlyphBundle(root).count,REQUIRED_MAC_GLYPHS.length));
});

test('Mac build fails instead of silently omitting, replacing or corrupting glyph PNGs', () => {
  fixture(({root,first})=>{
    unlinkSync(first);
    assert.throws(()=>verifyMacGlyphBundle(root),/missing\/invalid glyph segni\/01.png/);
    writeFileSync(first,Buffer.from('synthetic checkerboard, not a PNG'));
    assert.throws(()=>verifyMacGlyphBundle(root),/PNG signature mismatch/);
  });
});
