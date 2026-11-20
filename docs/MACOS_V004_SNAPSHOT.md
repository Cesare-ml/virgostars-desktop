# Mac v0.0.4 snapshot — isolated from main

- Source baseline: official published tag `v0.0.4` at commit `cbaf7d02f1c4c4dd2f92404a4aa1a3fb6e722629`.
- Source tree at the tag still declares `0.0.2` in six version fields, and predates Mac build tooling.
- This temporary branch starts from that exact commit, then changes **only** Mac build helpers/workflow, tests, documentation and metadata versions to `0.0.4`.
- Original `v0.0.4` Git tag and Windows Release are **not modified**. This snapshot commit is a Mac-port candidate, **not bit-for-bit identical to the tagged source**.
- The workflow is test-only; unsigned/ad-hoc; synthetic graphical assets; base public DE441 (1000–2200) and city catalog, without all optional data.
- No deployment, no release publication, no Apple secrets; use only the artefacts from the build run to validate the Mac port.
- This snapshot includes a scoped, one-time **push trigger** authorized for the initial run. The default `main` workflow remains manual-only.

## Primo tentativo e fix di portabilità

Il run 44783480637 è fallito prima di Rust/Tauri in `npm test` (13 fail ARM64 / 12 Intel). In questo aggiornamento, senza indebolire le policy CSP o di packaging:
- Il gate di sicurezza Tauri controlla un `userAgent` vincolato esattamente alla versione 0.0.4 (supportando la storica 0.0.2 per i suoi test); continua a rifiutare ogni altro attributo di finestra o cambio CSP.
- Il fixture Windows del Desktop Doctor dichiara esplicitamente x64, indipendentemente dall'architettura host Mac.
- Il test delle ore planetarie esercita il vero builder del checkout fratello pinnato, perché la root del package non lo espone ancora; la UI resta non convalidata per questo punto.
- I test di recovery Windows usano una directory temporanea fisicamente canonica quando `/var` è un alias macOS; il rifiuto dei symlink della recovery reale resta invariato.
- Il test privacy con nomi diversi solo per maiuscole viene saltato esclusivamente quando il volume del runner non può rappresentare entrambi, mantenendo invariato l'audit della build.
- Si include lo script pubblicazione già revisionato nel `main` per i contratti statici; nessuna release viene pubblicata.
