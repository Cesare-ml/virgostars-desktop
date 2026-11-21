/**
 * World-space Raycaster tolerance for visually constant-size star dots.
 *
 * THREE.Points uses a threshold in world units rather than screen pixels;
 * a fixed 1.6 at sky radius 100 makes tiny stars too easy to select at
 * narrow zoom and too difficult at wide fisheye zoom. Compute the angular
 * footprint of a small CSS-pixel target using the EXACT display lens.
 *
 * This is screen geometry, never an astronomical position calculation.
 */
export function skyStarPickThreshold(
  fovDeg:number,
  viewportHeightPx:number,
  screenRadius:number,
  lensTheta:(radius:number,fovDeg:number)=>number|null,
  skyRadius=100,
  targetRadiusPx=6,
):number|null {
  if(typeof lensTheta!=='function'||
    ![fovDeg,viewportHeightPx,screenRadius,skyRadius,targetRadiusPx].every(Number.isFinite)
    ||viewportHeightPx<=0||screenRadius<0||skyRadius<=0
    ||targetRadiusPx<=0||targetRadiusPx>32)return null;
  const theta=lensTheta(screenRadius,fovDeg);
  if(theta===null)return null;
  const delta=2*targetRadiusPx/viewportHeightPx;
  const thetaBefore=lensTheta(Math.max(0,screenRadius-delta),fovDeg);
  const thetaAfter=lensTheta(screenRadius+delta,fovDeg);
  const radial=Math.max(
    thetaBefore===null?0:Math.abs(theta-thetaBefore),
    thetaAfter===null?0:Math.abs(thetaAfter-theta),
  );
  // A pixel displacement perpendicular to the radial line can have a
  // different angular footprint, especially at large fisheye radii.
  const transverseRadius=Math.hypot(screenRadius,delta);
  const thetaSide=lensTheta(transverseRadius,fovDeg);
  let transverse=radial;
  if(screenRadius>1e-12&&thetaSide!==null){
    const cosine=Math.sin(theta)*Math.sin(thetaSide)*(screenRadius/transverseRadius)
      +Math.cos(theta)*Math.cos(thetaSide);
    transverse=Math.acos(Math.max(-1,Math.min(1,cosine)));
  }
  const angular=Math.max(radial,transverse);
  if(!Number.isFinite(angular)||angular<=0)return null;
  // Clamp degenerate tiny displays without ever allowing arbitrarily
  // large world-space selection near the all-sky rim.
  return Math.max(0.2,Math.min(3.25,2*skyRadius*Math.sin(angular/2)));
}
