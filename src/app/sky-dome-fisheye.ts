import * as THREE from 'three';
import {fisheyeBlend,SKY_FISHEYE_START_DEG} from './sky-dome-projection';

/**
 * All-sky display lens. Render the astronomical scene into six directions
 * only when its objects/layers change. The face size is chosen to fit
 * the device's reported cube-map limit (256/512/1024 px). Camera movements reproject
 * the cached cubemap without recomputing astronomy or six WebGL passes.
 *
 * Below 85° use the crisp native perspective camera. At 85° the shader is
 * exactly perspective; it transitions continuously to an equidistant
 * hemispheric/whole-sky projection by 120°. FOV can reach 220°.
 */
export class SkyDomeLens {
  private readonly target:THREE.WebGLCubeRenderTarget;
  private readonly cubeCamera:THREE.CubeCamera;
  private readonly screen:THREE.Scene;
  private readonly screenCamera:THREE.OrthographicCamera;
  private readonly material:THREE.ShaderMaterial;
  private readonly quad:THREE.Mesh;
  private dirty=true;

  constructor(size:256|512|1024=1024) {
    this.target=new THREE.WebGLCubeRenderTarget(size,{
      format:THREE.RGBAFormat,
      type:THREE.UnsignedByteType,
      generateMipmaps:false,
      minFilter:THREE.LinearFilter,
      magFilter:THREE.LinearFilter,
      depthBuffer:true,
    });
    this.cubeCamera=new THREE.CubeCamera(0.1,150,this.target);
    this.screen=new THREE.Scene();
    this.screenCamera=new THREE.OrthographicCamera(-1,1,1,-1,0,10);
    this.screenCamera.position.z=1;
    this.material=new THREE.ShaderMaterial({
      transparent:true,depthTest:false,depthWrite:false,
      uniforms:{
        uCube:{value:this.target.texture},
        uCam:{value:new THREE.Matrix3()},
        uAspect:{value:1},
        uHalfFov:{value:Math.PI/2},
        uBlend:{value:0},
      },
      vertexShader:`
        varying vec2 vUv;
        void main() {
          vUv=uv;
          gl_Position=vec4(position.xy,0.0,1.0);
        }
      `,
      fragmentShader:`
        uniform samplerCube uCube;
        uniform mat3 uCam;
        uniform float uAspect;
        uniform float uHalfFov;
        uniform float uBlend;
        varying vec2 vUv;
        const float PI = 3.141592653589793;

        void main() {
          vec2 xy=(vUv*2.0-1.0)*vec2(uAspect,1.0);
          float r=length(xy);
          float equidistant=r*uHalfFov;
          float theta=equidistant;
          // Do not evaluate tan(PI/2) at FOV=180° or negative tan beyond
          // the hemisphere. Fully fisheye views have no perspective term.
          // This must match skyLensTheta() used for mouse picking.
          if (uBlend<1.0) {
            float perspective=atan(r*tan(uHalfFov));
            theta=mix(perspective,equidistant,uBlend);
          }
          if (theta>PI) {
            gl_FragColor=vec4(0.0);
            return;
          }
          float s=sin(theta)/max(r,0.000001);
          vec3 local=vec3(xy*s,-cos(theta));
          vec3 direction=normalize(uCam*local);
          gl_FragColor=textureCube(uCube,direction);
        }
      `,
    });
    this.quad=new THREE.Mesh(new THREE.PlaneGeometry(2,2),this.material);
    this.quad.frustumCulled=false;
    this.screen.add(this.quad);
  }

  invalidate():void {this.dirty=true;}

  render(renderer:THREE.WebGLRenderer,scene:THREE.Scene,camera:THREE.PerspectiveCamera):void {
    if(camera.fov<SKY_FISHEYE_START_DEG){
      renderer.render(scene,camera);
      return;
    }
    if(this.dirty){
      // The scene's current view does not affect the cube (observer at origin).
      this.cubeCamera.update(renderer,scene);
      this.dirty=false;
    }
    camera.updateMatrixWorld();
    this.material.uniforms['uCam'].value.setFromMatrix4(camera.matrixWorld);
    this.material.uniforms['uAspect'].value=camera.aspect;
    this.material.uniforms['uHalfFov'].value=camera.fov*Math.PI/360;
    this.material.uniforms['uBlend'].value=fisheyeBlend(camera.fov);
    renderer.render(this.screen,this.screenCamera);
  }

  dispose():void {
    this.quad.geometry.dispose();
    this.material.dispose();
    this.target.dispose();
  }
}
