# Contributing to VirgoStars Desktop

Thank you for helping build a free, independently usable desktop astrology workspace.

## Before you start

Read [AGENTS.md](../AGENTS.md), [Architecture](ARCHITECTURE.md), [Roadmap](ROADMAP.md), [License and Publication](LICENSING_AND_PUBLICATION.md) and any relevant design/contract documents. This is a prototype; don't describe planned capabilities as already implemented.

No production account, private repository, confidential dataset or paid API is required for the standard synthetic development workflow.

## Local prerequisites and setup

Use Node.js 22.12+ or 24+, npm, and the public [Astrological Charts](https://github.com/Cesare-ml/astrological-charts) source checkout built as a sibling directory. For Tauri on Windows, install the Rust MSVC toolchain, Microsoft C++ Build Tools and WebView2 as documented by Tauri. See the exact commands in the [root README](../README.md).

After building the Charts library and its synthetic demo pack:

```sh
npm ci
npm run doctor
npm test
npm run build:ui
```

Use `npm start` for Angular UI work and `npm run tauri:dev` for the native prototype. The packaged Windows application is not a production release or an installable signed update. Don't claim full native validation from unit tests alone.

## Pull requests

- Discuss a coherent improvement in an issue when appropriate; use a feature branch and a draft PR.
- Include tests and update any affected design, API, privacy or license documents.
- Use fictional birth data, generated icons and synthetic chart assets only.
- Keep astronomy calculations in the Rust provider; don't duplicate them in UI code.
- State commands run, environment, test counts, missing coverage and known blockers.
- Never commit authentication tokens, API keys, original personal birth records, unreviewed artwork, privately distributed city catalogs or external astronomical kernels.
- Do not enable GitHub Actions, perform automatic deployments, merge to main, or publish a release without explicit maintainer approval.

## Licensing and credits

By submitting work, you must have the rights to contribute it under the project's [CPAL-1.0 license](../LICENSE) and preserve existing copyright notices. Contributors retain their applicable rights in their contributions; do not add third-party code under an incompatible license. Preserve attribution information and the launch/session notice where required by CPAL Exhibit B. See [NOTICE](../NOTICE).

Responsible security disclosure: [SECURITY.md](../SECURITY.md).
