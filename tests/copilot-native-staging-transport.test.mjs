import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createNativeCopilotStagingTransport,
} from '../src/app/native/copilot-staging-transport.ts';
import {
  requestCopilotPreview,
  COPILOT_PREVIEW_MESSAGE_PATH,
} from '../src/app/copilot-preview-client.ts';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const focus = { layer: 'NATAL', bodyId: 'VENUS' };
const body = { action: 'describe_focus', focus };

function fixtureEnvelope() {
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
      answer: 'VENUS (NATAL), sample only.',
      source: 'MOCK_DETERMINISTIC',
      chartRevision: 1,
      focus,
      chartCommands: [{
        type: 'chart.highlightAspects',
        aspectIds: ['synthetic:transit:saturn:venus'],
      }],
    },
  };
}

test('native bridge forwards only fixed focus, not URL, API key, model or user token', async () => {
  const calls = [];
  const native = {
    isNative: () => true,
    async invoke(command, args) {
      calls.push({ command, args });
      return fixtureEnvelope();
    },
  };
  const transport = createNativeCopilotStagingTransport(native);
  const result = await requestCopilotPreview(transport, focus, new AbortController().signal);
  assert.equal(result.synthetic, true);
  assert.equal(result.illustrativeAspectCount, 1);
  assert.deepEqual(calls, [{
    command: 'copilot_staging_preview',
    args: { focus },
  }]);
  const serialized = JSON.stringify(calls);
  for (const secret of ['Authorization', 'Bearer', 'apiKey', 'birthDate', 'model', 'provider']) {
    assert.doesNotMatch(serialized, new RegExp(secret));
  }
});

test('local readiness probe is boolean-only and does not transfer a token', async () => {
  const calls = [];
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke(command, args) {
      calls.push({ command, args });
      return true;
    },
  });
  assert.equal(await transport.isAvailable(), true);
  assert.deepEqual(calls, [{ command: 'copilot_staging_ready', args: undefined }]);
});

test('native forwards a sanitized synthetic projection, never a raw backend envelope', () => {
  const rust = read('src-tauri/src/copilot_staging_bridge.rs');
  assert.match(rust, /fn project_preview_envelope\(value: &Value, expected: &Focus\)/);
  assert.match(rust, /project_preview_envelope\(&envelope, &focus\)/);
  assert.doesNotMatch(rust, /\bOk\(envelope\)/);
  assert.match(rust, /"methodApproved"\)\.and_then\(Value::as_bool\) != Some\(false\)/);
  assert.match(rust, /"birthDataIncluded"\)\.and_then\(Value::as_bool\) != Some\(false\)/);
  assert.match(rust, /"personalChartIncluded"\)\.and_then\(Value::as_bool\) != Some\(false\)/);
  assert.match(rust, /"providerCostUsd"\)\.and_then\(Value::as_f64\) != Some\(0\.0\)/);
  assert.match(rust, /let mut unique = std::collections::HashSet::new\(\)/);
  assert.match(rust, /"chartCommands": \[\{ "type": "chart\.highlightAspects", "aspectIds": aspect_ids \}\]/);
  assert.match(rust, /"chartRevision": revision/);
});

test('native capabilities probe rejects non-boolean or misleading success results', async () => {
  for (const spoofed of [null, undefined, 1, 'true', {}, { enabled: true }]) {
    const transport = createNativeCopilotStagingTransport({
      isNative: () => true,
      async invoke(command) {
        assert.equal(command, 'copilot_staging_ready');
        return spoofed;
      },
    });
    assert.equal(await transport.isAvailable(), false);
  }
});

test('missing debug feature or staging configuration leaves preview unavailable', async () => {
  const disabled = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke(command) {
      assert.equal(command, 'copilot_staging_ready');
      return false;
    },
  });
  assert.equal(await disabled.isAvailable(), false);
  const commandMissing = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { throw new Error('unknown IPC command with sensitive details'); },
  });
  assert.equal(await commandMissing.isAvailable(), false);
  let called = false;
  const browser = createNativeCopilotStagingTransport({
    isNative: () => false,
    async invoke() { called = true; return true; },
  });
  assert.equal(await browser.isAvailable(), false);
  assert.equal(called, false);
});

test('browser and remote request injection fail before native invocation', async () => {
  let called = 0;
  const native = {
    isNative: () => false,
    async invoke() { called++; return fixtureEnvelope(); },
  };
  const transport = createNativeCopilotStagingTransport(native);
  await assert.rejects(
    transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal),
    /native_unavailable/,
  );
  assert.equal(called, 0);
});

test('untrusted payload cannot override action, focus, backend URL, provider or token', async () => {
  let called = 0;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { called++; return fixtureEnvelope(); },
  });
  const ctrl = new AbortController();
  for (const attack of [
    { ...body, url: 'https://third-party.invalid' },
    { ...body, apiKey: 'SECRET' },
    { ...body, provider: 'anthropic' },
    { action: 'setTransitInstant', focus },
    { action: 'describe_focus', focus: { layer: 'TRANSIT', bodyId: 'VENUS' } },
  ]) {
    await assert.rejects(
      transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, attack, ctrl.signal),
      /invalid_native_request/,
    );
  }
  await assert.rejects(
    transport.postJson('https://api.openai.com/v1/responses', body, ctrl.signal),
    /invalid_native_request/,
  );
  assert.equal(called, 0);
});

test('abort before network prevents calling native bridge', async () => {
  let called = false;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { called = true; },
  });
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, ctrl.signal), /cancelled/);
  assert.equal(called, false);
});

test('abort during native HTTP ignores stale response; no native cancel guarantee', async () => {
  const ctrl = new AbortController();
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { ctrl.abort(); return fixtureEnvelope(); },
  });
  await assert.rejects(transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, ctrl.signal), /cancelled/);
});

test('native single-flight busy gets one safe status but arbitrary IPC errors stay redacted', async () => {
  const busy = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { throw 'copilot_staging_busy'; },
  });
  await assert.rejects(
    busy.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal),
    error => error.message === 'copilot_preview_busy',
  );
  const forged = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { throw 'copilot_staging_busy plus SECRET_TOKEN'; },
  });
  await assert.rejects(
    forged.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal),
    error => error.message === 'copilot_preview_native_unavailable',
  );
});

test('native failure is sanitized; no environment, token or service details reach UI', async () => {
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    async invoke() { throw new Error('JWT SECRET and https://internal.example.test'); },
  });
  await assert.rejects(
    transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal),
    error => error.message === 'copilot_preview_native_unavailable',
  );
});

test('native HTTP concurrency is bounded across readiness and preview commands', () => {
  const rust = read('src-tauri/src/copilot_staging_bridge.rs');
  assert.match(rust, /static STAGING_HTTP_IN_FLIGHT: AtomicBool = AtomicBool::new\(false\)/);
  assert.match(rust, /compare_exchange\(false, true, Ordering::Acquire, Ordering::Relaxed\)/);
  assert.match(rust, /impl Drop for StagingHttpPermit<'_>/);
  assert.match(rust, /self\.gate\.store\(false, Ordering::Release\)/);
  // GET /capabilities returns false if the single native slot is busy.
  assert.match(rust, /None => return false,/);
  // POST returns a generic local error without spawning another request.
  assert.match(rust, /ok_or_else\(\|\| "copilot_staging_busy"\.to_owned\(\)\)/);
  assert.equal((rust.match(/StagingHttpPermit::acquire\(&STAGING_HTTP_IN_FLIGHT\)/g) || []).length, 2);
  assert.match(rust, /fn native_http_guard_limits_overlap_and_recovers_after_drop\(\)/);
});

test('release builds omit the staging command; Angular development-only wiring', () => {
  const lib = read('src-tauri/src/lib.rs');
  const command = read('src-tauri/src/copilot_staging_bridge.rs');
  const cargo = read('src-tauri/Cargo.toml');
  const main = read('src/main.ts');
  const config = JSON.parse(read('src-tauri/tauri.conf.json'));
  assert.match(lib, /cfg\(all\(debug_assertions, feature = "copilot-staging"\)\)/);
  assert.match(lib, /cfg\(not\(all\(debug_assertions, feature = "copilot-staging"\)\)\)/);
  assert.match(lib, /copilot_staging_bridge::copilot_staging_preview/);
  assert.match(lib, /copilot_staging_bridge::copilot_staging_ready/);
  assert.match(cargo, /copilot-staging\s*=\s*\["dep:reqwest"\]/);
  assert.match(command, /host_str\(\) != Some\("127\.0\.0\.1"\)/);
  assert.match(command, /Policy::none\(\)/);
  assert.match(command, /\.no_proxy\(\)/);
  assert.match(command, /MAX_RESPONSE_BYTES/);
  assert.match(command, /CAPABILITIES_PATH: &str = "\/api\/v1\/ai\/copilot-preview\/capabilities"/);
  assert.match(command, /\.get\(endpoint\)/);
  assert.match(command, /\.bearer_auth\(/);
  assert.match(command, /validate_staging_capabilities\(&value\)/);
  assert.match(command, /bounded_json\(response\)\.await/);
  assert.match(command, /providerEnabled/);
  assert.match(command, /modelSelectorAvailable/);
  assert.match(main, /isDevMode\(\) && isTauri\(\)/);
  assert.match(main, /VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT/);
  const tsconfig = JSON.parse(read('tsconfig.json'));
  const nativeSource = read('src/app/native/copilot-staging-transport.ts');
  assert.equal(tsconfig.compilerOptions.rewriteRelativeImportExtensions, true);
  assert.match(nativeSource, /from '\.\.\/copilot-preview-client\.ts'/);

  const component = read('src/app/desktop-app.component.ts');
  assert.match(component, /await this\.copilotTransport\.isAvailable\(\)/);
  assert.match(component, /this\.copilotPreviewReady = available === true/);
  assert.match(component, /recheckCopilotPreview\(\): void/);
  assert.match(component, /'copilot_preview_busy'/);
  const translations = read('src/app/translations.ts');
  assert.match(translations, /"ai\.preview\.busy":/);
  assert.match(component, /this\.copilotProbeBusy = true/);
  const template = read('src/app/desktop-app.component.html');
  assert.match(template, /\(click\)="recheckCopilotPreview\(\)"/);
  assert.match(template, /\[disabled\]="copilotProbeBusy \|\| copilotBusy"/);
  assert.match(component, /!this\.copilotConnected\) return/);
  assert.match(config.app.security.csp, /connect-src 'self'/);
  assert.doesNotMatch(config.app.security.csp, /api\.openai\.com|api\.anthropic\.com/);
});
