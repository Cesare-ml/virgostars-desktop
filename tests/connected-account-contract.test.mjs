import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {decodeConnectedAccountResponse, requestConnectedAccount} from '../src/app/native/connected-account-contract.ts';

const ATTEMPT = '123e4567-e89b-42d3-a456-426614174000';
const pending = {protocolVersion: 1, status: 'pending', attemptId: ATTEMPT, expiresInSeconds: 420};
const connected = {protocolVersion: 1, status: 'connected', attemptId: ATTEMPT, scope: 'chart_sync:read'};
const native = response => ({isNative: () => true, invoke: async () => response});

test('v1 connected schema and decoder agree on fields and backend scope', () => {
  const schema = JSON.parse(readFileSync(new URL('../contracts/connected-account-status.v1.schema.json', import.meta.url), 'utf8'));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(Object.keys(connected).sort(), [...schema.required].sort());
  assert.deepEqual(Object.keys(schema.properties).sort(), [...schema.required].sort());
  assert.equal(schema.properties.scope.const, connected.scope);
  assert.match(connected.attemptId, new RegExp(schema.properties.attemptId.pattern));
  assert.equal(schema.properties.protocolVersion.const, connected.protocolVersion);
  assert.equal(schema.properties.status.const, connected.status);
  assert.equal(decodeConnectedAccountResponse(connected, {operation: 'status', attemptId: ATTEMPT}).scope, schema.properties.scope.const);
});

test('default disabled, no native probe or invocation', async () => {
  let called = 0;
  const result = await requestConnectedAccount({
    isNative: () => {called++; throw new Error('must not call');},
    invoke: async () => {called++; throw new Error('must not invoke');},
  }, {operation: 'start'});
  assert.deepEqual(result, {kind: 'disabled'});
  assert.equal(called, 0);
});

test('registered native stub explicitly returns disabled even when enabled by caller', async () => {
  let calls = 0;
  const disabled = {protocolVersion: 1, status: 'disabled'};
  const transport = {isNative: () => true, invoke: async (name, args) => {
    calls++;
    assert.equal(name, 'desktop_connected_account_v1');
    assert.equal(args.request.protocolVersion, 1);
    return disabled;
  }};
  assert.deepEqual(await requestConnectedAccount(transport, {operation: 'start'}, {enabled: true}), {kind: 'disabled'});
  assert.deepEqual(await requestConnectedAccount(transport, {operation: 'status', attemptId: ATTEMPT}, {enabled: true}), {kind: 'disabled'});
  assert.deepEqual(await requestConnectedAccount(transport, {operation: 'cancel', attemptId: ATTEMPT}, {enabled: true}), {kind: 'disabled'});
  assert.equal(calls, 3);
});

test('disabled native response is exact, versioned and cannot carry private fields', () => {
  for (const operation of [{operation: 'start'}, {operation: 'status', attemptId: ATTEMPT}]) {
    assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status: 'disabled'}, operation), {kind: 'disabled'});
    for (const raw of [
      {protocolVersion: 1, status: 'disabled', attemptId: ATTEMPT},
      {protocolVersion: 1, status: 'disabled', token: 'secret'},
      {protocolVersion: 2, status: 'disabled'},
    ]) assert.throws(() => decodeConnectedAccountResponse(raw, operation));
  }
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

test('only status can report a native-confirmed read-only connection', async () => {
  const actual = await requestConnectedAccount(native(connected), {operation: 'status', attemptId: ATTEMPT}, {enabled: true});
  assert.deepEqual(actual, {kind: 'connected', attemptId: ATTEMPT, scope: 'chart_sync:read'});
  assert.ok(Object.isFrozen(actual));
  assert.throws(() => decodeConnectedAccountResponse({...connected, notesEnabled: true},
    {operation: 'status', attemptId: ATTEMPT}));
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
    {...connected, scope: 'chart_sync:read chart_sync:notes'},
    {...connected, deviceId: '123e4567-e89b-42d3-b456-426614174001'},
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

test('cancellation, disconnect and denial have operation-specific status', () => {
  assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status: 'cancelled', attemptId: ATTEMPT},
    {operation: 'cancel', attemptId: ATTEMPT}), {kind: 'cancelled', attemptId: ATTEMPT});
  for (const status of ['denied', 'expired']) {
    assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status, attemptId: ATTEMPT},
      {operation: 'status', attemptId: ATTEMPT}), {kind: status, attemptId: ATTEMPT});
  }
  assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status: 'cancelled', attemptId: ATTEMPT},
    {operation: 'status', attemptId: ATTEMPT}), {kind:'cancelled', attemptId:ATTEMPT});
  assert.deepEqual(decodeConnectedAccountResponse({protocolVersion: 1, status: 'disconnected', attemptId: ATTEMPT},
    {operation: 'disconnect', attemptId: ATTEMPT}), {kind:'disconnected', attemptId:ATTEMPT});
  assert.throws(() => decodeConnectedAccountResponse({protocolVersion: 1, status: 'connected', attemptId: ATTEMPT, scope:'chart_sync:read'},
    {operation: 'disconnect', attemptId: ATTEMPT}));
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
