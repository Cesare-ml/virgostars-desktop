# Contributing (design-stage)

This repository is currently **private** and not yet published under an open-source license. Contributions must be specifically authorized by the maintainer; future public contribution terms are still to be decided.

## For newcomers and AI-assisted contributors
You should be able to work on a synthetic local demo **without** having access to the original VirgoStars production source, private credentials, paid APIs or real user data. If your AI assistant helps develop new UI/screens, ask it to read `AGENTS.md`, the ADR, the architecture and the current roadmap first. Contributors should never be asked to provide production secrets.

## Planned local developer experience
Once the first code milestone is delivered, provide:
- A Windows PowerShell preflight/bootstrap script that detects missing prerequisites rather than blindly installing packages.
- Pinned Node LTS and Rust toolchain with reproducible installs and lockfiles.
- A small `npm run dev` command and `npm test` plus `npm run check`; explain the command outputs in plain English.
- Synthetic charts and mock local/cloud services for offline demo/testing.
- Separate instructions for user installer vs contributor compilation; normal end users should not need Node or Rust installed.

Tauri's Windows developer prerequisites include Microsoft C++ Build Tools, WebView2, Rust and Node package manager tooling (see official documentation). These requirements are **for building**, not necessarily for running the release installer.

## Workflow
Read `AGENTS.md`; inspect open PR/issue and upstream contracts, work in a small branch, add tests/docs, open draft PR and report what ran and what did not. Do not enable GitHub Actions or merge/release/deploy without maintainer authorization.

## Future Python interoperability
Do not recode astronomy in Python. Future Python tools may use upstream PyO3/maturin bindings from the Rust core and/or import/export versioned calculation/chart JSON datasets. Desktop scripting must be sandboxed/reviewed rather than allowing arbitrary code through privileged application IPC.

## Upstream status
The public/private VirgoStars libraries are developing independently. Their current README/AGENTS remain authoritative for their own functionality. Do not assume code, manifests, rights or published packages already exist.
