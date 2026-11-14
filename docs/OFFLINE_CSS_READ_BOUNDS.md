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
  descriptor identity, byte count, size, modification time and ctime again after reading.
  Checking ctime catches some same-length rewrites even if mtime is restored.
- Reject NUL bytes while streaming, and reject malformed UTF-8 using a fatal decoder. Return stable errors without
  OS exception strings or local absolute filesystem paths.

Both the existing static HTML-link rules and CSS import/resource checks remain
in control of what is safe to package. This is **not** a filesystem sandbox
or cross-platform proof against races through ancestor directories, timestamp
granularity, network filesystems or adversarial concurrent writes. On Windows,
ctime can have creation-time semantics and must not be treated as a universal
rewrite detector. The separate
component-CSS verifier still has its own bounded candidate scanner.

## Tests

```powershell
node --test tests/verify-bounded-ui-text.test.mjs
npm test
npm run build:ui
npm run verify:css
npm run verify:bundle
```

Focused synthetic test coverage includes valid HTML/CSS, multibyte UTF-8,
oversized sparse HTML and CSS files, embedded NUL bytes, symlink rejection when supported,
invalid UTF-8, unsupported helper types and redacted missing-file errors.
Two additional pure metadata-regression groups cover restored mtime with
changed ctime, descriptor-identity drift, invalid stat metadata and short reads.

**Executed in the authoring environment (Node 22.16.0):** 12/12 focused
checks of the new helper in a temporary isolated mirror. The mirrored helper
has the identical Git blob SHA `e878aaac45af0edba84b1e460a16d2ef8d977012`
as the committed source. These are **not** the entire committed integration
test file: that file additionally exercises the real `inspectDesktopStyles`
gate and remains unexecuted in the authoring environment.

**Additional static verification:** 19/19 assertions passed in a V8 harness
executing the `hasStableReadMetadata` function extracted from the **exact**
GitHub source blob `bb8f00cc15ccb2f72cac6a073fbf8596749f9d94`.
This is a focused pure-function test, **not** the complete Node test suite.

The original CSS inspector integration, full repo tests, production Angular
bundle, Rust/Tauri compilation and native Windows 11 WebView2 visual check
**remain unverified**. Run them on a complete approved source checkout before
merge.

## Constraints and follow-ups

There are draft branches adding other CSS resource scanners (e.g. #150 and
#154). Reconcile their shared `scripts/verify-bundled-css.mjs` changes before
merging. This PR should preserve any approved resource gate, not replace it.

No user accounts, birth records, personal data, city catalog, protected
assets, credentials, astronomical algorithms, native IPC, cloud sync, new
dependencies, CSP weakening, installer/release, GitHub Actions, repository
visibility or production changes. CPAL-1.0 attribution is unchanged.
