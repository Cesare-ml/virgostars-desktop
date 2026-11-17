# Local full build — approved artwork, city catalog, local calculation

Status: **Prototype**, for the maintainer's own machine. Not a release, not an installer.

`npm run build:local` builds the desktop executable with everything switched on so that nothing is missing in daily use:

- the owner's **approved private artwork** (`build:ui:private`, hash-checked against `approved-assets.json`);
- the **offline city catalog** from `.local/places` (resources declared in the ignored `.local/places/tauri-places.conf.json`);
- the **VirgoStars-Ephemeris provider** (a default feature; needs the DE441 data file at run time, see [VirgoStars-Ephemeris provider](VIRGOSTARS_EPHEMERIS_PROVIDER.md)), so charts are calculated and can be saved.

It does **not** download anything: it fails closed if the staged private assets or the city pack are absent. Fetch or restage them first with the existing scripts (`places:fetch:windows`, `prepare_tauri_bundle.py`, `prepare:frontend:private`) as described in [Asset pipeline](ASSET_PIPELINE.md) and [Local city packaging](LOCAL_CITY_PACKAGING.md).

```powershell
npm run build:local
```

The result is `src-tauri/target/release/virgostars-desktop-spike.exe`, without a bundle or signature.

## Limits that stay in force

- **Never distribute this executable.** This local build is not an installer: it has no bundle or signature, and it finds the DE441 data only through the environment or `ephemeris.json`. The installer is described in [Ephemeris data bundle](EPHEMERIS_DATA_BUNDLE.md); see also [Licensing and publication](LICENSING_AND_PUBLICATION.md).
- The default `npm run build:ui` / `npm run tauri:build` stay synthetic, so the public-source build still works with no private material.
- The chart archive is encrypted at rest with a key in the OS credential store; there is no recovery key ([Encrypted archive](ENCRYPTED_ARCHIVE.md)).
- Charts shown without a calculated chart are the demonstration wheel and keep their label.
