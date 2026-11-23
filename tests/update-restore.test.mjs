import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/updates/restore-backup.mjs', import.meta.url));
function setup() {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'vs-recovery-test-'));
  const id = 'before-12345-7'; const snap = path.join(root, 'update-backups', id);
  fs.mkdirSync(path.join(snap, 'private-chart-photos-v1'), { recursive: true });
  const files = [['charts-v2.vsarchive', 'older-encrypted'], ['private-chart-photos-v1/a.vphoto', 'older-photo']];
  for (const [name, content] of files) fs.writeFileSync(path.join(snap, name), content);
  const manifest = { format: 1, files: files.map(([name, content]) => ({ path: name, size: Buffer.byteLength(content), sha256: crypto.createHash('sha256').update(content).digest('hex') })) };
  fs.writeFileSync(path.join(snap, 'manifest.json'), JSON.stringify(manifest));
  fs.mkdirSync(path.join(root, 'private-chart-photos-v1'));
  fs.writeFileSync(path.join(root, 'charts-v2.vsarchive'), 'newer-encrypted');
  fs.writeFileSync(path.join(root, 'private-chart-photos-v1/a.vphoto'), 'newer-photo');
  const run = (...args) => spawnSync(process.execPath, [script, '--data-dir', root, ...args], { encoding: 'utf8' });
  return { root, id, snap, run };
}
test('preview is read-only and apply keeps the replaced files', () => {
  const { root, id, run } = setup();
  assert.equal(run('--snapshot', id).status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'charts-v2.vsarchive'), 'utf8'), 'newer-encrypted');
  const result = run('--snapshot', id, '--apply');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'charts-v2.vsarchive'), 'utf8'), 'older-encrypted');
  const work = fs.readdirSync(root).find(name => name.startsWith('restore-work-'));
  assert.equal(fs.readFileSync(path.join(root, work, 'original/charts-v2.vsarchive'), 'utf8'), 'newer-encrypted');
  assert.equal(fs.readFileSync(path.join(root, work, 'original/private-chart-photos-v1/a.vphoto'), 'utf8'), 'newer-photo');
  assert.equal(fs.existsSync(path.join(root, 'restore-in-progress.json')), false);
});
test('tampered backup fails before changing live data', () => {
  const { root, id, snap, run } = setup();
  fs.writeFileSync(path.join(snap, 'charts-v2.vsarchive'), 'tampered');
  assert.notEqual(run('--snapshot', id, '--apply').status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'charts-v2.vsarchive'), 'utf8'), 'newer-encrypted');
});
test('interrupted restore can roll back without losing either version', () => {
  const { root, run } = setup(); const work = 'restore-work-11111111-1111-1111-1111-111111111111';
  fs.mkdirSync(path.join(root, work, 'original'), { recursive: true });
  fs.renameSync(path.join(root, 'charts-v2.vsarchive'), path.join(root, work, 'original/charts-v2.vsarchive'));
  fs.writeFileSync(path.join(root, 'charts-v2.vsarchive'), 'partially-restored');
  fs.writeFileSync(path.join(root, 'restore-in-progress.json'), JSON.stringify({ format: 1, work, files: [{ path: 'charts-v2.vsarchive', hadOriginal: true }] }));
  const result = run('--rollback'); assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'charts-v2.vsarchive'), 'utf8'), 'newer-encrypted');
  assert.equal(fs.readFileSync(path.join(root, work, 'quarantine/charts-v2.vsarchive'), 'utf8'), 'partially-restored');
});
