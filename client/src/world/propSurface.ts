import * as THREE from "three";
import { psxUniforms } from "../retro/psx";

/** For directly packed model UVs, never psx's remapped atlas:N materials.
 * The map shares the colour atlas layout: R height, G porosity (B, once a wet sheen, is not read: Steve, 2026-09-27,
 * the rain drew pale rims on the barrels' staves and hoops; wet wood only darkens now).
 * One material/program, with weather driven by uniforms; no rain-time shader rebuild.
 * `bump`: three.js bumpScale; under 0.05 it is metres and world/bumps.ts lifts it to its kind's strength.
 */
export function propSurface(mat: THREE.MeshLambertMaterial, surface: THREE.Texture, bump = 0.002): void {
  surface.colorSpace = THREE.NoColorSpace;
  surface.flipY = false; // glTF atlas UV convention
  surface.wrapS = surface.wrapT = THREE.ClampToEdgeWrapping;
  surface.magFilter = THREE.LinearFilter;
  surface.minFilter = THREE.LinearMipmapLinearFilter;
  mat.bumpMap = surface;
  mat.bumpScale = bump;
  const previous = mat.onBeforeCompile;
  const key = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    previous.call(mat, shader, renderer);
    shader.uniforms.uPropWet = psxUniforms.uWet;
    shader.uniforms.uPropSurface = { value: surface };
    shader.fragmentShader = shader.fragmentShader.replace('void main() {', `
uniform float uPropWet;
uniform sampler2D uPropSurface;
void main() {`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `
vec3 propBaseNormal = normal;
#include <normal_fragment_maps>
normal = normalize(mix(propBaseNormal, normal, 1.0 - smoothstep(5.0, 14.0, length(vPsxWorld - cameraPosition))));`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
#include <color_fragment>
vec3 propSurfaceData = texture2D(uPropSurface, vMapUv).rgb;
// Damp porous surfaces darken; metal and cloth stay as they are.
diffuseColor.rgb *= 1.0 - 0.27 * uPropWet * propSurfaceData.g;`);
  };
  mat.customProgramCacheKey = () => `${key()}-prop-surface-v2`;
  mat.needsUpdate = true;
}
