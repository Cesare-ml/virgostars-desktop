# Windows acceptance: verify a real fictional CSV download

**Status:** opt-in local diagnostic. No actual Windows Tauri/WebView2 download was performed while preparing this script. This is not a release or astronomy certification.

## What it verifies

After manually downloading the CSV from the *natal* demonstration view in the running desktop app, `scripts/verify-synthetic-csv-download.mjs` compares the selected on-disk file **byte for byte** with the expected export generated from the same deterministic fictional geometry and CSV serializer that the component uses.

The expected payload is a fixed header, 10 fictional planet positions, 12 fictional house positions, `FICTIONAL_NOT_CALCULATED` on every row, decimal points, CRLF newlines and no additional bytes. A UTF-8 BOM or any subsequent edit causes a mismatch. The verifier does not support real natal records.

## Manual Windows 11/WebView2 sequence (pending)

1. Use an authorized complete checkout of this integration branch and the sibling `astrological-charts` library. Run `npm.cmd test`, `npm.cmd run build:ui`, `npm.cmd run verify:css` and the repository's Windows build gate. Do not weaken CSP or introduce remote assets.
2. Start the native Tauri prototype **without** the dev server, disconnect Internet and confirm the synthetic chart, layout, tabs, themes and read-only runtime footer are visible and styled in WebView2.
3. Select the **Natal** mode; use the fictional CSV toolbar button. Observe that the footer says only that the download was *requested*. Verify in the OS whether a new CSV file was actually saved; opening the save dialog or clicking is not sufficient evidence.
4. From the desktop checkout, validate the exact chosen local file (PowerShell; substitute the full path of the file that was actually saved):

   ```powershell
   node --experimental-strip-types .\scripts\verify-synthetic-csv-download.mjs --file 'C:\Users\<user>\Downloads\virgostars-FICTIONAL-NOT-CALCULATED.csv'
   ```

   If the browser renamed a duplicate file, specify that actual file's path instead. Do not copy a private chart or personal birth record into this diagnostic.

5. Record *locally*, without attaching real personal data, whether CSS loads, the native CSV save happened, the script returned PASS and a visually normal chart appears at standard and high-DPI resolutions. Verify PNG export separately; this tool does not inspect PNGs.

## Status and behavior

- Exit `0`: file bytes match the expected **fictional** export exactly.
- Exit `1`: missing, unreadable, symlinked, non-regular, truncated, appended or altered file.
- Exit `2`: incorrect command arguments.
- The script makes **no network calls**, installs nothing, writes no files and does not print file content, absolute paths, birth details or OS usernames. It reads only the explicitly selected local path and at most the expected number of file bytes (plus metadata checks).
- Filename equality is not required: Windows/WebView2 may append `(1)` to avoid overwriting previous downloads. **Content** is the invariant.
- The check confirms neither who initiated the download nor whether WebView2 applied the correct CSP. It does **not** prove a real ephemeris calculation or the safety of importing user records.

## Reproducible synthetic checks

```sh
node --experimental-strip-types --test tests/verify-synthetic-csv-download.test.mjs
node --check scripts/verify-synthetic-csv-download.mjs
```

The tests create temporary synthetic files, check success/failure and command exit codes, reject final symlinks and ensure diagnostics do not echo the selected path. Run the full `npm test` and native acceptance from a complete Windows checkout before considering a merge.

The verifier is separate from production accounts, Tauri IPC, storage, update signing and network synchronization. No new dependency, source license, release, repository visibility or GitHub Actions are involved.
