# Angular clock lifecycle and accessibility

**Prototype / source-checked only.** This is not Windows/WebView2 acceptance.

Device and selected-city clocks use the same sampled UTC instant.
Selected city and language changes update only civil-time labels,
not synthetic astronomical chart positions or native calculations.

Angular ignores late calls to `onCitySelected`, `onCityEdited` and
`toggleLanguage` after destruction. The timer callback already checks
the same flag and `ngOnDestroy` sets it before disposing the interval.

Both `<time>` elements explicitly use `aria-live="off"` to avoid
repeated screen-reader announcements every second. Their shared
`clockInstantIso` refers to the sampled device instant. Invalid
zone data never silently falls back to the device zone.

The source contract `tests/device-clock-wiring.test.mjs` now checks
the actual Angular callback rather than a stale source spelling.
It also checks late-event guards and clock accessibility.

Full-checkout commands (with the sibling public Charts library built):

```sh
node --experimental-strip-types --test tests/device-clock-wiring.test.mjs
node --experimental-strip-types --test tests/device-clock.test.mjs tests/selected-city-clock.test.mjs
npm test
npm run build:ui
```

Still required: Windows WebView2 visual/assistive technology QA,
timer updates after sleep, locale switching, city edits and teardown.
No private city catalog, user records, astronomy, account, network,
privileged IPC, dependency, license, GitHub Actions or release changes.
