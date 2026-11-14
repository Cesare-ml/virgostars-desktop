# Read-only local branch overlap report

**Status: locally tested developer aid, not proof of merge safety.**

VirgoStars Desktop has many parallel draft pull requests. Before integration,
run `scripts/branch-overlap-report.mjs` on **already available local Git refs** to
identify files changed on more than one branch. The tool performs no fetch,
checkout, merge, ref update, network call or GitHub Actions execution.

## Run (Windows PowerShell, macOS or Linux)

```sh
node scripts/branch-overlap-report.mjs --base=main fix/one fix/two
node scripts/branch-overlap-report.mjs --base=main origin/fix/one origin/fix/two --json
```

Each ref must already be available locally. The script uses the Git merge base
for each `base...branch` comparison, with NUL-delimited filenames (Unicode,
spaces and newlines are preserved) and a strict ref-name allowlist. Reports
contain changed-file counts, shared paths and the relevant branches. It
supports 2–100 refs and bounds Git output to 2 MiB per branch; errors fail
closed rather than returning an incomplete report.

## Important limitations

- Shared files **may merge cleanly**. Different files **may still conflict
  semantically**. A shared path is a review signal, **not** a confirmed
  textual conflict or merge authorization.
- Renames can require extra review: `git diff --name-only` does not show both
  path names. Missing refs and unrelated histories return an error.
- This tool does not check branch freshness, runtime compatibility, licensing,
  privacy, scientific correctness, or native Windows packaging.
- Before merging, compare candidates with current `main`, reconcile overlaps,
  then run `npm test`, `npm run verify:ipc`, `npm run build:ui`, and the
  Windows/Tauri/WebView2 acceptance tests where appropriate.
- No production services, personal records, private city packs, keys,
  installation releases or deployed applications are involved.

## Synthetic regression checks

```sh
node --test tests/branch-overlap-report.test.mjs
```

Tests cover safe ref handling, NUL/Unicode path parsing and a temporary local
Git repository with diverging branches. That test verifies that HEAD, the
current branch and the working tree remain untouched.
