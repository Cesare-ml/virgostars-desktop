import test from 'node:test';
import assert from 'node:assert/strict';
import {celestialGlyphUrl,zodiacGlyphUrl} from '../src/app/astrological-glyphs.ts';

test('celestial glyphs use the approved pack, including axes, nodes and kleroi', () => {
  for (const name of ['AS','DS','MC','IC','Sun','true Node','osc. Apogee','Tyche','Daimon']) {
    assert.equal(celestialGlyphUrl(name), `/assets/img/simboli-bianchi/elementi-celesti/${encodeURIComponent(name)}.png`);
  }
  assert.match(celestialGlyphUrl('Mercury',true),/Mercury-r\.png$/);
  assert.match(celestialGlyphUrl('Sun',true),/Sun\.png$/);
  assert.equal(zodiacGlyphUrl(0),'/assets/img/simboli-bianchi/segni/01.png');
  assert.equal(zodiacGlyphUrl(11),'/assets/img/simboli-bianchi/segni/12.png');
  assert.equal(zodiacGlyphUrl(12),'');
});
