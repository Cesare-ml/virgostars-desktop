/**
 * Proposed contract for the *experimental*, geometric Rust first_sky output.
 * This parser does NOT invoke Rust, calculate astronomy or authorize natal rendering.
 * Match upstream VirgoStars-Ephemeris first_sky.rs (branch dev/ephemeris).
 */
import type {CalculationRequest, CalculationResponse} from './latest-calculation-scheduler';

export const FIRST_SKY_BODIES = [
  'Sun','Moon','Mercury','Venus','MarsBarycenter','JupiterBarycenter',
  'SaturnBarycenter','UranusBarycenter','NeptuneBarycenter','PlutoBarycenter',
] as const;
export type FirstSkyBody = typeof FIRST_SKY_BODIES[number];

export const FIRST_SKY_APPROXIMATIONS = [
  'Ut1EqualsUtc','TruncatedTdbMinusTt','NoNutation','NoLightTime',
  'NoAberration','NoGravitationalDeflection','NoPolarMotion',
  'NoAtmosphericRefraction','OuterPlanetSystemBarycenters',
] as const;

export interface FirstSkyInput {
  readonly utcInstant: string;
  readonly observer: Readonly<{
    latitudeMicrodegrees:number;
    longitudeMicrodegrees:number;
    heightMeters:number;
  }>;
  readonly requestedBodies:readonly FirstSkyBody[];
}
export interface FirstSkyPosition {
  readonly body:FirstSkyBody;
  readonly meanEclipticLongitudeDeg:number;
  readonly meanEclipticLatitudeDeg:number;
  readonly meanRightAscensionDeg:number;
  readonly meanDeclinationDeg:number;
  readonly altitudeDeg:number;
  /** Azimuth east of north; null at zenith/nadir. */
  readonly azimuthDeg:number|null;
  readonly distanceKm:number;
}
export interface FirstSkyExperimentalResult {
  readonly provider:'VirgoStars-Ephemeris';
  readonly model:'experimental_first_sky';
  readonly quality:'unverified_geometric';
  readonly chartEligible:false;
  readonly frame:'topocentric_mean_of_date';
  readonly kernelFormat:'classic_DE441';
  readonly kernelSha256:string;
  readonly coreVersion:string;
  readonly computedUtc:string;
  readonly approximations:readonly (typeof FIRST_SKY_APPROXIMATIONS)[number][];
  readonly positions:readonly FirstSkyPosition[];
}
export interface FirstSkyPreview {
  readonly kind:'experimental_geometric_preview';
  readonly chartEligible:false;
  readonly response:CalculationResponse<FirstSkyExperimentalResult>;
}
const bodySet=new Set<string>(FIRST_SKY_BODIES);
const approximationSet=new Set<string>(FIRST_SKY_APPROXIMATIONS);
const start=Date.parse('1972-01-01T00:00:00.000Z');
const end=Date.parse('2027-06-28T00:00:00.000Z'); // Upstream IERS Bulletin C 72 expiry.
const token=/^[a-zA-Z0-9:_-]{1,128}$/;
function record(raw:unknown):raw is Record<string,unknown> {
  return raw!==null && typeof raw==='object' && !Array.isArray(raw);
}
function finiteRange(value:unknown,minimum:number,maximum:number):value is number {
  return typeof value==='number' && Number.isFinite(value) && value>=minimum && value<=maximum;
}
function canonicalUtc(value:unknown):value is string {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))return false;
  const epoch=Date.parse(value);
  return Number.isFinite(epoch)&&epoch>=start&&epoch<end&&new Date(epoch).toISOString()===value;
}
export function validateFirstSkyInput(input:unknown):asserts input is FirstSkyInput {
  if(!record(input)||!canonicalUtc(input.utcInstant)||!record(input.observer)||
     !Number.isSafeInteger(input.observer.latitudeMicrodegrees)||
     !finiteRange(input.observer.latitudeMicrodegrees,-90_000_000,90_000_000)||
     !Number.isSafeInteger(input.observer.longitudeMicrodegrees)||
     !finiteRange(input.observer.longitudeMicrodegrees,-180_000_000,180_000_000)||
     !finiteRange(input.observer.heightMeters,-12_000,100_000)||
     !Array.isArray(input.requestedBodies)||input.requestedBodies.length===0||
     input.requestedBodies.length>FIRST_SKY_BODIES.length||
     new Set(input.requestedBodies).size!==input.requestedBodies.length||
     !input.requestedBodies.every((body:unknown)=>typeof body==='string'&&bodySet.has(body))) {
    throw new Error('FIRST_SKY_INVALID_INPUT');
  }
}
function decodePosition(raw:unknown):FirstSkyPosition {
  if(!record(raw)||typeof raw.body!=='string'||!bodySet.has(raw.body)||
     !finiteRange(raw.meanEclipticLongitudeDeg,0,360) || raw.meanEclipticLongitudeDeg===360||
     !finiteRange(raw.meanEclipticLatitudeDeg,-90,90)||
     !finiteRange(raw.meanRightAscensionDeg,0,360) || raw.meanRightAscensionDeg===360||
     !finiteRange(raw.meanDeclinationDeg,-90,90)||
     !finiteRange(raw.altitudeDeg,-90,90)||
     !(raw.azimuthDeg===null || (finiteRange(raw.azimuthDeg,0,360)&&raw.azimuthDeg!==360))||
     !finiteRange(raw.distanceKm,0,1e15)||raw.distanceKm===0) {
    throw new Error('FIRST_SKY_INVALID_POSITION');
  }
  return {
    body:raw.body as FirstSkyBody,
    meanEclipticLongitudeDeg:raw.meanEclipticLongitudeDeg,
    meanEclipticLatitudeDeg:raw.meanEclipticLatitudeDeg,
    meanRightAscensionDeg:raw.meanRightAscensionDeg,
    meanDeclinationDeg:raw.meanDeclinationDeg,
    altitudeDeg:raw.altitudeDeg,azimuthDeg:raw.azimuthDeg,
    distanceKm:raw.distanceKm,
  };
}
/** Fully fail-closed. No synthetic or unlabelled response can become a chart. */
export function decodeFirstSkyPreview(
  raw:unknown,request:CalculationRequest<FirstSkyInput>
):FirstSkyPreview {
  if(request.protocolVersion!==1||!token.test(request.sessionId)||
     !token.test(request.calculationKey)||!Number.isSafeInteger(request.requestSeq)||
     request.requestSeq<1)throw new Error('FIRST_SKY_INVALID_REQUEST');
  validateFirstSkyInput(request.input);
  if(!record(raw)||raw.protocolVersion!==1||
     raw.sessionId!==request.sessionId||raw.requestSeq!==request.requestSeq||
     raw.calculationKey!==request.calculationKey||!record(raw.result)) {
    throw new Error('FIRST_SKY_INVALID_ENVELOPE');
  }
  const r=raw.result;
  if(r.provider!=='VirgoStars-Ephemeris'||r.model!=='experimental_first_sky'||
     r.quality!=='unverified_geometric'||r.chartEligible!==false||
     r.frame!=='topocentric_mean_of_date'||r.kernelFormat!=='classic_DE441'||
     typeof r.kernelSha256!=='string'||!/^[0-9a-f]{64}$/.test(r.kernelSha256)||
     typeof r.coreVersion!=='string'||!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(r.coreVersion)||
     r.computedUtc!==request.input.utcInstant||
     !Array.isArray(r.approximations)||
     r.approximations.length!==FIRST_SKY_APPROXIMATIONS.length||
     new Set(r.approximations).size!==FIRST_SKY_APPROXIMATIONS.length||
     !r.approximations.every((v:unknown)=>typeof v==='string'&&approximationSet.has(v))||
     !Array.isArray(r.positions)||r.positions.length!==request.input.requestedBodies.length) {
    throw new Error('FIRST_SKY_INVALID_MODEL');
  }
  const positions=r.positions.map(decodePosition);
  const expected=new Set(request.input.requestedBodies);
  if(new Set(positions.map(p=>p.body)).size!==positions.length||
     !positions.every(p=>expected.has(p.body)))throw new Error('FIRST_SKY_BODY_MISMATCH');
  const result:FirstSkyExperimentalResult={
    provider:'VirgoStars-Ephemeris',
    model:'experimental_first_sky',
    quality:'unverified_geometric',
    chartEligible:false,
    frame:'topocentric_mean_of_date',
    kernelFormat:'classic_DE441',
    kernelSha256:r.kernelSha256,
    coreVersion:r.coreVersion,
    computedUtc:request.input.utcInstant,
    approximations:[...r.approximations],
    positions,
  };
  return {
    kind:'experimental_geometric_preview',chartEligible:false,
    response:{protocolVersion:1,sessionId:request.sessionId,requestSeq:request.requestSeq,
      calculationKey:request.calculationKey,result},
  };
}
