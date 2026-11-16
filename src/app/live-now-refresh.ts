/**
 * Minute-bucket gate for a live current-sky chart.
 * The wall clock supplies the instant; this helper performs no astronomy.
 */
const MAX_DATE_MS = 8_640_000_000_000_000;
export const LIVE_NOW_REFRESH_INTERVAL_MS = 60_000;

/** Return the new minute bucket once, or null when the current bucket was handled. */
export function dueLiveNowMinute(timestampMs: number, lastHandledMinute: number | null): number | null {
  if (typeof timestampMs !== 'number' || !Number.isFinite(timestampMs) ||
      Math.abs(timestampMs) > MAX_DATE_MS) return null;
  const minute = Math.floor(timestampMs / LIVE_NOW_REFRESH_INTERVAL_MS);
  return minute === lastHandledMinute ? null : minute;
}
