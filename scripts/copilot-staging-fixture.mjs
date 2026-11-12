/**
 * Dependency-free, synthetic-only Virgo Stars AI loopback HTTP test double.
 * Does NOT authenticate real JWTs and must NEVER be used as a production backend.
 * Its value: exercising the native Tauri/reqwest IPC contract without external services.
 */
import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const HOST = '127.0.0.1';
const PREFIX = '/api/v1/ai/copilot-preview';
const MAX_BODY_BYTES = 2048;
const ALLOWED = new Set(['NATAL:VENUS', 'NATAL:SUN', 'TRANSIT:SATURN']);
const TEST_ACK = 'SYNTHETIC_LOOPBACK_TEST';

function sameToken(actual, expected) {
  if (typeof actual !== 'string' || typeof expected !== 'string') return false;
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(res, status, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': data.length,
  });
  res.end(data);
}

function isFocus(focus) {
  return focus !== null && typeof focus === 'object' && !Array.isArray(focus)
    && Object.keys(focus).length === 2
    && ALLOWED.has(focus.layer + ':' + focus.bodyId);
}

function previewEnvelope(focus) {
  const aspects = focus.layer === 'NATAL' && focus.bodyId === 'VENUS'
    ? ['synthetic:transit:saturn:venus', 'synthetic:natal:sun:venus']
    : focus.layer === 'NATAL'
      ? ['synthetic:natal:sun:venus']
      : ['synthetic:transit:saturn:venus'];
  return {
    contract: 'VirgoStarsCopilotMockPreviewEnvelope', version: '0.1.0',
    stage: 'STAGING_SYNTHETIC', syntheticFixture: true,
    astrologyIsReal: false, methodApproved: false, providerInvoked: false,
    providerCostUsd: 0, contentOrigin: 'DETERMINISTIC_FACT',
    interpretationStatus: 'FACT_ONLY',
    disclosures: { birthDataIncluded: false, personalChartIncluded: false,
      aiGeneratedTextPresent: false },
    data: {
      answer: 'Synthetic fixture only: ' + focus.layer + ':' + focus.bodyId
        + '. No astronomical or AI interpretation.',
      chartRevision: 1, source: 'MOCK_DETERMINISTIC', focus,
      chartCommands: [{ type: 'chart.highlightAspects', aspectIds: aspects }],
    },
  };
}

async function readJson(req) {
  const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') return { error: 415, reason: 'application_json_required' };
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return { error: 413, reason: 'preview_request_too_large' };
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return { error: 400, reason: 'invalid_preview_request' };
    }
    return { value };
  } catch {
    return { error: 400, reason: 'invalid_preview_request' };
  }
}

/** Construct an explicit test double. Only loopback binding is supported. */
export function createCopilotStagingFixture({ bearer, labSession, maxRequests = 8, windowMs = 60_000 } = {}) {
  if (typeof bearer !== 'string' || bearer.length < 32 || bearer.length > 4096
    || bearer.split('.').length !== 3 || bearer.split('.').some(part => part.length === 0)
    || !/^[a-zA-Z0-9._-]+$/.test(bearer)) {
    throw new TypeError('A JWT-shaped synthetic-only lab token is required');
  }
  // A per-launch challenge proves the launcher reached the instance it started,
  // rather than a stale or unexpected service on the same loopback port.
  // This is a lab identity guard, NOT a real JWT authentication mechanism.
  if (typeof labSession !== 'string' || !/^[a-f0-9]{32}$/.test(labSession)) {
    throw new TypeError('A random 128-bit synthetic lab session ID is required');
  }
  if (!Number.isSafeInteger(maxRequests) || maxRequests < 1
    || !Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError('Invalid fixture quotas');
  }
  let count = 0;
  let resetAt = Date.now() + windowMs;
  const server = createServer(async (req, res) => {
    // Do not log headers, tokens, raw requests or user-provided content.
    if (!sameToken(req.headers.authorization, 'Bearer ' + bearer)) {
      json(res, 401, { error: 'synthetic_fixture_unauthorized' });
      return;
    }
    const url = req.url;
    if (req.method === 'GET' && url === PREFIX + '/capabilities') {
      json(res, 200, {
        contract: 'VirgoStarsCopilotPreviewCapabilities', version: '0.1.0',
        stage: 'STAGING_SYNTHETIC', enabled: true, providerEnabled: false,
        modelSelectorAvailable: false, labSession, actions: ['describe_focus'],
        focusOptions: [...ALLOWED],
      });
      return;
    }
    if (req.method !== 'POST' || url !== PREFIX + '/message') {
      json(res, 404, { error: 'synthetic_fixture_not_found' });
      return;
    }
    if (Date.now() >= resetAt) { count = 0; resetAt = Date.now() + windowMs; }
    if (count >= maxRequests) {
      json(res, 429, { error: 'copilot_preview_rate_limited' });
      return;
    }
    count += 1;
    let parsed;
    try {
      parsed = await readJson(req);
    } catch {
      json(res, 400, { error: 'invalid_preview_request' });
      return;
    }
    if (parsed.error) {
      json(res, parsed.error, { error: parsed.reason });
      return;
    }
    const body = parsed.value;
    if (Object.keys(body).length !== 2 || body.action !== 'describe_focus' || !isFocus(body.focus)) {
      json(res, 400, { error: 'invalid_preview_request' });
      return;
    }
    json(res, 200, previewEnvelope({ layer: body.focus.layer, bodyId: body.focus.bodyId }));
  });
  return {
    async listen(port = 0) {
      if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new TypeError('Invalid port');
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, HOST, resolve);
      });
      return 'http://' + HOST + ':' + server.address().port;
    },
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    }),
    address: () => server.address(),
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  if (process.env.VIRGOSTARS_COPILOT_FIXTURE_ACK !== TEST_ACK) {
    console.error('Synthetic-only lab disabled: missing explicit acknowledgment.');
    process.exitCode = 2;
  } else {
    const port = process.argv.length === 3 ? Number(process.argv[2]) : 0;
    try {
      const fixture = createCopilotStagingFixture({
        bearer: process.env.VIRGOSTARS_COPILOT_PREVIEW_STAGING_TEST_BEARER,
        labSession: process.env.VIRGOSTARS_COPILOT_FIXTURE_SESSION,
      });
      const origin = await fixture.listen(port);
      console.log('Synthetic-only loopback fixture listening: ' + origin);
      process.on('SIGINT', async () => { await fixture.close(); process.exit(0); });
    } catch {
      console.error('Synthetic fixture configuration invalid; no listener started.');
      process.exitCode = 2;
    }
  }
}
