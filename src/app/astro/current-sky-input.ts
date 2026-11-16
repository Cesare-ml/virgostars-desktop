import type {NewChartInput} from '../new-chart-form';
import type {OfflinePlaceV1} from '../native/offline-places-contract';

/**
 * One current instant in the selected city's civil time, without changing the
 * UTC instant used for astronomy. No geolocation or network dependency.
 */
export function currentSkyInput(utcIso: string, place: OfflinePlaceV1): NewChartInput | null {
  if (typeof utcIso !== 'string' || !place || typeof place !== 'object' ||
      typeof place.name !== 'string' || !place.name.trim() ||
      typeof place.timeZone !== 'string' || !place.timeZone.trim()) return null;
  const epoch = Date.parse(utcIso);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== utcIso ||
      !Number.isSafeInteger(place.latMicro) || Math.abs(place.latMicro) > 90_000_000 ||
      !Number.isSafeInteger(place.lngMicro) || Math.abs(place.lngMicro) > 180_000_000) return null;
  const timeZone = place.timeZone;
  try {
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone, calendar: 'gregory', numberingSystem: 'latn',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
    });
    const fields = Object.fromEntries(formatter.formatToParts(new Date(epoch))
      .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
    const localDate = `${fields['year']}-${fields['month']}-${fields['day']}`;
    const localTime = `${fields['hour']}:${fields['minute']}:${fields['second']}`;
    const civilAsUtc = Date.UTC(Number(fields['year']), Number(fields['month']) - 1,
      Number(fields['day']), Number(fields['hour']), Number(fields['minute']), Number(fields['second']));
    const offsetSeconds = (civilAsUtc - Math.trunc(epoch / 1000) * 1000) / 1000;
    if (!Number.isSafeInteger(offsetSeconds) || Math.abs(offsetSeconds) > 86_400) return null;
    return {name: '', utcIso, localDate, localTime, timeZone, offsetSeconds,
      latMicro: place.latMicro, lngMicro: place.lngMicro, placeName: place.name};
  } catch {
    // Invalid or unavailable IANA zone: do not silently mislabel civil time.
    return null;
  }
}
