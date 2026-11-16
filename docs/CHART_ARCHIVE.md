# Local chart archive (SQLite)

**Status: Prototype / locally tested (2026-11-15).** Not a released feature. It keeps saved charts on one device; it is not the encrypted, account-aware store described in [Security and privacy](SECURITY_AND_PRIVACY.md) and [Offline auth and sync](OFFLINE_AUTH_AND_SYNC.md).

## What it stores

One row per saved chart, holding only what the user entered: a client-generated UUID, name, UTC instant, IANA time zone, latitude and longitude in micro-degrees, place label, and creation/update times. Calculated positions are never stored; a chart is recalculated when opened, so the archive does not depend on the ephemeris provider in use.

File: `charts-v1.sqlite3` in the application's local data folder (on Windows, under `%LOCALAPPDATA%\it.virgostars.desktop.rendererlab\`). The WebView cannot choose or learn the path.

## Not encrypted — open gate

The file is **plain SQLite**. Anyone who can read the Windows account's files can read the saved birth data. The interface says so next to the archive. Before any beta this must be replaced or wrapped by the encrypted design required by `SECURITY_AND_PRIVACY.md` rule 3 (SQLCipher or envelope encryption with OS key wrapping), together with a migration from this file. Do not describe the archive as protected storage.

There are no accounts, profiles, groups, notes, outbox or synchronisation yet. Deleting a chart removes the row; it does not securely erase disk blocks.

## Command

`chart_archive::chart_archive` takes one `request` object: `protocolVersion`, `operation` (`list`, `save`, `delete`), and either `chart` (save) or `id` (delete). Unknown fields are rejected. Every successful operation returns the whole archive, ordered by name.

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

Saving the same id again updates the row in place and keeps its creation time, so a repeated save is harmless. Each save runs in one immediate transaction. Schema changes are tracked with `PRAGMA user_version` (currently 1); there is no automatic repair, deletion or downgrade.

## TypeScript request boundary

Before IPC, the TypeScript adapter copies the seven chart fields from own,
enumerable data properties only. It rejects inherited required fields and
accessor-backed required fields without invoking getters; unrelated UI metadata
is ignored and never forwarded. A malformed object or a throwing Proxy trap is
reduced to `invalid_request`. The native Rust command independently validates
its versioned request and remains the authority for persistence.

## Interface

- **Tema** tab: "Save the active chart to the archive", the list of saved charts (click to open and recalculate), and delete with an explicit confirmation step.
- The sidebar **Archivio** button opens that panel.
- Charts are never saved automatically.

## Verification on 2026-11-15 (Windows 11)

- Rust: 10 archive tests (create, persist across connections, update, delete, invalid input before any disk access, SQL-looking text stored literally, damaged file untouched, newer schema refused, full archive, wire format).
- Node: 8 contract tests; IPC allowlist reports 4 commands and 4 adapters.
- Native release build, driven through WebView2's local DevTools port: a fictional chart was created from the offline city picker, saved, still listed after closing and restarting the application, reopened and recalculated, then deleted after confirmation; the archive ended empty.
- **Not done:** behaviour with the file locked by another process, a very large archive, concurrent application instances, and a manual click-through by a person.
