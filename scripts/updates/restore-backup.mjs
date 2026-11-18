#!/usr/bin/env node
// Offline recovery: no key material is read or exported. Run only with the app closed.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const rootArg = option('--data-dir');
if (!rootArg) throw Error('Specify --data-dir, --snapshot before-... and optionally --apply; use --rollback after interruption.');
const root = path.resolve(rootArg);
const journalPath = path.join(root, 'restore-in-progress.json');
const exists = p => fs.existsSync(p);
function checkPath(p) {
  let part = path.parse(p).root;
  for (const component of p.slice(part.length).split(path.sep).filter(Boolean)) {
    part = path.join(part, component);
    try {
      const stat = fs.lstatSync(part);
      if (stat.isSymbolicLink()) throw Error('Links or junctions are not permitted in recovery paths.');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function hash(p) {
  const h = crypto.createHash('sha256'); const fd = fs.openSync(p, 'r');
  const buffer = Buffer.alloc(65536); let size = 0;
  try { for (;;) { const n = fs.readSync(fd, buffer, 0, buffer.length, null); if (!n) break; h.update(buffer.subarray(0, n)); size += n; } }
  finally { fs.closeSync(fd); }
  return { size, sha256: h.digest('hex') };
}
function closed() {
  if (process.platform !== 'win32') return;
  const probe = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "if (Get-Process -Name 'virgostars-desktop-spike' -ErrorAction SilentlyContinue) { exit 3 }"], { stdio: 'ignore' });
  if (probe.status !== 0) throw Error('Close all VirgoStars Desktop processes before recovery.');
}
function safeName(name) {
  if (typeof name !== 'string' || name.includes('\\') || name.includes(':') || name.split('/').some(p => !p || p === '.' || p === '..')) return false;
  return name === 'charts-v2.vsarchive' || name === 'ephemeris.json' || name.startsWith('private-chart-photos-v1/') || name.startsWith('resources/places/') || name.startsWith('resources/ephemeris/');
}
function target(name) { if (!safeName(name)) throw Error('Invalid snapshot path.'); return path.join(root, ...name.split('/')); }
function rollback(journal) {
  const work = path.join(root, journal.work);
  if (!/^restore-work-[a-f0-9-]+$/.test(journal.work) || !Array.isArray(journal.files)) throw Error('Invalid recovery journal.');
  checkPath(work);
  for (const item of [...journal.files].reverse()) {
    const dest = target(item.path); const original = path.join(work, 'original', ...item.path.split('/'));
    const staged = path.join(work, 'staged', ...item.path.split('/'));
    const quarantine = path.join(work, 'quarantine', ...item.path.split('/'));
    checkPath(dest); checkPath(original); checkPath(staged);
    if (exists(original)) {
      if (exists(dest)) { fs.mkdirSync(path.dirname(quarantine), { recursive: true }); fs.renameSync(dest, quarantine); }
      fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(original, dest);
    } else if (!item.hadOriginal && !exists(staged) && exists(dest)) {
      fs.mkdirSync(path.dirname(quarantine), { recursive: true }); fs.renameSync(dest, quarantine);
    }
  }
  fs.renameSync(journalPath, path.join(work, 'rolled-back.json'));
}
checkPath(root);
if (!fs.statSync(root).isDirectory()) throw Error('Data directory unavailable.');
if (args.includes('--rollback')) {
  closed();
  rollback(JSON.parse(fs.readFileSync(journalPath, 'utf8')));
  console.log('Interrupted recovery rolled back. Existing files remain in the recovery folder.');
  process.exit(0);
}
if (exists(journalPath)) throw Error('A recovery is incomplete; run --rollback first.');
const id = option('--snapshot');
if (!/^before-\d+-\d+$/.test(id ?? '')) throw Error('Invalid snapshot name.');
const snapshot = path.join(root, 'update-backups', id);
checkPath(snapshot);
const manifest = JSON.parse(fs.readFileSync(path.join(snapshot, 'manifest.json'), 'utf8'));
if (manifest.format !== 1 || !Array.isArray(manifest.files) || manifest.files.length > 100000) throw Error('Invalid manifest.');
const seen = new Set();
for (const entry of manifest.files) {
  if (!safeName(entry.path) || seen.has(entry.path) || !Number.isSafeInteger(entry.size) || !/^[0-9a-f]{64}$/.test(entry.sha256)) throw Error('Invalid manifest entry.');
  seen.add(entry.path);
  const source = path.join(snapshot, ...entry.path.split('/')); checkPath(source);
  if (!fs.lstatSync(source).isFile()) throw Error('Snapshot item is not a file.');
  const actual = hash(source);
  if (actual.size !== entry.size || actual.sha256 !== entry.sha256) throw Error('Snapshot integrity verification failed.');
}
console.log(`Verified ${manifest.files.length} files. Installer resources remain in the snapshot for separate recovery.`);
if (!args.includes('--apply')) { console.log('Preview only; pass --apply after closing the application.'); process.exit(0); }
closed();
const personal = manifest.files.filter(f => !f.path.startsWith('resources/'));
if (!personal.some(f => f.path === 'charts-v2.vsarchive')) throw Error('Snapshot has no encrypted archive; refusing to replace current data.');
const workName = `restore-work-${crypto.randomUUID()}`; const work = path.join(root, workName);
fs.mkdirSync(work);
const files = [];
for (const item of personal) {
  const dest = target(item.path); const staged = path.join(work, 'staged', ...item.path.split('/'));
  checkPath(dest); fs.mkdirSync(path.dirname(staged), { recursive: true });
  if (exists(dest) && !fs.lstatSync(dest).isFile()) throw Error('Existing recovery target is not a regular file.');
  fs.copyFileSync(path.join(snapshot, ...item.path.split('/')), staged, fs.constants.COPYFILE_EXCL);
  const stagedFd = fs.openSync(staged, 'r+'); try { fs.fsyncSync(stagedFd); } finally { fs.closeSync(stagedFd); }
  const actual = hash(staged); if (actual.size !== item.size || actual.sha256 !== item.sha256) throw Error('Staging verification failed.');
  files.push({ path: item.path, hadOriginal: exists(dest) });
}
const journal = { format: 1, work: workName, files };
const fd = fs.openSync(journalPath, 'wx');
try { fs.writeFileSync(fd, JSON.stringify(journal)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
try {
  for (const item of files) {
    const dest = target(item.path); const staged = path.join(work, 'staged', ...item.path.split('/'));
    const original = path.join(work, 'original', ...item.path.split('/'));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (item.hadOriginal) { fs.mkdirSync(path.dirname(original), { recursive: true }); fs.renameSync(dest, original); }
    fs.renameSync(staged, dest);
  }
  fs.renameSync(journalPath, path.join(work, 'completed.json'));
} catch (error) {
  try { rollback(journal); } catch { throw Error('Recovery interrupted. Keep the app closed and run --rollback.'); }
  throw error;
}
console.log('Recovery complete. Previous files are preserved in the recovery folder.');
