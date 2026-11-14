/**
 * Synthetic-only UI decision helper for the future encrypted Desktop profile.
 * This is NOT authentication, device revocation, a native attestation, key
 * storage, or authorization to read any data. Only a future reviewed Rust
 * adapter may supply evidence after enforcing those protections itself.
 */

export type ProfileAvailability = 'absent' | 'locked' | 'unlocked' | 'unreadable';
export type SessionAvailability = 'none' | 'expired' | 'valid';
export type NetworkHint = 'offline' | 'online';
export type RevocationKnowledge = 'unknown' | 'known_revoked';

/** No user IDs, secrets, birth records, arbitrary paths or remote payloads. */
export interface OfflineProfileEvidenceV1 {
  readonly protocolVersion: 1;
  readonly profile: ProfileAvailability;
  readonly activatedOnlineBefore: boolean;
  readonly encryptedCachePresent: boolean;
  readonly nativeKeyUnlocked: boolean;
  readonly revocation: RevocationKnowledge;
  readonly session: SessionAvailability;
  readonly network: NetworkHint;
  /** True only once a separately reviewed native sync transport exists. */
  readonly syncTransportReady: boolean;
  /** Only knowable for an open profile; zero for inaccessible profiles. */
  readonly pendingMutations: number;
}

export type OfflineProfileGateStatus =
  | 'invalid_evidence' | 'activation_required' | 'snapshot_required'
  | 'unlock_required' | 'recovery_required' | 'known_revoked'
  | 'ready_offline' | 'ready_online';

export type OfflineSyncNotice =
  | 'blocked' | 'offline' | 'session_required'
  | 'transport_unavailable' | 'eligible_to_attempt';

export interface OfflineProfileGateDecision {
  readonly status: OfflineProfileGateStatus;
  readonly canReadLocal: boolean;
  readonly canWriteLocal: boolean;
  readonly canAttemptSync: boolean;
  /** Null is unknown; it must not be interpreted as a confirmed empty outbox. */
  readonly knownPendingMutations: number | null;
  readonly syncNotice: OfflineSyncNotice;
}

const FIELDS = Object.freeze([
  'protocolVersion', 'profile', 'activatedOnlineBefore',
  'encryptedCachePresent', 'nativeKeyUnlocked', 'revocation',
  'session', 'network', 'syncTransportReady', 'pendingMutations',
] as const);
const MAX_PENDING_MUTATIONS = 1_000_000;

/**
 * Strict schema v1: reject partial, accessor-backed, non-plain and future
 * version payloads rather than accidentally promoting a profile to "ready".
 * This validation cannot authenticate an IPC source or OS key ownership.
 */
export function decodeOfflineProfileEvidence(value: unknown): OfflineProfileEvidenceV1 | null {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return null;
    if (Reflect.ownKeys(value).length !== FIELDS.length) return null;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const data = Object.create(null) as Record<string, unknown>;
    for (const field of FIELDS) {
      const descriptor = descriptors[field];
      if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
      data[field] = descriptor.value;
    }
    if (data['protocolVersion'] !== 1 ||
        !['absent','locked','unlocked','unreadable'].includes(data['profile'] as string) ||
        typeof data['activatedOnlineBefore'] !== 'boolean' ||
        typeof data['encryptedCachePresent'] !== 'boolean' ||
        typeof data['nativeKeyUnlocked'] !== 'boolean' ||
        !['unknown','known_revoked'].includes(data['revocation'] as string) ||
        !['none','expired','valid'].includes(data['session'] as string) ||
        !['offline','online'].includes(data['network'] as string) ||
        typeof data['syncTransportReady'] !== 'boolean' ||
        !Number.isSafeInteger(data['pendingMutations']) ||
        (data['pendingMutations'] as number) < 0 ||
        (data['pendingMutations'] as number) > MAX_PENDING_MUTATIONS) return null;
    const profile = data['profile'] as ProfileAvailability;
    const activated = data['activatedOnlineBefore'];
    const cache = data['encryptedCachePresent'];
    const key = data['nativeKeyUnlocked'];
    const pending = data['pendingMutations'];
    if (profile === 'absent' && (cache || key || pending !== 0)) return null;
    if (profile !== 'absent' && (!activated || !cache)) return null;
    if (profile === 'unlocked' && !key) return null;
    if (profile !== 'unlocked' && (key || pending !== 0)) return null;
    // Copy primitives into a fresh immutable object. Never forward the input.
    return Object.freeze({
      protocolVersion: 1,
      profile,
      activatedOnlineBefore: activated as boolean,
      encryptedCachePresent: cache as boolean,
      nativeKeyUnlocked: key as boolean,
      revocation: data['revocation'] as RevocationKnowledge,
      session: data['session'] as SessionAvailability,
      network: data['network'] as NetworkHint,
      syncTransportReady: data['syncTransportReady'] as boolean,
      pendingMutations: pending as number,
    });
  } catch {
    // A Proxy or broken native adapter can throw on property inspection.
    return null;
  }
}

function blocked(status: OfflineProfileGateStatus): OfflineProfileGateDecision {
  return Object.freeze({
    status, canReadLocal: false, canWriteLocal: false,
    canAttemptSync: false, knownPendingMutations: null, syncNotice: 'blocked',
  });
}

/**
 * Produce conservative presentation/attempt eligibility, never authorization.
 * Even "eligible_to_attempt" does not mean a server accepted a mutation.
 */
export function assessOfflineProfileAccess(value: unknown): OfflineProfileGateDecision {
  const evidence = decodeOfflineProfileEvidence(value);
  if (!evidence) return blocked('invalid_evidence');
  // Known revocation prevents further local UI access; unknown *remote*
  // revocation cannot be detected while disconnected from the server.
  if (evidence.revocation === 'known_revoked') return blocked('known_revoked');
  if (evidence.profile === 'absent') {
    return blocked(evidence.session === 'valid' && evidence.network === 'online'
      ? 'snapshot_required' : 'activation_required');
  }
  if (evidence.profile === 'unreadable') return blocked('recovery_required');
  if (evidence.profile === 'locked') return blocked('unlock_required');
  const canAttemptSync = evidence.network === 'online' &&
    evidence.session === 'valid' && evidence.syncTransportReady;
  const syncNotice: OfflineSyncNotice = evidence.network === 'offline'
    ? 'offline' : evidence.session !== 'valid'
      ? 'session_required' : !evidence.syncTransportReady
        ? 'transport_unavailable' : 'eligible_to_attempt';
  return Object.freeze({
    status: evidence.network === 'online' && evidence.session === 'valid'
      ? 'ready_online' : 'ready_offline',
    canReadLocal: true, canWriteLocal: true, canAttemptSync,
    knownPendingMutations: evidence.pendingMutations, syncNotice,
  });
}
