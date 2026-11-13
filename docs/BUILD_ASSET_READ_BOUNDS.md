# Offline build asset read bounds

**Status: proposed, source-only review. Native Windows/WebView2 acceptance is pending.**

The existing offline bundle gate in `scripts/verify-offline-bundle.mjs` verifies the synthetic/approved-private asset manifest and the SHA-256 of every packaged image. The old verifier read entire files into memory before checking their declared length; a corrupt or unexpectedly large local file could consume excessive build-host memory even though its final hash/length check would fail.

## Implemented preflight

- The staged manifest must be a regular, non-symlink file of **1 byte to 8 MiB** before it is read or JSON-decoded.
- Both synthetic and explicitly approved-private builds must declare **1–2000** image entries.
- Every declared image size must be a safe nonnegative integer no greater than **20,000,000 bytes**, and declared sizes must total at most **200,000,000 bytes**.
- The verifier checks each emitted image's `lstat` length against its manifest value **before reading the image body**; the existing SHA-256 verification remains mandatory.
- `scripts/verify-bounded-file.mjs` now reads the bounded manifest from one descriptor and **streams image hashes in 64 KiB chunks**. It checks regular-file identity, size and modification timestamps before/after reading, refuses symlinks, and verifies the descriptor reached EOF without appended bytes. This also limits memory use when a legitimate image is close to 20 MB.
- These bounds mirror or exceed the approved staging pipelines: synthetic images allow up to 10 MB each, private images up to 20 MB, and either pack up to 200 MB in total. They do not authorize distributing private artworks or the protected city catalog.

## Tests and verification

The committed regression cases in `tests/verify-offline-bundle.test.mjs` cover oversized manifest bytes, 2001 declared image entries, oversized per-file and total declared size, and a sparse oversized output file. Existing synthetic bundle, WebView2 CSS/JS, image hash, manifest and Tauri checks remain in place.

The new isolated file-reader suite (`tests/verify-bounded-file.test.mjs`) covers binary manifests, streamed SHA-256, empty files, oversized sparse files, symbolic links, missing files and invalid budgets. **Executed locally with Node.js 22.16.0: 5/5 tests passed** using the same authored helper source and import layout as the committed files; `node --check` passed.

Run from an authorized checkout after installing the project dependencies and building the Charts sibling:

```powershell
node --test tests/verify-bounded-file.test.mjs tests/verify-offline-bundle.test.mjs
npm test
npm run build:ui
```

**The full combined bundle suite, npm test, Angular build and Windows native build have not been run here.** They are required before merging, followed by a Windows x64 native packaging smoke test.

## Boundaries

The change is offline and local: no account/login flow, personal birth data, network call, astronomical calculation, backend, migration, publication, GitHub Actions or installer release is involved. Size checks and hashes are a build-integrity guard, not a substitute for licensing review, platform-specific race-proof file opening (the identity checks reduce but cannot eliminate TOCTOU on Windows) or on-device WebView2 runtime checks.
