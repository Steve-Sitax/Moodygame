import * as THREE from "three";

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

/** A picture of a wall, loaded as world/quayStone.ts withPicture does; until all three are in, the atlas's own
 * paint shows (uWallPics). */
function wallPicture(url: string, ready: () => void): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 2;
  const t = new THREE.Texture(c as unknown as HTMLImageElement);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  const img = new Image();
  img.onload = () => {
    t.image = img;
    t.needsUpdate = true;
    ready();
  };
  img.onerror = () => console.warn("texture picture did not load", url);
  img.src = url;
  return t;
}

const U = {
  uGrimeNoise: { value: null as THREE.Texture | null },
  uBrickPic: { value: null as THREE.Texture | null },
  uPlasterPic: { value: null as THREE.Texture | null },
  uRenderPic: { value: null as THREE.Texture | null },
  uWallPics: { value: 0 },
};

/** Where the plain wall is (the atlas's alpha), what it is (the cell's style), how worn (the vertex alpha). */
const COMMON = /* glsl */ `
uniform sampler2D uGrimeNoise;
uniform sampler2D uBrickPic;
uniform sampler2D uPlasterPic;
uniform sampler2D uRenderPic;
uniform float uWallPics;
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
        // the plain wall from the pictures: brick (the dark brick darker), lime plaster, grey render
        vec3 brick = texture2D(uBrickPic, gW / 1.9).rgb;
        vec3 pic = gStyle < 0.5 ? brick * vec3(1.02, 0.98, 0.95)
                 : gStyle < 1.5 ? texture2D(uPlasterPic, gW / 3.0).rgb
                 : gStyle < 2.5 ? texture2D(uRenderPic, gW / 3.0).rgb
                 : brick * vec3(0.66, 0.6, 0.58);
        // plaster come off in patches, the brick behind it showing
        if (gStyle > 0.5 && gStyle < 2.5) {
          // (the plaster picture has its own; a worn house more)
          float off = smoothstep(0.84 - 0.1 * gWear, 0.87 - 0.1 * gWear, gNz.r * 0.8 + gNf.g * 0.2);
          pic = mix(pic, brick * 0.9, off);
        }
        diffuseColor.rgb = diffuse * pic * 1.08;
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
  if (!U.uBrickPic.value) {
    let n = 0;
    const one = () => {
      n++;
      if (n === 3) U.uWallPics.value = 1;
    };
    U.uBrickPic.value = wallPicture("/textures/wall_brick.jpg", one);
    U.uPlasterPic.value = wallPicture("/textures/wall_plaster.jpg", one);
    U.uRenderPic.value = wallPicture("/textures/wall_render.jpg", one);
  }
  install(facade, "facade");
  install(trim, "stone");
}
