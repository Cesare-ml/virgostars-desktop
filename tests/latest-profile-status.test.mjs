import test from 'node:test';
import assert from 'node:assert/strict';
import {LatestProfileStatus} from '../src/app/native/latest-profile-status.ts';

const DENIED=Object.freeze({status:'invalid_evidence',canReadLocal:false});
const READY=Object.freeze({status:'ready_offline',canReadLocal:true});
const assess=value=>value==='synthetic-approved'?READY:DENIED;
const create=()=>new LatestProfileStatus(assess,DENIED);

test('a pending read never keeps an earlier unlocked decision visible',()=>{
  const guard=create();
  assert.equal(guard.decision,DENIED);
  const first=guard.begin();
  assert.equal(guard.complete(first,'synthetic-approved'),true);
  assert.equal(guard.decision,READY);
  guard.begin();
  assert.equal(guard.decision,DENIED);
});

test('older response cannot override a newer profile status',()=>{
  const guard=create(),old=guard.begin(),latest=guard.begin();
  assert.equal(guard.complete(old,'synthetic-approved'),false);
  assert.equal(guard.decision,DENIED);
  assert.equal(guard.complete(latest,'synthetic-approved'),true);
  assert.equal(guard.decision,READY);
});

test('lock/logout immediately prevents a late successful read from reviving UI',()=>{
  const guard=create(),ticket=guard.begin();
  guard.invalidate();
  assert.equal(guard.complete(ticket,'synthetic-approved'),false);
  assert.equal(guard.decision,DENIED);
});

test('opaque tickets cannot be reused or copied across view instances',()=>{
  const a=create(),b=create(),tokenA=a.begin(),tokenB=b.begin();
  assert.notEqual(tokenA,tokenB);
  assert.equal(b.complete(tokenA,'synthetic-approved'),false);
  assert.equal(a.complete(tokenA,'synthetic-approved'),true);
  assert.equal(a.complete(tokenA,'synthetic-approved'),false);
  assert.equal(b.complete(tokenB,'synthetic-approved'),true);
});

test('invalid or throwing evidence fails closed with no raw payload exposure',()=>{
  const guard=create(),token=guard.begin();
  assert.equal(guard.complete(token,{secret:'fictional-data'}),true);
  assert.equal(guard.decision,DENIED);
  const throwing=new LatestProfileStatus(()=>{throw Error('private file path')},DENIED);
  assert.equal(throwing.complete(throwing.begin(),null),true);
  assert.equal(throwing.decision,DENIED);
});

test('reentrant begin during assessment cannot publish stale ready status',()=>{
  let guard;
  const started=[];
  guard=new LatestProfileStatus(()=>{
    started.push(guard.begin());
    return READY;
  },DENIED);
  const first=guard.begin();
  assert.equal(guard.complete(first,'anything'),false);
  assert.equal(guard.decision,DENIED);
  assert.equal(typeof started[0],'symbol');
});

test('reentrant invalidate during assessment cannot publish stale ready status',()=>{
  let guard;
  guard=new LatestProfileStatus(()=>{guard.invalidate();return READY},DENIED);
  assert.equal(guard.complete(guard.begin(),null),false);
  assert.equal(guard.decision,DENIED);
});

test('dispose permanently suppresses subsequent results and new requests',()=>{
  const guard=create(),ticket=guard.begin();
  guard.dispose();guard.dispose();
  assert.equal(guard.begin(),null);
  assert.equal(guard.complete(ticket,'synthetic-approved'),false);
  assert.equal(guard.decision,DENIED);
});

test('ten thousand rapid status refreshes retain only one accepted ticket',()=>{
  const guard=create();
  const tokens=[];
  for(let i=0;i<10000;i++)tokens.push(guard.begin());
  assert.equal(guard.complete(tokens[0],'synthetic-approved'),false);
  assert.equal(guard.complete(tokens[100],'synthetic-approved'),false);
  assert.equal(guard.complete(tokens[9999],'synthetic-approved'),true);
  assert.equal(guard.decision,READY);
});

test('out-of-order promises can be forwarded without reviving an old profile',async()=>{
  const guard=create();let resolveOld,resolveNew;
  const old=new Promise(resolve=>{resolveOld=resolve});
  const newer=new Promise(resolve=>{resolveNew=resolve});
  const first=guard.begin();
  const firstResult=old.then(value=>guard.complete(first,value));
  const second=guard.begin();
  const secondResult=newer.then(value=>guard.complete(second,value));
  resolveNew('synthetic-approved');
  assert.equal(await secondResult,true);
  resolveOld('synthetic-approved');
  assert.equal(await firstResult,false);
  assert.equal(guard.decision,READY);
});
