/** Find the Sun's tropical longitude ingress, using the installed ephemerides. */
export async function findSeasonIngress(sample:(instant:number)=>Promise<number>, year:number, season:number):Promise<number> {
  if (!Number.isInteger(year) || year<1 || year>9999 || !Number.isInteger(season) || season<0 || season>3) throw new Error('invalid season');
  const start=new Date(0); start.setUTCFullYear(year,2+season*3,1); start.setUTCHours(0,0,0,0);
  const end=new Date(0); end.setUTCFullYear(year,3+season*3,1); end.setUTCHours(0,0,0,0);
  const target=season*90;
  const difference=(value:number) => ((value-target+540)%360)-180;
  let left=start.getTime(), a=difference(await sample(left));
  for (let right=left+86400000;right<=end.getTime();right+=86400000) {
    const b=difference(await sample(right));
    if (a<=0 && b>=0 && b-a<180) {
      while (right-left>1000) {
        const middle=Math.floor((left+right)/2), value=difference(await sample(middle));
        if (value>=0) right=middle; else left=middle;
      }
      return right;
    }
    left=right;a=b;
  }
  throw new Error('season unavailable');
}
