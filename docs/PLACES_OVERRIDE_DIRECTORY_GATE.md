# Offline city Tauri override — directory safety check

**Status: prototype static source/build gate, not a signed release or verified native installation.**

The optional Windows city-pack build uses a generated, ignored Tauri configuration file at `.local/places/tauri-places.conf.json`. The existing Node verifier already compares its entire canonical JSON (allowing Windows CRLF) to the two approved local resources. Exact JSON content alone does not prove that the file is inside a regular local resource directory: a linked `.local` or `places` directory could redirect the read outside the checkout.

## New fail-closed boundary

Before parsing any override content, `verifyPlacesTauriOverride` now:

1. Requires the exact three trailing path components `.local/places/tauri-places.conf.json`.
2. Uses `lstatSync` on both `.local` and `places`; neither may be a symlink or a non-directory.
3. Retains the existing regular-file/no-file-symlink, max-4096-byte and exact-resource-only JSON checks.
4. Returns fixed, non-path-bearing error messages on missing or unreadable parent/file entries.

This guard is already invoked by `npm run verify:places-override` before each of the two city-aware Tauri packaging scripts. No changes to the generated config shape, source catalog importer, permissions, Tauri version or browser bundle are needed.

## Synthetic regression checks

Run from the Desktop checkout with Node 22.12+/24:

```sh
node --test tests/places-override-directory-gate.test.mjs
npm test
npm run verify:places-override
```

The dedicated tests use only tiny JSON files in temporary folders. They check valid LF/CRLF, tampered or duplicate-key configurations, wrong location, symlinked JSON, linked `.local`/`places` directories, missing directories with redacted errors, and that both Windows city builds still call the verifier. Symlink tests may be skipped when Windows privileges or host filesystem policy prohibit creating links.

**Limitations:** This is a read-only, pre-build path-layout check, **not** a proof against time-of-check/time-of-use races, linked higher ancestors/junctions, a compromise of an authorized developer machine, the validity of the private SQLite catalog, Windows native resource loading, or signed installer authenticity. `prepare_tauri_bundle.py` must still validate the actual database and manifest. The protected city dataset must not be copied into the repository or made publicly redistributable.

A real Windows 11/WebView2 build and offline smoke test remain separate acceptance requirements. No GitHub Actions, production service, personal data, release, license or `main` merge are part of this increment.
