# Bounded HTML and global CSS reads for Windows offline packaging

**Status:** prototype build-artifact hardening. No Tauri/WebView2 run is implied.

## Current verification — CSS lexical newline safety (2026-11-14)

A bug was reproduced on the previous branch: the CSS resource scanner
accepted an **unescaped form-feed** character inside a CSS quoted string,
and the `@import` scanner accepted unescaped LF/CR/FF inside CSS strings.
CSS treats LF, CR and FF as newlines within a string, so a malformed
string must not be skipped as if it were harmless quoted text.

Both scanners now reject **raw LF/CR/FF in quoted strings**, and reject
escaped form feed in identifiers where the CSS escape is invalid.
Valid CSS string continuations using **escaped CRLF** and **escaped FF**
remain accepted; regular FF whitespace outside strings remains valid.

**Actually executed** in an isolated exact-source mirror, Node.js 22.16.0:

```powershell
node --test tests/verify-bounded-ui-text.test.mjs tests/verify-css-resource-functions.test.mjs tests/verify-css-imports.test.mjs tests/css-bundle-combined.test.mjs
```

**57 passed, 0 failed, 0 skipped**, and `node --check` succeeded for the
eight source/test files. Checked source Git blobs against GitHub:

- `scripts/verify-css-imports.mjs`: `3acc16891395ae47c27fd73165fa3a348e8e0927`
- `scripts/verify-css-resource-functions.mjs`: `565fb1a2cc93d1ff49c435179f206a442b4a4100`
- `tests/verify-css-imports.test.mjs`: `8d8492b1975cce8f307def8796ce7f6565a205b7`
- `tests/verify-css-resource-functions.test.mjs`: `e756acad54a991981eeaa9c8a6a386a45a037de4`
- `tests/css-bundle-combined.test.mjs`: `26d390fcb21a85f4d55930e1e47d29c1088f0684`

The other three previously tested implementation/test files are unchanged.
This supersedes historical 38/38 and earlier counts below. It does **not**
constitute the entire repository `npm test`, Angular/Tauri build, Windows
WebView2 runtime verification or release acceptance.

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
- Reject NUL and other binary ASCII control bytes (`0x01`–`0x08`, `0x0B`,
  `0x0E`–`0x1F`, `0x7F`) while reading, but preserve the standard TAB, LF, FF,
  and CR whitespace bytes accepted by HTML/CSS. Reject malformed UTF-8 using
  a fatal decoder. Return stable errors without revealing absolute local paths.

Both the existing static HTML-link rules and CSS import/resource checks remain
in control of what is safe to package. This is **not** a filesystem sandbox
or cross-platform proof against races through ancestor directories, timestamp
granularity, network filesystems or adversarial concurrent writes. On Windows,
ctime can have creation-time semantics and must not be treated as a universal
rewrite detector. The separate component-CSS verifier still has its own
bounded candidate scanner.

## Tests

```powershell
node --test tests/verify-bounded-ui-text.test.mjs tests/verify-css-resource-functions.test.mjs tests/verify-css-imports.test.mjs tests/css-bundle-combined.test.mjs
npm test
npm run build:ui
npm run verify:css
npm run verify:bundle
```

Focused synthetic test coverage includes valid HTML/CSS, multibyte UTF-8,
oversized sparse HTML and CSS files, binary ASCII control bytes and NUL,
allowed whitespace, symlink rejection where supported, invalid UTF-8,
unsupported helper types and redacted missing-file errors.
Two additional pure metadata-regression groups cover restored mtime with
changed ctime, descriptor-identity drift, invalid stat metadata and short reads.

**Executed in a minimal local source mirror (Node.js v22.16.0):**
`node --test tests/verify-bounded-ui-text.test.mjs` — **20/20 PASS**,
zero failures and zero skips. This is the complete committed focused test file,
including actual integration through `inspectDesktopStyles()` and
`assertNoCssImports()`; it is not a full repository `npm test` run.

The source mirror contained **four exact GitHub file blobs**, verified with
`git hash-object` before and after the test:

| File | Git blob SHA |
| --- | --- |
| `scripts/read-bounded-ui-text.mjs` | `afbfc7e09f365a0c99877e7ce62857d504444664` |
| `scripts/verify-bundled-css.mjs` | `81bf813490eaad54bbc788a250c434537ff96fbf` |
| `scripts/verify-css-imports.mjs` | `116cf963bc2dcd54f023932ae033b412e5cb7b32` |
| `tests/verify-bounded-ui-text.test.mjs` | `08a95d1c4345c63d350e9e8a182a6ab960d8c9bd` |

Four new regression cases test an HTML payload exactly at the byte limit,
a NUL in the second read chunk, a valid UTF-8 codepoint split across
64 KiB chunks, and an invalid sequence split at the same boundary.
Four additional regression cases exercise allowed TAB/LF/FF/CR whitespace,
forbidden ESC in HTML, DEL/vertical-tab in CSS, and a forbidden byte exactly
at the second 64 KiB chunk boundary.

Additionally, a local, synthetic **32 MiB exact-size CSS boundary smoke**
passed with Node.js 22.16.0 (full data read and decoded, 33,554,432 bytes;
~214 ms on the authoring environment). It is not a cross-machine performance
benchmark or a Windows acceptance result. The byte scanner uses direct
comparisons to avoid per-byte array allocation. An earlier 19/19 pure-function check
covered metadata validation.

**Not executed:** repository-wide `npm test`, Angular output compilation,
`npm run verify:css` on real generated artifacts, complete synthetic/private
bundle gates, Rust/Tauri compilation, or native Windows 11 WebView2 visual
verification. The mirror uses synthetic temporary files only. Perform
full-workspace and Windows acceptance before merging this draft PR.

## Integrated CSS resource-function policy (draft #150)

This branch also carries the **exact** `scripts/verify-css-resource-functions.mjs`
scanner and 10-case `tests/verify-css-resource-functions.test.mjs`
from draft PR #150, byte-for-byte (Git blob SHA:
`1b5270f2d62a8632f3b07bec7cd5b958516261c1` and
`bc3352364952a81d6c120d534f85f444e24f82ac`).

After the bounded read and `assertNoCssImports()`,
`inspectDesktopStyles()` now calls `assertNoCssResourceFunctions()`.
The scanner rejects active `url()`, `image()`, `image-set()`, and
`-webkit-image-set()` functions, including escaped identifiers and trivia
between the name and `(`. Quoted strings, comments and unrelated names
remain valid. In this prototype, there is deliberately **no global CSS
resource allowlist**: real local images/fonts require separate asset/rights
review and a documented change to the policy.

**Combined focused integration verification, updated 2026-11-14:**
`node --test tests/css-bundle-combined.test.mjs tests/verify-bounded-ui-text.test.mjs tests/verify-css-resource-functions.test.mjs`
ran with Node.js **v22.16.0** on an exact-source local mirror: **38 passed,
0 failed, 0 skipped** (30 original cases + 8 cross-gate regressions).
The local copies of all five existing source/test modules were checked
with `git hash-object` and matched GitHub blob hashes; the new
`tests/css-bundle-combined.test.mjs` also matched the committed GitHub
blob `b15f5c4661ba26dfeab0baf65e464ba3dd29100c`.
The integrated inspector blob tested was
`f480c81c6018893115905ccfc6c1e735bf8a2adf`.

The new tests cover harmless URL-like text, escaped resource function
identifiers, `@import` precedence, invalid UTF-8 and forbidden control-byte
precedence, a resource function following a 64 KiB read boundary,
and safe redacted errors for missing/symlinked stylesheet files.
This is the **entire current 3-file focused combined suite**, not the
repository-wide `npm test` or a real Angular/Tauri build. An earlier
independent V8 source harness also passed 21/21 scanner probes and
8/8 wiring checks, superseded by the real Node integration tests.

The additional `lstatSync` guard now catches filesystem exceptions and
reports a stable, path-free error instead of printing an OS-specific
exception that may reveal the local checkout path. Existing missing-file
wording is preserved for compatibility with offline-bundle tests.

The alternative PR #154 proposes permitting certain local `url()`
references. Do not merge both policies blindly: the stricter no-resource
policy is selected for the present synthetic global stylesheet, while
#154 can inform a later reviewed extension. Neither policy alone audits
Angular component CSS embedded in JavaScript, or proves Windows WebView2
rendering and fully offline operation.

## Constraints and follow-ups

The formerly separate draft #150 resource scanner is incorporated in this
branch; keep its original PR open for independent review until maintainers
confirm supersession. The competing URL-allowlist draft #154 must not be
merged on top without an explicit policy decision and rerun of all tests.

No user accounts, birth records, personal data, city catalog, protected
assets, credentials, astronomical algorithms, native IPC, cloud sync, new
dependencies, CSP weakening, installer/release, GitHub Actions, repository
visibility or production changes. CPAL-1.0 attribution is unchanged.
