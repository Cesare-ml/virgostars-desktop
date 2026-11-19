#!/usr/bin/env node
// Restore the optional private development links after npm ci. Never remove a
// normal directory: the only replaceable objects are existing package links.
import {existsSync, lstatSync, readFileSync, realpathSync, renameSync, rmdirSync, symlinkSync, unlinkSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('Usage: node scripts/link-local-astrology-libraries.mjs <functions-worktree> <charts-worktree>');
  process.exit(2);
}
const functions = resolve(args[0]);
const charts = resolve(args[1], 'dist', 'grafici-astrologici');
const metadata = path => JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
const functionPackage = metadata(functions);
const chartPackage = metadata(charts);
if (functionPackage.name !== 'astrological-functions' ||
    !['./regolo-directions', './regolo-arabic-parts', './virgostars-kleroi', './virgostars-star-contacts']
      .every(key => functionPackage.exports?.[key]) || chartPackage.name !== 'grafici-astrologici') {
  throw new Error('Selected libraries do not expose the required Desktop contracts.');
}
const chartEntry = join(charts, 'fesm2022', 'grafici-astrologici.mjs');
const chartSource = readFileSync(chartEntry, 'utf8');
if (!chartSource.includes('SYNASTRY_DEFLECTION_VERSION') || !chartSource.includes('REGOLO_DIRECTIONS_RENDER_VERSION')) {
  throw new Error('Build the Charts worktree with the required Desktop renderer before linking it.');
}

const dependencies = join(root, 'node_modules');
if (!existsSync(dependencies)) throw new Error('Install the locked Desktop dependencies first.');
const links = [
  {path: join(dependencies, 'astrological-functions'), target: realpathSync(functions)},
  {path: join(dependencies, 'grafici-astrologici'), target: realpathSync(charts)},
];
const removeLink = path => process.platform === 'win32' ? rmdirSync(path) : unlinkSync(path);
for (const link of links) {
  link.backup = link.path + '.desktop-link-backup';
  if (existsSync(link.backup)) throw new Error('A previous link backup exists; resolve it before continuing.');
  if (existsSync(link.path)) {
    if (!lstatSync(link.path).isSymbolicLink()) throw new Error('Refusing to replace a non-link package directory.');
    link.unchanged = realpathSync(link.path) === link.target;
  }
}
const completed = [];
try {
  for (const link of links) {
    if (link.unchanged) continue;
    const hadOriginal = existsSync(link.path);
    if (hadOriginal) renameSync(link.path, link.backup);
    try {
      symlinkSync(link.target, link.path, process.platform === 'win32' ? 'junction' : 'dir');
    } catch (error) {
      if (hadOriginal) renameSync(link.backup, link.path);
      throw error;
    }
    completed.push({...link, hadOriginal});
  }
} catch (error) {
  for (const link of completed.reverse()) {
    removeLink(link.path);
    if (link.hadOriginal) renameSync(link.backup, link.path);
  }
  throw error;
}
for (const link of completed) if (link.hadOriginal) removeLink(link.backup);
console.log('Desktop links point to the selected local Functions and Charts builds.');
