# Temporary Windows ICO directory contract

Status: **locally tested generator hardening**, Windows native acceptance pending.

## Problem and fix

The synthetic icon generator emits PNG files at 32, 64 and 128 pixels.
The exported `temporaryIconIco(png)` helper previously hardcoded **64×64**
in the ICO directory entry, even when passed a valid generator-produced
32×32 or 128×128 PNG. That can produce inconsistent icon metadata for
Windows shell scaling and packager consumers.

`scripts/generate-spike-icon.mjs` now derives the ICO directory width and
height from the embedded PNG's first `IHDR` chunk, checking:

- input is a Node Buffer between 45 bytes and 1 MiB;
- valid PNG signature, a 13-byte IHDR and terminal IEND trailer;
- square 32, 64 or 128 pixels;
- generator-supported RGBA/8-bit, zero compression/filter/interlace flags;
- a matching CRC32 on the IHDR header;
- embedded PNG length and ICO data offset remain consistent.

The generator still uses a **64×64** synthetic icon by default for
`icon.ico`, preserving existing build behavior. Explicit calls with
32×32 and 128×128 supported PNGs now have matching ICO dimensions.
Existing icon files are **not overwritten** by the build utility.

This is a *narrow format preflight*, **not a full PNG validator**:
it does not decode IDAT, verify all intermediate chunks or certify
pixel contents. It is intended only for the original temporary icon
generator, not untrusted third-party artwork or release branding.

## Verification

On **Node.js 22.16.0** in an isolated local module mirror:

```powershell
node --test tests/generate-spike-icon.test.mjs
node --check scripts/generate-spike-icon.mjs
```

Results: **4/4 tests PASS**, zero failures. Tests cover original PNG
headers and default ICO, header/payload consistency for all three
generated sizes, and malformed signature/dimensions/color/CRC/trailer/
oversize inputs. The source and test Git blob hashes of the files
actually executed match the contents committed to this PR:

- `scripts/generate-spike-icon.mjs`: `131d48206e3e29773bce03aea2666bcc64af64db`
- `tests/generate-spike-icon.test.mjs`: `ea0265ef357ea531e4295b8eaef8a0d577205075`

## Still required

From the full, authorized Windows checkout:

```powershell
npm test
npm run prepare:icon
npm run build:ui
npm run tauri:build
```

For a clean temporary-icon acceptance test use a disposable clone or
isolated output directory. **Do not delete or overwrite approved icons**
just to force regeneration. After building, inspect actual icon
rendering in the Windows file explorer, taskbar and titlebar at common
DPI scales; a PNG/ICO header test cannot confirm that WebView2 or the
Windows shell displays it correctly.

No GitHub Actions, production data, release art, licensed external
assets, account credentials, license changes, distribution, signing,
installer, visibility change or `main` merge is authorized by this PR.
