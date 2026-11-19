#!/usr/bin/env node
// Private, local conversion of the user-supplied two table exports. No database
// connection, whole-row copy, external request or publication is performed.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {resolve, dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseDocument} from 'htmlparser2';
import {textContent} from 'domutils';

const [starsPath, constellationsPath] = process.argv.slice(2);
if (!starsPath || !constellationsPath) throw new Error('Expected star and constellation table exports');
const stage = resolve(dirname(fileURLToPath(import.meta.url)), '../../.local/ephemeris');
const target = join(stage, 'fixed-stars.json');
const signs = ['ARI','TAU','GEM','CAN','LEO','VIR','LIB','SCO','SAG','CAP','AQU','PIS'];
const allowed = new Set(['Sun','Moon','Mercury','Venus','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto','AS','DS','MC','IC']);

// This export uses one physical row per record and quotes nested JSON strings
// as '"...'". A bare CSV parser would split the embedded HTML and JSON.
function fields(s) {
  const out=[]; let i=0;
  while (i<s.length) {
    if (s[i] === '"') {
      const start=++i;
      while (i<s.length && !(s[i] === '"' && s[i-1] !== "'" && (i+1===s.length || s[i+1]===','))) i++;
      if (i===s.length) throw new Error('Unterminated quoted field');
      out.push(s.slice(start,i)); i++; if (s[i]===',') i++;
    } else {
      let end=s.indexOf(',',i); if (end<0) end=s.length;
      out.push(s.slice(i,end)); i=end+1;
    }
    if (i===s.length && s.endsWith(',')) out.push('');
  }
  return out;
}
const rows = file => readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(fields);
const plain = value => textContent(parseDocument(value, {decodeEntities:true})).replace(/\s+/gu,' ').trim();
const constellationRows = rows(constellationsPath);
if (constellationRows.some(row => row.length !== 9 || !/^\d+$/.test(row[0]))) throw new Error('Unexpected constellation export format');
const constellations = new Map(constellationRows.map(row => [row[0],plain(row[7] || row[1])]));
const raw = rows(starsPath);
if (raw.some(row => row.length !== 25 || !/^\d+$/.test(row[0]))) throw new Error('Unexpected star export format');

let correctedSignTypos=0;
function longitude(input, previous) {
  let value=plain(input);
  // Two export spellings can be resolved unambiguously from the same star's
  // 1900 sign; do not guess other malformed or missing coordinates.
  if (/^\d{1,2}CAB\d{1,2}$/i.test(value) && /^\d{1,2}CAN\d{1,2}$/i.test(plain(previous))) {
    value=value.replace(/CAB/i,'CAN'); correctedSignTypos++;
  } else if (/^\d{1,2}SCAP\d{1,2}$/i.test(value) && /^\d{1,2}CAP\d{1,2}$/i.test(plain(previous))) {
    value=value.replace(/SCAP/i,'CAP'); correctedSignTypos++;
  }
  const m = /^(\d{1,2})(ARI|TAU|GEM|CAN|LEO|VIR|LIB|SCO|SAG|CAP|AQU|PIS)(\d{1,2})$/i.exec(value);
  if (!m || +m[1]>=30 || +m[3]>=60) return null;
  return signs.indexOf(m[2].toUpperCase())*30 + +m[1] + +m[3]/60;
}
function latitude(input) {
  const text = plain(input).replace(/[−–]/g,'-').replace(/\s+/g,'');
  const match = /^([+-]?)(\d{1,2})(?:[.°](\d{1,2})(?:[′'](\d{1,2}(?:\.\d+)?))?[″′']?|\s*(\d{1,2})\s*(\d{1,2})?)?$/.exec(text);
  // Original exports also use space-separated degrees, minutes and seconds.
  const spaced = /^([+-]?)(\d{1,2})\s+(\d{1,2})(?:\s+(\d{1,2}(?:\.\d+)?))?$/.exec(plain(input).replace(/[−–]/g,'-').trim());
  const m = spaced || match;
  if (!m) return null;
  const degrees=+m[2], minutes=+(m[3] || 0), seconds=+(m[4] || 0);
  if (degrees>90 || minutes>60 || seconds>60) return null;
  const value=(degrees + minutes/60 + seconds/3600)*(m[1]==='-'?-1:1);
  return Math.abs(value)<90 ? value : null;
}
function interpretations(row) {
  const raw = row[23] || row[19] || row[18];
  if (!raw) return {};
  const obj = JSON.parse(raw.replaceAll("'\"",'"'));
  const entries = [];
  for (const [key,value] of Object.entries(obj)) {
    if (!allowed.has(key) || !Array.isArray(value)) continue;
    const content = value.filter(x=>typeof x==='string').map(plain).filter(Boolean).join('\n\n');
    if (content.length>8192) throw new Error('Interpretation exceeds the local catalogue bound');
    if (content) entries.push([key,content]);
  }
  return Object.fromEntries(entries);
}
const catalog=[]; let skipped=0;
for (const row of raw) {
  const lon=longitude(row[8],row[7]), lat=latitude(row[14]);
  if (lon===null || lat===null) {skipped++; continue;}
  const magnitudeText = plain(row[16]).replace(/[−–]/g,'-');
  const mag = /^[-+]?\d+(?:\.\d+)?/.exec(magnitudeText);
  const magnitude = mag && +mag[0]>=-10 && +mag[0]<=20 ? +mag[0] : null;
  const sourceName=plain(row[2] || `${row[3]} ${row[24]}`);
  const name=sourceName.replace(/[^\p{L}\p{N} .'-]/gu,' ').replace(/\s+/g,' ').trim().slice(0,80);
  if (!name) {skipped++; continue;}
  const metadata={id:+row[0],name,magnitude,
    constellation:(constellations.get(row[1]) || plain(row[24]) || null)?.slice(0,160) ?? null,
    interpretations:interpretations(row)};
  // HIP 32349 has a separately identified Hipparcos astrometric record. Radial
  // velocity remains an explicit zero assumption, as in the bundled sample.
  const coordinates = metadata.id === 102 ? {epochTdbJd:2448349.0625, raDeg:101.28854105,
    decDeg:-16.71314306, pmRaMasYear:-546.01, pmDecMasYear:-1223.08, parallaxMas:379.21, radialVelocityKmS:0} :
    {epochTdbJd:2451545, approximateEcliptic:{longitudeDeg:lon,latitudeDeg:lat}};
  catalog.push({...metadata,...coordinates});
}
if (!catalog.length) throw new Error('No usable star coordinates');
mkdirSync(stage,{recursive:true});
const output={schema:'virgostars-desktop-stars/1', provenance:'User-supplied VirgoStars cow_stelle/cow_costellazioni exports; approximate J2000 positions and selected conjunction interpretations.', stars:catalog};
writeFileSync(target,JSON.stringify(output),{flag:'wx',mode:0o600});
console.log(`Prepared ${catalog.length} star positions and selected conjunction texts; ${skipped} rows omitted, ${correctedSignTypos} sign typos resolved from the same row's 1900 value. Existing files were not overwritten.`);
