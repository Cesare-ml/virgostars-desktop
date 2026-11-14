# Parallel review lanes for Desktop draft branches

**Status: experimental, synthetic Git test harness.** This is a *read-only reviewer scheduling aid*, NOT a merge planner, build verification or release authorization.

VirgoStars Desktop has a large backlog of concurrent draft PRs. Once two or more local Git refs have been made available by a maintainer, the existing [branch overlap audit](BRANCH_OVERLAP_AUDIT.md) reports common file paths, base-side overlaps and revision drift. This complementary tool partitions that JSON into deterministic **review lanes**: each lane contains branches with no *reported* shared paths among them, so different reviewers can initially inspect separate file sets.

## Run locally

From an already checked-out repository, with at least two *existing* refs:

```sh
node scripts/branch-overlap-report.mjs --json --base=main feature/one feature/two feature/three | node scripts/triage-review-lanes.mjs
```

The command outputs only JSON. Each `lanes[]` entry contains:

- `branches`: local refs with no known cross-branch file overlaps *inside that lane*.
- `requiresBaseRefresh`: refs whose local merge base is behind local `main`.
- `baseOverlapBranches`: refs that modified at least one of the same paths as local `main` since divergence.

`branchCount` and `sharedPathCount` describe the input audit; `note` explicitly forbids treating the output as permission to merge. A branch in a lane can still conflict semantically with another, or with other branches from the same lane. Greedy allocation is deterministic, not guaranteed minimal; lanes are **not** a recommended merge order or a promise of independent releases.

The tool fails closed unless it receives a complete report with both `freshnessChecked` and `baseFilesChecked` set to true, consistent counters and valid branch/path memberships. Input is limited to 2 MiB of UTF-8 JSON. It never calls Git, fetches network data, checks out a ref, updates a branch, merges, modifies the working tree or inspects real user records. Upstream audit output depends on the **locally available refs**; no automatic remote freshness check is performed.

## Verify

```sh
node --test tests/triage-review-lanes.test.mjs
```

Synthetic tests exercise deterministic lane partitioning, stale/base-side warnings, incomplete or contradictory audit rejection, bounded CLI input and the two-tool pipeline over a temporary fictional Git repository without changing HEAD or the working tree. These tests do not validate any open PR, remote state, Windows WebView2, encryption, astronomic computations or a release installer.

### Before any actual integration

Manually inspect the latest GitHub PR diffs and dependencies, refresh local refs, resolve conflicts and run the relevant full suite plus native Windows GUI acceptance. Follow [AGENTS.md](../AGENTS.md): no automatic merges, production access, GitHub Actions, publishing or releases. This tool does not access the protected city catalog, cloud credentials or personal birth charts.
