/**
 * Experimental ACK-FP-001 synthetic-only, deterministic request fingerprint.
 * NOT a signature, MAC, authorization or real VirgoStars account protocol.
 * Browser-compatible Web Crypto; no Node-specific hash implementation.
 */
const DOMAIN = 'virgostars-ack-fp-001\n';
const MAX_BYTES = 262_144;
const REQUIRED = ['profile', 'mutation', 'entityType', 'entity', 'operation', 'baseRevision', 'createdAt'] as const;
const ALLOWED = new Set<string>([...REQUIRED, 'payload']);
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);
const SYNTHETIC_ID = /^synthetic-[A-Za-z0-9_-]+$/;
const UTC_SECOND = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/;
const ASCII = /^[\x20-\x7e]*$/;

function reject(): never { throw new Error('Unsupported synthetic ACK-FP-001 request'); }
function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 128 && SYNTHETIC_ID.test(value);
}

function ownDataEntries(value: object): Array<readonly [string, unknown]> {
  const isArray = Array.isArray(value);
  const keys = Reflect.ownKeys(value);
  const entries: Array<readonly [string, unknown]> = [];
  for (const key of keys) {
    if (typeof key !== 'string') reject();
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) reject();
    if (key === 'length' && isArray) continue;
    if (!descriptor.enumerable || FORBIDDEN.has(key)) reject();
    if (isArray && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) reject();
    entries.push([key, descriptor.value]);
  }
  if (isArray && entries.length !== value.length) reject();
  return entries;
}

function canonical(value: unknown, depth = 0): string {
  if (depth > 64) reject();
  if (value === null || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || Object.is(value, -0)) reject();
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    if (!ASCII.test(value)) reject();
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') reject();
  const array = Array.isArray(value);
  const proto = Object.getPrototypeOf(value);
  if (array ? proto !== Array.prototype : proto !== Object.prototype) reject();
  const entries = ownDataEntries(value);
  if (array) {
    const elements = new Map(entries);
    return '[' + Array.from({ length: value.length }, (_, i) => canonical(elements.get(String(i)), depth + 1)).join(',') + ']';
  }
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  return '{' + entries.map(([key, val]) => canonical(key, depth + 1) + ':' + canonical(val, depth + 1)).join(',') + '}';
}

/** A deterministic *synthetic-only* envelope; rejects unsupported inputs before hashing. */
export function canonicalAckRequest001(input: unknown): string {
  if (input === null || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) reject();
  const entries = ownDataEntries(input);
  const record = new Map(entries);
  if (entries.some(([key]) => !ALLOWED.has(key)) || REQUIRED.some(key => !record.has(key))) reject();
  if (!validId(record.get('profile')) || !validId(record.get('mutation')) || !validId(record.get('entity'))) reject();
  if (record.get('entityType') !== 'subject') reject();
  const operation = record.get('operation');
  if (operation !== 'upsert' && operation !== 'delete') reject();
  if (operation === 'upsert' && (!record.has('payload') || record.get('payload') === null)) reject();
  if (operation === 'delete' && record.has('payload')) reject();
  const revision = record.get('baseRevision');
  if (revision !== null && (typeof revision !== 'string' || !revision.length || revision.length > 128 || !ASCII.test(revision))) reject();
  const createdAt = record.get('createdAt');
  if (typeof createdAt !== 'string' || !UTC_SECOND.test(createdAt)) reject();
  const encoded = canonical(input);
  if (new TextEncoder().encode(encoded).byteLength > MAX_BYTES) reject();
  return encoded;
}

/** SHA-256 reference fingerprint; does NOT authenticate a receipt. */
export async function ackFingerprint001(input: unknown): Promise<string> {
  const encoded = canonicalAckRequest001(input);
  if (!globalThis.crypto?.subtle) reject();
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(DOMAIN + encoded));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
