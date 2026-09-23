import * as THREE from "three";

// PS1-style material patch: vertex snap, affine texture warp, and fog that
// picks up warm light from the gas lamps (analytic in-scatter per lamp).
// Numbers here are look settings from docs/05-art-direction.md.

export const MAX_LAMPS = 6;

export const psxUniforms = {
  uSnapRes: { value: new THREE.Vector2(240, 135) },
  uTime: { value: 0 },
  // xyz = lamp position, w = current brightness (flicker)
  uLamps: { value: Array.from({ length: MAX_LAMPS }, () => new THREE.Vector4(0, -999, 0, 0)) },
  uLampColor: { value: new THREE.Color(1.0, 0.62, 0.28) },
  uScatter: { value: 0.55 },
};

export interface PsxOptions {
  /** Animate vertices as water waves. */
  water?: boolean;
  /** Affine texture warp strength, 0..1. */
  affine?: number;
  /** Skip vertex snap (UI-ish objects like the sky). */
  noSnap?: boolean;
  /**
   * Texture atlas of N x N cells (the city houses): the geometry has a "cell"
   * attribute (column, row) and the uv repeats inside that cell.
   */
  atlas?: number;
  /** Fog reaches this many times further (landmarks: a shape in the fog from afar). */
  fogReach?: number;
}

const commonVertex = /* glsl */ `
uniform vec2 uSnapRes;
uniform float uTime;
varying vec3 vPsxWorld;
#ifdef USE_MAP
varying vec3 vAffineUv;
#endif
`;

const commonFragment = /* glsl */ `
#define MAX_LAMPS ${MAX_LAMPS}
uniform vec4 uLamps[MAX_LAMPS];
uniform vec3 uLampColor;
uniform float uScatter;
uniform float uAffine;
varying vec3 vPsxWorld;
#ifdef USE_MAP
varying vec3 vAffineUv;
#endif

// Light scattered toward the eye along the view ray, from one point light.
// Closed form of integral 1/(h^2 + t^2)^2 dt over the ray segment: a tight
// halo that stays near the lamp, so the fog is only warm under the lamps.
float halfScatter(float t, float h) {
  float h2 = h * h;
  return 0.5 * (t / (h2 * (h2 + t * t)) + atan(t / h) / (h2 * h));
}
float lampScatter(vec3 ro, vec3 rd, float len, vec3 p) {
  vec3 q = p - ro;
  float t0 = dot(q, rd);
  float d = length(q - rd * t0);
  float h = d + 1.2;
  float tight = halfScatter(len - t0, h) - halfScatter(-t0, h);
  // soft wide term, integral of 1/(h^2 + t^2), faded out past ~12 m
  float hw = d + 2.5;
  float wide = (atan((len - t0) / hw) - atan(-t0 / hw)) / hw;
  return tight + wide * 0.22 * smoothstep(14.0, 4.0, d);
}
// Mirror image of a lamp on the water: only the sharp core, no wide wash.
float lampReflect(vec3 ro, vec3 rd, vec3 p) {
  vec3 q = p - ro;
  float t0 = dot(q, rd);
  if (t0 < 0.0) return 0.0;
  float h = length(q - rd * t0) + 0.6;
  return min(halfScatter(60.0 - t0, h) - halfScatter(-t0, h), 4.0);
}
`;

export function psx<T extends THREE.Material>(mat: T, opts: PsxOptions = {}): T {
  const affine = opts.affine ?? 1.0;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uSnapRes = psxUniforms.uSnapRes;
    shader.uniforms.uTime = psxUniforms.uTime;
    shader.uniforms.uLamps = psxUniforms.uLamps;
    shader.uniforms.uLampColor = psxUniforms.uLampColor;
    shader.uniforms.uScatter = psxUniforms.uScatter;
    shader.uniforms.uAffine = { value: affine };

    let vs = shader.vertexShader;
    vs = vs.replace("#include <common>", "#include <common>\n" + commonVertex + (opts.atlas ? "attribute vec2 cell;\nvarying vec2 vCell;\n" : ""));
    if (opts.atlas) vs = vs.replace("#include <uv_vertex>", "#include <uv_vertex>\nvCell = cell;");

    if (opts.water) {
      // Plane is rotated -90 deg on X: local x = world x, local y = -world z,
      // local z = world up. Waves are a sum of sines; normals from their slope.
      vs = vs.replace(
        "#include <beginnormal_vertex>",
        /* glsl */ `vec3 objectNormal;
        {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float t = uTime;
          float dx = cos(wp.x * 0.35 + t * 0.9) * 0.035
                   + cos(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.016
                   + cos((wp.x + wp.z) * 1.3 + t * 1.7) * 0.039
                   + cos(wp.x * 3.1 - wp.z * 1.7 + t * 2.3) * 0.09;
          float dz = cos(wp.z * 0.55 - t * 0.7 + wp.x * 0.2) * 0.044
                   + cos((wp.x + wp.z) * 1.3 + t * 1.7) * 0.039
                   - cos(wp.x * 3.1 - wp.z * 1.7 + t * 2.3) * 0.05;
          objectNormal = normalize(vec3(-dx, dz, 1.0));
        }
        #ifdef USE_TANGENT
        vec3 objectTangent = vec3(tangent.xyz);
        #endif`,
      );
      vs = vs.replace(
        "#include <begin_vertex>",
        /* glsl */ `#include <begin_vertex>
        {
          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          float w = sin(wp.x * 0.35 + uTime * 0.9) * 0.10
                  + sin(wp.z * 0.55 - uTime * 0.7 + wp.x * 0.2) * 0.08
                  + sin((wp.x + wp.z) * 1.3 + uTime * 1.7) * 0.03;
          transformed.z += w;
        }`,
      );
    }

    vs = vs.replace(
      "#include <project_vertex>",
      /* glsl */ `#include <project_vertex>
      vPsxWorld = (inverse(viewMatrix) * mvPosition).xyz;
      ${
        opts.noSnap
          ? ""
          : `{
        // snap only past arm's length: up close the jitter just looks broken
        vec2 grid = uSnapRes;
        vec2 ndc = gl_Position.xy / gl_Position.w;
        vec2 snapped = floor(ndc * grid + 0.5) / grid;
        float k = smoothstep(1.5, 4.0, gl_Position.w);
        gl_Position.xy = mix(ndc, snapped, k) * gl_Position.w;
      }`
      }
      #ifdef USE_MAP
      vAffineUv = vec3(vMapUv * gl_Position.w, gl_Position.w);
      #endif`,
    );
    shader.vertexShader = vs;

    let fs = shader.fragmentShader;
    fs = fs.replace("#include <common>", "#include <common>\n" + commonFragment + (opts.atlas ? "varying vec2 vCell;\n" : ""));
    fs = fs.replace(
      "#include <map_fragment>",
      /* glsl */ `#ifdef USE_MAP
      {
        // affine warp fades in with distance: textures swim a little far off,
        // but stay straight at your feet and on walls you touch
        vec2 affUv = vAffineUv.xy / vAffineUv.z;
        float near = smoothstep(4.0, 14.0, length(vPsxWorld - cameraPosition));
        vec2 psxUv = mix(vMapUv, affUv, uAffine * near);
        ${opts.atlas ? `psxUv = (vCell + fract(psxUv)) / ${opts.atlas.toFixed(1)};` : ""}
        vec4 sampledDiffuseColor = texture2D(map, psxUv);
        diffuseColor *= sampledDiffuseColor;
      }
      #endif`,
    );
    fs = fs.replace(
      "#include <fog_fragment>",
      /* glsl */ `#ifdef USE_FOG
      {
        vec3 ro = cameraPosition;
        vec3 toFrag = vPsxWorld - ro;
        float len = length(toFrag);
        vec3 rd = toFrag / max(len, 1e-4);
        float glow = 0.0;
        for (int i = 0; i < MAX_LAMPS; i++) {
          glow += uLamps[i].w * lampScatter(ro, rd, len, uLamps[i].xyz);
        }
        float fogFactor = smoothstep(fogNear, fogFar * ${(opts.fogReach ?? 1).toFixed(2)}, vFogDepth);
        ${
          opts.water
            ? `{
          // wet mirror: fog sheen at grazing angles, lamp light smeared by waves
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          float fres = pow(1.0 - max(dot(wn, -rd), 0.0), 3.0);
          gl_FragColor.rgb += fogColor * fres * 0.3;
          vec3 rr = reflect(rd, wn);
          float refl = 0.0;
          for (int i = 0; i < MAX_LAMPS; i++) {
            refl += uLamps[i].w * lampReflect(vPsxWorld, rr, uLamps[i].xyz);
          }
          gl_FragColor.rgb += uLampColor * refl * 0.12;
        }`
            : ""
        }
        vec3 halo = uLampColor * glow * uScatter;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fogFactor);
        // in-scatter sits in the air between eye and surface
        gl_FragColor.rgb += halo * (0.35 + 0.65 * fogFactor);
      }
      #endif`,
    );
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `psx-${opts.water ? 1 : 0}-${opts.noSnap ? 1 : 0}-${opts.atlas ?? 0}-${opts.fogReach ?? 1}`;
  return mat;
}
