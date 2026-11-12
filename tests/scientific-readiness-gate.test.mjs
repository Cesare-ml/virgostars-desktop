import test from 'node:test';
import assert from 'node:assert/strict';
import { quarantineUnverifiedSkyPort } from '../src/app/native/scientific-readiness-gate.ts';

const request = Object.freeze({
  protocolVersion: 1, sessionId: 'fictional_session', requestSeq: 3,
  calculationKey: 'fictional.3', intent: 'now', utcIso: '2026-11-12T12:00:00.000Z',
  latMicro: 44_123_456, lngMicro: 11_345_678, timeZone: 'Europe/Rome',
});
const signal = () => new AbortController().signal;

const wrap = response => quarantineUnverifiedSkyPort(async () => response);

test('well-formed preview-shaped ready data cannot appear as ready', async () => {
  const raw = {
    status: 'ready', snapshot: {scientificStatus:'experimental_unverified', secret:'should-not-leak'},
    providerVersion: 'experimental', filePath: 'D:/private/kernel',
  };
  const result = await wrap(raw)(request, signal());
  assert.deepEqual(result, {
    protocolVersion: 1, sessionId: request.sessionId, requestSeq: 3,
    calculationKey: request.calculationKey, status: 'unsupported',
    reasonCode: 'EXPERIMENTAL_SKY_NOT_VALIDATED',
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private|kernel|snapshot|providerVersion/);
});

test('unknown, misleading or purportedly validated ready data is rejected', async () => {
  for (const snapshot of [undefined, null, {}, [], {scientificStatus:'validated'}, {scientificStatus:'fake'}]) {
    const result = await wrap({status:'ready', snapshot})(request, signal());
    assert.equal(result.status, 'invalid_snapshot');
    assert.equal(result.reasonCode, 'UNRECOGNIZED_SKY_SNAPSHOT');
    assert.equal('snapshot' in result, false);
  }
});

test('existing native unavailable and unsupported responses retain original semantics', async () => {
  for (const status of ['unavailable', 'unsupported']) {
    const original = Object.freeze({status, reasonCode:'EPHEMERIS_NOT_INTEGRATED'});
    assert.equal(await wrap(original)(request, signal()), original);
  }
});

test('a rejected native invocation is not silently interpreted as scientific unavailability', async () => {
  const port = quarantineUnverifiedSkyPort(async () => {throw new Error('synthetic transport failure');});
  await assert.rejects(port(request, signal()), /synthetic transport failure/);
});

test('late native preview cannot be exposed after cancellation', async () => {
  const controller = new AbortController();
  const port = quarantineUnverifiedSkyPort(async () => {
    controller.abort();
    return {status:'ready', snapshot:{scientificStatus:'experimental_unverified'}};
  });
  await assert.rejects(port(request, controller.signal), /CALC_ABORTED/);
});

test('non-objects and malformed status values do not gain artificial readiness', async () => {
  for (const reply of [null, [], false, 'ready', {}, {status:'READY'}]) {
    assert.equal(await wrap(reply)(request, signal()), reply);
  }
});
