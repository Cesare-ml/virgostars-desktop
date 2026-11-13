# Windows city catalog — Tauri override verification

**Status:** locally tested security/build guard for a generated, optional offline city catalog; **not a validated installer or proof of Windows release safety** (2026-11-13).

## Threat and scope

The default synthetic Desktop host uses `src-tauri/tauri.conf.json`. The two optional city catalog Windows builds add the locally generated `.local/places/tauri-places.conf.json` via `tauri build --config`. An additional Tauri configuration can change much more than bundled resources: for example, app security capabilities, plugin settings, development origins or packaging paths. The existing `npm run verify:ipc` inspects the default tracked configuration, not an arbitrary local override passed to the Tauri CLI.

The new `npm run verify:places-override` is a **pre-build guard** that must run after `scripts/places/prepare_tauri_bundle.py` and before Tauri receives this override. It verifies the **exact** Python-generator template containing only:

- `bundle.active: true`
- `../.local/places/world-cities.sqlite` → `places/world-cities.sqlite`
- `../.local/places/world-cities.manifest.json` → `places/world-cities.manifest.json`

It rejects added or changed fields, altered resource paths, duplicate JSON keys, symlinked or non-file overrides and oversized input. Windows CRLF is accepted. The exact format (including key order and indentation) is intentional: the file is **generated**, not a public configuration editing API. A legitimate future generator-format change requires a coordinated update and fresh tests. On failure the command exits nonzero and never prints file contents, user paths, or catalog metadata.

## Build wiring

Both `npm run tauri:build:places:windows` and `npm run tauri:build:places:private:windows` now run:

```text
prepare_tauri_bundle.py -> verify:ipc -> verify:places-override -> Angular build -> Tauri --config
```

The native audit and this override gate both run **before** the final Windows packaging step. The default `tauri:build` without an optional catalog remains unaffected, as do `npm start` and browser-only synthetic previews. No changes were made to the Python generator, catalog, private source art or Tauri's actual permissions.

## Tests executed

- Node.js 22.16.0, `node --test tests/places-tauri-override.test.mjs`: **8/8 PASS**, covering approved output, Windows line endings, injected app/plugin/build options, extra file resources/absolute paths, duplicate JSON keys, malformed/noncanonical output, missing/oversized/directory inputs and symlinks.
- `node --check` on the new verifier and tests: **PASS**.
- Python 3.13.5 `json.dumps(..., indent=2)` representative generator output: **PASS** through the new CLI; an injected capability changed its exit status to failure. This confirms serialization format compatibility, but does not run the full Python catalog validation routine.
- The executed local script and test bytes were compared to committed GitHub blob hashes: `6841527c92922e209d05e28c81f88f4f3d0a46d9` and `baf0a17920341c7a98917409526a351a56da088e`.

## Limits and next validation

This audit checks **only the optional Tauri override file**, not the SQLite records, city rights, dataset provenance, integrity of the final installer, release signature, real permissions after Tauri merges configurations, or network isolation. The separate Python generator checks its own manifest checksum and database metadata; these are distinct trust boundaries. An attacker able to modify trusted source code or invoke `tauri build` manually can bypass an npm-script-only gate.

Before approving a Windows build with the private city catalog, run the complete Node tests, the actual Python generator with an authorized dataset, both pre-build audits, Angular build against Charts, Rust/Cargo tests, a native Windows/WebView2 test and inspection of effective merged Tauri permissions. Keep the experimental city database uncommitted and confirm redistribution rights separately.

No production/backend changes, real birth records, extra dependencies, GitHub Actions, automatic releases, licensing or repository-visibility changes are included.
