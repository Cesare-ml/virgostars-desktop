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
for each `base...branch` comparison, with NUL-delimited `--name-status` records
(Unicode, spaces and newlines are preserved), explicit rename detection
(`--find-renames=50%`) and a strict ref-name allowlist. It includes **both
original and destination paths** for detected renames or copies, so a
rename-vs-edit of the original name is surfaced. Per-branch `changedFiles`
counts **paths reviewed**, which can count a rename twice. External diff
helpers and text conversions are disabled. Reports contain reviewed-path
counts, shared paths and the relevant branches. It supports 2–100 refs
and bounds Git diff output to 2 MiB per branch; errors fail closed rather
than returning an incomplete report.

## Branch freshness (read-only)

The same command also runs `git rev-list --left-right --count base...branch`
for each local branch. The JSON output includes `behindBy` (commits found
only in the base), `aheadBy` (commits found only in the branch),
`freshnessChecked` and `staleBranches`. The plain-text report shows the
numbers and warns when any branch is behind. Invalid, partial, negative or
out-of-range Git counters **stop the report** instead of marking a branch
fresh. Counters come from the locally available refs; the command does not
fetch from GitHub, so run `git fetch` manually if you need current remote
information. Neither a zero behind count nor a clean file-overlap report
proves that a PR is safe to merge.

## Important limitations

- Shared files **may merge cleanly**. Different files **may still conflict
  semantically**. A shared path is a review signal, **not** a confirmed
  textual conflict or merge authorization.
- Rename similarity is heuristic: when Git does not detect a rename,
  its deletion and addition still surface as separate paths, but their identity
  relationship remains unknown. Copies that Git does not classify as copies
  likewise cannot be inferred. Missing refs and unrelated histories return
  an error.
- Local ahead/behind counts do **not** guarantee that local refs match remote
  GitHub state. This tool does not check runtime compatibility, licensing,
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

Tests cover safe ref handling, NUL/Unicode `--name-status` parsing,
malformed/truncated change records, and temporary synthetic Git repositories
with diverging edits and rename-vs-original-edit overlap. The integration
tests verify that HEAD, the current branch and the working tree remain
untouched. Focused Node.js 22.16.0 / Git 2.47.3 check on 2026-11-14:
**4/4 passing test cases**; the complete Desktop checkout, Angular build and
Windows WebView2 acceptance are still required before integration.

A follow-up adds strict parsing of `rev-list` counts and a fifth synthetic
scenario: both branches diverge from `main`, which advances independently.
For local verification run the focused Node test command above; do not infer
production readiness from these fixture checks.
