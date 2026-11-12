/**
 * Explicit-only DE441 smoke runner safeguards. This module never loads kernels.
 * The backend remains the original Rust ephemeris crate, not a JS calculation.
 */
import { spawnSync } from 'node:child_process';

export const CARGO_TIMEOUT_MS = 5 * 60 * 1000;
export const CARGO_MAX_BUFFER_BYTES = 64 * 1024;
const UTC_MIN = Date.UTC(1972, 0, 1);
const UTC_MAX_EXCLUSIVE = Date.UTC(2027, 5, 28);
const UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const INTEGER_PATTERN = /^(?:0|-?[1-9]\d*)$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** Fail closed before Cargo is invoked, without revealing input data in errors. */
export function parseDe441SmokeArgs(args) {
  if (!Array.isArray(args) || args.length !== 5) return {kind:'ARGUMENTS_REQUIRED'};
  const [kernel, utcIso, rawLat, rawLng, rawHeight] = args;
  if ([kernel, utcIso, rawLat, rawLng, rawHeight].some(v => typeof v !== 'string')) {
    return {kind:'INVALID_INPUT'};
  }
  // A local path is passed only to Cargo. No arbitrary shell, network or WebView path is used.
  if (!kernel || kernel.length > 4096 || kernel.trim() !== kernel || /[\x00-\x1f\x7f]/.test(kernel)) {
    return {kind:'INVALID_INPUT'};
  }
  if (!UTC_PATTERN.test(utcIso)) return {kind:'INVALID_INPUT'};
  const epoch = Date.parse(utcIso);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== utcIso ||
      epoch < UTC_MIN || epoch >= UTC_MAX_EXCLUSIVE) return {kind:'INVALID_INPUT'};
  if (!INTEGER_PATTERN.test(rawLat) || !INTEGER_PATTERN.test(rawLng) ||
      !DECIMAL_PATTERN.test(rawHeight) || rawHeight.length > 40) return {kind:'INVALID_INPUT'};
  const latMicro = Number(rawLat), lngMicro = Number(rawLng);
  const heightMeters = Number(rawHeight);
  if (!Number.isSafeInteger(latMicro) || !Number.isSafeInteger(lngMicro) ||
      Math.abs(latMicro) > 90_000_000 || Math.abs(lngMicro) > 180_000_000 ||
      !Number.isFinite(heightMeters) || heightMeters < -12_000 || heightMeters > 100_000) {
    return {kind:'INVALID_INPUT'};
  }
  return {kind:'VALID', kernel, utcIso, latMicro, lngMicro, heightMeters};
}

/** A bounded native command; all failure codes are sanitized and path-free. */
export function runDe441CargoSmoke(input, manifest, validateSnapshot, spawn = spawnSync) {
  if (input?.kind !== 'VALID' || typeof manifest !== 'string' ||
      typeof validateSnapshot !== 'function') return 'INVALID_INPUT';
  let result;
  try {
    result = spawn('cargo', [
      'run', '--quiet', '--manifest-path', manifest, '--', input.kernel, input.utcIso,
      String(input.latMicro), String(input.lngMicro), String(input.heightMeters),
    ], {
      encoding:'utf8', shell:false, windowsHide:true,
      maxBuffer:CARGO_MAX_BUFFER_BYTES, timeout:CARGO_TIMEOUT_MS, killSignal:'SIGKILL',
    });
  } catch {
    return 'NATIVE_UNAVAILABLE';
  }
  if (result?.error?.code === 'ETIMEDOUT') return 'NATIVE_TIMEOUT';
  if (result?.error || result?.status !== 0 || typeof result?.stdout !== 'string' ||
      result.stdout.length === 0 || Buffer.byteLength(result.stdout, 'utf8') > CARGO_MAX_BUFFER_BYTES) {
    return 'NATIVE_UNAVAILABLE';
  }
  let payload;
  try { payload = JSON.parse(result.stdout); } catch { return 'INVALID_SCIENTIFIC_CONTRACT'; }
  // The actual shape validator lives in experimental-sky-contract.ts.
  try {
    const request = {utcIso: input.utcIso, latMicro:input.latMicro, lngMicro:input.lngMicro};
    return validateSnapshot(payload, request) && payload?.heightMeters === input.heightMeters
      ? 'SHAPE_VALID_EXPERIMENTAL_UNVERIFIED' : 'INVALID_SCIENTIFIC_CONTRACT';
  } catch {
    return 'INVALID_SCIENTIFIC_CONTRACT';
  }
}
