import * as THREE from 'three';

/**
 * A small textured tangent plane facing the centre of the celestial sphere.
 *
 * THREE.Sprite rotates separately for each of a CubeCamera's six faces,
 * producing discontinuous celestial markers at cube seams. A fixed radial
 * plane has the SAME orientation in all six renders and in the normal camera.
 * No astronomical angles or positions are calculated here.
 */
export type SkyBillboardOptions = Readonly<{
  color?:THREE.ColorRepresentation;
  opacity?:number;
  blending?:THREE.Blending;
  depthTest?:boolean;
  anchorX?:number;
  anchorY?:number;
  renderOrder?:number;
}>;

export function skyFacingPlane(
  texture:THREE.Texture|null,
  position:THREE.Vector3,
  width:number,height:number,
  options:SkyBillboardOptions={},
):THREE.Mesh<THREE.PlaneGeometry,THREE.MeshBasicMaterial> {
  if(![position.x,position.y,position.z,width,height].every(Number.isFinite)||
    position.lengthSq()<=0||width<=0||height<=0) {
    throw new Error('Invalid sky billboard geometry');
  }
  const anchorX=options.anchorX??0.5,anchorY=options.anchorY??0.5;
  if(![anchorX,anchorY].every(Number.isFinite)||
    anchorX<0||anchorX>1||anchorY<0||anchorY>1) {
    throw new Error('Invalid sky billboard anchor');
  }

  const normal=position.clone().normalize().negate();
  const upReference=Math.abs(normal.y)>.96
    ? new THREE.Vector3(0,0,-1):new THREE.Vector3(0,1,0);
  const right=new THREE.Vector3().crossVectors(upReference,normal).normalize();
  const up=new THREE.Vector3().crossVectors(normal,right).normalize();
  const basis=new THREE.Matrix4().makeBasis(right,up,normal);
  const geometry=new THREE.PlaneGeometry(width,height);
  geometry.translate((.5-anchorX)*width,(.5-anchorY)*height,0);
  const material=new THREE.MeshBasicMaterial({
    map:texture,color:options.color??0xffffff,
    transparent:true,opacity:options.opacity??1,
    blending:options.blending??THREE.NormalBlending,
    depthTest:options.depthTest??true,depthWrite:false,side:THREE.DoubleSide,
  });
  const plane=new THREE.Mesh(geometry,material);
  plane.position.copy(position);
  plane.quaternion.setFromRotationMatrix(basis);
  plane.renderOrder=options.renderOrder??0;
  return plane;
}
