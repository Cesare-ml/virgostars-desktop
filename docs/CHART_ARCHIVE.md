# Local chart archive (SQLite)

**Status: local integration under validation.** The encrypted archive, photos, historical inputs and account-bound synchronization are present in this worktree. Production login and native end-to-end synchronization have not been verified. See [Offline auth and sync](OFFLINE_AUTH_AND_SYNC.md).

## What it stores

One row per saved chart, holding only what the user entered: a client-generated UUID, name, UTC instant and IANA time zone for a modern chart or explicit historical clock settings, latitude and longitude in micro-degrees, place label, and creation/update times. Calculated positions are never stored; a chart is recalculated when opened, so the archive does not depend on the ephemeris provider in use.

File: `charts-v2.vsarchive` (encrypted; see [Encrypted archive](ENCRYPTED_ARCHIVE.md)) in the application's local data folder (on Windows, under `%LOCALAPPDATA%\it.virgostars.desktop.rendererlab\`). The WebView cannot choose or learn the path.

## Encrypted at rest

Optional portrait attachments are separate from the chart records: photos and paths never enter the chart DTO or future sync payload. See [Private chart photos](PRIVATE_CHART_PHOTOS.md) for encrypted offline-only storage, UI controls, limits and manual validation.
Photo visibility is off by default and controlled in application settings; with
photos hidden the archive uses compact single-row entries without placeholders.

Since 2026-11-17 the archive is a single file encrypted and authenticated as a whole, with a random key kept by the operating system's credential store ([Encrypted archive](ENCRYPTED_ARCHIVE.md)). The first prototype's plain file (`charts-v1.sqlite3`) is migrated once and then kept until the user deletes it from the archive panel. Encryption protects the file at rest only; there is no recovery key, so a lost credential means a lost archive. The design has not had a separate security review.

Groups and account-bound links are stored inside the sealed file; photos remain local and are not synchronized. Notes are not imported. Deleting a chart removes its row and attempts to remove its local encrypted photo; it does not securely erase disk blocks.

## Command

The native archive command supports list, save, delete, ordered group changes, legacy removal and local photo operations. Unknown fields, invalid group names and oversized images are rejected. Image bytes are returned only for an explicit photo read.

The candidate website read model permits up to 500 groups on a chart, so an
account containing more than 50 cannot yet be imported losslessly into this
local representation. Synchronization must detect and report that condition;
it must never truncate the remote groups.

| Status | Meaning |
| --- | --- |
| `ok` | Operation done; `charts` holds the current archive. |
| `invalid_request` | Failed validation. Nothing on disk was touched, not even created. |
| `not_found` | Delete of an id that is not in the archive. |
| `archive_full` | 5000 charts stored; existing charts can still be updated. |
| `archive_corrupt` | The file is not a healthy SQLite database. It is left exactly as it is. |
| `archive_newer` | Written by a newer schema version. Not opened, not modified. |
| `archive_unavailable` | Folder or file cannot be opened (permissions, lock, disk). |
| `photo_corrupt` | Individual private photo failed authenticated decryption or JPEG validation; chart data stays available. |

Rules enforced on both sides: lowercase UUID id; name up to 80 characters and place up to 160, trimmed, without control or invisible direction characters; coordinates in range. Modern records require a strict UTC instant (same parser as `calculate_chart`) and an IANA-shaped zone. Historical records use the separate validated input described below. All values are bound as SQL parameters.

## Historical chart input (prototype)

Historical records retain the explicit calendar, local clock, offset choice,
ΔT choice, uncertainties and observer coordinates. Their UTC and timezone
fields are empty rather than invented; they are recalculated on opening using
the historical command. The application keeps modern records unchanged.

The encrypted SQLite payload uses schema version 7. The two previous v2 layouts (historical input and account groups) are distinguished by their actual columns and tables, and upgraded in memory after authentication. The first successful write atomically seals the upgraded data; reads alone leave the original ciphertext untouched. Older versions reject the new schema. Tests cover synthetic historical v2 data, groups, photos and interrupted recovery; no user's archive was used.

The encrypted database also has a candidate account-bound group sync record.
It tracks a remote base and pending local group edits together with the edit;
an older response cannot clear an edit made in the meantime. A native-only
reconciliation candidate applies a server snapshot for an already linked
chart, detects concurrent edits and preserves unresolved conflicts. It checks
the captured base before writing the encrypted archive. The guarded account UI
can display and resolve existing conflicts; both displayed versions are checked
again atomically, and selecting the local version requires group-write consent.
The guarded account interface imports website charts with independent local IDs,
refreshes their civil data and reconciles their groups. It retains missing remote
charts locally, queues offline group edits and provides explicit conflict choices.
Existing local charts are never silently matched. A guarded explicit association
compares both displayed versions, preserves the website civil record independently,
and requires conflict resolution when groups differ. Deleting the local chart
retains the imported record and its pending group state. Upload of local-only
charts is available in the guarded candidate after separate consent. The
creation request and its stable mutation ID remain encrypted until acknowledged;
an uncertain response is retried before importing a snapshot. Imported records retain an unknown birth
time as unknown; the older archive command cannot overwrite or delete those rows.

## Interface

The archive searches both local and synchronized website charts by name or
place. Website charts use compact responsive cards and are displayed in batches
of 24. Group controls are temporarily hidden; existing group data and pending
sync state remain in the archive. Local-to-website actions are grouped in an
expandable area so they do not squeeze chart details in narrow windows.

- In synastry, a compact side picker lists session and saved charts while leaving the active radix visible. Saved inputs are recalculated before selection; a calculation failure leaves the current comparison intact. The second chart can be changed or swapped with the radix. Only house systems available in both charts can be selected in synastry. An optional outer ring shows the current sky calculated at the radix location and labels its instant; switch it off and on to refresh. The aspect table still compares the two charts. Deflection controls require Vehlow and renderer capability version 1; until a compatible renderer is installed they remain disabled. The ordinary cross-aspect table is hidden while deflection is active. This is an unreleased prototype without WebView2 visual acceptance.

- The sidebar **Archivio** button opens the archive as its own panel over the chart: charts open in this session (with a Save button for unsaved ones and the partner choice for synastry), the saved charts with a search box, **Open** (recalculates) and delete with an explicit confirmation step. It is separate from the new-chart panel.
- The sidebar **Nuovo tema** button opens the new-chart panel. Its checkbox **Save the chart in the local archive** is on by default: the typed inputs are written to the archive first, so a chart is kept even if the calculation then fails or no provider is built in. Untick it to keep a chart in memory only.
- The chart toolbar shows **Save chart** for an active chart that is not yet in the archive.
- The archive is encrypted; the panel says so. If the old plain file is still on disk, the panel warns and offers to delete it after a confirmation. A locked archive (key missing or different, file altered) is reported as such and never shown as empty.
- Saved charts appear as searchable cards with **Open**, **Edit details**, **Add/Change photo**, **Remove photo** and confirmed delete. The editor reuses the birth form and preserves the same archive ID, and the next opening recalculates rather than reusing an out-of-date session chart.
- Portraits default to **hidden**. The show/hide choice is a device-only preference, and hiding clears decrypted image object URLs from the WebView. The old long technical explanation has been removed from the archive panel.

## Verification on 2026-11-15 (Windows 11)

Additional group verification on 2026-11-18: in an isolated Windows debug
application profile, a fictional chart was saved, assigned a fictional group,
and the group was still visible after closing and reopening the app. The
fictional chart was then deleted and the test archive reported empty. Rust
tests cover encrypted group persistence, migration from encrypted schema v1,
invalid requests and removal with the chart. This does not verify network
synchronization or an actual astronomical calculation: DE441 was unavailable
in that isolated build.

- Rust: 10 archive tests (create, persist across connections, update, delete, invalid input before any disk access, SQL-looking text stored literally, damaged file untouched, newer schema refused, full archive, wire format).
- Node: 8 contract tests; IPC allowlist reports 4 commands and 4 adapters.
- Native release build, driven through WebView2's local DevTools port: a fictional chart was created from the offline city picker, saved, still listed after closing and restarting the application, reopened and recalculated, then deleted after confirmation; the archive ended empty.
- **Not done:** behaviour with the file locked by another process, a very large archive, concurrent application instances, and a manual click-through by a person.
