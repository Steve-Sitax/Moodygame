import * as THREE from "three";
import { psxUniforms } from "../retro/psx";

/** For directly packed model UVs, never psx's remapped atlas:N materials.
 * The map shares the colour atlas layout: R height, G porosity, B restrained wet sheen.
 * One material/program, with weather driven by uniforms; no rain-time shader rebuild.
 */
export function propSurface(mat: THREE.MeshLambertMaterial, surface: THREE.Texture): void {
  surface.colorSpace = THREE.NoColorSpace;
  surface.flipY = false; // glTF atlas UV convention
  surface.wrapS = surface.wrapT = THREE.ClampToEdgeWrapping;
  surface.magFilter = THREE.LinearFilter;
  surface.minFilter = THREE.LinearMipmapLinearFilter;
  mat.bumpMap = surface;
  mat.bumpScale = 0.002;
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
// Damp porous surfaces darken. Metal catches a little light, cloth stays matte.
diffuseColor.rgb *= 1.0 - 0.27 * uPropWet * propSurfaceData.g;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
vec3 propN = inverseTransformDirection(normal, viewMatrix);
vec3 propView = normalize(cameraPosition - vPsxWorld);
float propGrazing = pow(1.0 - max(dot(propN, propView), 0.0), 4.0);
outgoingLight += vec3(0.18, 0.20, 0.21) * uPropWet * propSurfaceData.b * propGrazing;
#include <opaque_fragment>`);
  };
  mat.customProgramCacheKey = () => `${key()}-prop-surface-v1`;
  mat.needsUpdate = true;
}
