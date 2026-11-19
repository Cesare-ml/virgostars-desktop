// VirgoStars Desktop original source, CPAL-1.0. See LICENSE and NOTICE.
// Modification 2026-11-19: explicit offline DE441 base coverage contract.
// This validates packaging metadata only; it does not calculate astronomy.

export const DESKTOP_BASE_FIRST_YEAR = 1000;
export const DESKTOP_BASE_LAST_YEAR = 2200;
export const DESKTOP_BASE_PROFILE_SCHEMA = 'virgostars.desktop.de441-base.v2';

const safeYear = value => {
  if (!/^-?\d{1,6}$/.test(String(value))) return null;
  const year = Number(value);
  return Number.isSafeInteger(year) && year >= -20_000 && year <= 20_000 ? year : null;
};

/**
 * A privately staged classic DE441 slice must cover every year in the
 * non-removable 1000–2200 base. Larger local slices remain possible for
 * experimental builds, but a stale 1890–2110 bundle cannot masquerade as
 * the new default. The actual coefficient ranges are verified by the
 * existing slice/export preflight, not by this metadata helper.
 */
export function desktopBaseProfile(firstYear, lastYear) {
  const first = safeYear(firstYear);
  const last = safeYear(lastYear);
  if (first === null || last === null ||
      first > DESKTOP_BASE_FIRST_YEAR || last < DESKTOP_BASE_LAST_YEAR ||
      first >= last) {
    throw new Error('Desktop DE441 must include the entire 1000–2200 base');
  }
  return Object.freeze({
    schema: DESKTOP_BASE_PROFILE_SCHEMA,
    stagedFirstYear: first,
    stagedLastYearInclusive: last,
    requiredFirstYear: DESKTOP_BASE_FIRST_YEAR,
    requiredLastYearInclusive: DESKTOP_BASE_LAST_YEAR,
    timeScale: 'JD_TDB',
    calendar: 'proleptic-gregorian-astronomical',
  });
}

export function hasDesktopBaseProfile(profile) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return false;
  try {
    const expected = desktopBaseProfile(profile.stagedFirstYear, profile.stagedLastYearInclusive);
    return Object.keys(expected).length === Object.keys(profile).length &&
      Object.entries(expected).every(([key, value]) => profile[key] === value);
  } catch {
    return false;
  }
}
