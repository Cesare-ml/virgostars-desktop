import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  COPILOT_PREVIEW_MESSAGE_PATH,
  isCopilotPreviewFocus,
  readCopilotPreviewReply,
  requestCopilotPreview,
} from '../src/app/copilot-preview-client.ts';

const focus = { layer: 'NATAL', bodyId: 'VENUS' };
function response(overrides = {}) {
  return {
    contract: 'VirgoStarsCopilotMockPreviewEnvelope',
    version: '0.1.0',
    stage: 'STAGING_SYNTHETIC',
    syntheticFixture: true,
    astrologyIsReal: false,
    methodApproved: false,
    providerInvoked: false,
    interpretationStatus: 'FACT_ONLY',
    data: {
      answer: 'VENUS (NATAL). Aspetti presenti: 1. Demo FACT_ONLY.',
      source: 'MOCK_DETERMINISTIC',
      chartRevision: 1,
      focus,
      chartCommands: [
        { type: 'chart.highlightAspects', aspectIds: ['synthetic:transit:saturn:venus'] },
      ],
    },
    ...overrides,
  };
}

test('only known staging synthetic focus choices are allowed', () => {
  assert.equal(isCopilotPreviewFocus(focus), true);
  assert.equal(isCopilotPreviewFocus({ layer: 'NATAL', bodyId: 'SUN' }), true);
  assert.equal(isCopilotPreviewFocus({ layer: 'TRANSIT', bodyId: 'SATURN' }), true);
  for (const bad of [
    {}, { layer: 'TRANSIT', bodyId: 'VENUS' }, { layer: 'NATAL', bodyId: 'SATURN' },
    { layer: 'NATAL', bodyId: 'VENUS', apiKey: 'secret' },
  ]) assert.equal(isCopilotPreviewFocus(bad), false);
});

test('only the Virgo Stars preview API path is sent and client cannot choose provider', async () => {
  const controller = new AbortController();
  const calls = [];
  const transport = {
    async postJson(path, body, signal) {
      calls.push({ path, body, signal });
      return response();
    },
  };
  const result = await requestCopilotPreview(transport, focus, controller.signal);
  assert.equal(result.synthetic, true);
  assert.equal(result.illustrativeAspectCount, 1);
  assert.equal(calls[0].path, COPILOT_PREVIEW_MESSAGE_PATH);
  assert.deepEqual(calls[0].body, { action: 'describe_focus', focus });
  // Keep natal/transit discriminant correlation; a separately rebuilt object
  // from focus.layer and focus.bodyId widens the type and fails strict tsc.
  assert.notStrictEqual(calls[0].body.focus, focus);
  assert.ok(Object.isFrozen(calls[0].body.focus));
  assert.deepEqual(Object.keys(calls[0].body.focus).sort(), ['bodyId', 'layer']);
  assert.equal(calls[0].signal, controller.signal);
  assert.equal('provider' in calls[0].body, false);
  assert.equal('model' in calls[0].body, false);
  assert.equal('apiKey' in calls[0].body, false);
});

test('an in-flight preview keeps its original validated focus even if caller mutates the object', async () => {
  const callerFocus = { layer: 'NATAL', bodyId: 'VENUS' };
  const ctrl = new AbortController();
  let release;
  let submitted;
  const transport = {
    async postJson(path, body) {
      assert.equal(path, COPILOT_PREVIEW_MESSAGE_PATH);
      submitted = body.focus;
      await new Promise(resolve => { release = resolve; });
      return response();
    },
  };
  const pending = requestCopilotPreview(transport, callerFocus, ctrl.signal);
  assert.deepEqual(submitted, { layer: 'NATAL', bodyId: 'VENUS' });
  assert.notStrictEqual(submitted, callerFocus);
  assert.ok(Object.isFrozen(submitted));
  // This could otherwise change the expected focus AFTER await and cause an
  // incorrect rejection or acceptance of a response for another selection.
  callerFocus.layer = 'TRANSIT';
  callerFocus.bodyId = 'SATURN';
  assert.deepEqual(submitted, { layer: 'NATAL', bodyId: 'VENUS' });
  release();
  const reply = await pending;
  assert.deepEqual(reply.focus, { layer: 'NATAL', bodyId: 'VENUS' });
  assert.notStrictEqual(reply.focus, callerFocus);
  assert.notStrictEqual(reply.focus, submitted);
  assert.ok(Object.isFrozen(reply.focus));
});

test('directly decoded replies never expose a mutable reference to the caller focus', () => {
  const callerFocus = { layer: 'NATAL', bodyId: 'VENUS' };
  const reply = readCopilotPreviewReply(response(), callerFocus);
  assert.notStrictEqual(reply.focus, callerFocus);
  assert.ok(Object.isFrozen(reply.focus));
  callerFocus.layer = 'TRANSIT';
  callerFocus.bodyId = 'SATURN';
  assert.deepEqual(reply.focus, { layer: 'NATAL', bodyId: 'VENUS' });
});

test('no remote operation starts on already-cancelled request', async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    requestCopilotPreview({ async postJson() { called = true; } }, focus, controller.signal),
    /cancelled/,
  );
  assert.equal(called, false);
});

test('cancellation after transport prevents stale reply use', async () => {
  const controller = new AbortController();
  await assert.rejects(requestCopilotPreview({
    async postJson() { controller.abort(); return response(); },
  }, focus, controller.signal), /cancelled/);
});

test('never trust an actual model result as a synthetic mock', () => {
  for (const mutation of [
    { stage: 'PRODUCTION' },
    { syntheticFixture: false },
    { astrologyIsReal: true },
    { providerInvoked: true },
    { methodApproved: true },
    { interpretationStatus: 'KNOWLEDGE_RESOLVED' },
    { contract: 'OtherContract' },
  ]) assert.throws(() => readCopilotPreviewReply(response(mutation), focus), /invalid_response/);
});

test('reject mismatched selected body and unsafe backend chart commands', () => {
  const base = response();
  assert.throws(() => readCopilotPreviewReply(base, { layer: 'NATAL', bodyId: 'SUN' }), /invalid_response/);
  for (const bad of [
    { type: 'chart.focusBody', bodyId: 'SUN' },
    { type: 'chart.setTransitInstant', asOfUtc: '2021-01-01T00:00:00Z' },
    { type: 'chart.highlightAspects', aspectIds: ['made-up'] },
    { type: 'chart.highlightAspects', aspectIds: ['synthetic:a', 'synthetic:a'] },
  ]) {
    assert.throws(() => readCopilotPreviewReply({
      ...base, data: { ...base.data, chartCommands: [bad] },
    }, focus), /invalid_response/);
  }
});

test('reject overlong response, bad revision and unwanted extra commands', () => {
  const base = response();
  for (const data of [
    { answer: 'x'.repeat(4001) },
    { chartRevision: -1 },
    { chartRevision: 0.5 },
    { chartCommands: [] },
  ]) assert.throws(() => readCopilotPreviewReply({
    ...base, data: { ...base.data, ...data },
  }, focus), /invalid_response/);
});

test('Angular inspector is opt-in, accessible, and never configures external vendors', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const template = readFileSync(resolve(here, '../src/app/desktop-app.component.html'), 'utf8');
  const component = readFileSync(resolve(here, '../src/app/desktop-app.component.ts'), 'utf8');
  const injection = readFileSync(resolve(here, '../src/app/copilot-preview-token.ts'), 'utf8');
  const csp = JSON.parse(readFileSync(resolve(here, '../src-tauri/tauri.conf.json'), 'utf8'));
  assert.match(template, /role="tab" id="tab-ai"/);
  assert.match(template, /aria-live="polite"/);
  assert.match(template, /\[disabled\]="!copilotConnected \|\| copilotBusy"/);
  assert.match(template, /ai\.preview\.notice/);
  assert.match(component, /inject\(VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT, \{ optional: true \}\)/);
  assert.match(component, /this\.invalidateCopilotRequest\(\)/);
  assert.match(injection, /new InjectionToken/);
  assert.match(csp.app.security.csp, /connect-src 'self'/);
  assert.doesNotMatch(csp.app.security.csp, /api\.openai\.com|api\.anthropic\.com/);
  assert.doesNotMatch(template, /apiKey|modelSelector|select.*provider/i);
});
