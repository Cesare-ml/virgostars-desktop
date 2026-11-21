/**
 * Observer camera and equidistant-fisheye geometry. This is display math,
 * NOT astronomy: altitudes and azimuths are supplied by the Rust host.
 *
 * The horizontal contract uses N=0°, E=90°. Its ENU coordinates are
 * left-handed in X(E), Y(Up), Z(N); Three.js uses a right-handed scene, so
 * world +Z is SOUTH. Keeping this mapping explicit prevents mirrored skies.
 */
export const SKY_FOV_MIN_DEG = 28;
export const SKY_FOV_MAX_DEG = 220;
export const SKY_FISHEYE_START_DEG = 85;
export const SKY_FISHEYE_FULL_DEG = 120;

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export type SkyVector3 = Readonly<{x:number;y:number;z:number}>;
export type SkyCameraFrame = Readonly<{
  right:SkyVector3;
  up:SkyVector3;
  back:SkyVector3;
  /** Azimuth of the actual camera forward direction. */
  headingDeg:number;
  /** Signed geographic elevation of the forward direction. */
  altitudeDeg:number;
}>;

function vector(x:number,y:number,z:number):SkyVector3 {return {x,y,z};}
function validAngles(az:number,alt:number):boolean {
  return Number.isFinite(az)&&Number.isFinite(alt)&&Math.abs(az)<1e7&&Math.abs(alt)<1e7;
}
function normalize360(value:number):number {
  return ((value % 360)+360)%360;
}
export function normalizePitch(value:number):number {
  return ((value+180)%360+360)%360-180;
}

/** The Three.js world vector for a host-provided alt/az direction. */
export function skyWorldVector(azimuthNorthEastDeg:number,altitudeDeg:number,radius=1):SkyVector3|null {
  if(!validAngles(azimuthNorthEastDeg,altitudeDeg)||
    altitudeDeg< -90||altitudeDeg>90||!Number.isFinite(radius)||radius<=0)return null;
  const az=azimuthNorthEastDeg*RAD,alt=altitudeDeg*RAD;
  return vector(
    radius*Math.cos(alt)*Math.sin(az),
    radius*Math.sin(alt),
    -radius*Math.cos(alt)*Math.cos(az),
  );
}

/**
 * Stable camera basis through zenith AND nadir; never use lookAt()'s
 * undefined polar up-vector. Pitch can rotate past +/-90° continuously.
 * Camera local +X=right, +Y=up, -Z=forward.
 */
export function skyCameraFrame(yawDeg:number,pitchDeg:number):SkyCameraFrame|null {
  if(!validAngles(yawDeg,pitchDeg))return null;
  const az=yawDeg*RAD,alt=pitchDeg*RAD;
  const sa=Math.sin(az),ca=Math.cos(az),sp=Math.sin(alt),cp=Math.cos(alt);
  const frame={
    right:vector(ca,0,sa),
    up:vector(-sp*sa,cp,sp*ca),
    back:vector(-cp*sa,-sp,cp*ca),
    headingDeg:normalize360(yawDeg+(cp<0?180:0)),
    altitudeDeg:Math.asin(Math.max(-1,Math.min(1,sp)))*DEG,
  };
  return frame;
}

export function clampedSkyFov(value:number):number {
  if(!Number.isFinite(value))return 75;
  return Math.max(SKY_FOV_MIN_DEG,Math.min(SKY_FOV_MAX_DEG,value));
}

export function fisheyeBlend(fovDeg:number):number {
  if(!Number.isFinite(fovDeg))return 0;
  const value=Math.max(0,Math.min(1,(fovDeg-SKY_FISHEYE_START_DEG)/
    (SKY_FISHEYE_FULL_DEG-SKY_FISHEYE_START_DEG)));
  return value*value*(3-2*value);
}

/**
 * Smooth perspective -> equidistant lens:
 * - up to 85° it is mathematically identical to PerspectiveCamera;
 * - from 120° onward it becomes equidistant, supporting >180° all-sky.
 * A radius of 1 is the vertical edge's half-span (not the screen corner).
 */
export function skyLensTheta(radius:number,fovDeg:number):number|null {
  if(!Number.isFinite(radius)||radius<0||!Number.isFinite(fovDeg)||
    fovDeg<SKY_FOV_MIN_DEG||fovDeg>SKY_FOV_MAX_DEG)return null;
  const half=fovDeg*RAD/2;
  const baseHalf=SKY_FISHEYE_START_DEG*RAD/2;
  // Anchor the pre-fisheye *shape* at 85° instead of evaluating a changing
  // perspective tan(fov/2) above 85°. That older interpolation made objects
  // near the centre briefly reverse direction while zooming out at ~105°.
  // Both the shader and mouse picking use exactly this same radial formula.
  const blend=fisheyeBlend(fovDeg);
  let theta:number;
  if(fovDeg<=SKY_FISHEYE_START_DEG){
    theta=Math.atan(radius*Math.tan(half));
  }else if(blend>=1){
    // No perspective tangent is evaluated in the 120–220° all-sky regime.
    theta=radius*half;
  }else{
    const perspectiveShape=Math.atan(radius*Math.tan(baseHalf))/baseHalf;
    theta=half*((1-blend)*perspectiveShape+blend*radius);
  }
  return Number.isFinite(theta)&&theta>=0&&theta<=Math.PI?theta:null;
}

/** Inverse screen->sky for raycasting in the all-sky renderer. */
export function skyFisheyeWorldRay(
  ndcX:number,ndcY:number,aspect:number,fovDeg:number,frame:SkyCameraFrame,
):SkyVector3|null {
  if(![ndcX,ndcY,aspect].every(Number.isFinite)||aspect<=0)return null;
  const x=ndcX*aspect,y=ndcY,r=Math.hypot(x,y);
  const theta=skyLensTheta(r,fovDeg);
  if(theta===null)return null;
  const unitX=r>1e-12?x/r:0,unitY=r>1e-12?y/r:0;
  const sin=Math.sin(theta),cos=Math.cos(theta);
  const localX=sin*unitX,localY=sin*unitY,localZ=-cos;
  return vector(
    frame.right.x*localX+frame.up.x*localY+frame.back.x*localZ,
    frame.right.y*localX+frame.up.y*localY+frame.back.y*localZ,
    frame.right.z*localX+frame.up.z*localY+frame.back.z*localZ,
  );
}
