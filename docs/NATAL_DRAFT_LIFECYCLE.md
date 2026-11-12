# Natal draft lifecycle and UTC preview freshness

**Status: targeted privacy and correctness hardening, stacked on draft PR #63.** This is a small follow-up for the existing natal editor. It does not introduce or duplicate the different birth form from draft PR #62.

## Problem

The existing in-memory natal draft is deliberately retained across inspector-tab changes, but it was not explicitly cleared when the entire desktop shell is destroyed. Additionally, the native city's selection may be updated through the parent Settings inspector; a previously rendered UTC fold choice must never be reused after any external mutation of the underlying draft. The form's normal input handlers already invalidate their local preview, but updates from other code paths should be guarded too.

## Implemented

- `NatalDraftState.inputRevision` is a monotonically increasing in-memory revision incremented for every mutation that invalidates a preview (name, date/time, known/unknown time, place, correction controls, clear).
- `NatalDraftComponent` records the revision of the draft used for `previewIanaCivilTime`. `selectedUtc` and `chooseUtc()` return no selection when the source draft is missing or its revision differs. This also protects against changes performed outside the component while it remains mounted.
- `NatalDraftState.dispose()` clears retained name, birth date/time, city, preview and issues, then retires the state so late update/correction/place callbacks cannot repopulate it.
- Root `DesktopAppComponent.ngOnDestroy()` disposes its shared natal draft. **Normal inspector tab switches still retain the form**; the child `ngOnDestroy()` deliberately does not dispose the shared state.
- `clear()` remains reusable during ordinary editing; a disposed draft never becomes active again.

**Important privacy limit:** Clearing object references in JavaScript is best-effort lifecycle hygiene, **not** cryptographic memory erasure. JavaScript runtimes can retain copies, immutable prior preview snapshots, diagnostics or old heap pages. No claim of secure zeroization, encrypted storage or saved chart functionality is made.

## Tests

`node --experimental-strip-types --test tests/natal-draft-lifecycle.test.mjs` exercises nine regression scenarios with fictional birth/place data, including mutation revisions, stale preview invalidation, ordinary clear, terminal dispose, late callbacks, unknown time and static Angular wiring. All new test fixtures remain synthetic.

Also re-run the existing PR #63 `natal-draft-state`, correction, timezone tests and full `npm test`; run Angular production build and Windows WebView2 form smoke from a combined checkout before merging. Existing draft #45 and earlier UI #62 touch overlapping shell files and need explicit reconciliation. Do not merge both natal forms without selecting one UX.

No astronomical calculations, network, persistence, secrets, credentials, external city catalog, private records, GitHub Actions, app deployment, public release or main merge.

## Extended stale-preview content guard (follow-up)

The UI now uses `captureNatalPreviewAnchor` and `isNatalPreviewCurrent` from a separately tested pure module. The guard validates all currently entered civil, named subject, place, coordinates and time-zone fields against the preview snapshot, in addition to checking the mutation revision and exact preview object. This closes the prototype's direct-assignment hole: a change to a publicly mutable field without calling `update()` can no longer leave a valid-looking old UTC selection.

`currentPreview` and `currentTimeResult` are the only sources of visible preview content. The template hides both the birth preview and the DST buttons whenever the anchor is stale; `chooseUtc` checks the same guard. Unknown birth time still shows an unresolved preview, never an invented UTC. Existing tests that asserted the old revision-only guard are updated.

Local synthetic validation: ten new actual-data tests plus seven existing lifecycle tests passed on Node v22.16.0 (**17/17**), with standalone TypeScript 5.8.3 strict compilation of the state and freshness helper. No Angular template compiler or real Windows GUI retest was run for this additional change. The comparison is an in-memory safety check, not a security boundary against malicious JavaScript or a scientific guarantee for the unverified tzdb.
