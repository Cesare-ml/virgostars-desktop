# Private offline city archive — verified local import boundary

**Status (2026-11-14):** synthetic Python import tests; not a validated Windows installer or a permission to redistribute the protected city catalog.

## Scope

`scripts/places/fetch_catalog.py` downloads the **pinned** private release archive through the developer's own authorized GitHub CLI session, checks its SHA-256 and installs a local `.local/places` SQLite resource. The import helper can also be exercised with tiny synthetic ZIP files in tests without network access or private geographic data.

Before accepting a freshly extracted catalog **or reusing an installed copy**, the importer now requires:

- A nonempty UTF-8 JSON manifest of at most **16,384 bytes**, with no duplicate keys at any object level;
- `file` exactly `world-cities.sqlite`, `schemaVersion` exactly integer `2`, plus matching integer row count, country lookup count `244`, database byte length and pinned SHA-256. Boolean values are not valid integer substitutes;
- The same pinned database digest, exact two-entry ZIP membership and byte-count checks as before;
- No symbolic-link destination or immediate parent directory, and no symbolic-link SQLite or manifest file, including dangling links. Existing different files are not overwritten.

These checks reduce confusing reuse of corrupted manifests and local path redirection. They do **not** certify the correctness of the locations, prove filesystem race-freedom, authenticate the GitHub CLI session, check every ancestor for junctions/reparse points, provide database encryption, or grant publishing rights. The native `prepare_tauri_bundle.py` has its own separate manifest and database preflight; both stages remain necessary.

## Reproduce with synthetic inputs

From a clean, authorized Desktop source checkout:

```powershell
py -3 -m unittest discover -s tests -p test_places_fetch_catalog.py -v
py -3 -m unittest discover -s tests -p "test_places*.py" -v
```

Tests use a tiny **fictional** database byte string and local ZIPs. No production account or private catalog download is necessary. Before integrating the private Windows build, verify the real manifest schema/values against the pinned archive under authorized access, run the read-only Windows doctor, then repeat the documented native/offline/WebView2 smoke. Never commit `.local/places`, its catalog, authorization tokens or signing keys.

No production cloud routes, astronomy, user charts, CI workflows, release configuration or repository visibility are changed by this import hardening.
