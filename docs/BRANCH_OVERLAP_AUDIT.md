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

## Branch versus main file conflicts (read-only candidates)

In addition to comparing feature branches with one another, the script now
inspects both sides of each branch's merge base:

- `git diff --name-status -z main...feature` finds feature-side changes.
- `git diff --name-status -z feature...main` finds `main`-side changes
  since their common ancestor. The second query is skipped only when that
  branch's `behindBy` is exactly zero.
- `baseOverlaps` lists `{branch,path}` where **both sides changed the same
  path** (including original and destination names of detected renames).
  `baseOverlapFiles` is the number of branch/path pairs, not the number of
  guaranteed textual conflicts; `baseFilesChecked` distinguishes a complete
  native read-only audit from a pure report lacking that check.

A branch may have `behindBy > 0` and `baseOverlapFiles = 0`; it still needs
integration review and tests. Two-sided file comparisons are not a substitute
for a merge, semantic review or upstream dependency validation. Neither
direction performs checkout, merge, fetch or writes to the working tree.

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
**8/8 passing test cases**, including branch-versus-main collisions, UTF-8
paths, renames and independent `main` advancement. The verified script and
test file matched their committed Git blob SHA-1 hashes exactly. This is a
focused test of this tool, **not** the entire Desktop `npm test`, Angular
build or Windows WebView2 acceptance.

Additional regressions cover strict parsing of `rev-list` counts,
incomplete base-side results, and a local synthetic Git fixture in which `main`
and only one feature branch change the same file after diverging. Run the
focused Node test command above on a complete checkout; fixture tests alone
do not certify merge safety or Windows/Desktop readiness.
