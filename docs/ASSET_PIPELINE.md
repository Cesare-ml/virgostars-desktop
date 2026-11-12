# Offline synthetic asset pipeline — Gate 1 hardening

**Status:** Implemented and verified with Node.js 22.16.0 synthetic fixtures on Linux. Actual Angular/Tauri Windows build still unverified (2026-11-10). This is not production asset delivery.

## Why this change

The first Tauri experiment used an entire upstream `astrological-charts` **demo build** merely to stage images. VirgoStars Desktop now owns its Angular workspace and imports the separately built chart **library**, so compiling and packaging the demo JS/HTML is unnecessary and potentially misleading.

The `prepare:frontend` command remains for backwards compatibility, but it now stages **only generated checkerboard images** from an explicitly marked local synthetic pack. No upstream demo HTML, JS, CSS, original VirgoStars artwork or server URLs are copied. It does not copy the private asset repository or load any production data.

## Build sequence

Place the two authorized private repositories side-by-side on the development computer. Use Node.js 22 LTS (and Rust MSVC / Windows build prerequisites for Tauri).

In `astrological-charts`:

```powershell
npm ci
npm run build:library
npm run demo:pack     # only once when .local/demo-pack is absent
```

In `virgostars-desktop`:

```powershell
npm install
npm test
npm run build:ui
npm run tauri:build
```

Or use the existing `powershell -NoProfile -File .\scripts\build-windows-spike.ps1` from the Desktop repository root. **No `build:demo` step is needed.**

- `npm run prepare:frontend`: manifest + SHA-256 check and stage to ignored `.local/frontend/assets`.
- `npm run build:ui`: prepare/reuse verified stage, build the desktop-owned Angular application, verify resulting `dist/desktop/browser` bundle.
- `npm run verify:bundle`: read `.local/frontend/synthetic-assets-manifest.json` and validate exact emitted image paths and hashes, an Angular desktop root, and absence of external script/style tags and historical demo bootstrap.
- `npm run tauri:build`: first build and verify Angular, then build the Tauri executable. `bundle.active=false` still means **no installer** is produced.
- `npm start`: verifies/stages assets before starting the local Angular development server. Offline release builds should not require a development server.

## Fail-closed behavior

- Only manifest `source.repository=synthetic-local-fixtures`, `source.commit=none`, `source.assetRoot=public/assets`; rightsHolder and synthetic permissionBasis must match generator output.
- Only image paths under `img/`, recognized formats and bounded file sizes/count/total size; no traversal, backslashes, symlinks or case-insensitive duplicates.
- Revalidates every image against its declared SHA-256 before writing any output.
- Creates the staging directory atomically using a temporary sibling directory, renaming on success; never silently deletes existing data.
- Re-running with the same verified stage is safe. A changed, contaminated or legacy staging folder fails and requires manual inspection/removal of **only** the ignored `.local/frontend` folder, never the private source repo.
- Angular output verification rejects any extra image (including accidental private art), missing image, tampered image, wrong frontend root, remote script/style or stale demo bootstrap. It does **not** prove complete absence of all runtime network connections; a WebView2 offline/network test remains required.

## Validation record

Local Node.js 22.16.0, 2026-11-10:
- 11 staging tests: approved-only content, idempotent reuse, staged tamper, unauthorized manifest/rights, modified source SHA, invalid paths, symlinks, spaces, case-collision, legacy files, incorrect declared size.
- 5 bundle tests: exact synthetic files, modified image, extra image, wrong frontend/external script, old demo bootstrap.
- 2 existing icon-format tests.
- **18/18 passed in the isolated local scripts/tests workspace.** New branch changes must still be tested after a clean checkout and upstream dependency install; no actual Angular npm or Tauri Rust build was run.

## Follow-up gates

1. Validate the current `astrological-charts` synthetic generator's full manifest and all 452 generated files against this preparer on a clean Windows checkout.
2. Build Angular 20 and Tauri 2 on Windows 11 x64; verify all chart modes and both themes with WebView2, PNG export, resizing and GPU context loss.
3. Verify no HTTP(S) requests while the packaged test app runs without Internet, including default asset resolution.
4. Review and commit lockfiles after an actual installation. Do not invent or handcraft npm/Cargo locks.
5. When approved for real public builds, define a **separate**, explicitly licensed manifest pipeline for original artworks; never repurpose the synthetic-only path without rights review.

## Security limits

Synthetic provenance fields are build-time safeguards, not cryptographic proof of artistic ownership. A developer with write access to both the manifest and its generator could forge them; public release requires separate signed/provenance-reviewed assets. These tests do not validate accounts, encryption, cloud sync or astronomical correctness. The repo is still private with license undecided, and no GitHub Actions, merges, releases or production changes were made here.

## Immagini originali approvate per build private

La modalità `private-artwork` utilizza il repository privato fratello `astrological-assets`, senza richiedere il repository di produzione. Serve un checkout accessibile ai collaboratori autorizzati. `npm run build:ui:private` verifica il manifest approvato fissato tramite SHA-256, la corrispondenza con `catalog/approvals.json`, tutti gli hash e le dimensioni, e prepara una copia in `.local/frontend-private`. Il bundle è verificato separatamente con `npm run verify:bundle:private`; asset extra, manomissioni, link simbolici e manifest diversi causano un errore. Il renderer continua a caricare `/assets/` in locale.

La modalità sintetica resta il default di `npm run build:ui` e la sua cartella `.local/frontend` non viene sovrascritta. Per generare una build privata con catalogo città, su Windows e dopo l’autenticazione GitHub CLI usare `npm run tauri:build:places:private:windows`. Per il solo prototipo senza il catalogo città usare `npm run tauri:build:private`. Il pacchetto privato contiene esclusivamente le immagini autorizzate; i font non sono inclusi. Il manifest fissato è quello del checkout `astrological-assets` corrente; aggiornamenti deliberati richiedono revisione e aggiornamento del relativo hash.

I file originali, il bundle compilato e i pacchetti restano locali e fuori da Git. L’autorizzazione esistente riguarda la collaborazione privata; non implica diritti di ridistribuzione pubblica. Le carte mostrate dalla demo usano ancora posizioni sintetiche e non costituiscono calcoli astronomici.
