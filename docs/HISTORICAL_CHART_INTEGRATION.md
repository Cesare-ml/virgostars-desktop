# Historical full chart: implementation checkpoint

**Status: locally developed building block, not activated in the chart UI or an IPC command.** This checklist concerns the desktop; the main VirgoStars server and stars are outside the current scope.

## Already present

- The active desktop full-chart flow converts a local date and IANA time zone to UTC using the host time-zone database. It reports nonexistent times and requires a choice for ambiguous times. Both that resolver and the chart command currently accept calendar years 1900–2033. Historical time-zone rules depend on the host database and are not a source of established ancient local time.
- `calculate_chart` invokes the VirgoStars-Ephemeris provider. The provider returns ten planetary bodies, mean and true lunar nodes, mean and osculating apogees, and five house systems where defined; Chiron requires its own file. The renderer consumes the returned snapshot. This is local integration, not a released installer or a guarantee of accuracy.
- The separate historical planet panel accepts an explicit UT1 instant and an opt-in ΔT source, but does not create a chart or resolve local civil time.

## New internal building block

`chart_with_explicit_time` in `src-tauri/src/virgostars_provider.rs` validates explicit UT1, TT−UT1, the caller's uncertainty and its source, then calls the existing full-chart machinery with the resulting UT1/TT/TDB. The returned internal result keeps the time metadata together with the chart. The existing modern chart path is unchanged and shares the same calculation routine. This is **not** registered for IPC or wired to the UI. The normal ecliptic/equatorial frame, lunar points and house-angle code still impose modern-epoch guards, so ancient requests fail instead of silently producing a partial or extrapolated chart. Its planetary speeds are the existing modern chart speeds, not the experimental long-range candidate used by the separate planet panel.

## Remaining work before a historical chart can be offered

1. Define an input contract for calendar, location, local civil time and explicit time provenance. Handle calendar conventions and ambiguous/nonexistent local times without assuming IANA offsets describe ancient clocks. A supplied historical offset or local-mean-time policy needs a source and explicit user choice. Preserve these inputs when saving/reopening a chart.
2. Resolve UT1 and TT with an explicitly selected source and uncertainty. Espenak–Meeus 2006 is opt-in for astronomical years −1999 through 3000; the available standard-error estimate has a narrower range. Outside these ranges require another defensible source rather than silently extrapolating. Distinguish the uncertainty of the input clock and UT1 from the ΔT uncertainty. UTC table dates currently interpreted as UT1 remain an approximation.
3. Implement and validate long-term Earth orientation and sidereal/house angles consistent with the chosen ecliptic convention. `house_angles` currently calls the modern IAU 2000B path with a 1900–2100 TT guard; existing cusps cannot overcome this guard on their own. Test system availability and polar cases explicitly.
4. Implement and validate lunar points on a compatible long-term frame. The current `lunar_point` uses modern orientation routines; its present 1900–2100 behavior is not proof of ancient node or apogee accuracy. Mean and osculating definitions differ, and unavailable points must stay explicit.
5. Connect the validated full snapshot to a versioned native/UI contract, renderer, chart archive and navigation. Avoid representing UT1 as UTC in the existing v1 `utcIso` field. Select the accepted long-range planetary speed convention explicitly, and keep consistent ecliptic/equatorial frames.
6. Check real data coverage for every requested body and epoch. The installer slice is 1890–2110; the locally supplied full DE441 is separate. Chiron and historical time data have their own coverage and provenance. Test representative epochs and boundaries without treating samples as a continuous-range guarantee.

The requested target is astronomical years −12999 through 3999 (13000 BCE through 3999 CE); this checkpoint does not claim full-chart support for that interval.
