# Local chart archive (SQLite)

**Status: Prototype.** The pre-existing encrypted chart archive was tested on Windows 11 in November 2026; the new portrait/editor extension is TypeScript-tested but still needs a native Windows acceptance run and security review. Account-aware synchronization from [Offline auth and sync](OFFLINE_AUTH_AND_SYNC.md) is not implemented yet.

## What it stores

One row per saved chart, holding only what the user entered: a client-generated UUID, name, UTC instant and IANA time zone for a modern chart or explicit historical clock settings, latitude and longitude in micro-degrees, place label, and creation/update times. Calculated positions are never stored; a chart is recalculated when opened, so the archive does not depend on the ephemeris provider in use.

File: `charts-v2.vsarchive` (encrypted; see [Encrypted archive](ENCRYPTED_ARCHIVE.md)) in the application's local data folder (on Windows, under `%LOCALAPPDATA%\it.virgostars.desktop.rendererlab\`). The WebView cannot choose or learn the path.

## Encrypted at rest

Optional portrait attachments are separate from the chart records: photos and paths never enter the chart DTO or future sync payload. See [Private chart photos](PRIVATE_CHART_PHOTOS.md) for encrypted offline-only storage, UI controls, limits and manual validation.

Since 2026-11-17 the archive is a single file encrypted and authenticated as a whole, with a random key kept by the operating system's credential store ([Encrypted archive](ENCRYPTED_ARCHIVE.md)). The first prototype's plain file (`charts-v1.sqlite3`) is migrated once and then kept until the user deletes it from the archive panel. Encryption protects the file at rest only; there is no recovery key, so a lost credential means a lost archive. The design has not had a separate security review.

There are no accounts, profiles, groups, notes, outbox or synchronisation yet. Deleting a chart removes its row and attempts to remove its optional encrypted portrait; it does not securely erase disk blocks.

## Command

`chart_archive::chart_archive` takes one `request` object: `protocolVersion`, `operation` (`list`, `save`, `delete`, `remove_legacy`, `photo_save`, `photo_read`, `photo_delete`), and a validated `chart`, `id`, or bounded JPEG bytes. Unknown fields are rejected. Every successful operation returns the whole archive, ordered by name, plus local photo presence IDs. Image bytes appear **only** in the response to an explicit `photo_read`, never in `list`.

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

The encrypted SQLite payload uses schema version 2 with an optional historical
input column. Version-1 payloads are upgraded **in memory** after authentication;
reading alone does not rewrite the encrypted file. The first successful write
seals the upgraded data using the existing staged, atomic archive path. Older
Desktop versions reject the newer schema rather than overwrite it, so retain a
backup before downgrading. The legacy plain-v1 import remains read-only and its
source file is not removed by migration. No historical data or archive key is
sent to the server.

Saving the same id again updates the row in place and keeps its creation time, so a repeated save is harmless. Each save runs in one immediate transaction. Schema changes are tracked with `PRAGMA user_version` (currently 2); there is no automatic repair, deletion or downgrade.

## Interface

- The sidebar **Archivio** button opens the archive as its own panel over the chart: charts open in this session (with a Save button for unsaved ones and the partner choice for synastry), the saved charts with a search box, **Open** (recalculates) and delete with an explicit confirmation step. It is separate from the new-chart panel.
- The sidebar **Nuovo tema** button opens the new-chart panel. Its checkbox **Save the chart in the local archive** is on by default: the typed inputs are written to the archive first, so a chart is kept even if the calculation then fails or no provider is built in. Untick it to keep a chart in memory only.
- The chart toolbar shows **Save chart** for an active chart that is not yet in the archive.
- The archive is encrypted; the panel says so. If the old plain file is still on disk, the panel warns and offers to delete it after a confirmation. A locked archive (key missing or different, file altered) is reported as such and never shown as empty.
- Saved charts appear as searchable cards with **Open**, **Edit details**, **Add/Change photo**, **Remove photo** and confirmed delete. The editor reuses the birth form and preserves the same archive ID, and the next opening recalculates rather than reusing an out-of-date session chart.
- Portraits default to **hidden**. The show/hide choice is a device-only preference, and hiding clears decrypted image object URLs from the WebView. The old long technical explanation has been removed from the archive panel.

## Verification on 2026-11-15 (Windows 11)

- Rust: 10 archive tests (create, persist across connections, update, delete, invalid input before any disk access, SQL-looking text stored literally, damaged file untouched, newer schema refused, full archive, wire format).
- Node: 8 contract tests; IPC allowlist reports 4 commands and 4 adapters.
- Native release build, driven through WebView2's local DevTools port: a fictional chart was created from the offline city picker, saved, still listed after closing and restarting the application, reopened and recalculated, then deleted after confirmation; the archive ended empty.
- **Not done:** behaviour with the file locked by another process, a very large archive, concurrent application instances, and a manual click-through by a person.
