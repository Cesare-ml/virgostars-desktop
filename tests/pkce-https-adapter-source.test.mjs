import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const rust = readFileSync(new URL('../src-tauri/src/pkce_reqwest_https.rs', import.meta.url), 'utf8');
const lib = readFileSync(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const manifest = readFileSync(new URL('../src-tauri/Cargo.toml', import.meta.url), 'utf8');
const docs = readFileSync(new URL('../docs/CONNECTED_ACCOUNT_NATIVE_HTTPS_REVIEW_2026-11-18.md', import.meta.url), 'utf8');

test('HTTPS candidate is compiled but not wired into the login flow or IPC', () => {
  assert.match(rust, /pub struct StagingReqwestHttps;/);
  assert.match(rust, /impl TokenHttpTransport for StagingReqwestHttps/);
  assert.match(lib, /mod pkce_reqwest_https;/);
  assert.match(manifest, /^reqwest\s*=\s*\{[^\n]*version\s*=\s*"=0\.13\.5"/m);
  assert.doesNotMatch(lib.match(/generate_handler!\[[\s\S]*?\]/)?.[0] ?? '', /StagingReqwestHttps|pkce_reqwest_https/);
  assert.match(docs, /Cargo\.lock/);
});

test('candidate uses HTTPS-only rustls client, strict staging host, no redirects or proxy', () => {
  for (const expression of [
    /valid_staging_token_endpoint\(endpoint\.as_str\(\)\)/,
    /\.https_only\(true\)/,
    /\.tls_backend_rustls\(\)/,
    /\.redirect\(Policy::none\(\)\)/,
    /\.no_proxy\(\)/,
    /\.referer\(false\)/,
    /\.timeout\(timeout\)/,
    /\.connect_timeout\(timeout\)/,
    /"application\/x-www-form-urlencoded"/,
  ]) assert.match(rust, expression);
  assert.doesNotMatch(rust, /danger_accept_invalid_certs|danger_accept_invalid_hostnames|Proxy::|\.basic_auth\(|\.bearer_auth\(/);
});

test('response body is bounded by streaming, with no redirects followed or secrets logged', () => {
  assert.match(rust, /MAX_TOKEN_RESPONSE_BYTES: usize = 8192/);
  assert.match(rust, /MAX_TOKEN_FORM_BYTES: usize = 2048/);
  assert.match(rust, /MAX_TOKEN_DEADLINE: Duration = Duration::from_secs\(10\)/);
  assert.match(rust, /Body::sized\(reader, body\.len\(\) as u64\)/);
  assert.match(rust, /struct SecretFormReader/);
  assert.match(rust, /bytes: Zeroizing<Vec<u8>>/);
  assert.match(rust, /\.take\(\(max_response_bytes \+ 1\) as u64\)/);
  assert.match(rust, /if status != 200/);
  assert.match(rust, /if bytes\.len\(\) > max_response_bytes/);
  assert.doesNotMatch(rust, /println!|eprintln!|dbg!|tracing::|log::|localStorage/);
  const serialized = [...rust.matchAll(/#\[derive\(serde::Serialize\)\][\s\S]*?struct\s+(\w+)/g)].map(m => m[1]);
  assert.deepEqual(serialized, ['GroupRequest']);
  assert.match(rust, /struct GroupRequest<'a> \{ sync_id: &'a str, base_groups: &'a \[String\], groups: &'a \[String\] \}/);
});

test('native HTTPS activation gate remains explicit after compilation', () => {
  assert.match(docs, /cargo test --manifest-path src-tauri\/Cargo\.toml pkce_reqwest_https::tests --locked/);
  assert.match(docs, /lockfile[\s\S]*?rigenerato con Cargo/);
  assert.match(docs, /test di rete HTTPS[\s\S]*?aperti/);
  assert.match(docs, /NOT activated|non attivato/);
});
