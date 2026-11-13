/**
 * VirgoStars Desktop — pure sync/outbox REFERENCE MODEL.
 * This module contains NO persistence, encryption, network access, authorization,
 * Tauri privileges or production endpoints. Do not wire it to real user records.
 * The Rust host must eventually own transactional SQLite writes and sync.
 */
export type EntityType = 'subject' | 'chart' | 'note' | 'preference';
export type MutationOperation = 'upsert' | 'delete';
export type JsonValue = null | string | number | boolean | JsonValue[] | { [key: string]: JsonValue };

export type Mutation = Readonly<{
  profileId: string;
  mutationId: string;
  entityType: EntityType;
  entityId: string;
  operation: MutationOperation;
  baseServerRevision: string | null;
  createdAtUtc: string;
  payload?: JsonValue;
}>;

export type OutboxEntry = Readonly<{
  mutation: Mutation;
  state: 'pending' | 'conflict';
  conflictServerRevision?: string | null;
}>;

export type Outbox = Readonly<{
  profileId: string;
  entries: readonly OutboxEntry[];
}>;

export type Receipt =
  | Readonly<{ mutationId: string; result: 'accepted' | 'already_applied'; serverRevision: string }>
  | Readonly<{ mutationId: string; result: 'conflict'; serverRevision: string | null }>
  | Readonly<{ mutationId: string; result: 'retry' }>;

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const TYPES: ReadonlySet<string> = new Set(['subject', 'chart', 'note', 'preference']);
const OPERATIONS: ReadonlySet<string> = new Set(['upsert', 'delete']);
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype']);

function checkIdentifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error('Invalid sync identifier');
}

// Only JSON values are acceptable across this boundary. Reject cycles, non-finite
// numbers, class instances, and prototype-sensitive keys before cloning.
function validateJson(value: unknown, ancestors: Set<object> = new Set(), depth = 0): asserts value is JsonValue {
  if (depth > 64) throw new Error('Invalid JSON payload');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return;
    throw new Error('Invalid JSON payload');
  }
  if (typeof value !== 'object') throw new Error('Invalid JSON payload');
  const object = value as object;
  if (ancestors.has(object)) throw new Error('Invalid JSON payload');
  const prototype = Object.getPrototypeOf(object);
  if (Array.isArray(value) ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null) {
    throw new Error('Invalid JSON payload');
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || FORBIDDEN_KEYS.has(key)) throw new Error('Invalid JSON payload');
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error('Invalid JSON payload');
    }
    if (Array.isArray(value) && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= value.length)) {
      throw new Error('Invalid JSON payload');
    }
  }
  ancestors.add(object);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      if (!Object.hasOwn(value, i)) throw new Error('Invalid JSON payload');
      validateJson(value[i], ancestors, depth + 1);
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key)) throw new Error('Invalid JSON payload');
      validateJson(item, ancestors, depth + 1);
    }
  }
  ancestors.delete(object);
}

function stableJson(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableJson).join(',') + ']';
  return '{' + Object.keys(value).sort()
    .map((key) => JSON.stringify(key) + ':' + stableJson(value[key]))
    .join(',') + '}';
}

function freezeDeep<T extends JsonValue>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeDeep(child);
    Object.freeze(value);
  }
  return value;
}

function snapshotMutation(change: Mutation, expectedProfile: string): Mutation {
  if (change === null || typeof change !== 'object') throw new Error('Invalid sync mutation');
  checkIdentifier(change.profileId);
  checkIdentifier(change.mutationId);
  checkIdentifier(change.entityId);
  if (change.profileId !== expectedProfile) throw new Error('Cross-profile sync prohibited');
  if (!TYPES.has(change.entityType) || !OPERATIONS.has(change.operation)) throw new Error('Unsupported sync operation');
  if (change.baseServerRevision !== null) checkIdentifier(change.baseServerRevision);
  if (typeof change.createdAtUtc !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(change.createdAtUtc)
    || !Number.isFinite(Date.parse(change.createdAtUtc))
    || new Date(change.createdAtUtc).toISOString().slice(0, 19) !== change.createdAtUtc.slice(0, 19)) {
    throw new Error('Invalid UTC timestamp');
  }
  const hasPayload = Object.hasOwn(change, 'payload');
  if (change.operation === 'upsert' && !hasPayload) throw new Error('Upsert requires payload');
  if (change.operation === 'delete' && hasPayload) throw new Error('Delete cannot carry payload');
  const common = {
    profileId: change.profileId,
    mutationId: change.mutationId,
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    baseServerRevision: change.baseServerRevision,
    createdAtUtc: change.createdAtUtc,
  };
  if (!hasPayload) return Object.freeze(common);
  validateJson(change.payload);
  const json = JSON.stringify(change.payload);
  // The future IPC/storage boundary is byte-oriented. UTF-16 string.length
  // undercounts accented characters and astral Unicode in serialized JSON.
  // Check code units first to avoid encoding clearly oversized payloads.
  const MAX_PAYLOAD_BYTES = 262144;
  if (json.length > MAX_PAYLOAD_BYTES || new TextEncoder().encode(json).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error('Payload exceeds reference-model limit');
  }
  const snapshot = freezeDeep(JSON.parse(json) as JsonValue);
  return Object.freeze({ ...common, payload: snapshot });
}

function entityKey(change: Mutation): string {
  return change.entityType + ':' + change.entityId;
}

function newOutbox(profileId: string, entries: readonly OutboxEntry[]): Outbox {
  return Object.freeze({ profileId, entries: Object.freeze([...entries]) });
}

export function createOutbox(profileId: string): Outbox {
  checkIdentifier(profileId);
  return newOutbox(profileId, []);
}

/** Append an immutable, profile-scoped mutation; exactly repeated IDs are idempotent. */
export function enqueueMutation(state: Outbox, incoming: Mutation): Outbox {
  const mutation = snapshotMutation(incoming, state.profileId);
  const previous = state.entries.find((entry) => entry.mutation.mutationId === mutation.mutationId);
  if (previous) {
    if (stableJson(previous.mutation as unknown as JsonValue) !== stableJson(mutation as unknown as JsonValue)) {
      throw new Error('Mutation ID reused for different data');
    }
    return state;
  }
  return newOutbox(state.profileId, [...state.entries, Object.freeze({ mutation, state: 'pending' as const })]);
}

/** Send at most one unacknowledged mutation per entity per round, in FIFO order. */
export function nextSyncBatch(state: Outbox, limit = 50): readonly Mutation[] {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new RangeError('Invalid batch limit');
  const blocked = new Set<string>();
  const batch: Mutation[] = [];
  for (const entry of state.entries) {
    const key = entityKey(entry.mutation);
    if (blocked.has(key)) continue;
    blocked.add(key); // Conflict or pending: later same-entity edits must wait.
    if (entry.state === 'conflict') continue;
    batch.push(entry.mutation);
    if (batch.length === limit) break;
  }
  return Object.freeze(batch);
}

/**
 * A receipt is untrusted until its own data descriptors have been captured.
 * Reject getters, inherited fields and unexpected properties rather than
 * reading a mutable remote reply repeatedly while deciding whether to ACK.
 */
function snapshotReceipt(input: unknown): Receipt {
  try {
    if (input === null || typeof input !== 'object' || Array.isArray(input)) throw new Error();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw new Error();
    const props = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(props);
    const allowed = new Set(['mutationId', 'result', 'serverRevision']);
    if (keys.some(key => typeof key !== 'string' || !allowed.has(key))) throw new Error();
    const ownData = (key: string): unknown => {
      const descriptor = Object.hasOwn(props, key) ? props[key] : undefined;
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new Error();
      return descriptor.value;
    };
    const mutationId = ownData('mutationId');
    checkIdentifier(mutationId);
    const result = ownData('result');
    if (result === 'retry' && keys.length === 2) {
      return Object.freeze({mutationId, result});
    }
    if (keys.length !== 3) throw new Error();
    const serverRevision = ownData('serverRevision');
    if (result === 'conflict') {
      if (serverRevision !== null) checkIdentifier(serverRevision);
      return Object.freeze({mutationId, result, serverRevision});
    }
    if (result === 'accepted' || result === 'already_applied') {
      checkIdentifier(serverRevision);
      return Object.freeze({mutationId, result, serverRevision});
    }
    throw new Error();
  } catch {
    // Do not expose potentially sensitive diagnostics from untrusted objects.
    throw new Error('Invalid sync receipt');
  }
}

/**
 * Process a server response atomically as a pure transformation. Unknown,
 * duplicated or out-of-order receipts fail closed; retries keep pending writes.
 * A conflict remains available to the user and blocks later edits to that entity.
 */
export function applySyncReceipts(state: Outbox, receipts: readonly Receipt[]): Outbox {
  const byId = new Map<string, Receipt>();
  for (const raw of receipts) {
    const receipt = snapshotReceipt(raw);
    if (byId.has(receipt.mutationId)) throw new Error('Duplicated sync receipt');
    if (!state.entries.some((entry) => entry.mutation.mutationId === receipt.mutationId)) {
      throw new Error('Unexpected sync receipt');
    }
    byId.set(receipt.mutationId, receipt);
  }
  // Only the oldest unresolved operation per entity is eligible. This also
  // rejects a future ack that would skip an earlier pending mutation.
  const eligible = new Set(nextSyncBatch(state, 500).map((mutation) => mutation.mutationId));
  for (const receipt of byId.values()) {
    if (!eligible.has(receipt.mutationId)) throw new Error('Out-of-order sync receipt');
  }
  if (byId.size === 0) return state;
  const entries: OutboxEntry[] = [];
  for (const entry of state.entries) {
    const receipt = byId.get(entry.mutation.mutationId);
    if (!receipt || receipt.result === 'retry') { entries.push(entry); continue; }
    if (receipt.result === 'conflict') {
      entries.push(Object.freeze({ mutation: entry.mutation, state: 'conflict', conflictServerRevision: receipt.serverRevision }));
    } // accepted & already_applied are acknowledged and removed from this model.
  }
  return newOutbox(state.profileId, entries);
}

export function outboxCounts(state: Outbox): Readonly<{ pending: number; conflicts: number }> {
  return Object.freeze({
    pending: state.entries.filter((entry) => entry.state === 'pending').length,
    conflicts: state.entries.filter((entry) => entry.state === 'conflict').length,
  });
}
