# Virgo Stars AI — Desktop inspector staging-contract slice

**Status (2026-11-11):** UI + typed transport port on a **draft feature branch** only. No real AI, user accounts, backend transport injection, provider calls, release, deployment or production activation.  
**Related private backend:** `Cesare-ml/virgo-stars` issue #158; base contract PR #159; staging mock API PR #160 (depends on #159).  
**Desktop base:** PR #22, which retains the guest-first/offline requirement and existing chart-first workspace.

## Implemented on this branch

- A fourth, accessible **AI** inspector tab, retaining the central chart's layout, light/dark tokens, IT/EN and mobile overlay behavior.
- Select **natal Venus**, **natal Sun**, **transiting Saturn** as the only synthetic back-end preview focus values. When Venus/Sun is selected from the existing local planet inspector, the preview selection follows (Saturn only in transit mode). This is a *UI selection*, not a claim that the renderer highlights the chart.
- An optional `VIRGOSTARS_COPILOT_PREVIEW_TRANSPORT` Angular InjectionToken. When absent (current state), the Ask button is disabled, guest/offline startup remains untouched and no network requests occur. **Do not add a fake login or ask users to paste JWTs.**
- A pure TypeScript `requestCopilotPreview` client that sends exactly `{action:"describe_focus",focus}` to the Virgo Stars-owned `/api/v1/ai/copilot-preview/message` contract **through an injected transport**. No provider selection or OpenAI/Anthropic SDK/keys.
- Strict response validation: only `VirgoStarsCopilotMockPreviewEnvelope@0.1.0`, `STAGING_SYNTHETIC`, `FACT_ONLY`, `providerInvoked=false`, and matching focus are accepted. The service's synthetic aspect IDs are **display-only counts** and are never applied to the real renderer.
- AbortController + request generation guard to prevent late replies from overwriting a more recent selection or a destroyed component.
- Pure contract tests with injected fake transport and UI/CSP structural tests. No remote network required.

## Architectural and security decision

The native Tauri CSP intentionally says `connect-src 'self'` and remains **unchanged**. Do **not** add vendor URLs or relax CSP to make direct WebView `fetch` calls.

**Next integration step (not in this PR):** after the Virgo Stars account's optional system-browser PKCE and secure native token store exist, introduce a narrow audited **Rust/Tauri authenticated Virgo Stars HTTP transport**. It must:
1. Restrict destination to a canonical Virgo Stars-owned HTTPS origin and the allowlisted preview API path; never accept arbitrary user-provided URLs or provider names.
2. Fetch user access tokens only from OS-protected native storage (no token string in Angular, no localStorage, no logging).
3. Implement short request deadlines, bounded response sizes and cancellation; maintain offline behavior without retry storms.
4. Respect staging-only backend enablement, real JWT authorization and quota; fail closed on 401/403/429.
5. Inject the port into Angular **only when the user has opted into an authenticated online session**. Disconnect removes the port and cancels in-flight requests.
6. Validate real backend responses and existing method/presentation/ownership gates before any real chart is shared. Do not submit raw birth info, location or notes to the prototype.

No account data or personal natal chart is sent by this PR, and there is **no live backend call** in the default application. The backend fixture itself is deliberately fictional and not ephemerides: the visible graphic fixture is also fictional and **not necessarily identical**. Neither should be represented as a physical celestial configuration.

## Files

- `src/app/copilot-preview-client.ts` — typed Virgo Stars-only request + strict staging response validation.
- `src/app/copilot-preview-token.ts` — optional DI transport boundary.
- `src/app/desktop-app.component.{ts,html,css}` — compact AI inspector, accessibility and cancel-safe UI.
- `src/app/workspace-state.ts`, `src/app/translations.ts` — fourth tab, localized labels.
- `tests/copilot-preview-client.test.mjs` — synthetic, secure-request and UI structural regression tests.

## Validation commands

```powershell
cd D:\GitHub\virgostars-desktop
npm.cmd test
npm.cmd run build:ui
npm.cmd run verify:css
```

Run those commands on the **actual branch checkout with the separately built astrological-charts package**, using the project's established offline asset preparation. Native WebView2 visual acceptance, theme contrast, zoom/Fit and offline behavior require a Windows 11 smoke run.

**No actual Node/Angular build or native execution has been claimed by this PR unless explicitly recorded in the PR checks.** GitHub code content and static review are not a substitute for a passing build.

## Follow-up
After the base branch and this PR are verified, continue with reviewed login/native transport. Then conduct JWT-gated staging-only mock HTTP tests using synthetic users, followed by the knowledge/Method Pack approval workflow. Only later enable actual OpenAI provider calls server-side; do not add billing, model selection, provider endpoints or user birth data to this Desktop preview.
