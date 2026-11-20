import {copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {basename, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const hashedAsset = /^(?:main|chunk|polyfills|scripts|styles)-[A-Z0-9]{8,}\.(?:js|css)$/;
const hash = p => createHash('sha256').update(readFileSync(p)).digest('hex');

/** Keep the previous deployed hashed assets so already-open clients keep working. */
export function snapshotAssets(dist, snapshot, expectedMain) {
  if (!/^main-[A-Z0-9]{8,}\.js$/.test(expectedMain)) throw Error('Nome bundle remoto inatteso.');
  const index = readFileSync(join(dist,'index.html'),'utf8');
  const matches = [...index.matchAll(/main-[A-Z0-9]{8,}\.js/g)].map(m=>m[0]);
  if (matches.length !== 1 || matches[0] !== expectedMain) throw Error('La build locale precedente non corrisponde al sito pubblicato.');
  if (existsSync(snapshot)) throw Error('La cartella snapshot esiste già.');
  const names = readdirSync(dist).filter(name=>hashedAsset.test(name));
  if (!names.includes(expectedMain)) throw Error('Bundle precedente non presente.');
  mkdirSync(snapshot,{recursive:true});
  for (const name of names) copyFileSync(join(dist,name),join(snapshot,name));
  return names.length;
}

export function restoreAssets(dist, snapshot) {
  const names = readdirSync(snapshot);
  if (!names.length || names.some(name=>!hashedAsset.test(name))) throw Error('Snapshot asset non valido.');
  for (const name of names) {
    const old = join(snapshot,name), dest = join(dist,name);
    if (existsSync(dest) && hash(old) !== hash(dest)) throw Error(`Asset omonimo con contenuto differente: ${basename(name)}`);
  }
  for (const name of names) if (!existsSync(join(dist,name))) copyFileSync(join(snapshot,name),join(dist,name));
  return names.length;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [, , action, dist, snapshot, expectedMain] = process.argv;
    if (action === 'snapshot' && process.argv.length === 6) console.log(`Asset precedenti conservati: ${snapshotAssets(dist,snapshot,expectedMain)}`);
    else if (action === 'restore' && process.argv.length === 5) console.log(`Asset precedenti ripristinati: ${restoreAssets(dist,snapshot)}`);
    else throw Error('Uso: release-site-assets.mjs snapshot DIST SNAPSHOT MAIN oppure restore DIST SNAPSHOT');
  } catch (error) { console.error(error.message); process.exitCode=1; }
}
