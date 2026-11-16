/** Canonical UTC instant accepted by the Rust chart calculation port (1600–2400). */
const UTC_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{3})?Z$/;

/** Validate the proleptic Gregorian date without Date.parse normalization. */
export function validChartUtcIso(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const parts = UTC_PATTERN.exec(value);
  if (!parts) return false;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = parts;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year < 1600 || year > 2400 || month < 1 || month > 12 ||
      hour > 23 || minute > 59 || second > 59 || day < 1) return false;
  const leap = year % 400 === 0 || (year % 4 === 0 && year % 100 !== 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return day <= days[month - 1];
}
