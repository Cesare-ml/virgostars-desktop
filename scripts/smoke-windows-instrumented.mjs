// Instrumented Windows GUI smoke for the locally built, synthetic-only prototype.
//
// Launches the fixed-path release executable, attaches to its WebView2 through a
// loopback-only DevTools port and checks what the manual runbook cannot measure:
// applied stylesheets, layout at two window sizes, WebGL, outbound requests, page
// exceptions, the read-only IPC commands, synthetic PNG export and WebGL context
// recovery. It is NOT a release test: no installer, signature, real astronomy,
// accessibility audit or GPU/performance measurement.
//
// Safety: fixed executable path, throw-away WebView2 profile and download folder in the
// OS temp directory (removed at the end), loopback port only, no screenshots, no network
// download, no archive command, no personal data. Output contains no absolute paths.
import {spawn} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const DEVTOOLS_PORT = 9339;
export const MIN_PNG_BYTES = 10_000;
/** The square wheel must take at least this share of its stage's shorter side. */
export const MIN_CHART_HEIGHT_SHARE = 0.95;
const MIN_NAV_WIDTH_PX = 40;
const LOCAL_URL = /^(https?:\/\/(tauri|ipc|asset)\.localhost(?:[:/]|$)|tauri:|ipc:|data:|blob:|about:)/;
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** Pure decision logic: observations in, stable failure identifiers and warnings out. */
export function evaluateSmoke(observed) {
  const failures = [];
  const warnings = [];
  // Without an ephemeris provider there is no chart to draw or export; the page must say so instead.
  const calculated = observed.calculation?.status === 'ok';
  const fail = (id, condition) => { if (condition) failures.push(id); };
  const sheets = observed.styleSheets ?? [];
  fail('CSS_NOT_APPLIED', !sheets.some(sheet => sheet.href !== 'inline' && sheet.rules > 0));
  const layout = observed.layout ?? {};
  fail('LAYOUT_COLLAPSED', !(layout.sidebar?.w >= MIN_NAV_WIDTH_PX && layout.inspector?.w > 100 && layout.canvas?.w >= 200 && layout.canvas?.h >= 200));
  fail('WEBGL_UNAVAILABLE', observed.webgl?.ok !== true || observed.webgl?.lost === true);
  // The program opens on the sky of the moment, and shows no placeholder chart.
  fail('STARTUP_SKY_MISSING', calculated && !/cielo|sky/i.test(observed.startupTitle ?? ''));
  fail('EXTERNAL_REQUEST', (observed.requests ?? []).some(url => !LOCAL_URL.test(url)));
  fail('PAGE_EXCEPTION', (observed.exceptions ?? []).length > 0);
  for (const size of ['1280x720', '1920x1080']) {
    const resized = observed.resize?.[size];
    fail(`RESIZE_${size}`, !resized || resized.overflowX || resized.overflowY || !(resized.canvas?.[0] >= 200));
    const stageSide = Math.min(...(resized?.stage ?? []));
    fail(`CHART_NOT_TALL_${size}`, !Number.isFinite(stageSide) || stageSide <= 0
      || !(resized?.canvas?.[1] >= MIN_CHART_HEIGHT_SHARE * stageSide));
  }
  const info = observed.runtimeInfo;
  fail('IPC_RUNTIME_INFO', !(info?.protocolVersion === 1 && info.fixtureKind === 'synthetic_demo'
    && info.accountConnected === false && info.cloudSyncAvailable === false));
  // Without a provider the host must say so; it must never answer with invented positions.
  const calc = observed.calculation;
  const honest = calc?.status === 'provider_unavailable' && calc.chart === null
    || calc?.status === 'ok' && calc.provider && calc.chart;
  fail('IPC_CALCULATION_NOT_TRUTHFUL', !honest);
  fail('IPC_INVALID_REQUEST_ACCEPTED', observed.invalidCalculation?.status !== 'invalid_request');
  fail('PNG_EXPORT', calculated && !(observed.png?.signatureOk && observed.png.bytes >= MIN_PNG_BYTES));
  fail('WEBGL_CONTEXT_NOT_RECOVERED', !(observed.contextLoss?.lostAfterLose === true && observed.contextLoss.lostAfterRestore === false));
  if ((observed.console ?? []).some(line => /ipc\.localhost/.test(line))) {
    warnings.push('IPC_CSP_FALLBACK: Tauri IPC over ipc.localhost is blocked by connect-src and falls back to postMessage');
  }
  return {failures, warnings};
}

const sleep = ms => new Promise(done => setTimeout(done, ms));

function connect(url) {
  return new Promise((resolveSocket, reject) => {
    const socket = new WebSocket(url);
    let nextId = 0;
    const pending = new Map();
    const listeners = [];
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const {resolve: ok, reject: ko} = pending.get(message.id);
        pending.delete(message.id);
        message.error ? ko(new Error(message.error.message ?? 'cdp error')) : ok(message.result);
      } else listeners.forEach(listener => listener(message));
    };
    socket.onerror = () => reject(new Error('devtools connection failed'));
    socket.onopen = () => resolveSocket({
      send: (method, params = {}) => new Promise((ok, ko) => {
        const id = ++nextId;
        pending.set(id, {resolve: ok, reject: ko});
        socket.send(JSON.stringify({id, method, params}));
      }),
      on: listener => listeners.push(listener),
      close: () => socket.close()
    });
  });
}

export async function runSmoke(root) {
  if (process.platform !== 'win32') throw new Error('NATIVE_SMOKE_WINDOWS_ONLY');
  const exe = join(root, 'src-tauri', 'target', 'release', 'virgostars-desktop-spike.exe');
  if (!existsSync(exe)) throw new Error('NATIVE_SMOKE_EXECUTABLE_MISSING');
  const work = mkdtempSync(join(tmpdir(), 'vsd-smoke-'));
  const downloads = join(work, 'downloads');
  mkdirSync(downloads);
  const observed = {requests: [], console: [], exceptions: []};
  const child = spawn(exe, [], {
    env: {...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${DEVTOOLS_PORT} --remote-debugging-address=127.0.0.1`,
      WEBVIEW2_USER_DATA_FOLDER: join(work, 'profile')},
    stdio: 'ignore'
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  const deadline = setTimeout(() => child.kill(), 120_000);
  try {
    const list = async path => (await fetch(`http://127.0.0.1:${DEVTOOLS_PORT}${path}`)).json();
    let page;
    for (let attempt = 0; attempt < 60 && !page; attempt++) {
      await sleep(500);
      if (exited) throw new Error('NATIVE_SMOKE_EARLY_EXIT');
      try { page = (await list('/json/list')).find(target => target.type === 'page' && /^http:\/\/tauri\.localhost\//.test(target.url)); } catch { /* not up yet */ }
    }
    if (!page) throw new Error('NATIVE_SMOKE_NO_PAGE');
    const cdp = await connect(page.webSocketDebuggerUrl);
    cdp.on(message => {
      const {method, params} = message;
      if (method === 'Network.requestWillBeSent') observed.requests.push(params.request.url);
      else if (method === 'Runtime.consoleAPICalled') observed.console.push(`${params.type}: ${params.args.map(arg => arg.value ?? arg.description ?? '').join(' ').slice(0, 200)}`);
      else if (method === 'Log.entryAdded') observed.console.push(`${params.entry.level}: ${params.entry.text.slice(0, 200)}`);
      else if (method === 'Runtime.exceptionThrown') observed.exceptions.push((params.exceptionDetails.exception?.description ?? params.exceptionDetails.text).slice(0, 200));
    });
    for (const domain of ['Network', 'Runtime', 'Log', 'Page']) await cdp.send(`${domain}.enable`);
    const browser = await connect((await list('/json/version')).webSocketDebuggerUrl);
    await browser.send('Browser.setDownloadBehavior', {behavior: 'allow', downloadPath: downloads});

    const evaluate = async expression => {
      const result = await cdp.send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true});
      if (result.exceptionDetails) throw new Error('page evaluation failed');
      return result.result.value;
    };
    // Reload so that every startup request is observed from the beginning.
    await cdp.send('Page.reload', {ignoreCache: true});
    // A cold start of a freshly built executable can be slow: wait for the chart or the empty state, not a fixed time.
    for (let attempt = 0; attempt < 80; attempt++) {
      await sleep(500);
      if (await evaluate(`!!document.querySelector('.stage-info, .empty-state')`).catch(() => false)) break;
    }
    await sleep(2500);
    // Pause the sky's own refresh (every 33 s) so that it cannot redraw in the middle of a measurement.
    await evaluate(`document.querySelector('.sky-live.live')?.click()`);
    // The planet table starts closed; open it so that its layout is measured too.
    await evaluate(`document.querySelector('.info-button')?.click()`);
    await sleep(1500);

    observed.styleSheets = await evaluate(`[...document.styleSheets].map(sheet => { try { return {href: sheet.href ? new URL(sheet.href).pathname : 'inline', rules: sheet.cssRules.length}; } catch { return {href: 'unreadable', rules: 0}; } })`);
    const box = selector => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; const b = el.getBoundingClientRect(); return {w: Math.round(b.width), h: Math.round(b.height)}; })()`;
    observed.layout = await evaluate(`({sidebar: ${box('.sidebar')}, canvas: ${box('canvas.chart-canvas')}, inspector: ${box('.inspector')}})`);
    observed.webgl = await evaluate(`(() => { const c = document.querySelector('canvas.chart-canvas'); const gl = c && (c.getContext('webgl2') || c.getContext('webgl')); return gl ? {ok: true, lost: gl.isContextLost()} : {ok: false}; })()`);
    observed.startupTitle = await evaluate(`document.querySelector('.stage-info h1')?.textContent ?? ''`);

    observed.resize = {};
    for (const [width, height] of [[1280, 720], [1920, 1080]]) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
      await sleep(1500);
      observed.resize[`${width}x${height}`] = await evaluate(`(() => { const b = document.querySelector('canvas.chart-canvas')?.getBoundingClientRect(); const s = document.querySelector('.chart-stage')?.getBoundingClientRect(); const d = document.documentElement; return {stage: s && [Math.round(s.width), Math.round(s.height)], canvas: b && [Math.round(b.width), Math.round(b.height)], overflowX: d.scrollWidth > d.clientWidth, overflowY: d.scrollHeight > d.clientHeight}; })()`);
    }
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await sleep(800);

    const invoke = (command, args) => evaluate(`window.__TAURI_INTERNALS__.invoke(${JSON.stringify(command)}, ${JSON.stringify(args)}).catch(() => null)`);
    observed.runtimeInfo = await invoke('desktop_runtime_info', {});
    // Synthetic request: a fictional instant and coordinates, no birth data.
    observed.calculation = await invoke('calculate_chart', {request: {protocolVersion: 1, utcIso: '2000-01-01T12:00:00Z', latMicro: 45_000_000, lngMicro: 9_000_000}});
    observed.invalidCalculation = await invoke('calculate_chart', {request: {protocolVersion: 1, utcIso: 'not-a-date', latMicro: 0, lngMicro: 0}});

    await evaluate(`document.querySelector('.export-button')?.click()`);
    await sleep(4000);
    const files = readdirSync(downloads);
    const file = files.length === 1 ? join(downloads, files[0]) : null;
    const bytes = file ? readFileSync(file) : Buffer.alloc(0);
    observed.png = {bytes: bytes.length, signatureOk: PNG_SIGNATURE.every((value, index) => bytes[index] === value) && statSync(file ?? work).isFile()};

    observed.contextLoss = await evaluate(`(async () => {
      const c = document.querySelector('canvas.chart-canvas'); const gl = c && (c.getContext('webgl2') || c.getContext('webgl'));
      const ext = gl && gl.getExtension('WEBGL_lose_context'); if (!ext) return null;
      ext.loseContext(); await new Promise(r => setTimeout(r, 800)); const lostAfterLose = gl.isContextLost();
      ext.restoreContext(); await new Promise(r => setTimeout(r, 2500));
      return {lostAfterLose, lostAfterRestore: gl.isContextLost()};
    })()`);
    cdp.close(); browser.close();
  } finally {
    clearTimeout(deadline);
    child.kill();
    await sleep(500);
    rmSync(work, {recursive: true, force: true});
  }
  return observed;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const root = resolve(fileURLToPath(import.meta.url), '..', '..');
  try {
    const observed = await runSmoke(root);
    const {failures, warnings} = evaluateSmoke(observed);
    console.log(JSON.stringify({
      requests: observed.requests.length, exceptions: observed.exceptions.length,
      pngBytes: observed.png.bytes, calculationStatus: observed.calculation?.status ?? null,
      failures, warnings
    }, null, 2));
    console.log(failures.length ? 'NATIVE_INSTRUMENTED_SMOKE_FAILED' : 'NATIVE_INSTRUMENTED_SMOKE_PASSED (prototype executable only; not a release or astronomy validation)');
    process.exitCode = failures.length ? 1 : 0;
  } catch (error) {
    console.error(String(error?.message ?? error).split('\n')[0]);
    process.exitCode = 2;
  }
}
