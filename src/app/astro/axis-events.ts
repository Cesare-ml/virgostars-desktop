/** Search conjunctions in ecliptic longitude with the chart angles. */
export type AxisName = 'AS' | 'MC' | 'DS' | 'IC';
export type AxisSample = Readonly<{longitude:number; ascendant:number; midheaven:number}>;
export type AxisSampler = (utcMs:number) => Promise<AxisSample>;

type AxisSnapshot = Readonly<{bodies:readonly Readonly<{id:string; longitudeDeg:number}>[];
  houses:readonly Readonly<{ascendantDeg:number; mcDeg:number}>[]}>;
const OPPOSITES:Readonly<Record<string,string>> = {
  'true Node Sud':'true Node','mean Node Sud':'mean Node','osc. Perigee':'osc. Apogee','mean Perigee':'mean Apogee',
};

/** Bind each search to the chosen body, including the four derived opposite points. */
export function axisSamplerForBody(body:string,read:(time:number)=>Promise<AxisSnapshot>):AxisSampler {
  const opposite=Object.hasOwn(OPPOSITES,body), id=opposite ? OPPOSITES[body] : body;
  return async time=>{
    const snapshot=await read(time), position=snapshot.bodies.find(item=>item.id===id), houses=snapshot.houses[0];
    if (!position || !houses) throw new Error('position unavailable');
    return {longitude:(position.longitudeDeg+(opposite ? 180 : 0))%360,
      ascendant:houses.ascendantDeg,midheaven:houses.mcDeg};
  };
}

const STEP_MS = 30 * 60_000;
const MAX_STEPS = 144; // Three days: bounded even when an angle is unavailable.
const wrapped = (value:number):number => ((value+180)%360+360)%360-180;

function difference(sample:AxisSample, axis:AxisName):number {
  const angle = axis==='AS' ? sample.ascendant : axis==='DS' ? sample.ascendant+180 :
    axis==='MC' ? sample.midheaven : sample.midheaven+180;
  if (![sample.longitude,angle].every(Number.isFinite)) throw new Error('angle unavailable');
  return wrapped(sample.longitude-angle);
}

/** Angular error of the point against the selected chart axis, in degrees. */
export function axisContactError(sample:AxisSample,axis:AxisName):number {
  return Math.abs(difference(sample,axis));
}

async function crossing(sample:AxisSampler, start:number, axis:AxisName, direction:-1|1):Promise<number|null> {
  const read=async (time:number)=>difference(await sample(time),axis);
  let previous=start, prev=await read(previous);
  if (Math.abs(prev)<1e-8) return previous;
  for (let i=0;i<MAX_STEPS;i++) {
    const current=previous+direction*STEP_MS, next=await read(current);
    if (Math.abs(next)<1e-10) return current;
    // A discontinuity at ±180° is not a conjunction.
    if (prev*next<=0 && Math.abs(next-prev)<180) {
      let left=Math.min(previous,current), right=Math.max(previous,current), leftValue=direction===1 ? prev : next;
      while (right-left>1000) {
        const middle=Math.floor((left+right)/2), value=await read(middle);
        if (Math.abs(value)<1e-10) return middle;
        if ((leftValue<=0 && value<=0) || (leftValue>=0 && value>=0)) {left=middle;leftValue=value;}
        else right=middle;
      }
      return Math.round((left+right)/2);
    }
    previous=current;prev=next;
  }
  return null;
}

/** Last Ascendant at/before the reference; other angles are the first after it. */
export async function findAxisEvent(sample:AxisSampler, referenceMs:number, axis:AxisName):Promise<number|null> {
  if (!Number.isSafeInteger(referenceMs) || !['AS','MC','DS','IC'].includes(axis)) throw new Error('invalid request');
  const asc=await crossing(sample,referenceMs,'AS',-1);
  if (asc===null || axis==='AS') return asc;
  return crossing(sample,asc+1000,axis,1);
}
