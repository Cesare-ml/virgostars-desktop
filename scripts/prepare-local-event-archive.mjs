/** Owner's local development snapshot; not part of the application bundle. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const repo = resolve('../VirgoStars-Event-Ephemeris');
const rev = 'origin/data/2026-11-10-snapshot';
const expected = 'c7746927f9132aea8fc338524d4bc6927010229e1589ff6f1bff5e4f8f6d8c2e';
const folder = resolve('.local/event-ephemeris');
const target = resolve(folder, 'virgostars-events-20261110.vseph-p0');
const digest = value => createHash('sha256').update(value).digest('hex');
if (existsSync(target)) {
  if (digest(readFileSync(target)) !== expected) throw Error('Existing local event archive does not match the trusted snapshot; left untouched.');
  console.log('Verified existing local event archive.');
} else {
  const parts = [0,1,2].map(i => execFileSync('git', ['show', `${rev}:datasets/2026-11-10/virgostars-events-20261110.vseph-p0.parts/part-00${i}`],
    {cwd:repo, maxBuffer:2_000_000}));
  const bytes = Buffer.concat(parts);
  if (digest(bytes) !== expected) throw Error('Event archive does not match the trusted snapshot.');
  mkdirSync(folder, {recursive:true});
  writeFileSync(target, bytes, {flag:'wx'});
  console.log('Prepared and verified local event archive (not bundled).');
}
