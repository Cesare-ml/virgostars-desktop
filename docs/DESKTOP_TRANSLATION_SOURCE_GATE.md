# Desktop translation source gate

Status: **locally tested static check**, not a native Windows/WebView2 or full Angular-build acceptance result.

## Purpose

Angular's typed IT/EN dictionary already checks runtime key parity, but JavaScript object parsing silently discards a duplicated key in the same locale. An accidental duplicate, blank label, dynamic initializer, computed/spread entry, invisible bidi override or missing language can therefore survive a simple comparison of `Object.keys` at runtime. The new gate inspects the **TypeScript source AST without executing it**, before the synthetic or authorized-private frontend staging step.

## Behavior

`scripts/verify-translations.mjs` requires one static `STRINGS` object with exactly `it` and `en`, literal string labels, unique safe dot-separated message keys (maximum 80 characters, no prototype-related reserved names), identical key sets and visible nonblank text. It rejects Unicode control, format, surrogate and line/paragraph-separator categories (including invisible bidi marks and zero-width formatters) in label values. Source and template inputs are limited to 256 KiB (UTF-16 code units) before AST parsing or regex checks. Dynamic syntax fails closed, and errors describe keys but do not echo text. The same pre-build command also checks literal `t('key')` references in the desktop shell and offline city-picker HTML templates, ignoring inert HTML comments and requiring at least one literal translation reference per template. It intentionally does **not** parse dynamic `t(variable)` expressions or TypeScript key maps (which are guarded by Angular's type checker), nor prove translation quality, linguistic correctness, screen-reader output, XSS safety or that all strings in the UI are localized.

The npm `verify:translations` command runs automatically in both `prepare:frontend` and `prepare:frontend:private`. That places it ahead of the Angular build and its Tauri packaging path, without enabling GitHub Actions or adding dependencies: the already-pinned `typescript` developer dependency supplies the parser. A normal `npm ci` is required first.

## Verification

```sh
node --test tests/verify-translations.test.mjs
npm run verify:translations
npm test
npm run build:ui
```

Sixteen regression test groups now cover static dictionary safety, unknown HTML label references, inert comments, invalid inputs, and checks against the checked-in dictionary/templates. The original six synthetic AST test groups have passed using Node 22.16.0 and TypeScript 5.8.3 in an isolated local harness. Run the actual checked-out dictionary gate, full npm suite, Angular build and Windows 11 Tauri/WebView2 review before integration; the isolated tests alone do not establish that the assembled app works.

## Scope

No changes to on-screen text, locale preference schema, account data, birth data, sync, city dataset, astronomical algorithms, runtime IPC, CSP, network behavior, CPAL attribution or releases. This audit cannot replace reviewer checks for legitimate Unicode formatting in new translations; if intentionally required, review the policy and tests rather than bypassing the gate.
