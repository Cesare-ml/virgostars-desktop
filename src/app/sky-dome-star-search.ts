import type {SkyDomePoint} from './native/sky-dome-contract';

/**
 * Private, bounded in-memory search over the stars the Rust host actually
 * returned for this observer. No network query and no invented star catalogue.
 */
function fold(text:string):string {
  return text.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('en-US').trim();
}
export function findSkyStars(stars:readonly SkyDomePoint[],query:string,limit=8):readonly SkyDomePoint[] {
  if(typeof query!=='string'||query.length>80||!Number.isSafeInteger(limit)||limit<1||limit>32)return [];
  const wanted=fold(query);
  if(wanted.length<2||wanted.length>60)return [];
  const candidates=stars.filter(star=>typeof star.id==='string' && fold(star.id).includes(wanted));
  return candidates
    .sort((a,b)=>{
      const aName=fold(a.id),bName=fold(b.id);
      const rankA=aName===wanted?0:aName.startsWith(wanted)?1:2;
      const rankB=bName===wanted?0:bName.startsWith(wanted)?1:2;
      return rankA-rankB ||
        (a.magnitude??99)-(b.magnitude??99) ||
        a.id.localeCompare(b.id,'it');
    })
    .slice(0,limit);
}
