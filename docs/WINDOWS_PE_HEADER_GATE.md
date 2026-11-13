# Windows PE x64 header preflight (prototype, 2026-11-13)

## Purpose and scope

The Windows 11 x64 development launchers now run
`node scripts/verify-windows-pe.mjs` **after** the Tauri build and the existing
`doctor:verify` stage. This read-only check is independent of the
experimental astronomy engine, the Angular renderer and the offline city database.
It checks the *fixed* build output at
`src-tauri/target/release/virgostars-desktop-spike.exe`. The CLI does not accept
caller-supplied paths, credentials, birth data, or remote endpoints.

A preflight pass requires:

- A readable regular file, not a symlink, that has unchanged best-effort metadata
  across inspection.
- MZ and PE signatures; a bounded PE offset and section count; present optional
  header and section table; executable and non-DLL COFF characteristics.
- The **AMD64** machine identifier (0x8664), **PE32+** optional-header format and
  **Windows GUI** subsystem (2), matching the present Tauri x64 release target.
- A plausible declared `SizeOfHeaders` and `SizeOfImage`, an entrypoint inside
  a mapped executable section, and raw-section byte ranges that fit the actual
  on-disk file size. A valid-looking PE header with truncated sections fails closed.
  Section metadata is inspected in the initial bounded header read; executable
  section contents are **not** loaded or cryptographically verified.
- No two sections may overlap in their mapped image extents or in their nonempty
  raw file ranges. Adjacent non-overlapping sections are allowed. This prevents
  a malformed section table from passing merely because each range is in bounds.

The inspection reads at most **8 KiB**, performs no writes and sends no telemetry.
Expected failures use fixed `WINDOWS_PE_...` status strings; local file paths
and system errors are not printed by the CLI. Unexpected or missing files cause
the launcher to stop rather than claiming a valid x64 build.

## Verification

Synthetic regression coverage lives in `tests/windows-pe-header.test.mjs`.
Run on any supported Node.js developer machine:

```powershell
node --test tests/windows-pe-header.test.mjs
node --check scripts/verify-windows-pe.mjs
```

On a **complete native Windows 11 x64 build checkout**, run:

```powershell
npm.cmd test
.\scripts\build-windows.cmd
node scripts/verify-windows-pe.mjs
```

The normal batch launcher and PowerShell launcher both invoke the PE gate
automatically after successful compilation. It is not a release or installer
step. The baseline repository keeps `bundle.active=false`.

## Security and acceptance limits

This is a **structural file-layout sanity check only**, not an integrity hash,
Authenticode signature check, trusted publisher verification, antimalware
scan, code review, Rust/Angular correctness proof or executable runtime smoke.
An attacker can forge a syntactically valid PE header. Best-effort file identity
checks do not eliminate replace-and-restore races. Linux/macOS synthetic fixture
passes do not establish that a real Tauri executable compiles or launches under
Windows/WebView2. The tool intentionally does not inspect private user data,
production services, cloud accounts or signing keys.

Still required before any beta: run full Node/Cargo/Angular checks on a complete
checkout; compile the real Windows x64 executable; run it **offline** with WebView2;
test chart layout, CSS, renderer, IPC and PNG export; review licensing and
dependencies; and separately validate signature, signing and distribution.
