import * as THREE from "three";

// Lamp glass in the fog (M7 fog lamps, 2026-09-25, Steve: "small lantern shapes hang in the air in the
// middle of the street, with no person under them"). The glass of the gas lamps, the carried lanterns,
// the quest boxes' lamps and the omnibus lamps was drawn without fog (`fog: false`) so that a lit flame
// shows through it. But the post, the carrier and the box behind it fog away at the fog's far end,
// and the glass did not: an unlit lamp hung as a dark box in the grey, a lantern floated where its
// carrier had faded (and the culler, world/cull.ts, never hid a thing without fog: it may show past it).
//
// Now the glass fogs like what it hangs on. A lit one may carry a little further (`reach`, in fog-fars:
// the flame shows through the fog before the post does), never past `maxReach`, which the culler reads
// (userData.fogReach) to hide the thing beyond it, as it hides the post.

export interface LampFog {
  /** How far the glass shows, in fog-fars (1: as the post; more: a lit flame carries further). */
  value: number;
}

export function lampFog(mat: THREE.Material, reach = 1, maxReach = Math.max(1, reach)): LampFog {
  const u: LampFog = { value: reach };
  (mat as THREE.MeshBasicMaterial).fog = true;
  mat.userData.fogReach = maxReach;
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader, renderer) => {
    prev?.call(mat, shader, renderer);
    shader.uniforms.uFogReach = u;
    shader.fragmentShader =
      "uniform float uFogReach;\n" +
      shader.fragmentShader.replace(
        "#include <fog_fragment>",
        /* glsl */ `#ifdef USE_FOG
          gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, smoothstep(fogNear, fogFar * uFogReach, vFogDepth));
        #endif`,
      );
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `lampfog|${key ? key() : ""}`;
  mat.needsUpdate = true;
  return u;
}
