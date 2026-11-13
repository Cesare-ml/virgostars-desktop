# Offline preflight for external classic JPL DE441 kernels

**Status: locally tested operator-side integrity tool; not a native ephemeris integration, license approval, or astronomical accuracy certification.**

## Why this exists

The upstream experimental virgostars-ephemeris-core Rust API on dev/ephemeris exposes first_sky::calculate and De441::open for a **classic little-endian DE441 binary**, not SPK .bsp. A genuine external file is approximately 2.8 GB, must not be copied into this repository, and remains separately licensed. Production astronomy is not enabled in Desktop.

scripts/ephemeris/verify-classic-de441.mjs adds a **read-only, offline** preflight for a locally obtained file before any future controlled native activation. It has no HTTP, GitHub, account, backend or Tauri dependencies.

## Manual command (Node.js 22+)

Obtain **independently trusted**, reviewed byte size and SHA-256 for the **specific** classic DE441 distribution. Do not create an expected checksum by hashing the same untrusted file being checked: that would not establish trusted provenance.

```powershell
node scripts/ephemeris/verify-classic-de441.mjs --file 'D:\Ephemeris\linux_p1550p2650.441' --bytes <reviewed-size> --sha256 <reviewed-lowercase-64-hex-digest>
```

Replace the example path and placeholders with your own documented distribution-specific values. The CLI never prints the input path and does not write, copy, stage or upload the file.

### Enforcement

- Requires a regular file (not symlink or directory), checked by pre-open lstat and opened-handle identity.
- Requires an exact expected byte size and lower-case SHA-256. The complete file is SHA-256 hashed in 1 MiB chunks (bounded working buffer, no full-file RAM load).
- Checks classic DE441 ASCII title and the little-endian ephemeris ID 441 at the upstream reader's documented header offset 2840. It rejects a mismatched .bsp/SPK file rather than silently treating it as classic DE441.
- Checks file metadata again after hashing and fails closed on detected changes. A caller must still protect against later on-disk substitution: revalidate the **same opened handle** when the native provider eventually opens it.
- Errors are concise and omit local path, secrets and OS exception details.

## Tests actually executed

```powershell
node --test tests/verify-classic-de441.test.mjs
```

**Node.js 22.16.0: 11/11 PASS** against tiny fictional, non-astronomical files, including a >1 MiB streamed fixture, wrong hash, byte edits, swapped endianness, missing/truncated file, symlink and malformed inputs. The executed script and test Git blob hashes were verified against repository readback after pushing.

## What this does NOT prove

A syntactically plausible header and matching operator-supplied hash do **not** validate the astronomical coefficient records, scientific accuracy, physical corrections, time scales, planetary-center definitions, kernel usage permissions or original publisher authenticity. The test data are deliberately fabricated. No real DE441 was read here; no Rust/Cargo, Windows Tauri/WebView2, native IPC, installer or chart was run. This tool does not integrate or distribute the external file and must not change ephemerisReady from false.

## Follow-on gate

Once a trustworthy kernel and its rights are reviewed, the native Rust integration must use the same opened validated file handle with De441::new, version-lock the upstream crate and its CPAL obligations, check full coverage and independent JPL Horizons parity, maintain a bounded worker and explicit statuses, and retain the draft #51 fail-closed UI quarantine until that work passes review. No automatic fallback to approximation is allowed.

No GitHub Actions, production change, network fetch, release, main merge or publication is part of this change.
