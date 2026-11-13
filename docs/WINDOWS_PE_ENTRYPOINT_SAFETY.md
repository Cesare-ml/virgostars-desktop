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

The synthetic tests construct a tiny, entirely invented PE-shaped byte buffer.
The on-disk regression also writes that fictional header to a temporary file,
checks acceptance at the last meaningful executable byte, and checks rejection
on the first padding byte. The test removes its temporary directory after use.
It does not distribute a third-party binary, inspect real birth data, read
secrets or access a production service.

## Related draft PR

This integration candidate is **stacked on draft PR #145**, which already
rejects overlapping mapped/raw sections and virtual header aliasing.
It adds PR #152's stricter `VirtualSize`/raw-byte entrypoint rule while
preserving PR #145's section-overlap checks.

**Integration in this branch is source-level only.** Both existing PE test
files must run together and the branch must be reviewed before either PR
is merged. No runtime PE, Windows loader or Tauri binary is validated here. No update/release signing or
installer is provided. No Github Actions or automatic merge are involved.

## Newer #145 alignment rules (2026-11-13)

This integration branch starts from #145 commit `2c6a9d9a5e064ff13fb8f8f501c011cbe1e66906`,
which also checks the declared PE section/file alignment fields and aligned
section offsets, sizes and image dimensions. The synthetic entrypoint test
fixture now sets conventional MSVC-style alignments (`0x1000` and `0x200`).
The extra entrypoint rule remains conservative: it does not relax any newer
section-overlap or alignment rules.

## Test evidence for the aligned integration candidate

Executed with **Node.js v22.16.0** on Linux in an isolated, synthetic-only
local mirror containing the **exact Git blobs** from this integration branch:

- Integrated PE inspector: `840837a30ca905378527a9b360042b8a35f5c525`
- Entrypoint bounds helper: `b72ce2f149e8cf7f268f9918e24d6e5e112693e2`
- Entrypoint regression tests: `08940ac7b3642a168bc4d03d1629c60cc6f8bd61`

`node --check` passed for inspector and regression tests.
`node --test tests/pe-entrypoint-bounds.test.mjs`: **9/9 PASS**,
0 failed, 0 skipped. The checks include reading a temporary fictional
PE executable with permitted and rejected entry RVA values.

The complete `tests/windows-pe-header.test.mjs` from the newer #145 branch
was **not run** in the local mirror; it remains mandatory, alongside
`npm test`, native Windows x64/MSVC Tauri build, bundled executable
inspection and real offline WebView2 GUI smoke. A synthetic PE header
is not a launchable or signed Windows application.

## Cross-PR regression gate (2026-11-14)

A dedicated `tests/windows-pe-integrated-boundaries.test.mjs` now covers the
combined behavior of both pending PRs in **one two-section fictional PE**:

1. Aligned, disjoint PE sections and entrypoint on the last meaningful byte;
2. Rejection of an entrypoint in raw padding after nonzero `VirtualSize`;
3. Rejection of overlapping virtual **and** raw section ranges;
4. Rejection of unaligned `PointerToRawData`.

This prevents a future conflict resolution from silently retaining only one
PR's validation. Node's normal `npm test` glob will discover the new
`.test.mjs` automatically; no GitHub Actions or scripts are introduced.

**Executed in an isolated V8 harness**, using GitHub-fetched source code
for `inspectWindowsPeHeader` and `isFileBackedPeEntryPoint` with simple
synthetic byte/assert adapters (no Node filesystem or CLI):
- `tests/windows-pe-header.test.mjs`: 7 parser-only test bodies passed;
- `tests/pe-entrypoint-bounds.test.mjs`: 8 parser/helper-only bodies passed;
- `tests/windows-pe-integrated-boundaries.test.mjs`: 4 bodies passed;
- **19/19 V8 parser test bodies passed**, no failing cases.

Source blob SHAs at this checkpoint:
- Integrated parser: `840837a30ca905378527a9b360042b8a35f5c525`
- Helper: `b72ce2f149e8cf7f268f9918e24d6e5e112693e2`
- Existing PE baseline tests: `287c1061cf080698d9436a073b8391804dd5db6d`
- Existing entrypoint tests: `08940ac7b3642a168bc4d03d1629c60cc6f8bd61`
- New cross-PR test: `dcc69859b10d0a3dac2c45a4741e3efd98561d42`

This isolated V8 result **does not** imply the full Node test runner passed:
filesystem, symlink, launcher subprocess, and on-disk regression bodies
were not executed in this combined pass. The older, separately documented
9/9 Node entrypoint run remains scoped to its earlier isolated mirror.

Required full-checkout command before merge:

```powershell
node --test tests/windows-pe-header.test.mjs tests/pe-entrypoint-bounds.test.mjs tests/windows-pe-integrated-boundaries.test.mjs
npm test
```

Native Windows x64/Tauri build, WebView2 offline smoke and signature/release
acceptance remain separate outstanding tasks.
