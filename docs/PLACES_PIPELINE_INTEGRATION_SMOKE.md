# Offline cities: synthetic import → Tauri override integration smoke

**Status (2026-11-14): locally tested in isolated mirror; Windows native acceptance pending.**

This integration branch consolidates two independently developed *draft* changes:
- **PR #196:** strict bounded UTF-8 and duplicate-key manifest validation, schema/type/hash checks on import and reuse; reject linked installer destinations and data files.
- **PR #201:** generated Tauri override must live under regular `.local/places` directories; reject linked parent directories, wrong layout, altered JSON, and leaking local paths in filesystem errors.

Neither PR is a signed installer, a production account integration, a native end-to-end packaging test, or permission to publish the protected city catalog. Branch is based on `main`, leaving both original drafts for coordination/review.

## New integration regression

`tests/test_places_archive_override_integration.py` creates a tiny fictional SQLite database with the two `catalog_meta` rows needed by the native resource preparer and a synthetic `country_lookup` table. It then:

1. Creates a two-entry ZIP and bounded v2 manifest, computes test-only SHA-256 digests, and installs it using the real `install_archive` importer.
2. Exercises verified reuse of already installed local data.
3. Runs the unchanged `prepare_tauri_bundle.prepare(root, expected=3)` to emit the same generated Tauri override shape used in the Windows city build (without bundling anything).
4. Invokes the actual Node `verifyPlacesTauriOverride(path)` on the generated file.
5. Mutates the override and confirms Node rejects it, and corrupts the SQLite file to verify the Python preparer refuses to replace a previously valid override.

There are **no personal birth charts, real city rows, login tokens, external requests, repository downloads, or private release files** in these fixtures. `expected=3` is an explicit synthetic-test parameter; the production pack remains pinned to **1,951,599** rows separately.

## Reproduction

From an authorized Desktop checkout with Python 3 and Node.js 22.12+/24:

```powershell
py -3 -m unittest discover -s tests -p "test_places*.py" -v
node --test tests/places-override-directory-gate.test.mjs
npm test
npm run verify:places-override
```

`verify:places-override` **requires** the real, generated `.local/places/tauri-places.conf.json`; if absent it is expected to fail safely. `npm test` runs the Node-focused tests, not the Python integration tests. When Node is missing, the Python integration methods needing it mark themselves **skipped**, not passed.

### Evidence actually executed (isolated mirror, 2026-11-14)

- Python **3.13.5**, `python -m unittest discover -s tests -p 'test_places*.py' -v`: **11/11 passed, 0 skipped**, including 3 new end-to-end synthetic cases.
- Node **22.16.0**, `node --test tests/places-override-directory-gate.test.mjs`: **8/8 passed, 0 skipped**.
- `python -m py_compile` for the four Python source/test files and `node --check` for the Node verifier: **passed**.
- `git hash-object` for the six executed files matched the exact GitHub source blobs. The mirror uses a small `package.json` with the checked Windows build script strings, independently compared to the real package manifest. This is **not a full repository checkout**.

**Not executed:** complete repository `npm test`, Angular + sibling Charts build, `cargo test --locked`, Windows native Tauri build, WebView2 offline GUI, protected v2 catalog access/download, installer signing/release. Those remain separate blockers.

## Merge/release coordination

Review consolidated changes once, reconcile outstanding original draft PRs #196 and #201, run the full checkout tests, confirm real pinned manifest against the authorized pack, and carry out Windows 11 x64 offline packaging smoke before any approval. No `main` merge, CI/GitHub Actions, deployment, protected dataset redistribution, source visibility or release is performed by this work.
