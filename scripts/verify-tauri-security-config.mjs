/**
 * Review gate for the packaged Tauri/WebView surface, not a runtime CSP test.
 * See docs/TAURI_PRODUCTION_SECURITY_GATE.md before changing the allowlist.
 */
import { lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_CSP = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
  'base-uri': ["'self'"],
});


const EXPECTED_DEV_CSP = Object.freeze({
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-eval'"],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'blob:', 'http://127.0.0.1:4177'],
  'font-src': ["'self'", 'data:'],
  'connect-src': ["'self'", 'ws://127.0.0.1:4200', 'http://127.0.0.1:4177'],
  'object-src': ["'none'"],
  'frame-src': ["'none'"],
});

const REVIEWED_SECURITY_FIELDS = Object.freeze(['capabilities', 'csp', 'devCsp']);

function assertSafe(ok, reason) {
  if (!ok) throw new Error('TAURI SECURITY CONFIG: ' + reason);
}
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Pin every directive exactly. Development has narrow loopback-only allowances. */
function verifyPinnedCsp(csp, expected, mode) {
  assertSafe(typeof csp === 'string' && csp.length > 0 && csp.length <= 2048,
    'missing or invalid ' + mode + ' CSP');
  const directives = new Map();
  for (const part of csp.split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, ...sources] = trimmed.split(/\s+/);
    assertSafe(Object.hasOwn(expected, name), 'unreviewed CSP directive');
    assertSafe(!directives.has(name), 'duplicate CSP directive');
    assertSafe(sources.length === expected[name].length &&
      [...sources].sort().every((source, index) => source === [...expected[name]].sort()[index]),
      'CSP source list changed');
    directives.set(name, sources);
  }
  assertSafe(directives.size === Object.keys(expected).length,
    'missing ' + mode + ' CSP directive');
  return Object.freeze({ directives: directives.size });
}

export function verifyProductionCsp(csp) {
  return verifyPinnedCsp(csp, EXPECTED_CSP, 'production');
}

export function verifyDevelopmentCsp(csp) {
  return verifyPinnedCsp(csp, EXPECTED_DEV_CSP, 'development');
}

/** Inspect both packaged and development Tauri WebView boundaries. */
export function verifyTauriSecurityConfig(config) {
  assertSafe(isObject(config) && isObject(config.build) && isObject(config.app) &&
    isObject(config.app.security) && isObject(config.bundle), 'invalid Tauri config');
  assertSafe(config.build.frontendDist === '../dist/desktop/browser' &&
    !Object.hasOwn(config.build, 'beforeBuildCommand'),
    'packaged frontend path or build hook changed');
  assertSafe(config.build.devUrl === 'http://127.0.0.1:4200' &&
    !Object.hasOwn(config.build, 'beforeDevCommand'),
    'development frontend must remain on reviewed loopback origin');
  assertSafe(config.bundle.active === false, 'installer packaging requires separate review');
  assertSafe(Array.isArray(config.app.windows) && config.app.windows.length === 1 &&
    config.app.windows.every(window => isObject(window) && window.label === 'main' &&
      !Object.hasOwn(window, 'url')),
    'unreviewed native window configuration');
  const security = config.app.security;
  // Explicitly reject new Tauri security knobs, including options introduced by
  // future Tauri versions: an innocuous-looking default must be reviewed first.
  assertSafe(Object.keys(security).every(field => REVIEWED_SECURITY_FIELDS.includes(field)),
    'unreviewed Tauri security option');
  assertSafe(Array.isArray(security.capabilities) && security.capabilities.length === 0,
    'native capability list changed');
  assertSafe(config.app.withGlobalTauri !== true &&
    security.dangerousDisableAssetCspModification !== true &&
    !Object.hasOwn(security, 'assetProtocol'),
    'native/WebView security boundary changed');
  verifyProductionCsp(security.csp);
  verifyDevelopmentCsp(security.devCsp);
  return Object.freeze({ windows: config.app.windows.length });
}

export function verifyTauriSecurityCheckout(root = ROOT) {
  const file = join(root, 'src-tauri', 'tauri.conf.json');
  const stat = lstatSync(file);
  assertSafe(stat.isFile() && !stat.isSymbolicLink(), 'unsafe Tauri config file');
  return verifyTauriSecurityConfig(JSON.parse(readFileSync(file, 'utf8')));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assertSafe(process.argv.length === 2, 'unexpected command-line argument');
    const result = verifyTauriSecurityCheckout();
    console.log('Tauri production security configuration reviewed: ' + result.windows + ' local window(s), pinned offline CSP.');
  } catch {
    // Never print arbitrary config contents, private paths or parse exceptions.
    console.error('TAURI SECURITY CONFIG: verification failed; review the production Tauri configuration.');
    process.exitCode = 1;
  }
}
