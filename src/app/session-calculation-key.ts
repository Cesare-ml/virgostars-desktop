import type {ProvisionalNatalCandidate} from './natal-calculation-candidate';

/** All properties of the *current* unavailable-only natal preview are explicit. */
const CANDIDATE_FIELDS = [
  'status','protocolVersion','instantUtc','latMicro','lngMicro','timeZone',
  'offsetSeconds','tzdbVersion','tzdbCaution','timeZoneProvenance','declaredProviderId',
] as const;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const IDENTIFIER = /^[A-Za-z0-9_.-]{1,80}$/;
const TZ_VERSION = /^[A-Za-z0-9_.-]{2,40}$/;
const TIME_ZONE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+)*$/;
const failure = (): Error => new Error('Calculation identity unavailable');

function canonicalPreview(candidate: ProvisionalNatalCandidate): string {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) ||
      Object.keys(candidate).length !== CANDIDATE_FIELDS.length ||
      CANDIDATE_FIELDS.some(field => !Object.prototype.hasOwnProperty.call(candidate,field))) {
    throw failure();
  }
  const c=candidate;
  if (c.status !== 'provisional_only' || c.protocolVersion !== 1 ||
      typeof c.instantUtc !== 'string' || !UTC.test(c.instantUtc) ||
      typeof c.timeZone !== 'string' || c.timeZone.length>80 ||
      !TIME_ZONE.test(c.timeZone) ||
      typeof c.tzdbVersion !== 'string' || !TZ_VERSION.test(c.tzdbVersion) ||
      c.tzdbVersion === 'unknown' ||
      c.timeZoneProvenance !== 'bundled_moment_unverified' ||
      typeof c.declaredProviderId !== 'string' || !IDENTIFIER.test(c.declaredProviderId) ||
      ![null,'pre_1970','future_rules'].includes(c.tzdbCaution) ||
      !Number.isSafeInteger(c.latMicro) || Math.abs(c.latMicro)>90_000_000 ||
      !Number.isSafeInteger(c.lngMicro) || Math.abs(c.lngMicro)>180_000_000 ||
      !Number.isSafeInteger(c.offsetSeconds) || Math.abs(c.offsetSeconds)>86_400) {
    throw failure();
  }
  const time=Date.parse(c.instantUtc);
  if (!Number.isFinite(time) || new Date(time).toISOString()!==c.instantUtc) throw failure();

  // Positional canonical encoding is deliberately frozen to this v1 preview
  // calculation contract. A real provider with house/zodiac options MUST use
  // a new version that includes every additional calculation-changing input.
  return JSON.stringify([
    'virgostars-desktop:unavailable-natal-preview:v1',
    c.status,c.protocolVersion,c.instantUtc,c.latMicro,c.lngMicro,
    c.timeZone,c.offsetSeconds,c.tzdbVersion,c.tzdbCaution,
    c.timeZoneProvenance,c.declaredProviderId,
  ]);
}

/**
 * A private, volatile, non-exportable WebCrypto HMAC key. Never use its output
 * as a persisted ID, an authentication token, or a cross-session cache key.
 */
export class SessionCalculationKeyV1 {
  #key: CryptoKey | null;
  #subtle: SubtleCrypto;
  #revision=0;

  private constructor(key:CryptoKey,subtle:SubtleCrypto) {
    this.#key=key;
    this.#subtle=subtle;
  }

  static async create(cryptoProvider:Pick<Crypto,'subtle'>=globalThis.crypto):Promise<SessionCalculationKeyV1> {
    if (!cryptoProvider?.subtle) throw failure();
    try {
      const key=await cryptoProvider.subtle.generateKey(
        {name:'HMAC',hash:'SHA-256',length:256}, false, ['sign']);
      if (!('type' in key) || key.type!=='secret' || key.extractable ||
          key.algorithm.name!=='HMAC' || !key.usages.includes('sign')) throw failure();
      return new SessionCalculationKeyV1(key,cryptoProvider.subtle);
    } catch { throw failure(); }
  }

  async forPreview(candidate:ProvisionalNatalCandidate):Promise<string> {
    const key=this.#key,revision=this.#revision;
    if (!key) throw failure();
    const payload=canonicalPreview(candidate);
    let signature:ArrayBuffer;
    try {signature=await this.#subtle.sign('HMAC',key,new TextEncoder().encode(payload));}
    catch {throw failure();}
    if (this.#key!==key || this.#revision!==revision) throw failure();
    const bytes=new Uint8Array(signature);
    if (bytes.length!==32) throw failure();
    return 'natal_hmac1.'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }

  /** Blocks in-flight keys after completion; does not guarantee RAM zeroization. */
  dispose():void {this.#revision++;this.#key=null;}
}
