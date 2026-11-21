import * as THREE from 'three';

/**
 * A per-object terminator for photo-textured celestial globes, made with
 * THREE.MeshBasicMaterial's built-in shader rather than global scene lights.
 *
 * The caller supplies a BODY→SUN unit direction, already computed in Rust and
 * transformed from horizontal to the Three.js sky frame. No phase, orbit or
 * astronomical vector is calculated here.
 *
 * WebGL only: the desktop renderer uses three@0.170.0 WebGLRenderer.
 */
export const SOLAR_SHADER_KEY='virgostars-sky3d-body-sun-r170-v1';

/** Defensive validation before creating a GPU surface. */
export function sunlitPlanetMaterial(sunWorldDirection:THREE.Vector3):THREE.MeshBasicMaterial {
  if(![sunWorldDirection.x,sunWorldDirection.y,sunWorldDirection.z].every(Number.isFinite) ||
    sunWorldDirection.lengthSq()<1e-12) {
    throw new Error('Invalid native sunlight direction');
  }
  const light=sunWorldDirection.clone().normalize();
  const material=new THREE.MeshBasicMaterial({color:0xffffff});
  material.customProgramCacheKey=()=>SOLAR_SHADER_KEY;
  material.onBeforeCompile=(shader)=>{
    shader.uniforms['uSkySunDir']={value:light};
    shader.vertexShader=shader.vertexShader.replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vSkyWorldNormal;',
    );
    shader.vertexShader=shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      // Globe models have no nonuniform scale, so this orthonormal world
      // normal is independent of camera or cube-map face orientation.
      vSkyWorldNormal = normalize(mat3(modelMatrix) * normal);`,
    );
    shader.fragmentShader=shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      varying vec3 vSkyWorldNormal;
      uniform vec3 uSkySunDir;`,
    );
    shader.fragmentShader=shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float solarIncidence = dot(normalize(vSkyWorldNormal),normalize(uSkySunDir));
      float daySide = smoothstep(-0.035,0.075,solarIncidence);
      // A small display-only dark-side lift reveals the outline, without
      // fabricating reflected light or substituting a physical radiance model.
      diffuseColor.rgb *= mix(0.065,1.0,daySide);`,
    );
  };
  return material;
}
