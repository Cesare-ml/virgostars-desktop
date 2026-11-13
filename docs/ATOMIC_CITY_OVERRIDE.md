# Atomic preparation of the optional offline city pack

**Status:** small, local-only packaging improvement. The licensed 1,951,599-city database is not in the source tree and must not be checked in, distributed or attached to public CI.

## Behavior

`scripts/places/prepare_tauri_bundle.py` continues to validate the generated SQLite pack against its manifest (schema, claimed row count, byte size and SHA-256) and read-only SQLite metadata before generating `.local/places/tauri-places.conf.json`.

It now additionally:

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

The first command constructs a **two-row synthetic metadata fixture** in a temporary SQLite database. It covers standard output, regeneration, invalid manifest, linked catalog/manifest, linked override and simulated failed replacement. Symlink cases may be skipped on Windows hosts where the test account cannot create links. The second command requires a real locally prepared override and will fail without one; it is **not** run by the synthetic test.

Locally executed on Python 3.13.5/Linux, the six new test methods passed, with ResourceWarnings treated as errors. The exact Git blob SHAs of the executed Python files match the committed branch. No Windows build, authorized full-city pack smoke, Tauri resource packaging or WebView2 end-to-end check was performed.

No GitHub Actions, production data, account, sync, astronomy, unsigned installer, deployment, release or repository visibility change is involved.
