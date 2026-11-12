import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CARGO_TIMEOUT_MS, CARGO_MAX_BUFFER_BYTES, parseDe441SmokeArgs, runDe441CargoSmoke,
} from '../scripts/de441-smoke-runner.mjs';

const good = ['/external/classic-de441.eph', '2026-11-12T17:01:02.000Z', '44123456', '11345678', '120.5'];
const input = () => parseDe441SmokeArgs(good);

test('canonical UTC and exact observer fields are parsed and bounded', () => {
  assert.deepEqual(input(), {
    kind:'VALID', kernel:good[0], utcIso:good[1], latMicro:44123456,
    lngMicro:11345678, heightMeters:120.5,
  });
});

test('missing or unsafe arguments cannot dispatch Cargo', () => {
  for (const args of [[], good.slice(0,4), [...good,'x'],
    ['',...good.slice(1)], [' a ',...good.slice(1)],
    ['bad\npath',...good.slice(1)], ['a'.repeat(4097),...good.slice(1)],
    [1,...good.slice(1)]]) assert.notEqual(parseDe441SmokeArgs(args).kind, 'VALID');
});

test('invalid calendar values and noncanonical UTC representations fail closed', () => {
  for (const date of ['2026-02-30T17:01:02.000Z','2026-11-31T17:01:02.000Z',
    '2026-11-12T24:01:02.000Z','2026-11-12T17:01:02+00:00',
    '2026-11-12T17:01:02Z','2026-11-12T17:01:02.000Z ']) {
    assert.equal(parseDe441SmokeArgs([good[0],date,...good.slice(2)]).kind,'INVALID_INPUT',date);
  }
});

test('IERS-supported range is inclusive at start and exclusive at end', () => {
  assert.equal(parseDe441SmokeArgs([good[0],'1972-01-01T00:00:00.000Z',...good.slice(2)]).kind,'VALID');
  assert.equal(parseDe441SmokeArgs([good[0],'2027-06-27T23:59:59.999Z',...good.slice(2)]).kind,'VALID');
  for (const utc of ['1971-12-31T23:59:59.999Z','2027-06-28T00:00:00.000Z']) {
    assert.equal(parseDe441SmokeArgs([good[0],utc,...good.slice(2)]).kind,'INVALID_INPUT');
  }
});

test('coordinate and height arguments require canonical finite decimal values', () => {
  for (const value of ['',' ','NaN','Infinity','1e3','0x10','01','+1','1.2','90000001','-90000001']) {
    assert.equal(parseDe441SmokeArgs([good[0],good[1],value,good[3],good[4]]).kind,'INVALID_INPUT',value);
  }
  assert.equal(parseDe441SmokeArgs([good[0],good[1],good[2],'180000001',good[4]]).kind,'INVALID_INPUT');
  for (const height of ['',' ','NaN','1e4','-12000.1','100000.1','-Infinity','a'.repeat(41)]) {
    assert.equal(parseDe441SmokeArgs([...good.slice(0,4),height]).kind,'INVALID_INPUT',height);
  }
  assert.equal(parseDe441SmokeArgs([good[0],good[1],'-90000000','-180000000','-12000']).kind,'VALID');
});

test('Cargo command is shell-free, bounded, and receives only exact five inputs', () => {
  let called = 0;
  const fakeSpawn = (command, argv, options) => {
    called++;
    assert.equal(command,'cargo');
    assert.deepEqual(argv, ['run','--quiet','--manifest-path','/test/Cargo.toml','--',
      good[0],good[1],good[2],good[3],good[4]]);
    assert.equal(options.shell,false);
    assert.equal(options.timeout,CARGO_TIMEOUT_MS);
    assert.equal(options.maxBuffer,CARGO_MAX_BUFFER_BYTES);
    assert.equal(options.windowsHide,true);
    assert.equal(options.killSignal,'SIGKILL');
    return {status:0,stdout:'{"heightMeters":120.5}'};
  };
  const code=runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>true,fakeSpawn);
  assert.equal(code,'SHAPE_VALID_EXPERIMENTAL_UNVERIFIED');
  assert.equal(called,1);
});

test('invalid arguments never invoke a child process', () => {
  assert.equal(runDe441CargoSmoke({kind:'INVALID_INPUT'},'/test/Cargo.toml',()=>true,()=>{throw Error('must not run');}),'INVALID_INPUT');
});

test('native timeout, missing Cargo, failed child and throw are sanitized', () => {
  for(const [result,expected] of [
    [{status:null,error:{code:'ETIMEDOUT'},stderr:'PRIVATE PATH'},'NATIVE_TIMEOUT'],
    [{status:null,error:{code:'ENOENT'}},'NATIVE_UNAVAILABLE'],
    [{status:1,stderr:'BIRTH DATA',stdout:'oops'},'NATIVE_UNAVAILABLE'],
    [{status:0,stdout:''},'NATIVE_UNAVAILABLE'],
  ]) assert.equal(runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>true,()=>result),expected);
  assert.equal(runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>true,()=>{throw Error('private path');}),'NATIVE_UNAVAILABLE');
});

test('malformed and oversized replies are rejected without leaking contents', () => {
  for(const stdout of ['not-json','{"heightMeters":', 'x'.repeat(CARGO_MAX_BUFFER_BYTES+1)]) {
    const actual=runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>true,()=>({status:0,stdout}));
    assert.ok(['INVALID_SCIENTIFIC_CONTRACT','NATIVE_UNAVAILABLE'].includes(actual));
    assert.equal(actual.includes('not-json'),false);
  }
});

test('scientific envelope is correlated and height must match request exactly', () => {
  assert.equal(runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>false,()=>({status:0,stdout:'{"heightMeters":120.5}'})),
    'INVALID_SCIENTIFIC_CONTRACT');
  assert.equal(runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>true,()=>({status:0,stdout:'{"heightMeters":120.6}'})),
    'INVALID_SCIENTIFIC_CONTRACT');
  assert.equal(runDe441CargoSmoke(input(),'/test/Cargo.toml',()=>{throw Error('sensitive');},()=>({status:0,stdout:'{"heightMeters":120.5}'})),
    'INVALID_SCIENTIFIC_CONTRACT');
});
