#!/usr/bin/env node
// Validate that an original-artwork Mac build contains all glyphs used by the UI.
// The separately executed private-bundle verifier checks each image against its pinned SHA-256.
import {lstatSync, readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const HEADER=Buffer.from('89504e470d0a1a0a','hex');
const CELESTIAL=Object.freeze([
  'Sun','Moon','Mercury','Mercury-r','Venus','Venus-r','Mars','Mars-r',
  'Jupiter','Jupiter-r','Saturn','Saturn-r','Uranus','Uranus-r',
  'Neptune','Neptune-r','Pluto','Pluto-r','Chiron','Chiron-r',
  'true Node','true Node-r','true Node Sud','true Node Sud-r',
  'mean Node','mean Node-r','mean Node Sud','mean Node Sud-r',
  'AS','DS','MC','IC'
]);
export const REQUIRED_MAC_GLYPHS=Object.freeze([
  ...Array.from({length:12},(_,i)=>'segni/'+String(i+1).padStart(2,'0')+'.png'),
  ...CELESTIAL.map(name=>'elementi-celesti/'+name+'.png')
]);

export function verifyMacGlyphBundle(bundlePath) {
  const base=join(resolve(bundlePath),'assets','img','simboli-bianchi');
  for(const relative of REQUIRED_MAC_GLYPHS) {
    const full=join(base,...relative.split('/'));
    try {
      const info=lstatSync(full);
      if(!info.isFile() || info.isSymbolicLink() || info.size<24)
        throw new Error('not an ordinary PNG file');
      const bytes=readFileSync(full);
      if(!bytes.subarray(0,8).equals(HEADER)) throw new Error('PNG signature mismatch');
    } catch(error) {
      throw new Error('Mac artwork bundle missing/invalid glyph '+relative+': '+(error instanceof Error?error.message:String(error)));
    }
  }
  return {count:REQUIRED_MAC_GLYPHS.length};
}

if(process.argv[1] && resolve(process.argv[1])===resolve(fileURLToPath(import.meta.url))) {
  try {
    if(process.argv.length!==2) throw new Error('No CLI options are supported');
    const output=verifyMacGlyphBundle(join(ROOT,'dist','desktop','browser'));
    console.log('Verified '+output.count+' required original zodiac/planet glyph PNGs in the Mac Angular bundle.');
  } catch(error) {
    console.error('MAC_GLYPH_BUNDLE_FAILED:',error instanceof Error?error.message:String(error));
    process.exitCode=1;
  }
}
