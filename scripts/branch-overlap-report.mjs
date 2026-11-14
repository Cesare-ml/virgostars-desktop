#!/usr/bin/env node
// Read-only local branch path overlaps, not proof of textual conflicts.
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';

export function safeRef(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 240 &&
    /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(s) && !s.includes('..') &&
    !s.includes('//') && !s.includes('/.') && !s.endsWith('/') &&
    !s.endsWith('.') && !s.split('/').some(p => p.endsWith('.lock'));
}

/**
 * Decode `git diff --name-status -z` without confusing path bytes with status
 * tokens. Renames (and any detected copies) include *both* source and target:
 * a concurrent edit to either path needs review before the branches are merged.
 */
export function parsePaths(bytes) {
  if (!Buffer.isBuffer(bytes) || (bytes.length && bytes.at(-1) !== 0))
    throw new Error('Incomplete Git change list');
  if (!bytes.length) return [];
  const decode = new TextDecoder('utf-8', {fatal:true});
  const fields = [];
  let begin = 0;
  for (let i=0; i<bytes.length; i++) {
    if (bytes[i] !== 0) continue;
    if (begin === i) throw new Error('Empty Git change field');
    fields.push(decode.decode(bytes.subarray(begin,i)));
    begin = i+1;
  }
  const paths = new Set();
  for (let i=0; i<fields.length;) {
    const status = fields[i++];
    const renameOrCopy = /^[RC](?:100|[0-9]{1,2})$/.test(status);
    if (!renameOrCopy && !/^[ADMT]$/.test(status))
      throw new Error('Unexpected Git change status');
    const n = renameOrCopy ? 2 : 1;
    if (i + n > fields.length) throw new Error('Incomplete Git change record');
    for (let j=0; j<n; j++) paths.add(fields[i++]);
  }
  return [...paths];
}

export function report(base, branches) {
  if (!safeRef(base) || branches.length<2 || branches.length>100 ||
    branches.some(b=>!safeRef(b.branch) || !Array.isArray(b.paths)) ||
    new Set(branches.map(b=>b.branch)).size!==branches.length ||
    branches.some(b=>b.branch===base)) throw new Error('Invalid branch list');
  const files=new Map();
  const stats=[];
  for (const {branch,paths} of branches) {
    const unique=new Set(paths);
    stats.push({branch,changedFiles:unique.size});
    for (const path of unique) {
      if (typeof path!=='string' || !path || path.includes('\0')) throw new Error('Invalid path');
      if (!files.has(path)) files.set(path,[]);
      files.get(path).push(branch);
    }
  }
  const overlaps=[...files].filter(([,owners])=>owners.length>1)
    .map(([path,owners])=>({path,branches:owners.sort()}))
    .sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  return {base,branches:stats,overlapFiles:overlaps.length,overlaps,
    note:'Shared paths require review; they are not confirmed merge conflicts.'};
}

export function parseArgs(args) {
  let base='main', seenBase=false, json=false;
  const branches=[];
  for (const arg of args) {
    if (arg==='--json' && !json) json=true;
    else if (arg.startsWith('--base=') && !seenBase) {
      seenBase=true; base=arg.slice(7);
    } else if (arg.startsWith('-')) throw new Error('Invalid argument');
    else branches.push(arg);
  }
  if (!safeRef(base) || branches.length<2 || branches.length>100 ||
    branches.some(b=>!safeRef(b) || b===base) || new Set(branches).size!==branches.length)
    throw new Error('Provide 2–100 distinct local branch refs');
  return {base,branches,json};
}

export function run(base,branches) {
  // Validate everything before launching Git, including direct API callers.
  parseArgs([`--base=${base}`,...branches]);
  return report(base, branches.map(branch=>{
    const r=spawnSync('git',['diff','--no-ext-diff','--no-textconv','--name-status','-z','--find-renames=50%','--diff-filter=ACDMRT',
      `${base}...${branch}`,'--'],{encoding:null,maxBuffer:2*1024*1024,windowsHide:true});
    if (r.error || r.signal || r.status!==0)
      throw new Error(`Cannot compare ${base} with ${branch}: missing refs or merge base`);
    return {branch,paths:parsePaths(r.stdout)};
  }));
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const {base,branches,json}=parseArgs(process.argv.slice(2));
    const result=run(base,branches);
    if (json) console.log(JSON.stringify(result,null,2));
    else {
      console.log(`${result.overlapFiles} shared paths among ${branches.length} branches (base ${base})`);
      for (const row of result.overlaps) console.log(`${JSON.stringify(row.path)}: ${row.branches.join(', ')}`);
      console.log(result.note);
    }
  } catch (e) {
    console.error(e instanceof Error?e.message:'Cannot inspect branches');
    process.exitCode=2;
  }
}
