import * as THREE from "three";
import { LAMP_SCATTER_GLSL, MAX_LAMPS, psxUniforms } from "../retro/psx";

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
//
// Night fog (2026-09-26): the air in front of it glows with the lamps as it does in front of every psx
// surface (retro/psx.ts in-scatter) and the sky (world/sky.ts). Without it a far lamp's glass, or anything
// else fogged this way (the dark lining of a house seen through its windows, world/houseInWorld.ts), was a
// dark spot in the glowing air round it. `lampFog(mat, 1)` gives any plain material the psx fog.

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
    shader.uniforms.uLamps = psxUniforms.uLamps;
    shader.uniforms.uLampColor = psxUniforms.uLampColor;
    shader.uniforms.uScatter = psxUniforms.uScatter;
    // the world point (inverse of the view: a rigid move), for the ray from the eye
    shader.vertexShader =
      "varying vec3 vAirWorld;\n" +
      shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\n  vAirWorld = transpose(mat3(viewMatrix)) * (mvPosition.xyz - viewMatrix[3].xyz);",
      );
    shader.fragmentShader =
      `uniform float uFogReach;\n#define MAX_LAMPS ${MAX_LAMPS}\nuniform vec4 uLamps[MAX_LAMPS];\nuniform vec3 uLampColor;\nuniform float uScatter;\nvarying vec3 vAirWorld;\n${LAMP_SCATTER_GLSL}\n` +
      shader.fragmentShader.replace(
        "#include <fog_fragment>",
        /* glsl */ `#ifdef USE_FOG
          {
            vec3 toFrag = vAirWorld - cameraPosition;
            float len = length(toFrag);
            vec3 rd = toFrag / max(len, 1e-4);
            float glowLen = glowReach(len, fogFar, rd);
            float glow = 0.0;
            for (int i = 0; i < MAX_LAMPS; i++) glow += uLamps[i].w * lampScatter(cameraPosition, rd, glowLen, uLamps[i].xyz);
            float fogK = smoothstep(fogNear, fogFar * uFogReach, vFogDepth);
            gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogK);
            gl_FragColor.rgb += uLampColor * glow * uScatter * (0.35 + 0.65 * fogK) * gl_FragColor.a;
          }
        #endif`,
      );
  };
  const key = mat.customProgramCacheKey?.bind(mat);
  mat.customProgramCacheKey = () => `lampfog2|${key ? key() : ""}`;
  mat.needsUpdate = true;
  return u;
}
