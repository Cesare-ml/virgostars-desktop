/**
 * Pure helpers for the solar and lunar return panel: input checks and labels.
 * No astronomy; the instants come from the native return search.
 */
export type ReturnKind = 'solar' | 'lunar';

/** The chart a return is computed from, captured when the panel opens. */
export type ReturnRadix = Readonly<{
  chartId: number;
  name: string;
  sunLongitude: number;
  moonLongitude: number;
  latMicro: number;
  lngMicro: number;
  timeZone: string;
  placeName: string;
}>;

const MIN_YEAR = 1600;
const MAX_YEAR = 2400;
const MAX_NAME_LENGTH = 80;

/** Four-digit UTC calendar year, or null. */
export function parseReturnYear(raw: string): number | null {
  const text = String(raw ?? '').trim();
  if (!/^\d{4}$/.test(text)) return null;
  const year = Number(text);
  return year >= MIN_YEAR && year <= MAX_YEAR ? year : null;
}

/**
 * `RS 2026 Name` for a solar return, `RL 2026-03-14 Name` for a lunar one.
 * The date is the UTC date of the return, so the label does not depend on a zone.
 */
export function returnChartName(kind: ReturnKind, utcIso: string, radixName: string): string {
  const prefix = kind === 'solar' ? 'RS ' + utcIso.slice(0, 4) : 'RL ' + utcIso.slice(0, 10);
  return (prefix + ' ' + radixName.trim()).trim().slice(0, MAX_NAME_LENGTH);
}

export function validTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.length > 120 ||
      !/^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/.test(timeZone)) {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-GB', {timeZone});
    return true;
  } catch {
    return false;
  }
}

/** Local date and time of an instant in a zone; falls back to the UTC text. */
export function formatReturnInstant(utcIso: string, timeZone: string, locale: 'it' | 'en'): string {
  try {
    return new Intl.DateTimeFormat(locale === 'it' ? 'it-IT' : 'en-GB', {
      dateStyle: 'medium', timeStyle: 'medium', timeZone,
    }).format(new Date(utcIso));
  } catch {
    return utcIso;
  }
}
