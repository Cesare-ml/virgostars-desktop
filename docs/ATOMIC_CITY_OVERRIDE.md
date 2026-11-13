# Atomic preparation of the optional offline city pack

**Status:** small, local-only packaging improvement. The licensed 1,951,599-city database is not in the source tree and must not be checked in, distributed or attached to public CI.

## Behavior

`scripts/places/prepare_tauri_bundle.py` continues to validate the generated SQLite pack against its manifest (schema, claimed row count, byte size and SHA-256) and read-only SQLite metadata before generating `.local/places/tauri-places.conf.json`.

It now additionally:

- Reads at most 16,385 bytes when parsing the city manifest and rejects anything beyond the approved 16 KiB archive-import limit. Strict UTF-8 JSON parsing rejects duplicate object keys and non-object values; required numeric metadata must be actual JSON integers, never booleans. Both v1 and v2 catalog checks remain in place.
- Rejects symbolic links at `.local`, `.local/places`, the SQLite catalog, its manifest and the target override file before proceeding. This is a guard against accidentally packaging linked local resources, not a comprehensive defense against an attacker changing files concurrently.
- Closes the temporary read-only SQLite connection explicitly instead of relying on garbage collection. This matters on Windows, where open database handles can interfere with later file operations.
- Writes the small canonical JSON to an exclusive, sibling temporary file, flushes and syncs it, and replaces the previous override using `os.replace`. If preparation fails before replacement, the previous valid override remains intact. Any leftover temporary file is removed.
- Preserves the same `bundle.active` flag, exactly two Tauri resource mappings, manifest requirements and command-line usage. The regular synthetic desktop build still needs no private city pack.

The atomic rename prevents partial configuration writes on a shared filesystem, but is **not** a guarantee of crash-proof persistence, protection against malicious local races or immutability of the data between preparation and Tauri packaging.

## Synthetic verification

From the repository root:

```powershell
py -3 -W error::ResourceWarning -m unittest discover -s tests -p test_prepare_tauri_bundle.py -v
npm.cmd run verify:places-override
```

The first command constructs a **synthetic v1/v2 metadata fixture** in a temporary SQLite database. It covers standard output, regeneration, bad checksums, oversized or duplicate-key manifests, boolean numeric fields, invalid UTF-8/non-object JSON, v2 country count typing, linked catalog/manifest and linked override, and simulated failed replacement. Symlink cases may be skipped on Windows hosts where the test account cannot create links. The second command requires a real locally prepared override and will fail without one; it is **not** run by the synthetic test.

**Latest verification (2026-11-13):** Python 3.13.5/Linux `python3 -W error::ResourceWarning -m unittest discover -s tests -p test_prepare_tauri_bundle.py -v` passed **11/11 tests**, zero failures/skips, with ResourceWarnings treated as errors. The **exact locally executed** source/test files match committed Git blob SHAs: script `d3ab25ad9114d0bd13dd3490f78ea9aa70374111`, tests `8191accac31efda909508533db632ab88713cb47`. `python3 -m py_compile` passed for both source files. No Windows build, authorized full-city pack smoke, Tauri resource packaging or WebView2 end-to-end check was performed.

No GitHub Actions, production data, account, sync, astronomy, unsigned installer, deployment, release or repository visibility change is involved.
