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
  await model.poll(model.generation);
  assert.equal(model.status, 'connected');
  status = {kind:'expired', attemptId:ID};
  await model.poll(model.generation);
  assert.equal(model.status, 'expired');
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
