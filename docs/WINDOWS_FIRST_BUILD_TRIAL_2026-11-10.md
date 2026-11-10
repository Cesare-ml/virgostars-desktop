# Windows first build trial — 2026-11-10

**Source:** maintainer-provided terminal output from a private Windows 11 x64 development checkout. Paths here are relative and no account, user name, secret or birth record is reproduced.

## Observed, not inferred

- `node scripts/desktop-doctor.mjs`: **11 PASS / 4 WARN / 0 BLOCK**. Node, npm, Cargo, MSVC, WebView2 and sibling Charts package were detected. Warnings concerned built Charts artifacts (before the build), Desktop dependencies and absent npm/Cargo lockfiles.
- `scripts/build-windows.cmd` passed its initial doctor preflight.
- `astrological-charts` `npm ci` completed; `npm run build:library` completed successfully and produced the `grafici-astrologici` package.
- Desktop `npm install` completed.
- Desktop `npm test`: **53 passed, 2 failed, 55 total**. Both failures were in `tests/desktop-doctor.test.mjs`. The batch file then exited as designed; **no Angular/Tauri desktop build or Windows executable was produced by this attempt**.
- The npm installer reported **22 dependency audit findings** in Charts (21 moderate, 1 high) and **44 in Desktop** (2 low, 26 moderate, 14 high, 2 critical). These findings are **not yet investigated or classified by runtime exposure**; do not publish a release until a targeted dependency audit and remediation review.

## Reproduced root cause and patch

The simulated filesystem fixture in the doctor tests used hard-coded `/` path concatenation. The doctor's implementation uses `node:path.join`, which produces Windows-style path separators on Windows. Therefore the mocked filesystem failed to resolve its own expected `package.json`, `angular.json`, output and CLI fixture paths. Tests that expected a simulated pass returned `blocked`. Tests expecting failure could pass for the wrong reason.

The patch replaces those fixture path expressions with `node:path.join`, as the doctor already does. It also adds an explicit simulated Windows test for the `ng.cmd` Angular CLI path. **This is a test correction; it does not disable doctor checks, weaken real prerequisites, change the native build or bypass failed tests.** Changes are applied to both the doctor PR #10 branch and the current desktop shell PR #13 branch so the maintainer can update their existing checkout.

## Required retest (pending)

From the current `fix/render-lifecycle-generation-001` branch checkout, after confirming no unsaved work:

```powershell
cd D:\GitHub\virgostars-desktop
git status --short
git pull --ff-only
npm.cmd test
.\scripts\build-windows.cmd
```

The fixed suite should have **56 tests**, but this is a prediction and not a passed result until the Windows command has been run. Report the complete first new failing step, especially Angular compilation and native Rust/Tauri errors.

Do **not** run `npm audit fix --force` blindly; it can introduce breaking dependency updates. Plan a separate audit to identify actionable packages, dev-only vulnerabilities and safe version upgrades.

The repository remains private, the license remains undecided, and no GitHub Actions, merge, deployment or publishing is authorized by this report.
