# DE441 release catalog trust boundary

Status: **isolated Rust candidate; not exposed to the app and not a downloader**.
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
atomic activation, recovery and integration with the Rust multipack engine
remain necessary before any UI claims the packs can be installed or used.
