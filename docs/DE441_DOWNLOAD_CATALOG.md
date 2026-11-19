# DE441 release catalog trust boundary

Status: **isolated Rust candidate; not exposed to the app**.
The catalog parser authenticates exact catalog bytes against a SHA-256 digest
supplied by the trusted application, then checks its schema, ordered adjacent
half-open JD TDB intervals against the canonical Rust calendar, required
1000–2200 base, identifiers, filenames, sizes and SHA-256 syntax. It constructs
GitHub asset URLs from fixed repository, validated release tag and filename.
The remote document cannot supply an arbitrary URL or local path.

The digest must be embedded in an independently authenticated application
release. A digest fetched with the catalog is not a trust anchor. No production
digest or catalog is configured here; changing the catalog requires a
separately authenticated app update. The parser does not itself verify a
download, enforce redirects, prevent rollback, inspect free disk space,
install files or verify the publisher's redistribution rights.

Synthetic local unit tests cover a pinned catalog, altered bytes, unsafe
filenames/tags, altered boundaries, missing base and malformed hashes.
No external data or network access is required. A secure transfer manager,
serialization, recovery and integration with the Rust multipack calculation
engine remain necessary before any UI claims the packs can be installed or used.

The isolated HTTP transport accepts only catalog-derived GitHub release URLs;
HTTPS redirects are restricted to GitHub and its release-asset host. It checks
Range responses, retries transient failures and interrupted transfers, reports
progress through a callback and checks a cancellation flag. Local loopback
tests exercise interruption, resume, HTTP 503 and a server ignoring Range.
An additional ignored local test resumed and verified the real 111,662,384-byte
base. A second ignored test used the full locally generated 145-pack catalog
and a loopback server to download and activate the five packs from 800–999
back to 0–199 in order; it rejected removal of an interior pack and removed
the earliest pack. The catalog pin used by that test is a fixture, not a
production trust anchor. No remote release is contacted by the tests.

An isolated staging primitive saves bounded chunks, reopens a partial file,
enforces offsets and size, and hashes the complete file. A separate candidate
activation checks SHA-256, length and classic-DE441 coverage of the base,
all installed packs and the candidate; the Rust pack manager permits only
the next contiguous edge. A hard link creates the final name atomically
without replacing an existing file. A leftover staging link after a crash
is harmless only when the host re-verifies the installed file.

Cooperating download, activation and removal operations acquire a
cross-process OS file lock; the lock is released when the process exits.
Before a download the host checks available space for remaining bytes plus
an 8 MiB margin, while write errors remain possible if free space changes.
The explicit removal primitive checks the verified inventory and rejects the
base and non-edge packages. The application must unload any open reader
before removal. These functions assume an app-owned directory and do not
defend against a non-cooperating local actor changing paths during checks.
They are not exposed through IPC. Catalog pin provisioning, reader lifecycle,
update and end-to-end recovery remain open.

The new direct `fs2` 0.4.3 dependency provides cross-platform free-space
inspection (MIT/Apache-2.0). The existing transitive `rustls` 0.23.46 is
also declared directly to initialize its ring provider for the downloader.
Both remain subject to the normal release dependency and notice audit.

The existing explicit historical-chart path returned a chart for years
1000 and 2200 with the local base and selected ΔT input, including the
Espenak–Meeus option. This is a local test, not verification of historical
time accuracy or of a complete installed-app UI flow. The ordinary UTC
chart path has its own narrower policy.
