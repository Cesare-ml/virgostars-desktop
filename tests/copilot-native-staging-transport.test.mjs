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
  assert.match(rust, /fn project_preview_envelope\(/);
  assert.match(rust, /expected_fixture_session: Option<&str>/);
  assert.match(rust, /project_preview_envelope\(&envelope, &focus, fixture_session\.as_deref\(\)\)/);
  assert.doesNotMatch(rust, /\bOk\(envelope\)/);
  assert.match(rust, /"methodApproved"\)\.and_then\(Value::as_bool\) != Some\(false\)/);
  assert.match(rust, /"birthDataIncluded"\)\.and_then\(Value::as_bool\) != Some\(false\)/);
  assert.match(rust, /"personalChartIncluded"\)\.and_then\(Value::as_bool\) != Some\(false\)/);
  assert.match(rust, /"providerCostUsd"\)\.and_then\(Value::as_f64\) != Some\(0\.0\)/);
  assert.match(rust, /let mut unique = std::collections::HashSet::new\(\)/);
  assert.match(rust, /"chartCommands": \[\{ "type": "chart\.highlightAspects", "aspectIds": aspect_ids \}\]/);
  assert.match(rust, /"chartRevision": revision/);
});

test('native staging rejects invalid and privileged loopback ports before HTTP', () => {
  const rust = read('src-tauri/src/copilot_staging_bridge.rs');
  assert.match(rust, /!matches!\(url\.port\(\), Some\(1024\.\.=65535\)\)/);
  assert.match(rust, /strip_prefix\("http:\/\/127\.0\.0\.1:"\)/);
  assert.match(rust, /let port_text = authority\.strip_suffix\('\/'\)\.unwrap_or\(authority\)/);
  assert.match(rust, /port_text\.parse::<u16>\(\)/);
  for (const invalidOrigin of [
    'http://127.1:3000', 'http://127.000.000.001:3000',
    'HTTP://127.0.0.1:3000', ' http://127.0.0.1:3000',
    'http://127.0.0.1:3000 ', 'http://127.0.0.1:03000',
  ]) assert.ok(rust.includes('"' + invalidOrigin + '"'));

  const allowed = ['http://127.0.0.1:1024', 'http://127.0.0.1:3000', 'http://127.0.0.1:65535'];
  const denied = ['http://127.0.0.1:0', 'http://127.0.0.1:1',
    'http://127.0.0.1:80', 'http://127.0.0.1:1023', 'http://127.0.0.1:65536'];
  for (const origin of allowed) {
    assert.ok(rust.includes('staging_origin("' + origin + '").is_ok()'));
  }
  for (const origin of denied) {
    assert.ok(rust.includes('"' + origin + '"'));
  }
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

test('abort while native IPC remains pending rejects immediately and consumes late errors', async () => {
  let rejectNative;
  const nativePromise = new Promise((_resolve, reject) => { rejectNative = reject; });
  const ctrl = new AbortController();
  let invoked = 0;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    invoke() { invoked++; return nativePromise; },
  });
  const pending = transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, ctrl.signal);
  assert.equal(invoked, 1);
  ctrl.abort();
  // There is deliberately no native completion yet; the WebView promise must
  // already be settled when the selection changes.
  await assert.rejects(pending, error => error.message === 'copilot_preview_cancelled');
  rejectNative(new Error('LATE_NATIVE_SECRET_DO_NOT_FORWARD'));
  // The late rejected invoke is consumed by awaitNativeOrAbort, not exposed to
  // another request or as an unhandled rejection.
  await new Promise(resolve => setImmediate(resolve));
});

test('old cancelled IPC cannot replace a newer selection or bypass native single-flight', async () => {
  let finishFirst;
  let call = 0;
  const transport = createNativeCopilotStagingTransport({
    isNative: () => true,
    invoke() {
      call++;
      if (call === 1) return new Promise(resolve => { finishFirst = resolve; });
      return Promise.resolve(fixtureEnvelope());
    },
  });
  const cancelled = new AbortController();
  const first = transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, cancelled.signal);
  cancelled.abort();
  await assert.rejects(first, /cancelled/);
  // The abandoned WebView promise does NOT imply the native Rust request has
  // released its own single-flight permit. Do not issue a second IPC yet.
  await assert.rejects(
    transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal),
    error => error.message === 'copilot_preview_busy',
  );
  assert.equal(call, 1);
  finishFirst({ accessToken: 'LATE_SECRET', ...fixtureEnvelope() });
  await new Promise(resolve => setImmediate(resolve));
  const second = await transport.postJson(
    COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal,
  );
  assert.equal(second.data.answer, 'VENUS (NATAL), sample only.');
  assert.equal(call, 2);
});

test('abort listeners are removed after native completion and cancellation', async () => {
  for (const cancelled of [false, true]) {
    const ctrl = new AbortController();
    const signal = ctrl.signal;
    let added = 0;
    let removed = 0;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args) => { added++; return add(...args); };
    signal.removeEventListener = (...args) => { removed++; return remove(...args); };
    const transport = createNativeCopilotStagingTransport({
      isNative: () => true,
      invoke() { return cancelled ? new Promise(() => {}) : Promise.resolve(fixtureEnvelope()); },
    });
    const promise = transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, signal);
    if (cancelled) {
      ctrl.abort();
      await assert.rejects(promise, /cancelled/);
    } else {
      await promise;
    }
    assert.equal(added, 1);
    assert.equal(removed, 1);
  }
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

test('only exact native authorization and quota codes are classified for the UI', async () => {
  for (const [nativeCode, expected] of [
    ['copilot_staging_not_authorized', 'copilot_preview_authorization_required'],
    ['copilot_staging_rate_limited', 'copilot_preview_rate_limited'],
    ['copilot_staging_not_authorized SECRET_TOKEN', 'copilot_preview_native_unavailable'],
    ['copilot_staging_rate_limited with private IP', 'copilot_preview_native_unavailable'],
  ]) {
    const transport = createNativeCopilotStagingTransport({
      isNative: () => true,
      async invoke() { throw nativeCode; },
    });
    await assert.rejects(
      transport.postJson(COPILOT_PREVIEW_MESSAGE_PATH, body, new AbortController().signal),
      error => error instanceof Error && error.message === expected,
    );
  }
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

test('Rust rejects wrong local fixture challenges without affecting real backend staging', () => {
  const rust = read('src-tauri/src/copilot_staging_bridge.rs');
  assert.match(rust, /STAGING_FIXTURE_SESSION_ENV: &str = "VIRGOSTARS_COPILOT_FIXTURE_SESSION"/);
  assert.match(rust, /fn valid_fixture_session\(value: &str\) -> bool/);
  assert.match(rust, /Err\(std::env::VarError::NotUnicode\(_\)\) => \{/);
  assert.match(rust, /return Err\("copilot_staging_invalid_fixture_session"\)/);
  assert.match(rust, /let fixture_session = match optional_fixture_session\(\)/);
  assert.match(rust, /fn optional_lab_session_requires_exact_lowercase_128_bit_hex\(\)/);
  assert.match(rust, /fn validate_staging_capabilities\(value: &Value, expected_fixture_session: Option<&str>\)/);
  assert.match(rust, /value\.get\("labSession"\)\.and_then\(Value::as_str\) != Some\(expected\)/);
  assert.match(rust, /validate_staging_capabilities\(&value, fixture_session\.as_deref\(\)\)/);
  assert.match(rust, /assert!\(validate_staging_capabilities\(&valid, None\)\)/);
  assert.match(rust, /assert!\(!validate_staging_capabilities\(&valid, Some\(session\)\)\)/);
});

test('every native POST checks the optional lab session before projecting safe fields', () => {
  const rust = read('src-tauri/src/copilot_staging_bridge.rs');
  assert.match(rust, /fn optional_fixture_session\(\) -> Result<Option<String>, &'static str>/);
  assert.match(rust, /let fixture_session = optional_fixture_session\(\)\.map_err\(str::to_owned\)\?/);
  assert.match(rust, /value\.get\("labSession"\)\.and_then\(Value::as_str\) != Some\(session\)/);
  assert.match(rust, /project_preview_envelope\(&envelope, &focus, fixture_session\.as_deref\(\)\)/);
  assert.match(rust, /fn preview_requires_the_same_lab_session_without_leaking_it_to_webview\(\)/);
  // The safe projected JSON explicitly omits this native-only field.
  const start = rust.indexOf('    Ok(json!({', rust.indexOf('fn project_preview_envelope('));
  const end = rust.indexOf('\n    }))', start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(rust.slice(start, end), /labSession/);
  // Missing session is allowed for the genuine staging backend, whose JWT
  // middleware remains mandatory independently of this synthetic fixture.
  assert.match(rust, /project_preview_envelope\(&fixture, &expected, None\)\.is_ok\(\)/);
});

test('generic native transport failures clear stale AI readiness but quota and busy stay retryable', () => {
  const component = read('src/app/desktop-app.component.ts');
  const start = component.indexOf('async askCopilotPreview(): Promise<void>');
  const end = component.indexOf('\n  zoom(direction:', start);
  assert.ok(start >= 0 && end > start);
  const request = component.slice(start, end);
  const auth = request.indexOf("code === 'copilot_preview_authorization_required'");
  const quota = request.indexOf("code === 'copilot_preview_rate_limited'");
  const busy = request.indexOf("code === 'copilot_preview_busy'");
  const generic = request.indexOf("this.copilotStatus = 'ai.preview.error'");
  assert.ok(auth >= 0 && auth < quota && quota < busy && busy < generic);
  assert.match(request, /if \(code === 'copilot_preview_authorization_required'\) \{\s*this\.copilotPreviewReady = false/);
  assert.match(request, /\} else \{\s*\/\/ Unreachable\/replaced fixture[\s\S]*?this\.copilotPreviewReady = false;\s*this\.copilotStatus = 'ai\.preview\.error'/);
  // A failed probe never hides the error status or forces an offline login.
  assert.match(component, /get copilotCanProbe\(\): boolean \{ return this\.copilotTransport !== null; \}/);
  const template = read('src/app/desktop-app.component.html');
  assert.match(template, /\(click\)="recheckCopilotPreview\(\)"/);
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
  assert.match(command, /validate_staging_capabilities\(&value, fixture_session\.as_deref\(\)\)/);
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
  assert.match(component, /this\.copilotPreviewReady = false;/);
  assert.match(component, /code === 'copilot_preview_authorization_required'/);
  assert.match(component, /code === 'copilot_preview_rate_limited'/);
  assert.match(component, /this\.copilotStatus = 'ai\.preview\.auth_required'/);
  assert.match(component, /this\.copilotStatus = 'ai\.preview\.rate_limited'/);
  assert.match(component, /\|\| this\.copilotBusy \|\| this\.copilotProbeBusy\) return;/);
  assert.match(component, /'copilot_preview_busy'/);
  const translations = read('src/app/translations.ts');
  assert.match(translations, /"ai\.preview\.busy":/);
  assert.equal((translations.match(/"ai\.preview\.auth_required":/g) || []).length, 2);
  assert.equal((translations.match(/"ai\.preview\.rate_limited":/g) || []).length, 2);
  assert.equal((translations.match(/"ai\.preview\.selection":/g) || []).length, 2);
  assert.match(component, /this\.copilotProbeBusy = true/);
  const template = read('src/app/desktop-app.component.html');
  assert.match(template, /t\('ai\.preview\.selection'\)/);
  assert.match(template, /\(click\)="recheckCopilotPreview\(\)"/);
  assert.match(template, /\[disabled\]="copilotProbeBusy \|\| copilotBusy"/);
  assert.match(component, /!this\.copilotConnected\s*\|\| this\.copilotBusy \|\| this\.copilotProbeBusy\) return/);
  assert.match(config.app.security.csp, /connect-src 'self'/);
  assert.doesNotMatch(config.app.security.csp, /api\.openai\.com|api\.anthropic\.com/);
});
