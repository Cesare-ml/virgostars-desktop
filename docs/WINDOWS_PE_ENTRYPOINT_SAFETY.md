# Windows PE file-backed entry-point guard

Status: **prototype / synthetic structural validation**, 2026-11-13.

The read-only Windows x64 PE verifier previously accepted an RVA inside an
executable section's mapped extent even if the corresponding bytes existed only
as virtual zero-fill or as raw-file alignment padding. Such a header can claim
an executable entry point without the entry instruction being backed by actual
file bytes. This is a false positive in the preflight, **not** evidence of a
working executable.

## Contract

For a PE section carrying `IMAGE_SCN_MEM_EXECUTE`, the entry-point RVA must:

1. Fall at or after the section's `VirtualAddress`.
2. Be strictly within the section's `SizeOfRawData` (file-backed extent).
3. Be strictly within `VirtualSize` when it is nonzero (exclude raw padding).
4. Continue to meet the existing file size, image size, PE32+ AMD64, GUI
   subsystem and entry-point structure checks.

A zero `VirtualSize` uses `SizeOfRawData` as the meaningful bound. This is
deliberately conservative for the experimental Rust/Tauri Windows binary.
Nothing here validates actual instructions, section alignment, all possible
Windows loader behaviors, signatures, dependencies, trust or execution.

## Review and validation

From a full repository checkout:

```powershell
node --test tests/pe-entrypoint-bounds.test.mjs
npm test
node scripts/verify-windows-pe.mjs
npm run doctor:verify
```

The last two commands require a locally compiled Windows x64 executable. Run
the existing Windows build and WebView2 smoke gates separately. Check the
generated PE's sections and real entry RVA before accepting this extra guard.

The synthetic tests construct a tiny, entirely invented PE-shaped byte buffer;
they do not distribute a third-party binary, inspect real birth data, read
secrets or access a production service. No update/release signing or
installer is provided. No Github Actions or automatic merge are involved.
