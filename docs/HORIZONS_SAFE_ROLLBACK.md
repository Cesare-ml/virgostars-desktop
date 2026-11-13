# D-13 — Conservative rollback of a failed Horizons acquisition

**Status:** Local Node.js 22 unit tests passed. This is a manual acquisition safety improvement, **not** astronomy, source authentication, or a Windows-tested production feature.

## Why

An earlier version of the opt-in Horizons downloader performed `rm(outputDirectory, {recursive:true,force:true})` on every handled failure after creating the directory. If a different process placed important files there during the acquisition, this could erase those files despite the original exclusive `mkdir` guard.

## Changed behavior

The downloader now imports `rollback-horizons-directory.mjs`. Immediately after the exclusive directory creation it records its **device/inode identity**. It tracks each successfully saved response file and the manifest after exclusive creation: filename, device, inode, file size, modification time and change time.

On handled failure, cleanup checks the original directory identity and **every directory entry** before deleting anything. If all entries are exactly the run-owned and unchanged files, it unlinks those files by name and removes the now-empty directory with `rmdir`. It does **not** recursively remove any directory. If it sees a foreign file, symlink, different inode, changed file metadata, unexpected filename, replaced folder, incomplete ownership list or other unexpected condition, it returns without deleting the ambiguous directory.

**Intentional trade-off:** partial directories can remain after errors. Inspect them locally before manual deletion. Never reuse an existing output directory for a new acquisition. A hard crash between exclusive file creation and recording its identity may also leave a partial directory rather than risk deleting data not positively identified as owned.

### Remaining limits

Directory and inode checks use separate filesystem calls. They reduce accidental data loss but **cannot eliminate hostile concurrent replace-and-restore races** or guarantee atomic file ownership. Use a trusted private local folder for the explicit manual acquisition. A stronger cross-platform design could use a platform-specific native directory file-descriptor / openat sandbox after security review. This code does not expand network privileges or change the strict JPL query allowlist.

## Checks actually completed

Node.js v22.16.0:

```text
node --check scripts/ephemeris/rollback-horizons-directory.mjs
node --test tests/rollback-horizons-directory.test.mjs
# 14 passed, 0 failed
```

The 14 **executed local unit tests** use real temporary local files, including newly created directories, owned files, unexpected files, changed metadata, replaced inodes, symlinks, switched directories, path traversal, duplicate or missing entries. The executed file Git blob IDs were checked against GitHub readback:
- `scripts/ephemeris/rollback-horizons-directory.mjs`: `e53c399242a195ef2a66b7f3172dfcd19ab4901f`
- `tests/rollback-horizons-directory.test.mjs`: `9c77f3b6df86224d1a0db4e6002824d67c7bce1f`

Two additional real-acquisition mock-transport regressions have been added to the existing `tests/acquire-horizons-vectors.test.mjs`. They verify preservation of an untracked file and an in-place modified response on a failed second request. **These two full-acquisition tests were not run in the isolated local mirror.** Re-run the full Node suite from an up-to-date checkout before making the change merge-ready.

**Not executed:** real Horizons networking, end-to-end current-repo Node suite, Rust/Cargo, Angular, Windows Tauri/WebView2 or a DE441 scientific comparison. No merge, release, GitHub Actions, publication, user records or production change.

## D-16 — Ownership is recorded from the original file handle

The acquisition now writes response bytes and the JSON manifest via `writeOwnedFileOnce`, using exclusive, no-follow file creation and an opened descriptor, then captures device/inode, size, mtime and ctime **from that same descriptor** before closing it. A fresh path/directory lookup must still match those objects before the file is added to the run-owned cleanup list. This removes the earlier gap in which ownership was first recorded by reopening a filename after a separate `writeFile` call. Changed names, swapped folders, symlinks, preexisting destinations and inconsistent descriptor/path metadata cause an error; ambiguous partial files are intentionally retained.

The operation is still **not an atomic cross-process transaction**; hostile replacement after identity checks and before unlink remains possible. It is a defense against accidental data loss, not an OS sandbox.

Node.js 22.16.0: 9 new actual-filesystem descriptor-ownership tests + 14 existing rollback tests pass; all locally available isolated tests total **51/51 PASS** (including the other 28 header/runner checks). The complete Horizons acquisition + bundle suite remains **unexecuted** in this isolated runtime. The full gate now requires **84 tests** instead of 75 (new suite of 9), and remains fail-closed when modules are missing.
