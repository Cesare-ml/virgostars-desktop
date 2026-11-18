# Local chart archive (SQLite)

**Status: Prototype / locally tested (2026-11-15).** Not a released feature. It keeps saved charts on one device; it is not the encrypted, account-aware store described in [Security and privacy](SECURITY_AND_PRIVACY.md) and [Offline auth and sync](OFFLINE_AUTH_AND_SYNC.md).

## What it stores

One row per saved chart, holding only what the user entered: a client-generated UUID, name, UTC instant, IANA time zone, latitude and longitude in micro-degrees, place label, and creation/update times. Calculated positions are never stored; a chart is recalculated when opened, so the archive does not depend on the ephemeris provider in use.

File: `charts-v2.vsarchive` (encrypted; see [Encrypted archive](ENCRYPTED_ARCHIVE.md)) in the application's local data folder (on Windows, under `%LOCALAPPDATA%\it.virgostars.desktop.rendererlab\`). The WebView cannot choose or learn the path.

## Encrypted at rest

Since 2026-11-17 the archive is a single file encrypted and authenticated as a whole, with a random key kept by the operating system's credential store ([Encrypted archive](ENCRYPTED_ARCHIVE.md)). The first prototype's plain file (`charts-v1.sqlite3`) is migrated once and then kept until the user deletes it from the archive panel. Encryption protects the file at rest only; there is no recovery key, so a lost credential means a lost archive. The design has not had a separate security review.

The local archive can now assign ordered group names to saved charts and search
them by group. Groups are stored inside the same sealed file; they are local
only and are not yet synchronized. There are no account profiles, notes or
outbox. Deleting a chart removes its group assignments; it does not securely
erase disk blocks.

## Command

`chart_archive::chart_archive` takes one `request` object: `protocolVersion`,
`operation` (`list`, `save`, `delete`, `set_groups`, `remove_legacy`), and
the operation's fields. `set_groups` takes a chart id and the complete ordered
group-name array. Unknown fields, duplicate/empty/unsafe names, more than 50
names and names longer than 160 characters are rejected before disk access.
Every successful operation returns the whole archive, ordered by name.

| Status | Meaning |
| --- | --- |
| `ok` | Operation done; `charts` holds the current archive. |
| `invalid_request` | Failed validation. Nothing on disk was touched, not even created. |
| `not_found` | Delete of an id that is not in the archive. |
| `archive_full` | 5000 charts stored; existing charts can still be updated. |
| `archive_corrupt` | The file is not a healthy SQLite database. It is left exactly as it is. |
| `archive_newer` | Written by a newer schema version. Not opened, not modified. |
| `archive_unavailable` | Folder or file cannot be opened (permissions, lock, disk). |

Rules enforced on both sides: lowercase UUID id; name up to 80 characters and place up to 160, trimmed, without control or invisible direction characters; strict UTC instant (same parser as `calculate_chart`); IANA-shaped zone; coordinates in range. All values are bound as SQL parameters.

Saving the same id again updates the row in place, keeps its creation time and
preserves groups. Group replacement is transactional; deleting a chart also
removes its assignments. Schema changes are tracked with `PRAGMA user_version`
(currently 2). Version 1 encrypted databases are upgraded in memory, leaving
the old ciphertext untouched until the next successful atomic write. Older
application versions cannot open a version 2 archive. There is no automatic
repair, deletion or downgrade.

## Interface

- The sidebar **Archivio** button opens the archive as its own panel over the chart: charts open in this session (with a Save button for unsaved ones and the partner choice for synastry), the saved charts with a search box, **Open** (recalculates) and delete with an explicit confirmation step. It is separate from the new-chart panel.
- The sidebar **Nuovo tema** button opens the new-chart panel. Its checkbox **Save the chart in the local archive** is on by default: the typed inputs are written to the archive first, so a chart is kept even if the calculation then fails or no provider is built in. Untick it to keep a chart in memory only.
- The chart toolbar shows **Save chart** for an active chart that is not yet in the archive.
- The archive is encrypted; the panel says so. If the old plain file is still on disk, the panel warns and offers to delete it after a confirmation. A locked archive (key missing or different, file altered) is reported as such and never shown as empty.

## Verification on 2026-11-15 (Windows 11)

- Rust: 10 archive tests (create, persist across connections, update, delete, invalid input before any disk access, SQL-looking text stored literally, damaged file untouched, newer schema refused, full archive, wire format).
- Node: 8 contract tests; IPC allowlist reports 4 commands and 4 adapters.
- Native release build, driven through WebView2's local DevTools port: a fictional chart was created from the offline city picker, saved, still listed after closing and restarting the application, reopened and recalculated, then deleted after confirmation; the archive ended empty.
- **Not done:** behaviour with the file locked by another process, a very large archive, concurrent application instances, and a manual click-through by a person.
