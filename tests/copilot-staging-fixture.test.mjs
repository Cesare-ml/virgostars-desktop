import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createCopilotStagingFixture } from '../scripts/copilot-staging-fixture.mjs';

const bearer = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJzeW50aGV0aWMifQ.LOCAL_UNSIGNED_FIXTURE';
const basePath = '/api/v1/ai/copilot-preview';
const valid = { action: 'describe_focus', focus: { layer: 'NATAL', bodyId: 'VENUS' } };
const withAuth = (options = {}) => ({ ...options, headers: {
  Authorization: 'Bearer ' + bearer, ...(options.headers || {}),
} });
const json = body => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

async function lab(t, options = {}) {
  const server = createCopilotStagingFixture({ bearer, ...options });
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
  assert.equal(capabilities.providerEnabled, false);
  assert.equal(capabilities.modelSelectorAvailable, false);
  assert.deepEqual(capabilities.focusOptions, ['NATAL:VENUS', 'NATAL:SUN', 'TRANSIT:SATURN']);
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
    },
  });
  assert.equal(child.status, 2);
  assert.match(child.stderr, /Synthetic-only lab disabled/);
  assert.doesNotMatch(child.stdout + child.stderr, /LOCAL_UNSIGNED_FIXTURE/);
});
