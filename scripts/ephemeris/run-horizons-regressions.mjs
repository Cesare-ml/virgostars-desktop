/**
 * Manual deterministic Horizons test gate. No network acquisition or app boot.
 * A partial checkout must fail, never appear to pass as the complete suite.
 */
import { lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const ROOT=fileURLToPath(new URL('../../', import.meta.url));
const SUITES=Object.freeze({
  core:Object.freeze([
    'tests/rollback-horizons-directory.test.mjs',
    'tests/strict-horizons-headers.test.mjs',
  ]),
  all:Object.freeze([
    'tests/prepare-horizons-vector-plan.test.mjs',
    'tests/acquire-horizons-vectors.test.mjs',
    'tests/verify-horizons-bundle.test.mjs',
    'tests/rollback-horizons-directory.test.mjs',
    'tests/strict-horizons-headers.test.mjs',
  ]),
});
const EXPECTED=Object.freeze({core:29,all:75});
const MAX_FILE=512*1024;
const SAFE_CODE=Object.freeze({PASS:0,FAILED:1,INCOMPLETE:2,INVALID_ARGS:2,INTERNAL_ERROR:3});

export function parseRegressionArgs(args) {
  if (!Array.isArray(args) || args.length!==2 || args[0]!=='--suite' ||
      !Object.hasOwn(SUITES,args[1])) return null;
  return args[1];
}
export function getRegressionSuites(suite) {
  return Object.hasOwn(SUITES,suite) ? [...SUITES[suite]] : null;
}
/** Reject misleading child TAP summaries including skipped or cancelled tests. */
export function parseTestSummary(stdout, expected) {
  if (typeof stdout!=='string' || !Number.isInteger(expected) || expected<1 || expected>500)
    return false;
  const last = name => [...stdout.matchAll(new RegExp('^# '+name+' (\\d+)\\s*$','gm'))]
    .map(m=>Number(m[1]));
  const tests=last('tests'), pass=last('pass'), fail=last('fail');
  const skipped=last('skipped'), cancelled=last('cancelled'), todo=last('todo');
  return [tests,pass,fail,skipped,cancelled,todo].every(x=>x.length===1) &&
    tests[0]===expected && pass[0]===expected && fail[0]===0 &&
    skipped[0]===0 && cancelled[0]===0 && todo[0]===0;
}

/** A test directory with missing, symlinked or oversized files is incomplete. */
export async function inspectRegressionFiles(root,suite) {
  const list=getRegressionSuites(suite);
  if (!list || typeof root!=='string') return false;
  try {
    for (const relative of list) {
      const file=await lstat(join(root,relative));
      if (!file.isFile() || file.isSymbolicLink() || file.size===0 || file.size>MAX_FILE)
        return false;
    }
  } catch { return false; }
  return true;
}

/** Intended for operator invocation only; no GitHub Actions or background job. */
export async function runHorizonsRegressions(suite,options={}) {
  const root=options.root??ROOT;
  const run=options.spawn??spawnSync;
  if (!getRegressionSuites(suite)) return Object.freeze({status:'INVALID_ARGS',exitCode:SAFE_CODE.INVALID_ARGS});
  if (!await inspectRegressionFiles(root,suite))
    return Object.freeze({status:'INCOMPLETE',exitCode:SAFE_CODE.INCOMPLETE});
  try {
    // A regression runner may itself be launched by Node's test framework. Do not
    // propagate the internal child-test context to the nested suite.
    const env={...process.env};
    delete env.NODE_TEST_CONTEXT;
    const actual=run(process.execPath,['--test',...SUITES[suite]],{
      cwd:root,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024,
      windowsHide:true,stdio:['ignore','pipe','pipe'],env,
    });
    if (actual.error || actual.signal || actual.status!==0 ||
        !parseTestSummary(actual.stdout,EXPECTED[suite]))
      return Object.freeze({status:'FAILED',exitCode:SAFE_CODE.FAILED});
    return Object.freeze({status:'PASS',exitCode:SAFE_CODE.PASS,testCount:EXPECTED[suite]});
  } catch {
    return Object.freeze({status:'INTERNAL_ERROR',exitCode:SAFE_CODE.INTERNAL_ERROR});
  }
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const suite=parseRegressionArgs(process.argv.slice(2));
  const result=await runHorizonsRegressions(suite);
  process.stdout.write('HORIZONS_REGRESSION:'+result.status+'\n');
  if (result.status==='PASS') process.stdout.write('HORIZONS_TEST_COUNT:'+result.testCount+'\n');
  process.exitCode=result.exitCode;
}
