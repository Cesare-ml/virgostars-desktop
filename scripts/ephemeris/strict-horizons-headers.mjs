/**
 * Read NASA/JPL Horizons-style text fields only from the pre-ephemeris header.
 * Each security-relevant label must be unique, including accepted aliases.
 * This checks structure, NOT source authenticity or astronomical accuracy.
 */
const FIELDS = Object.freeze({
  'api version': 'apiVersion',
  'api source': 'apiSource',
  'target body name': 'targetName',
  'center body name': 'centerName',
  'center-site name': 'centerSite',
  'output units': 'outputUnits',
  'output type': 'outputType',
  'output format': 'outputFormat',
  'reference frame': 'referenceFrame',
  'coordinate systm': 'coordinateSystem',
  'coordinate system': 'coordinateSystem',
  'start time': 'startTime',
});

const REQUIRED = Object.freeze([
  'apiVersion','apiSource','targetName','centerName','centerSite',
  'outputUnits','outputType','outputFormat','referenceFrame',
  'coordinateSystem','startTime',
]);

/**
 * Does not scan footnotes after $$EOE or data after $$SOE: they cannot be
 * used to supply or override model/target/time attributes. Reject mixed
 * case duplicates, empty values and the two coordinate spelling variants.
 */
export function parseUniqueHorizonsHeaders(text) {
  if (typeof text !== 'string') throw new Error('INVALID_RESPONSE_HEADER');
  const first = text.indexOf('$$SOE');
  if (first < 0) throw new Error('INVALID_RESPONSE_HEADER');
  const preamble = text.slice(0, first);
  const result = Object.create(null);
  for (const line of preamble.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const label = line.slice(0, colon).trim().replace(/\s+/g,' ').toLowerCase();
    const key = FIELDS[label];
    if (!key) continue;
    if (Object.hasOwn(result,key)) throw new Error('AMBIGUOUS_RESPONSE_HEADER');
    const value = line.slice(colon + 1).trim();
    if (!value || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
      throw new Error('INVALID_RESPONSE_HEADER');
    result[key] = value;
  }
  if (!REQUIRED.every(key => Object.hasOwn(result,key)))
    throw new Error('MISSING_RESPONSE_HEADER');
  return Object.freeze({...result});
}
