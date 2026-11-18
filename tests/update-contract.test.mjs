import test from 'node:test';
import assert from 'node:assert/strict';
import {updateRequest} from '../src/app/native/update-contract.ts';

test('check reports a newer version and notes without starting installation', async()=>{
  const calls=[]; const port={invoke:async(command,args)=>{calls.push([command,args]);return {status:'available',currentVersion:'0.0.2',version:'0.0.3',notes:'Changes'};}};
  assert.deepEqual(await updateRequest(port,'check','stable'),{status:'available',currentVersion:'0.0.2',version:'0.0.3',notes:'Changes'});
  assert.deepEqual(calls,[['check_updates',{channel:'stable'}]]);
});
test('installer requires an explicit, valid version and sends only the selected channel', async()=>{
  const calls=[]; const port={invoke:async(command,args)=>{calls.push([command,args]);return {status:'install_started',currentVersion:'0.0.2',version:null,notes:null};}};
  await updateRequest(port,'install','stable'); assert.equal(calls.length,0);
  await updateRequest(port,'install','stable','../../bad'); assert.equal(calls.length,0);
  await updateRequest(port,'install','beta','0.0.3-beta.1','progress');
  assert.deepEqual(calls,[['install_update',{channel:'beta',version:'0.0.3-beta.1',progress:'progress'}]]);
});
test('offline, malformed responses and invalid channels fail closed', async()=>{
  let calls=0; const port={invoke:async()=>{calls++;throw Error('private network detail')}};
  assert.equal((await updateRequest(port,'check','stable')).status,'check_failed');
  assert.equal((await updateRequest(port,'check','invalid')).status,'check_failed'); assert.equal(calls,1);
  const bad={invoke:async()=>({status:'available',currentVersion:'0.0.2',version:42,notes:null})};
  assert.equal((await updateRequest(bad,'check','stable')).status,'check_failed');
});
