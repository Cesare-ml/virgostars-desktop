import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createCopilotStagingFixture } from '../scripts/copilot-staging-fixture.mjs';
import { readCopilotPreviewReply, requestCopilotPreview, COPILOT_PREVIEW_MESSAGE_PATH }
  from '../src/app/copilot-preview-client.ts';

const bearer = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.LOCAL_UNSIGNED_FIXTURE';
const basePath = '/api/v1/ai/copilot-preview';
const labSession = randomBytes(16).toString('hex');
const valid = { action: 'describe_focus', focus: { layer: 'NATAL', bodyId: 'VENUS' } };
const withAuth = (options = {}) => ({ ...options, headers: {
  Authorization: 'Bearer ' + bearer, ...(options.headers || {}),
} });
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function lab(t, options = {}) {
  const server = createCopilotStagingFixture({ bearer, labSession, ...options });
  const origin = await server.listen();
  t.after(() => server.close());
  assert.equal(server.address().address, '127.0.0.1');
  return origin;
}

test('synthetic capabilities require the local test token and never enable a provider', async t => {
  const origin = await lab(t);
  const unauthorized = await fetch(origin + basePath + '/capabilities');
  assert.equal(unauthorized.status, 401);
  const response = await fetch(origin + basePath + '/capabilities', withAuth());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const capabilities = await response.json();
  assert.equal(capabilities.contract, 'VirgoStarsCopilotPreviewCapabilities');
  assert.equal(capabilities.stage, 'STAGING_SYNTHETIC');
  assert.equal(capabilities.labSession, labSession);
  assert.equal(capabilities.providerEnabled, false);
  assert.equal(capabilities.modelSelectorAvailable, false);
  assert.deepEqual(capabilities.focusOptions, ['NATAL:VENUS', 'NATAL:SUN', 'TRANSIT:SATURN']);
});


test('different synthetic fixture instances have different session challenges', async t => {
  const firstId = randomBytes(16).toString('hex');
  const secondId = randomBytes(16).toString('hex');
  assert.notEqual(firstId, secondId);
  const first = await lab(t, { labSession: firstId });
  const second = await lab(t, { labSession: secondId });
  const a = await fetch(first + basePath + '/capabilities', withAuth());
  const b = await fetch(second + basePath + '/capabilities', withAuth());
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  const firstCapabilities = await a.json();
  const secondCapabilities = await b.json();
  assert.equal(firstCapabilities.labSession, firstId);
  assert.equal(secondCapabilities.labSession, secondId);
  assert.notEqual(firstCapabilities.labSession, secondCapabilities.labSession);
  assert.equal(firstCapabilities.stage, 'STAGING_SYNTHETIC');
  assert.equal(secondCapabilities.stage, 'STAGING_SYNTHETIC');
  const focus = { layer: 'NATAL', bodyId: 'SUN' };
  const firstPost = await fetch(first + basePath + '/message',
    withAuth(json({ action: 'describe_focus', focus })));
  const secondPost = await fetch(second + basePath + '/message',
    withAuth(json({ action: 'describe_focus', focus })));
  assert.equal(firstPost.status, 200);
  assert.equal(secondPost.status, 200);
  const firstReply = await firstPost.json();
  const secondReply = await secondPost.json();
  assert.equal(firstReply.labSession, firstId);
  assert.equal(secondReply.labSession, secondId);
  assert.notEqual(firstReply.labSession, secondReply.labSession);
});

test('all three synthetic focus requests return the expected bounded native envelope', async t => {
  const origin = await lab(t);
  for (const focus of [{ layer: 'NATAL', bodyId: 'VENUS' }, { layer: 'NATAL', bodyId: 'SUN' },
    { layer: 'TRANSIT', bodyId: 'SATURN' }]) {
    const res = await fetch(origin + basePath + '/message', withAuth(json({ action: 'describe_focus', focus })));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(Buffer.byteLength(text) < 8192);
    const reply = JSON.parse(text);
    assert.equal(reply.contract, 'VirgoStarsCopilotMockPreviewEnvelope');
    assert.equal(reply.stage, 'STAGING_SYNTHETIC');
    assert.equal(reply.labSession, labSession);
    assert.equal(reply.contentOrigin, 'DETERMINISTIC_FACT');
    assert.equal(reply.providerCostUsd, 0);
    assert.equal(reply.disclosures.personalChartIncluded, false);
    assert.equal(reply.providerInvoked, false);
    assert.equal(reply.data.source, 'MOCK_DETERMINISTIC');
    assert.deepEqual(reply.data.focus, focus);
    assert.deepEqual(Object.keys(reply.data.chartCommands[0]), ['type', 'aspectIds']);
    assert.ok(reply.data.chartCommands[0].aspectIds.every(id => id.startsWith('synthetic:')));
  }
});

test('live loopback JSON is accepted by the actual Desktop TypeScript preview decoder', async t => {
  const origin = await lab(t);
  const calls = [];
  const transport = {
    async isAvailable() { return true; },
    async postJson(path, body, signal) {
      assert.equal(path, COPILOT_PREVIEW_MESSAGE_PATH);
      calls.push({ path, body });
      const response = await fetch(origin + path, withAuth({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      }));
      assert.equal(response.status, 200);
      return response.json();
    },
  };
  for (const focus of [{ layer: 'NATAL', bodyId: 'VENUS' },
    { layer: 'NATAL', bodyId: 'SUN' }, { layer: 'TRANSIT', bodyId: 'SATURN' }]) {
    const answer = await requestCopilotPreview(transport, focus, new AbortController().signal);
    assert.equal(answer.synthetic, true);
    assert.equal(answer.chartRevision, 1);
    assert.deepEqual(answer.focus, focus);
    assert.ok(answer.illustrativeAspectCount >= 1);
    assert.match(answer.answer, /Synthetic fixture only/);
    assert.equal(Object.hasOwn(answer, 'labSession'), false);
  }
  assert.equal(calls.length, 3);
  assert.ok(calls.every(item => !('model' in item.body) && !('apiKey' in item.body)));
});

test('TypeScript decoder refuses contradictory disclosure, cost and blank-answer flags from live HTTP', async t => {
  const origin = await lab(t);
  const res = await fetch(origin + basePath + '/message', withAuth(json(valid)));
  assert.equal(res.status, 200);
  const raw = await res.json();
  const accepted = readCopilotPreviewReply(raw, valid.focus);
  assert.equal(accepted.synthetic, true);
  // Rust intentionally strips these validated server-only fields before IPC.
  const { disclosures, providerCostUsd, contentOrigin, ...nativeProjection } = raw;
  assert.equal(readCopilotPreviewReply(nativeProjection, valid.focus).synthetic, true);
  for (const attack of [
    { contentOrigin: 'AI_GENERATED' },
    { contentOrigin: null },
    { providerCostUsd: 0.01 },
    { providerCostUsd: -1 },
    { disclosures: { ...disclosures, birthDataIncluded: true } },
    { disclosures: { ...disclosures, personalChartIncluded: true } },
    { disclosures: { ...disclosures, aiGeneratedTextPresent: true } },
    { disclosures: { birthDataIncluded: false } },
    { disclosures: null },
    { data: { ...raw.data, answer: ' \t ' } },
  ]) {
    assert.throws(() => readCopilotPreviewReply({ ...raw, ...attack }, valid.focus),
      /invalid_response/);
  }
});

test('untrusted prompt fields, invalid focus and unsupported endpoints are rejected', async t => {
  const origin = await lab(t);
  for (const body of [{ ...valid, prompt: 'LEAK_SENTINEL' },
    { action: 'describe_focus', focus: { layer: 'NATAL', bodyId: 'MOON' } },
    { action: 'setTransitInstant', focus: valid.focus }]) {
    const res = await fetch(origin + basePath + '/message', withAuth(json(body)));
    assert.equal(res.status, 400);
    assert.doesNotMatch(await res.text(), /LEAK_SENTINEL/);
  }
  assert.equal((await fetch(origin + basePath + '/other', withAuth())).status, 404);
});

test('body parser limits 2 KiB including chunked requests and rejects invalid JSON/content-type', async t => {
  const origin = await lab(t);
  const excessive = { ...valid, custom: 'X'.repeat(2500) };
  const large = await fetch(origin + basePath + '/message', withAuth(json(excessive)));
  assert.equal(large.status, 413);
  const malformed = await fetch(origin + basePath + '/message', withAuth({ method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{' }));
  assert.equal(malformed.status, 400);
  const other = await fetch(origin + basePath + '/message', withAuth({ method: 'POST',
    headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(valid) }));
  assert.equal(other.status, 415);
  const chunked = await new Promise((resolve, reject) => {
    const url = new URL(origin + basePath + '/message');
    const req = request(url, { method: 'POST', headers: {
      Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json',
      'Transfer-Encoding': 'chunked',
    } }, response => {
      let text = '';
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: text }));
    });
    req.on('error', reject);
    const body = JSON.stringify(excessive);
    req.write(body.slice(0, 1800));
    req.end(body.slice(1800));
  });
  assert.equal(chunked.status, 413);
  assert.deepEqual(JSON.parse(chunked.body), { error: 'preview_request_too_large' });
});

test('partial trickle-upload is closed within the fixed body deadline and fixture remains healthy', async t => {
  const origin = await lab(t);
  const startedAt = Date.now();
  await new Promise((resolve, reject) => {
    const client = request(new URL(origin + basePath + '/message'), {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + bearer,
        'Content-Type': 'application/json',
        'Transfer-Encoding': 'chunked',
      },
    }, response => { response.resume(); response.once('end', finish); });
    let settled = false;
    const trickle = setInterval(() => {
      if (!client.destroyed) client.write(' ');
    }, 200);
    const watchdog = setTimeout(() => {
      client.destroy();
      finish(new Error('synthetic HTTP partial body exceeded wall-clock deadline'));
    }, 6000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      clearInterval(trickle);
      if (error) reject(error);
      else resolve();
    }
    client.on('error', () => { /* ECONNRESET is expected after the fixed deadline. */ });
    client.on('close', () => finish());
    client.flushHeaders();
    client.write('{"action":');
    // No .end(): a slow client must not retain the handler indefinitely.
  });
  assert.ok(Date.now() - startedAt < 6000);
  const capabilities = await fetch(origin + basePath + '/capabilities', withAuth());
  assert.equal(capabilities.status, 200);
  const validPost = await fetch(origin + basePath + '/message', withAuth(json(valid)));
  assert.equal(validPost.status, 200);
});

test('quota returns 429 without consulting a provider', async t => {
  const origin = await lab(t, { maxRequests: 2 });
  for (const status of [200, 200, 429]) {
    const res = await fetch(origin + basePath + '/message', withAuth(json(valid)));
    assert.equal(res.status, status);
  }
});

test('invalid or missing lab tokens fail before opening a listener', () => {
  assert.throws(() => createCopilotStagingFixture(), /synthetic-only lab token/);
  assert.throws(() => createCopilotStagingFixture({ bearer: 'not-a-jwt' }), /synthetic-only lab token/);
  assert.throws(() => createCopilotStagingFixture({ bearer }), /synthetic lab session ID/);
  assert.throws(() => createCopilotStagingFixture({ bearer, labSession: 'abc' }), /synthetic lab session ID/);
});

test('standalone fixture CLI fails closed without explicit synthetic opt-in', () => {
  const fixturePath = fileURLToPath(new URL('../scripts/copilot-staging-fixture.mjs', import.meta.url));
  const child = spawnSync(process.execPath, [fixturePath], {
    encoding: 'utf8',
    timeout: 3000,
    env: {
      ...process.env,
      VIRGOSTARS_COPILOT_FIXTURE_ACK: 'DISABLED',
      VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER: bearer,
      VIRGOSTARS_COPILOT_FIXTURE_SESSION: labSession,
    },
  });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /Synthetic-only lab disabled/);
  assert.doesNotMatch(child.stdout + child.stderr, /LOCAL_UNSIGNED_FIXTURE/);
});
