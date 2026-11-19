import test from 'node:test';
import assert from 'node:assert/strict';
import {ConnectedAccountState} from '../src/app/native/connected-account-state.ts';

const ID = '123e4567-e89b-42d3-a456-426614174000';
const pending = {kind:'pending', attemptId:ID, expiresInSeconds:600};
const connected = {kind:'connected', attemptId:ID, scope:'chart_sync:read'};
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise, resolve}; }

test('disabled login stays disconnected and duplicate starts are suppressed', async () => {
  const waiting = deferred(); const calls = [];
  const model = new ConnectedAccountState(op => { calls.push(op); return waiting.promise; }, () => {});
  const first = model.start();
  await model.start();
  assert.equal(calls.length, 1);
  waiting.resolve({kind:'disabled'});
  await first;
  assert.equal(model.status, 'unavailable');
  model.dispose();
});

test('only confirmed status becomes connected and expiry remains visible', async () => {
  let status = connected;
  const model = new ConnectedAccountState(async op => op.operation === 'start' ? pending : status, () => {});
  await model.start();
  assert.equal(model.status, 'pending');
  assert.equal(model.connectedAttemptId, null);
  await model.poll(model.generation);
  assert.equal(model.status, 'connected');
  assert.equal(model.connectedAttemptId, ID);
  status = {kind:'expired', attemptId:ID};
  await model.poll(model.generation);
  assert.equal(model.status, 'expired');
  assert.equal(model.connectedAttemptId, null);
  model.dispose();
});

test('cancel during browser launch cleans up the late native attempt', async () => {
  const waiting = deferred(); const calls = [];
  const model = new ConnectedAccountState(async op => {
    calls.push(op.operation);
    if (op.operation === 'start') return waiting.promise;
    return {kind: op.operation === 'cancel' ? 'cancelled' : 'disconnected', attemptId:ID};
  }, () => {});
  const started = model.start();
  await model.cancel();
  assert.equal(model.status, 'canceling');
  waiting.resolve(pending);
  await started;
  assert.equal(model.status, 'idle');
  assert.deepEqual(calls, ['start','cancel','disconnect']);
  model.dispose();
});

test('a delayed status cannot reconnect after disconnection', async () => {
  const waiting = deferred();
  const model = new ConnectedAccountState(async op => {
    if (op.operation === 'start') return pending;
    if (op.operation === 'status') return waiting.promise;
    return {kind:op.operation === 'cancel' ? 'cancelled' : 'disconnected', attemptId:ID};
  }, () => {});
  await model.start();
  const poll = model.poll(model.generation);
  await model.cancel();
  waiting.resolve(connected);
  await poll;
  assert.equal(model.status, 'idle');
  model.dispose();
});

test('destroy during launch cleans up a late attempt without updating UI', async () => {
  const waiting = deferred(); const calls = []; let changes = 0;
  const model = new ConnectedAccountState(async op => {
    calls.push(op.operation);
    if (op.operation === 'start') return waiting.promise;
    return {kind: op.operation === 'cancel' ? 'cancelled' : 'disconnected', attemptId:ID};
  }, () => changes++);
  const started = model.start();
  model.dispose();
  const observed = changes;
  waiting.resolve(pending);
  await started;
  assert.equal(changes, observed);
  assert.deepEqual(calls, ['start','cancel','disconnect']);
});

test('a stored session restores without opening the browser and closing does not sign out', async () => {
  const calls = [];
  const model = new ConnectedAccountState(async op => {
    calls.push(op.operation);
    return op.operation === 'restore' ? pending : connected;
  }, () => {});
  await model.restore();
  await model.poll(model.generation);
  assert.equal(model.status, 'connected');
  model.dispose();
  assert.deepEqual(calls, ['restore','status']);
});

test('explicit sign-out requests server revocation while canceling restore does not', async () => {
  const calls = [];
  const model = new ConnectedAccountState(async op => {
    calls.push(op.operation);
    if (op.operation === 'restore') return pending;
    if (op.operation === 'status') return connected;
    return {kind:op.operation === 'cancel' ? 'cancelled':'disconnected',attemptId:ID};
  }, () => {});
  await model.restore(); await model.poll(model.generation); await model.cancel();
  assert.deepEqual(calls,['restore','status','signout']);
  assert.equal(model.status,'idle');
  model.dispose();
});

test('offline restoration can retry without revoking the saved credential', async () => {
  const calls = []; let status = {kind:'offline',attemptId:ID};
  const model = new ConnectedAccountState(async op => {
    calls.push(op.operation);
    if (op.operation === 'restore') return pending;
    if (op.operation === 'status') return status;
    return {kind:'disconnected',attemptId:ID};
  }, () => {});
  await model.restore(); await model.poll(model.generation);
  assert.equal(model.status,'offline');
  status = connected;
  await model.retryRestore(); await model.poll(model.generation);
  assert.equal(model.status,'connected');
  assert.deepEqual(calls,['restore','status','disconnect','restore','status']);
  model.dispose();
});

test('a saved session allows offline startup while restoration runs and retries', async () => {
  let phase = {kind:'offline',attemptId:ID};
  const model = new ConnectedAccountState(async op => {
    if (op.operation === 'restore') return pending;
    if (op.operation === 'status') return phase;
    return {kind:'disconnected',attemptId:ID};
  }, () => {});
  await model.restore();
  assert.equal(model.hasRestorableSession, true);
  assert.equal(model.connectedAttemptId, null);
  await model.poll(model.generation);
  assert.equal(model.status, 'offline');
  assert.equal(model.hasRestorableSession, true);
  phase = {...connected, persistent:true};
  await model.retryRestore();
  assert.equal(model.hasRestorableSession, true);
  await model.poll(model.generation);
  assert.equal(model.status, 'connected');
  await model.cancel();
  assert.equal(model.hasRestorableSession, false);
  model.dispose();
});

test('a new browser login is not mistaken for a saved offline account', async () => {
  const model = new ConnectedAccountState(async op => op.operation === 'start' ? pending : {kind:'disconnected',attemptId:ID}, () => {});
  await model.start();
  assert.equal(model.status, 'pending');
  assert.equal(model.hasRestorableSession, false);
  model.dispose();
});
