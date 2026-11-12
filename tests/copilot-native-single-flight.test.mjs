import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeCopilotStagingTransport } from '../src/app/native/copilot-staging-transport.ts';
import { COPILOT_PREVIEW_MESSAGE_PATH } from '../src/app/copilot-preview-client.ts';

const focus = Object.freeze({ layer: 'NATAL', bodyId: 'VENUS' });
const request = Object.freeze({ action: 'describe_focus', focus });
const invokePreview = (transport, signal = new AbortController().signal) =>
  transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, request, signal);
const reply = () => ({ stage: 'STAGING_SYNTHETIC', data: { focus } });

test('overlapping previews never enqueue a second native IPC call', async () => {
  let finish;
  let calls = 0;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    invoke() {
      calls++;
      return new Promise(resolve => { finish = resolve; });
    },
  });
  const first = invokePreview(transport);
  assert.equal(calls, 1);
  await assert.rejects(invokePreview(transport), error => error.message === 'copilot_preview_busy');
  assert.equal(calls, 1);
  finish(reply());
  assert.deepEqual(await first, reply());
  assert.equal(calls, 1);
});

test('cancelled WebView request frees UI immediately but retains native single flight until Rust settles', async () => {
  let settleFirst;
  let calls = 0;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    invoke() {
      calls++;
      if (calls === 1) return new Promise(resolve => { settleFirst = resolve; });
      return Promise.resolve(reply());
    },
  });
  const controller = new AbortController();
  const first = invokePreview(transport, controller.signal);
  controller.abort();
  await assert.rejects(first, error => error.message === 'copilot_preview_cancelled');
  await assert.rejects(invokePreview(transport), error => error.message === 'copilot_preview_busy');
  assert.equal(calls, 1, 'abort must not queue an extra Tauri invoke');
  settleFirst({ secret: 'discarded-late-reply' });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await invokePreview(transport), reply());
  assert.equal(calls, 2);
});

test('native rejection and synchronous invocation failure release the local pending guard', async () => {
  let rejectFirst;
  let calls = 0;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    invoke() {
      calls++;
      if (calls === 1) return new Promise((_resolve, reject) => { rejectFirst = reject; });
      if (calls === 2) throw new Error('local private detail must be redacted');
      return Promise.resolve(reply());
    },
  });
  const ctrl = new AbortController();
  const first = invokePreview(transport, ctrl.signal);
  ctrl.abort();
  await assert.rejects(first, /cancelled/);
  rejectFirst(new Error('private native error'));
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(invokePreview(transport), error => error.message === 'copilot_preview_native_unavailable');
  assert.equal(calls, 2);
  assert.deepEqual(await invokePreview(transport), reply());
  assert.equal(calls, 3);
});
