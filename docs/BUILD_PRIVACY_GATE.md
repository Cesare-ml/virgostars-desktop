# Desktop browser packaging privacy gate

Status: **Locally tested with synthetic filesystem fixtures; Windows/Tauri runtime unverified.**

The existing bundle verifier checks Angular entrypoints, CSP-compatible CSS and approved artwork checksums. This independent inspection targets accidental shipping of development files, local database snapshots or credential-like artifacts in the Tauri WebView output.

Run `npm run verify:privacy` to inspect only the generated `dist/desktop/browser` directory. Both `npm run verify:bundle` and `npm run verify:bundle:private` run this check after the current asset verifier. Consequently, the ordinary synthetic and separately approved private-artwork UI builds stop before Tauri packaging if the browser output fails either gate. No network access, original artworks, user records or account credentials are needed for this check.

## Rejected artifacts

- `*.map`, emitted JavaScript/CSS with a source-map directive, and raw `*.ts`, `*.tsx`, `*.mts` or `*.cts` files.
- `.env*`, dotfiles and dot-directories, common credentials/secrets/token files, private key/certificate formats, local SQLite/DB files, logs and backups.
- Symbolic links, special files, unsafe or absent `index.html`, output paths colliding under Unicode-NFC/case-insensitive comparison, more than 10,000 output files, and JavaScript/CSS larger than 64 MiB per file.

Normal local HTML, hashed JavaScript and CSS, font files, approved images and third-party license text are accepted. The existing exact manifest check remains responsible for determining which image assets are authorized.

## Manual validation

```sh
node --test tests/verify-build-privacy.test.mjs
npm run verify:privacy
npm run build:ui
# Only when an approved private-artwork configuration is available:
npm run build:ui:private
```

The unit tests generate entirely fictional files. The script emits aggregate counts or fixed error reasons without printing paths or file contents.

## Limitations

This is a *denylist packaging gate*, **not** a general secret scanner, executable-code audit, proof that the compiled JavaScript contains no secrets, or a WebView2 network test. It does not inspect Rust binaries, native resources, metadata outside `dist/desktop/browser`, installers or update signatures. It cannot prevent deliberate filesystem replacement races between listing and reading. Separate rights, source attribution, dependency, scientific correctness, Windows GPU/CSP and release checks remain mandatory.

No production backend, login, user data, scientific algorithms, licensing, repository visibility, automated workflows or releases are modified by this feature.
