/** Optional private-only corpus, supplied locally by an authorized collaborator. */
import {createHash} from 'node:crypto';
import {existsSync, lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const local = join(root, '.local');
const localStat = lstatSync(local);
if (!localStat.isDirectory() || localStat.isSymbolicLink()) throw Error('Invalid local staging directory');
const source = join(root, '.local', 'monomeri.json');
const output = join(root, '.local', 'monomeri-data.private.ts');
// Regolo source blob 2e53a914f97674eb222076a0e9f9880d780ef59f,
// converted to a compact UTF-8 JSON array without changing its strings.
const expected = '5b02baeef8c1270978c36fefdcab522ed90aaf01c20dd800fe71c06924d22d6f';
let values = [];
if (existsSync(source)) {
  const stat = lstatSync(source);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 100_000) throw Error('Invalid private monomeri source');
  const bytes = readFileSync(source);
  if (createHash('sha256').update(bytes).digest('hex') !== expected) throw Error('Private monomeri checksum mismatch');
  values = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(values) || values.length !== 360 || values.some(x => typeof x !== 'string' || !x.trim()))
    throw Error('Invalid private monomeri corpus');
}
if (existsSync(output) && (lstatSync(output).isSymbolicLink() || !lstatSync(output).isFile()))
  throw Error('Invalid private monomeri output');
writeFileSync(output, `export const MONOMERI: readonly string[] = ${JSON.stringify(values)};\n`, 'utf8');
console.log(values.length ? 'Private monomeri corpus verified.' : 'Private monomeri corpus unavailable; feature disabled.');
