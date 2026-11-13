/**
 * Manual-only preparation of independent JPL Horizons geometric state-vector
 * requests. No networking, astronomical calculations, or chart-readiness.
 * Source: https://ssd-api.jpl.nasa.gov/doc/horizons.html (v1.3, June 2025).
 */
import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const HORIZONS_BODIES = Object.freeze([
  Object.freeze({bodyId:'sun',naifId:'10',centerKind:'body_center'}),
  Object.freeze({bodyId:'moon',naifId:'301',centerKind:'body_center'}),
  Object.freeze({bodyId:'mercury',naifId:'199',centerKind:'body_center'}),
  Object.freeze({bodyId:'venus',naifId:'299',centerKind:'body_center'}),
  Object.freeze({bodyId:'mars_barycenter',naifId:'4',centerKind:'system_barycenter'}),
  Object.freeze({bodyId:'jupiter_barycenter',naifId:'5',centerKind:'system_barycenter'}),
  Object.freeze({bodyId:'saturn_barycenter',naifId:'6',centerKind:'system_barycenter'}),
  Object.freeze({bodyId:'uranus_barycenter',naifId:'7',centerKind:'system_barycenter'}),
  Object.freeze({bodyId:'neptune_barycenter',naifId:'8',centerKind:'system_barycenter'}),
  Object.freeze({bodyId:'pluto_barycenter',naifId:'9',centerKind:'system_barycenter'}),
]);

const API_URL='https://ssd.jpl.nasa.gov/api/horizons.api';
const JD_FORMAT=/^(?:24[4-6][0-9]{4})\.[0-9]{4,9}$/;
// Range deliberately restricted to the current experimental leap-second model.
// These are broad guards, not a conversion of UTC to TDB.
const JD_MIN=2441317.5, JD_MAX=2461585.5;
const ORDER=['format','COMMAND','OBJ_DATA','MAKE_EPHEM','EPHEM_TYPE','CENTER',
  'REF_PLANE','REF_SYSTEM','OUT_UNITS','VEC_TABLE','VEC_CORR','CSV_FORMAT',
  'VEC_LABELS','TIME_TYPE','TLIST_TYPE','TLIST'];

/**
 * The input TDB Julian date must be independently reviewed, not copied
 * uncritically from VirgoStars-Ephemeris; otherwise comparisons are not fully
 * independent. Refuses calendar strings, exponent notation and ambiguous times.
 */
export function parseReviewedTdbJulianDay(value) {
  if (typeof value!=='string' || !JD_FORMAT.test(value)) return null;
  const jd=Number(value);
  return Number.isFinite(jd) && jd>=JD_MIN && jd<JD_MAX ? value : null;
}

export function buildHorizonsVectorPlan(tdbJulianDay) {
  const jd=parseReviewedTdbJulianDay(tdbJulianDay);
  if (!jd) throw new Error('INVALID_REVIEWED_TDB_JD');
  return {
    schemaVersion:1,
    reviewStatus:'query_plan_unverified',
    agency:'NASA/JPL Horizons',
    apiDocumentation:'https://ssd-api.jpl.nasa.gov/doc/horizons.html',
    origin:'solar_system_barycenter',
    frame:'ICRF',
    timeScale:'TDB',
    timeInput:'independently_reviewed_julian_day',
    tdbJulianDay:jd,
    correction:'NONE_GEOMETRIC',
    output:'Cartesian_position_velocity_km_and_km_per_second',
    requests:HORIZONS_BODIES.map(body=>{
      const params={
        format:'text',COMMAND:"'"+body.naifId+"'",OBJ_DATA:'NO',MAKE_EPHEM:'YES',
        EPHEM_TYPE:'VECTORS',CENTER:"'500@0'",REF_PLANE:'FRAME',REF_SYSTEM:'ICRF',
        OUT_UNITS:'KM-S',VEC_TABLE:'2',VEC_CORR:'NONE',CSV_FORMAT:'YES',
        VEC_LABELS:'NO',TIME_TYPE:'TDB',TLIST_TYPE:'JD',TLIST:jd,
      };
      const url=new URL(API_URL);
      for (const key of ORDER) url.searchParams.set(key,params[key]);
      return {
        bodyId:body.bodyId,naifId:body.naifId,centerKind:body.centerKind,
        responseFilename:'horizons-'+body.bodyId+'.txt',
        url:url.toString(),
      };
    }),
  };
}

export function parsePlanArgs(args) {
  if (!Array.isArray(args) || args.length!==4) return null;
  const values=Object.create(null);
  for(let i=0;i<args.length;i+=2){
    const k=args[i],v=args[i+1];
    if(!['--tdb-jd','--out'].includes(k) || Object.hasOwn(values,k) ||
       typeof v!=='string' || !v || v.startsWith('--') || /[\x00-\x1f\x7f]/.test(v))return null;
    values[k]=v;
  }
  const jd=parseReviewedTdbJulianDay(values['--tdb-jd']);
  if (!jd || typeof values['--out']!=='string' ||
      values['--out'].length>4096 || values['--out'].trim()!==values['--out'])return null;
  return {tdbJulianDay:jd,outputPath:values['--out']};
}

/** Explicit local write: never replace a plan or print a sensitive epoch/path. */
export async function writePlanOnce(path,plan) {
  if (typeof path!=='string' || !path || !plan || plan.reviewStatus!=='query_plan_unverified')
    throw new Error('INVALID_PLAN_INPUT');
  // wx is exclusive create: prevents pre-existing file and symlink overwrites.
  const file=await open(path,'wx',0o600);
  try { await file.writeFile(JSON.stringify(plan,null,2)+'\n',{encoding:'utf8'}); }
  finally { await file.close(); }
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const parsed=parsePlanArgs(process.argv.slice(2));
  if(!parsed){
    process.stderr.write('HORIZONS_PLAN:INVALID_ARGUMENTS\n');
    process.exitCode=1;
  }else{
    try{
      await writePlanOnce(parsed.outputPath,buildHorizonsVectorPlan(parsed.tdbJulianDay));
      process.stdout.write('HORIZONS_PLAN:CREATED_UNVERIFIED_10_BODY_REQUESTS\n');
      process.stdout.write('Manual review and retrieval required; this is not a numeric reference.\n');
    }catch{
      process.stderr.write('HORIZONS_PLAN:WRITE_FAILED\n');
      process.exitCode=1;
    }
  }
}
