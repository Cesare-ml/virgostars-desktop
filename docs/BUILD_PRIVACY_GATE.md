# Desktop browser packaging privacy gate

Status: **Locally tested on Node.js 22 with synthetic filesystem fixtures; Windows/Tauri runtime unverified.**

The existing bundle verifier checks Angular entrypoints, CSP-compatible CSS and approved artwork checksums. This independent inspection blocks accidental inclusion of development files, credentials, local database snapshots and other unreviewed files in the WebView output. It runs for *both* synthetic and separately approved private-artwork builds.

Run `npm run verify:privacy` to inspect only the generated `dist/desktop/browser` directory. `npm run verify:bundle` and `npm run verify:bundle:private` run this gate after the existing manifest verifier. Their corresponding `build:ui` scripts therefore stop before Tauri packaging if either check fails. No network access, original artwork, real birth records or account credentials are required.

## Exact file allowlist

The browser bundle currently permits **only**:

- Root `index.html`, and root-level Angular `.js`, `.mjs`, `.css` files with simple filename characters (such as `main-ABC123.js` or `styles-ABC123.css`).
- Root `3rdpartylicenses.txt`, `LICENSE.txt`, and `NOTICE.txt` attribution files.
- Approved-style images under `assets/img/` with `.png`, `.jpg`, `.jpeg`, or `.webp` extensions. The *separate* bundle manifest verifier must also confirm every image's exact filename, byte length and SHA-256.

Everything else is rejected, including arbitrary `.json`, `.csv`, compressed backups, additional HTML/JS directories, arbitrary `.txt` files, `media/` fonts, unknown images and unexpected root files. **This is deliberately restrictive.** If a future Angular build needs WASM, local fonts, a favicon, or another type of file, the developer must explicitly review the provenance and extend this allowlist with tests; the gate must not be disabled simply to make the build succeed.

The gate also rejects source maps or embedded source-map directives, dotfiles, keys, credentials, raw TypeScript, SQLite databases, logs, symlinks, special files and case-insensitive output path collisions. It bounds individual file size (64 MiB), total browser payload (256 MiB), entries (12,000), files (10,000) and directory nesting (32 levels), so unexpected output fails before packaging.

Only the expected directory structure (`assets/`, `assets/img/` and safe nested image directories) is accepted; unexpected empty directories are rejected too. Every directory and file name must be portable to Windows: reserved device names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`–`COM9`, `LPT1`–`LPT9`, including extension forms), trailing dot/space and Windows-invalid characters are blocked. Linux/macOS synthetic tests create otherwise invalid Windows names to verify the guard; such fixture-creation tests are explicitly skipped when running on Windows itself.

## Manual validation

Run from the repository on Node.js 22 or 24:

~~~sh
node --test tests/verify-build-privacy.test.mjs tests/verify-build-privacy-allowlist.test.mjs tests/verify-build-privacy-windows-paths.test.mjs
node --check scripts/verify-build-privacy.mjs
npm run verify:privacy
npm run build:ui
# Only if an authorized private-artwork pack is staged:
npm run build:ui:private
~~~

The 60 locally executed synthetic regression cases cover accepted build layouts, rejected file types, unexpected directories, Windows-invalid names, and redacted errors. The script emits aggregate counts or fixed error reasons without printing filenames or personal paths.

## Remaining limits

This is a *build packaging guard*, **not** a general secret scanner, proof that compiled JavaScript has no embedded credentials, static analysis, WebView2 runtime test, or legal/artwork provenance audit. It does not inspect native Rust resources, installers, signing keys outside the browser output or data already inside binary files. It cannot prevent deliberate filesystem races between listing and reading. Additional rights, dependency, scientific, native IPC, Windows GPU/CSP and release gates remain mandatory.

No production backend, login, sync, user records, scientific algorithms, license, repository visibility, automated workflow, deployment or release is changed by this feature.
