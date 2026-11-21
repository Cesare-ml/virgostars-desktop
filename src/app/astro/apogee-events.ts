export type ApogeePosition = Readonly<{sun:number; apogee:number; speed:number}>;
export type ApogeeConjunction = Readonly<{instant:number; longitude:number; speed:number}>;
const delta=(position:ApogeePosition) => ((position.apogee-position.sun+540)%360)-180;

/** Previous group of Sun–osculating-apogee conjunctions. */
export async function findApogeeConjunctions(sample:(instant:number)=>Promise<ApogeePosition>, reference:number):Promise<readonly ApogeeConjunction[]> {
  const day=86400000, roots:ApogeeConjunction[]=[];
  const initial=await sample(reference);
  let later=reference, laterValue=delta(initial), complete=false;
  if (laterValue===0) roots.push({instant:reference,longitude:initial.apogee,speed:initial.speed});
  for (let i=0;i<550;i++) {
    let earlier=later-day, earlierValue=delta(await sample(earlier));
    if (roots.length && Math.abs(earlierValue)>=60) {complete=true;break;}
    if ((earlierValue===0 || earlierValue*laterValue<0) && Math.abs(earlierValue-laterValue)<180 && earlierValue!==laterValue) {
      let lo=earlier, hi=later, loValue=earlierValue;
      if (earlierValue===0) hi=earlier;
      while (hi-lo>1000) {
        const mid=Math.floor((lo+hi)/2), midValue=delta(await sample(mid));
        if (midValue*loValue<=0) hi=mid; else {lo=mid;loValue=midValue;}
      }
      const position=await sample(hi);
      if (!Number.isFinite(position.speed)) throw new Error('apogee speed unavailable');
      roots.push({instant:hi,longitude:position.apogee,speed:position.speed});
    }
    later=earlier;laterValue=earlierValue;
  }
  if (!roots.length || !complete) throw new Error('conjunction unavailable');
  return roots.reverse();
}
