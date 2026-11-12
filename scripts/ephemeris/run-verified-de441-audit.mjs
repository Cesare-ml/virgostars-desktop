/**
 * Manual-only DE441 audit: verify ALL preserved reference evidence before
 * and after comparing the experimental output against that reference.
 * Neither a matching digest nor a numerical pass certifies the sky.
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEvidenceArgs, verifyReferenceEvidence } from './verify-reference-evidence.mjs';
import { parseComparisonArgs, auditLocalReference } from './compare-de441-reference.mjs';

const SWITCHES = Object.freeze([
  '--actual', '--reference', '--raw-source', '--raw-query', '--normalizer-source',
  '--max-direction-arcsec', '--max-distance-ppm', '--max-epoch-seconds',
]);

/** Strictly validate the complete command before any file is opened. */
export function parseVerifiedAuditArgs(args) {
  if (!Array.isArray(args) || args.length !== 16) return null;
  const values = Object.create(null);
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (!SWITCHES.includes(key) || Object.hasOwn(values, key) ||
        typeof value !== 'string' || !value || value.startsWith('--')) return null;
    values[key] = value;
  }
  const subset = keys => keys.flatMap(key => [key, values[key]]);
  const evidence = parseEvidenceArgs(subset([
    '--reference', '--raw-source', '--raw-query', '--normalizer-source',
  ]));
  const comparison = parseComparisonArgs(subset([
    '--actual', '--reference', '--raw-source',
    '--max-direction-arcsec', '--max-distance-ppm', '--max-epoch-seconds',
  ]));
  if (!evidence || !comparison) return null;
  return Object.freeze({ evidence, comparison });
}

const blocked = reason => Object.freeze({status:'REVIEW_BLOCKED', reason, scientificallyValidated:false});
function safeMetrics(result) {
  return result?.bodyCount === 10 &&
    ['maxDirectionArcsec','maxDistancePpm','maxEpochSeconds'].every(key =>
      typeof result[key] === 'number' && Number.isFinite(result[key]) && result[key] >= 0);
}

/**
 * Enforces evidence -> numeric comparison -> evidence. No stale preflight
 * success can bypass this path. An adversarial file race remains possible
 * between independent opens; a future atomic-handle review must close it.
 * The dependency injection is only for synthetic unit tests.
 */
export async function runVerifiedDe441Audit(parsed, operations = {}) {
  if (!parsed?.evidence || !parsed?.comparison) return blocked('INVALID_ARGUMENTS');
  const verify = operations.verify ?? verifyReferenceEvidence;
  const compare = operations.compare ?? auditLocalReference;
  if (typeof verify !== 'function' || typeof compare !== 'function') return blocked('INVALID_OPERATIONS');
  try {
    const before = await verify(parsed.evidence);
    if (before?.status !== 'EVIDENCE_BYTES_MATCH') return blocked('EVIDENCE_REJECTED');
    const comparison = await compare(parsed.comparison, parsed.comparison.tolerance);
    if (!['WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL','OUTSIDE_DECLARED_TOLERANCE'].includes(comparison?.status) ||
        comparison.scientificallyValidated !== false || !safeMetrics(comparison)) {
      return blocked('COMPARISON_INVALID');
    }
    const after = await verify(parsed.evidence);
    if (after?.status !== 'EVIDENCE_BYTES_MATCH') return blocked('EVIDENCE_CHANGED');
    return Object.freeze({
      status: comparison.status === 'WITHIN_DECLARED_TOLERANCE_EXPERIMENTAL'
        ? 'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL'
        : 'REVIEW_OUTSIDE_TOLERANCE_EXPERIMENTAL',
      maxDirectionArcsec: comparison.maxDirectionArcsec,
      maxDistancePpm: comparison.maxDistancePpm,
      maxEpochSeconds: comparison.maxEpochSeconds,
      scientificallyValidated: false,
    });
  } catch { return blocked('REVIEW_UNAVAILABLE'); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const parsed = parseVerifiedAuditArgs(process.argv.slice(2));
  const report = await runVerifiedDe441Audit(parsed);
  // Sanitized summary only: no user paths, coordinates, UTC instants or raw JSON.
  console.log('VERIFIED_DE441_AUDIT:' + report.status);
  if (report.status === 'REVIEW_BLOCKED') console.error('VERIFIED_DE441_AUDIT:' + report.reason);
  else console.log('Maximum discrepancies: ' + report.maxDirectionArcsec.toFixed(6) +
    ' arcsec; ' + report.maxDistancePpm.toFixed(6) + ' ppm; ' +
    report.maxEpochSeconds.toFixed(6) + ' seconds.');
  console.log('REVIEW ONLY: not JPL authentication, scientific certification or a chart-ready sky.');
  if (report.status !== 'REVIEW_WITHIN_TOLERANCE_EXPERIMENTAL') process.exitCode = 1;
}
