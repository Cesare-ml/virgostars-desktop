# Local full build — approved artwork, city catalog, local calculation

Status: **Prototype**, for the maintainer's own machine. Not a release, not an installer.

`npm run build:local` builds the desktop executable with everything switched on so that nothing is missing in daily use:

- the owner's **approved private artwork** (`build:ui:private`, hash-checked against `approved-assets.json`);
- the **offline city catalog** from `.local/places` (resources declared in the ignored `.local/places/tauri-places.conf.json`);
- the **Swiss Ephemeris provider** (`--features swiss-ephemeris`), so charts are calculated and can be saved.

It does **not** download anything: it fails closed if the staged private assets or the city pack are absent. Fetch or restage them first with the existing scripts (`places:fetch:windows`, `prepare_tauri_bundle.py`, `prepare:frontend:private`) as described in [Asset pipeline](ASSET_PIPELINE.md) and [Local city packaging](LOCAL_CITY_PACKAGING.md).

```powershell
npm run build:local
```

The result is `src-tauri/target/release/virgostars-desktop-spike.exe`, without a bundle or signature.

## Limits that stay in force

- **Never distribute this executable.** The artwork, the city catalog and Swiss Ephemeris (AGPL-3.0 or commercial; no professional licence is held) are all local-use only. See [Swiss Ephemeris provider](SWISS_EPHEMERIS_PROVIDER.md) and [Licensing and publication](LICENSING_AND_PUBLICATION.md).
- The default `npm run build:ui` / `npm run tauri:build` stay synthetic, so the public-source build still works with no private material.
- The chart archive is an unencrypted SQLite file ([Chart archive](CHART_ARCHIVE.md)).
- Charts shown without a calculated chart are the demonstration wheel and keep their label.
