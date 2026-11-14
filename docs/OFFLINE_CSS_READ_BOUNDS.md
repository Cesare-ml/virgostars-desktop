# Bounded HTML and global CSS reads for Windows offline packaging

**Status:** prototype build-artifact hardening. No Tauri/WebView2 run is implied.

## Scope

The existing `inspectDesktopStyles()` validates Angular's enabled, local
`styles*.css` link before `npm run verify:css` and the normal/private
`verify:bundle` path. Its `readFileSync(..., 'utf8')` calls previously read
the generated `index.html` and global stylesheet without a byte cap.
An accidentally replaced, damaged or oversized file could consume excessive
memory before reaching any CSS validity checks.

The verifier now uses `scripts/read-bounded-ui-text.mjs` for these **two**
read sites. It enforces:

- Generated `index.html`: at most **2 MiB**.
- Generated single linked global `styles*.css`: at most **32 MiB**.
- Only regular final files: reject final-component symlinks, missing files and
  changed descriptor identity. Apply `O_NOFOLLOW` where supported.
- Read through one descriptor in chunks of up to **64 KiB**, checking one
  sentinel byte beyond the limit to detect growth. Check the descriptor's
  identity, byte count, size, modification time and ctime again after reading.
  Checking ctime catches some same-length rewrites even if mtime is restored.
- Reject NUL bytes while streaming, and reject malformed UTF-8 using a fatal
  decoder. Return stable errors without OS exception strings or local absolute paths.

Both the existing static HTML-link rules and CSS import/resource checks remain
in control of what is safe to package. This is **not** a filesystem sandbox
or cross-platform proof against races through ancestor directories, timestamp
granularity, network filesystems or adversarial concurrent writes. On Windows,
ctime can have creation-time semantics and must not be treated as a universal
rewrite detector. The separate component-CSS verifier still has its own
bounded candidate scanner.

## Tests

```powershell
node --test tests/verify-bounded-ui-text.test.mjs
npm test
npm run build:ui
npm run verify:css
npm run verify:bundle
```

Focused synthetic test coverage includes valid HTML/CSS, multibyte UTF-8,
oversized sparse HTML and CSS files, embedded NUL bytes, symlink rejection
when supported,
invalid UTF-8, unsupported helper types and redacted missing-file errors.
Two additional pure metadata-regression groups cover restored mtime with
changed ctime, descriptor-identity drift, invalid stat metadata and short reads.

**Executed in a minimal local source mirror (Node.js v22.16.0):**
`node --test tests/verify-bounded-ui-text.test.mjs` — **16/16 PASS**,
zero failures and zero skips. This is the complete committed focused test file,
including actual integration through `inspectDesktopStyles()` and
`assertNoCssImports()`; it is not a full repository `npm test` run.

The source mirror contained **four exact GitHub file blobs**, verified with
`git hash-object` before and after the test:

| File | Git blob SHA |
| --- | --- |
| `scripts/read-bounded-ui-text.mjs` | `bb8f00cc15ccb2f72cac6a073fbf8596749f9d94` |
| `scripts/verify-bundled-css.mjs` | `81bf813490eaad54bbc788a250c434537ff96fbf` |
| `scripts/verify-css-imports.mjs` | `116cf963bc2dcd54f023932ae033b412e5cb7b32` |
| `tests/verify-bounded-ui-text.test.mjs` | `5516708905e2e1dd4e0bd6ab6b2d6bf9ff17ffc4` |

Four new regression cases test an HTML payload exactly at the byte limit,
a NUL in the second read chunk, a valid UTF-8 codepoint split across
64 KiB chunks, and an invalid sequence split at the same boundary.
An earlier independent 19/19 pure-function check covered metadata validation.

**Not executed:** repository-wide `npm test`, Angular output compilation,
`npm run verify:css` on real generated artifacts, complete synthetic/private
bundle gates, Rust/Tauri compilation, or native Windows 11 WebView2 visual
verification. The mirror uses synthetic temporary files only. Perform
full-workspace and Windows acceptance before merging this draft PR.

## Constraints and follow-ups

There are draft branches adding other CSS resource scanners (e.g. #150 and
#154). Reconcile their shared `scripts/verify-bundled-css.mjs` changes before
merging. This PR should preserve any approved resource gate, not replace it.

No user accounts, birth records, personal data, city catalog, protected
assets, credentials, astronomical algorithms, native IPC, cloud sync, new
dependencies, CSP weakening, installer/release, GitHub Actions, repository
visibility or production changes. CPAL-1.0 attribution is unchanged.
