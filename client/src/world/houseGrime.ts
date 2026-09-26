import * as THREE from "three";
import { wallRelief } from "../retro/psx"; // bump maps on the walls (2026-09-26)

// M7 the grime pass (Steve, 2026-09-25, with a picture of a street at night: "make sure it is not too clean, more
// like it was back then"). The house fronts get old: the plain wall of the facade atlas (the texels
// cityTextures.facadeAtlas marks with alpha 0.5) is drawn from pictures of weathered brick, stained lime plaster
// and grey render (Codex, 2026-09-25, assets/ATTRIBUTION.md) laid along the wall in metres, and over it: patches
// where the plaster has come off and the brick shows, big blotches, dark streaks down the walls and under every
// sill, soot over the windows, green-black damp rising at the foot, worn paint on doors, gates and shutters. How
// much, the house's own dice: its wear, 0 kept well .. 1 black with dirt, in the alpha of its vertex colour
// (tools/blender/build_city.py wear_of: the alley cottages worst, the back streets more than the quays).
// The window cells still line up: only the plain wall's texels change, the painted lintels, sills and plinths stay.

/** A tileable noise, 128 px: r big blotches, g fine speckle, b streaks running down. */
function grimeNoise(): THREE.DataTexture {
  const n = 128;
  let s = 1873 >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const grid = (cells: number) => {
    const v: number[] = [];
    for (let i = 0; i < cells * cells; i++) v.push(rnd());
    return (x: number, y: number) => {
      const fx = (x / n) * cells, fy = (y / n) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (i: number, j: number) => v[((j % cells) + cells) % cells * cells + (((i % cells) + cells) % cells)];
      const a = at(x0, y0) * (1 - sx) + at(x0 + 1, y0) * sx;
      const b = at(x0, y0 + 1) * (1 - sx) + at(x0 + 1, y0 + 1) * sx;
      return a * (1 - sy) + b * sy;
    };
  };
  const big = [grid(4), grid(8), grid(16)];
  const fine = grid(64);
  // streaks: a value per column, smoothed a little across, running down with a slow change of strength
  const cols: number[] = [];
  for (let x = 0; x < n; x++) cols.push(rnd() < 0.35 ? rnd() : rnd() * 0.25);
  const run = grid(4);
  const data = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      const b = big[0](x, y) * 0.55 + big[1](x, y) * 0.3 + big[2](x, y) * 0.15;
      const c = (cols[(x + n - 1) % n] + 2 * cols[x] + cols[(x + 1) % n]) / 4;
      data[i] = Math.round(b * 255);
      data[i + 1] = Math.round(fine(x, y) * 255);
      data[i + 2] = Math.round(Math.min(1, c * (0.4 + 0.9 * run(x * 0.25, y))) * 255);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/**
 * The districts pass: the wall pictures, one layer each of a texture array (build_city.py WALL_LAYERS, the same
 * order), and how many metres one tile of each covers. 13 layers of 512 x 512: 13.6 MB on the GPU, 18 MB with its
 * mipmaps. Loaded as world/quayStone.ts withPicture does: until all are in, the atlas's own paint shows (uWallPics).
 */
const WALL_PICS: Array<[string, number]> = [
  // (metres a tile: from the pictures' own courses, a brick course about 6.5 cm, a stone course 35 to 40 cm)
  ["brick_fine", 2.1], ["brick", 1.9], ["brick_clinker", 2.2], ["speklagen", 2.5], ["brick_yellow", 1.7], ["brick_yellow_old", 1.1],
  ["brick_white", 1.2], ["plaster_smooth", 3.0], ["plaster_rough", 2.5], ["plaster", 3.0], ["render", 3.0], ["ashlar_sand", 2.7], ["ashlar_blue", 3.2],
];
const PIC = 512;

function wallPictures(ready: () => void): THREE.DataArrayTexture {
  const n = WALL_PICS.length;
  const data = new Uint8Array(PIC * PIC * 4 * n);
  const t = new THREE.DataArrayTexture(data, PIC, PIC, n);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  const c = document.createElement("canvas");
  c.width = c.height = PIC;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  let left = n;
  WALL_PICS.forEach(([name], i) => {
    const img = new Image();
    img.onload = () => {
      g.drawImage(img, 0, 0, PIC, PIC);
      data.set(g.getImageData(0, 0, PIC, PIC).data, i * PIC * PIC * 4);
      if (--left === 0) {
        t.needsUpdate = true;
        ready();
      }
    };
    img.onerror = () => console.warn("wall picture did not load", name);
    img.src = `/textures/wall_${name}.jpg`;
  });
  return t;
}

const U = {
  uGrimeNoise: { value: null as THREE.Texture | null },
  uWallArr: { value: null as THREE.DataArrayTexture | null },
  uWallTile: { value: WALL_PICS.map(([, m]) => m) },
  uWallPics: { value: 0 },
  // the paints (build_city.py PAINTS): none; fresh cream, ochre, pale grey, pale green, pale pink, white; greys; old
  // paint; slight tints for the unpainted pictures
  uPaint: {
    value: [
      [1, 1, 1], [0.97, 0.92, 0.8], [0.93, 0.8, 0.56], [0.88, 0.88, 0.84], [0.82, 0.88, 0.78], [0.96, 0.84, 0.8], [0.97, 0.96, 0.92],
      [0.8, 0.8, 0.77], [0.72, 0.73, 0.72], [0.86, 0.85, 0.8], [0.86, 0.8, 0.66], [0.8, 0.7, 0.5], [0.76, 0.76, 0.72], [0.84, 0.78, 0.74],
      [1.04, 0.99, 0.95], [0.94, 0.94, 0.96], [1.0, 0.96, 0.92], [0.9, 0.88, 0.86], [1.06, 1.02, 0.98], [0.97, 1.0, 1.0],
    ].map(([r, g, b]) => new THREE.Vector3(r, g, b)),
  },
};

/** Where the plain wall is (the atlas's alpha), what it is (the cell's style), how worn (the vertex alpha). */
const COMMON = /* glsl */ `
uniform sampler2D uGrimeNoise;
uniform highp sampler2DArray uWallArr;
uniform float uWallTile[${WALL_PICS.length}];
uniform float uWallPics;
varying vec2 vGMat;
uniform vec3 uPaint[20];
vec3 gPic(float layer, vec2 w) {
  int i = int(layer);
  return texture(uWallArr, vec3(w / uWallTile[i], layer)).rgb;
}
float gWearOf() {
  #ifdef USE_COLOR_ALPHA
    return vColor.a;
  #else
    return 0.6;
  #endif
}
// the wall's own frame: along it (u, from the world normal) and up (y), in metres
vec2 gWallUv(vec3 wn) {
  vec2 t = vec2(-wn.z, wn.x);
  float l = length(t);
  return l > 0.3 ? vec2(dot(vPsxWorld.xz, t / l), vPsxWorld.y) : vPsxWorld.xz;
}
`;

function install(mat: THREE.Material, kind: "facade" | "stone"): void {
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey.bind(mat);
  mat.onBeforeCompile = (shader, renderer) => {
    prev.call(mat, shader, renderer);
    Object.assign(shader.uniforms, U);
    // the house's wall picture and paint (build_city.py "Mat": r = layer / 16, g b a the paint)
    shader.vertexShader = shader.vertexShader.replace("void main() {", "attribute vec2 gmat;\nvarying vec2 vGMat;\nvoid main() {\n  vGMat = gmat;");
    let fs = shader.fragmentShader;
    // (just before main: the varyings it reads, vColor and vPsxWorld, are declared by then)
    fs = fs.replace("void main() {", COMMON + "\nvoid main() {");
    const facade = kind === "facade";
    fs = fs.replace(
      "#include <color_fragment>",
      /* glsl */ `{
      float gWear = gWearOf();
      vec3 gN = normalize((vec4(vNormal, 0.0) * viewMatrix).xyz);
      float gVert = 1.0 - abs(gN.y);
      vec2 gW = gWallUv(gN);
      vec4 gNz = texture2D(uGrimeNoise, gW / 5.0);
      vec4 gNf = texture2D(uGrimeNoise, gW / 1.3);
      float gStreak = texture2D(uGrimeNoise, vec2(gW.x / 2.2, gW.y / 9.0)).b;
      ${
        facade
          ? /* glsl */ `
      vec2 gCell = floor(vCell + 0.5);
      vec2 gLc = fract(vMapUv);
      bool gWallCell = (gCell.x < 3.5 && gCell.y < 3.5) || gCell.y > 6.5;
      float gStyle = gCell.y > 6.5 ? gCell.x : gCell.y;
      float gFill = gWallCell ? 1.0 - step(0.75, diffuseColor.a) : 0.0;
      if (gFill > 0.5 && uWallPics > 0.5) {
        // the plain wall from the house's own picture, in its paint (the painted ones) or a slight tint
        float layer = floor(vGMat.x + 0.5);
        // (glTF stores v flipped: the paint's index is 1 - v)
        vec3 gPaint = uPaint[int(clamp(floor(1.5 - vGMat.y), 0.0, 19.0))];
        vec3 pic = gPic(layer, gW) * gPaint;
        if (layer > 5.5 && layer < 10.5) {
          // plaster and limewash (Steve's review, 2026-09-26: "leopard blotches"): the picture's own patches and
          // stains flattened, so the skin reads as one; the weathering is drawn here, the way water and damp make it
          int gi = int(layer);
          vec3 gFlat = textureLod(uWallArr, vec3(gW / uWallTile[gi], layer), 6.0).rgb * gPaint;
          pic = mix(gFlat, pic, 0.4);
          // soft stains, long and ragged, running down (never round): brown where the water ran and dried
          float gSt = texture2D(uGrimeNoise, vec2(gW.x / 3.4 + 0.37, gW.y / 12.0)).r * 0.7 + texture2D(uGrimeNoise, vec2(gW.x / 1.1, gW.y / 4.0)).g * 0.3;
          pic *= mix(vec3(1.0), vec3(0.8, 0.75, 0.66), smoothstep(0.45, 0.8, gSt) * (0.2 + 0.8 * gWear));
          // plaster fallen off a worn house: few, ragged, hard-edged holes to the brick, most near the foot where
          // the damp works; a light rim where the plaster breaks, a shadow under its lower edge
          if (gWear > 0.55) {
            vec2 gWp = gW + (vec2(gNf.g, texture2D(uGrimeNoise, gW / 0.8 + 0.5).g) - 0.5) * 0.7;
            float gM = texture2D(uGrimeNoise, vec2(gWp.x / 4.5, gWp.y / 2.6) + 0.21).r * 0.8 + texture2D(uGrimeNoise, gWp / 0.9).g * 0.2;
            float gMu = texture2D(uGrimeNoise, vec2(gWp.x / 4.5, (gWp.y + 0.05) / 2.6) + 0.21).r * 0.8 + texture2D(uGrimeNoise, vec2(gWp.x, gWp.y + 0.05) / 0.9).g * 0.2;
            float gLow = 1.0 - smoothstep(0.4, 3.0, vPsxWorld.y);
            float gThr = 0.74 - 0.08 * (gWear - 0.55) / 0.45 - 0.1 * gLow;
            float gOff = step(gThr, gM);
            float gRim = step(gThr - 0.02, gM) - gOff;
            vec3 gBrick = gPic(1.0, gW) * mix(vec3(1.0), vec3(0.75, 0.72, 0.66), gLow);
            pic = mix(pic, gBrick, gOff);
            pic = mix(pic, pic * 1.1 + 0.02, gRim * 0.7);
            pic *= 1.0 - 0.35 * gOff * (1.0 - step(gThr, gMu));
          }
        }
        diffuseColor.rgb = diffuse * pic * 1.08;
        // --- bump maps on the walls (retro/psx.ts wallRelief, 2026-09-26): the picture's height map ---
        #ifdef WALL_RELIEF
        diffuseColor.rgb *= wallRelief(layer, gW, gN, uWallTile[int(layer)]);
        #endif
        // ---
      }
      if (gWallCell) {
        // under every sill a dark run of water, over every window soot (the upper and far-off cells: the window
        // 21..43 of 64 across; the shop window 12..52), fading into the wall
        bool gUp = gCell.y > 6.5 || (gCell.x > 0.5 && gCell.x < 1.5);
        bool gShop = gCell.x < 0.5 && gCell.y < 3.5;
        if (gUp || gShop) {
          float a0 = gUp ? 0.3 : 0.17, a1 = gUp ? 0.7 : 0.83;
          float col = smoothstep(a0 - 0.04, a0 + 0.04, gLc.x) * (1.0 - smoothstep(a1 - 0.04, a1 + 0.04, gLc.x));
          float run = smoothstep(0.0, 0.14, gLc.y) * (1.0 - step(0.14, gLc.y)) * (0.45 + 0.9 * gStreak);
          float soot = gUp ? smoothstep(0.875, 0.97, gLc.y) : 0.0;
          diffuseColor.rgb *= 1.0 - col * (run * 0.45 + soot * 0.3) * (0.35 + 0.65 * gWear);
        }
        // big blotches, and streaks down the whole wall
        diffuseColor.rgb *= 1.0 - (gNz.r - 0.45) * 0.2 * gWear;
        diffuseColor.rgb *= 1.0 - gStreak * 0.38 * gWear * gVert;
      }`
          : /* glsl */ `
      // stone (sills, heads, cornices, quoins, kerbs): darker with the years, streaked
      diffuseColor.rgb *= (1.0 - 0.28 * gWear) * (1.0 - gStreak * 0.3 * gWear * gVert) * (1.0 - (gNz.r - 0.45) * 0.3 * gWear);`
      }
      // grime pass 2: more soot the higher up (the smoke of the town's chimneys), and on the cornices
      diffuseColor.rgb *= 1.0 - smoothstep(4.5, 14.0, vPsxWorld.y) * 0.32 * gWear;
      // green-black damp rising from the street: higher on a worn house, a ragged top edge
      float gTop = 0.4 + 0.7 * gWear + 0.35 * (gNf.g - 0.5) + 0.25 * (gNz.r - 0.5);
      float gDamp = (1.0 - smoothstep(gTop - 0.3, gTop, vPsxWorld.y)) * gVert;
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.4, 0.46, 0.34), gDamp * 0.8);
      diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.18, vPsxWorld.y)) * 0.3 * gVert;
    }
    #include <color_fragment>
    {
      float gWear = gWearOf();
      ${
        facade
          ? /* glsl */ `
      // worn paint on the doors, the gates, the loading doors and the shutters: flakes of bare grey wood, the kick
      // rail scuffed dark
      vec2 gCell2 = floor(vCell + 0.5);
      vec2 gLc2 = fract(vMapUv);
      bool gLeaf = (gCell2.y > 3.5 && gCell2.y < 4.5 && gCell2.x > 3.5) || (gCell2.y > 5.5 && gCell2.y < 6.5 && gCell2.x > 3.5 && gCell2.x < 6.5)
                || (gCell2.y > 4.5 && gCell2.y < 5.5 && gCell2.x > 5.5 && gCell2.x < 6.5) || (gCell2.y > 1.5 && gCell2.y < 2.5 && gCell2.x > 3.5 && gCell2.x < 5.5);
      if (gLeaf) {
        // (big flakes, at the edges and low down most: the blotch noise, not the speckle)
        vec2 gP = gWallUv(normalize((vec4(vNormal, 0.0) * viewMatrix).xyz)) * 1.6 + vCell * 0.37;
        float fl = texture2D(uGrimeNoise, gP).r * 0.7 + texture2D(uGrimeNoise, gP * 3.0).r * 0.3;
        float edge = max(1.0 - smoothstep(0.0, 0.08, min(gLc2.x, 1.0 - gLc2.x)), 1.0 - smoothstep(0.0, 0.3, gLc2.y));
        float flake = smoothstep(0.72 - 0.12 * gWear - 0.15 * edge, 0.75 - 0.12 * gWear - 0.15 * edge, fl);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.13, 0.115, 0.1), flake * 0.5 * gWear);
        diffuseColor.rgb *= 1.0 - (1.0 - smoothstep(0.0, 0.16, gLc2.y)) * 0.35 * gWear;
      }
      // over all of it a brown-black film of coal smoke: darker, never grey
      diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.76, 0.7), gWear);`
          : ""
      }
      diffuseColor.a = opacity;
    }`,
    );
    shader.fragmentShader = fs;
  };
  mat.customProgramCacheKey = () => `${prevKey()}-grime-${kind}`;
  mat.needsUpdate = true;
}

/**
 * Make the house materials of world/city.ts old and dirty: `facade` (the facade atlas) and `trim` (stone).
 * The pictures load in the background; until then the painted atlas shows with the grime over it.
 */
export function houseGrime(facade: THREE.Material, trim: THREE.Material): void {
  U.uGrimeNoise.value ??= grimeNoise();
  U.uWallArr.value ??= wallPictures(() => (U.uWallPics.value = 1));
  install(facade, "facade");
  install(trim, "stone");
  // --- bump maps on the walls (retro/psx.ts wallRelief, 2026-09-26) ---
  wallRelief(facade, WALL_PICS.map(([name]) => name));
  // ---
}

/**
 * Grime pass 2: the material of the decals (build_city.py MAT_GRIME: rust runs, soot, damp, corner grime): its
 * dark tint laid over the wall, as much as the cell's alpha times the house's wear; the fog washes it out far off;
 * it writes no depth and is pulled forward, so it never fights the wall.
 */
export function grimeDecalMaterial(map: THREE.Texture, cells = 4): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { map: { value: null } }]),
    vertexShader: /* glsl */ `
      attribute vec2 cell;
      attribute vec4 color;
      varying vec2 vUv;
      varying vec2 vCell;
      varying vec4 vCol;
      #include <fog_pars_vertex>
      void main() {
        vUv = uv;
        vCell = cell;
        vCol = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec2 vCell;
      varying vec4 vCol;
      #include <fog_pars_fragment>
      void main() {
        float a = texture2D(map, (floor(vCell + 0.5) + fract(vUv)) / ${cells.toFixed(1)}).a * vCol.a;
        // (unlit: the day's light from the fog's colour, so a light decal, the ghost of a pulled-down house's plaster
        // and its wallpaper, darkens at dusk with the wall under it; 0.125 its brightness by day)
        float light = 1.0;
        #ifdef USE_FOG
          a *= 1.0 - smoothstep(fogNear, fogFar, vFogDepth);
          light = clamp(dot(fogColor, vec3(0.3, 0.59, 0.11)) / 0.125, 0.06, 1.0);
        #endif
        gl_FragColor = vec4(vCol.rgb * light, a);
        #include <colorspace_fragment>
      }`,
    fog: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -4,
  });
  m.uniforms.map.value = map;
  return m;
}
