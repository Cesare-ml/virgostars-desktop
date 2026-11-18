/** Convert the explicitly supplied Regolo source into the local private corpus. */
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const input = process.argv[2];
if (!input || process.argv.length !== 3) throw Error('Supply the local Regolo monomeri.ts file');
const stat = lstatSync(input);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000) throw Error('Invalid Regolo source');
const source = readFileSync(input, 'utf8');
const match = /^\s*export\s+const\s+monomeri\s*=\s*(\[[\s\S]*\])\s*;?\s*$/.exec(source);
if (!match) throw Error('Unexpected Regolo source format');
const values = JSON.parse(match[1].replace(/,\s*\]$/, ']'));
if (!Array.isArray(values) || values.length !== 360 || values.some(x => typeof x !== 'string' || !x.trim()))
  throw Error('Invalid Regolo corpus');
const json = JSON.stringify(values);
const expected = '5b02baeef8c1270978c36fefdcab522ed90aaf01c20dd800fe71c06924d22d6f';
if (createHash('sha256').update(json).digest('hex') !== expected) throw Error('Regolo corpus checksum mismatch');
const local = join(root, '.local');
mkdirSync(local, {recursive:true});
if (lstatSync(local).isSymbolicLink()) throw Error('Invalid local directory');
const output = join(local, 'monomeri.json');
if (existsSync(output)) {
  const info = lstatSync(output);
  if (!info.isFile() || info.isSymbolicLink() || createHash('sha256').update(readFileSync(output)).digest('hex') !== expected)
    throw Error('Existing private corpus differs; inspect it before replacing');
} else writeFileSync(output, json, {encoding:'utf8',flag:'wx'});
console.log('Private Regolo corpus verified locally.');
