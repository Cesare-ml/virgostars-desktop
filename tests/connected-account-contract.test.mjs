import assert from 'node:assert/strict';
import test from 'node:test';
import {decodeConnectedAccountResponse, requestConnectedAccount} from '../src/app/native/connected-account-contract.ts';

const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';
const DEVICE = '123e4567-e89b-42d3-b456-426614174001';
const pending = {protocolVersion: 1, status: 'pending', attemptId: ATTEMPT, expiresInSeconds: 420};
const connected = {protocolVersion: 1, status: 'connected', attemptId: ATTEMPT, deviceId: DEVICE, scope: 'charts:read', notesEnabled: false};
const native = response => ({isNative: () => true, invoke: async () => response});

test('default disabled, no native probe or invocation', async () => {
  let called = 0;
  const result = await requestConnectedAccount({
    isNative: () => {called++; throw new Error('must not call');},
    invoke: async () => {called++; throw new Error('must not invoke');},
  }, {operation: 'start'});
  assert.deepEqual(result, {kind: 'disabled'});
  assert.equal(called, 0);
});

test('browser preview never starts authorization', async () => {
  let called = 0;
  const result = await requestConnectedAccount({
    isNative: () => false,
    invoke: async () => {called++; return pending;},
  }, {operation: 'start'}, {enabled: true});
  assert.deepEqual(result, {kind: 'not_native'});
  assert.equal(called, 0);
});

test('start sends only a typed request, not credentials or redirect URL', async () => {
  let sent;
  const transport = {isNative: () => true, invoke: async (name, args) => {
    sent = {name, args};
    return pending;
  }};
  assert.deepEqual(await requestConnectedAccount(transport, {operation: 'start'}, {enabled: true}),
    {kind: 'pending', attemptId: ATTEMPT, expiresInSeconds: 420});
  assert.deepEqual(sent, {name: 'desktop_connected_account_v1', args: {request: {protocolVersion: 1, operation: 'start'}}});
});

test('only status can report native-confirmed connection and optional notes approval', async () => {
  const actual = await requestConnectedAccount(native(connected), {operation: 'status', attemptId: ATTEMPT}, {enabled: true});
  assert.deepEqual(actual, {kind: 'connected', attemptId: ATTEMPT, deviceId: DEVICE, scope: 'charts:read', notesEnabled: false});
  assert.ok(Object.isFrozen(actual));
  assert.deepEqual(await requestConnectedAccount(native({...connected, notesEnabled: true}),
    {operation: 'status', attemptId: ATTEMPT}, {enabled: true}), {...actual, notesEnabled: true});
  assert.throws(() => decodeConnectedAccountResponse(connected, {operation: 'start'}));
});

test('pending status cannot exceed ten minute native authorization lifetime', () => {
  for (const seconds of [0, -5, 601, 0.5, '400', Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => decodeConnectedAccountResponse({...pending, expiresInSeconds: seconds}, {operation: 'start'}));
  }
});

test('status cannot be replayed across different attempts', () => {
  const other = '123e4567-e89b-42d3-a456-426614174099';
  assert.throws(() => decodeConnectedAccountResponse(connected, {operation: 'status', attemptId: other}));
  assert.throws(() => decodeConnectedAccountResponse(pending, {operation: 'status', attemptId: other}));
});

test('a connection never accepts write scope or malformed identity', () => {
  for (const invalid of [
    {...connected, scope: 'charts:write'},
    {...connected, scope: 'admin'},
    {...connected, deviceId: 'foo'},
    {...connected, notesEnabled: 1},
    {...connected, attemptId: 'bad'},
  ]) assert.throws(() => decodeConnectedAccountResponse(invalid, {operation: 'status', attemptId: ATTEMPT}));
});

test('native responses containing credentials, codes, URLs or unexpected keys fail closed', () => {
  for (const extra of [
    {accessToken:'Bearer secret'}, {refreshToken:'secret'}, {code:'one-time-code'},
    {codeVerifier:'secret'}, {state:'random'}, {redirectUri:'http://127.0.0.1:4444/callback'},
    {extra:'unknown'},
  ]) assert.throws(() => decodeConnectedAccountResponse({...connected, ...extra}, {operation: 'status', attemptId: ATTEMPT}));
});

test('rejects getters, inherited properties and non-plain reply objects', () => {
  const withGetter = Object.defineProperty({...pending}, 'status', {get() { throw new Error('leak'); }, enumerable:true});
  for (const raw of [withGetter, Object.create(pending), [], null, new Date(), {__proto__: pending}]) {
    assert.throws(() => decodeConnectedAccountResponse(raw, {operation: 'start'}));
  }
});

test('rejects unknown protocol and status values', () => {
  for (const raw of [{...pending, protocolVersion: 2}, {...pending, status: 'success'}, {...pending, status: 'connected'}]) {
    assert.throws(() => decodeConnectedAccountResponse(raw, {operation: 'start'}));
  }
});

test('cancellation and denial have operation-specific status', () => {
  assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status: 'cancelled', attemptId: ATTEMPT},
    {operation: 'cancel', attemptId: ATTEMPT}), {kind: 'cancelled', attemptId: ATTEMPT});
  for (const status of ['denied', 'expired']) {
    assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status, attemptId: ATTEMPT},
      {operation: 'status', attemptId: ATTEMPT}), {kind: status, attemptId: ATTEMPT});
  }
  assert.throws(() => decodeConnectedAccountResponse({protocolVersion: 1, status: 'cancelled', attemptId: ATTEMPT},
    {operation: 'status', attemptId: ATTEMPT}));
});

test('invalid attempt ID is rejected before IPC', async () => {
  let calls = 0;
  const result = await requestConnectedAccount({isNative: () => true, invoke: async () => {calls++; return connected;}},
    {operation: 'status', attemptId: 'unsafe'}, {enabled: true});
  assert.deepEqual(result, {kind: 'native_unavailable'});
  assert.equal(calls, 0);
});

test('native errors are redacted; no synthetic account is reported connected', async () => {
  const result = await requestConnectedAccount({isNative:()=>true, invoke:async()=>{throw new Error('secret C:\\users\\hidden\\path');}},
    {operation:'start'}, {enabled:true});
  assert.deepEqual(result, {kind:'native_unavailable'});
  assert.deepEqual(await requestConnectedAccount(native({...connected, accessToken: 'secret'}),
    {operation:'status', attemptId:ATTEMPT}, {enabled:true}), {kind:'native_unavailable'});
});
