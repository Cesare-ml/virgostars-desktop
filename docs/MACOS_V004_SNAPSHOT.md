# Mac v0.0.4 snapshot — isolated from main

- Source baseline: official published tag `v0.0.4` at commit `cbaf7d02f1c4c4dd2f92404a4aa1a3fb6e722629`.
- Source tree at the tag still declares `0.0.2` in six version fields, and predates Mac build tooling.
- This temporary branch starts from that exact commit, then changes **only** Mac build helpers/workflow, tests, documentation and metadata versions to `0.0.4`.
- Original `v0.0.4` Git tag and Windows Release are **not modified**. This snapshot commit is a Mac-port candidate, **not bit-for-bit identical to the tagged source**.
- The workflow is test-only; unsigned/ad-hoc; synthetic graphical assets; base public DE441 (1000–2200) and city catalog, without all optional data.
- No deployment, no release publication, no Apple secrets; use only the artefacts from the build run to validate the Mac port.
- This snapshot includes a scoped, one-time **push trigger** authorized for the initial run. The default `main` workflow remains manual-only.
