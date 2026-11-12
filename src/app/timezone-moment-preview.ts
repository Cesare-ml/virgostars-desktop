import moment from 'moment-timezone';
import type {LocalBirthCivil} from './natal-draft-state';
import {resolveCivilTime, type CivilTimeResolution, type TimezoneIntervals} from './timezone-civil';

/**
 * Data are bundled by moment-timezone (already a Desktop dependency): no HTTP,
 * browser system-zone guess or server account. This adapter is a *preview* only.
 * Versioned native tzdb validation must precede durable natal-chart saves.
 */
export function previewIanaCivilTime(
  civil: LocalBirthCivil,
  timezone: string | null
): CivilTimeResolution {
  const version=moment.tz.dataVersion || 'unknown';
  const zone=timezone ? moment.tz.zone(timezone) : null;
  const intervals:TimezoneIntervals | null=zone
    ? {name:zone.name,untils:zone.untils,offsets:zone.offsets} : null;
  return resolveCivilTime(civil,intervals,version);
}
