import * as THREE from "three";
import { gustRoar, rollingCask, shutterBang, signCreak, slateCrash, waveSlam } from "../../audio/aliveSounds";
import { mistMaterial } from "./air";
import { rand, type Ctx, type Frame, type Part } from "./common";
import { tempest } from "../tempest";
import { neverMirrored } from "../mirror";

// The great storm's own noises (Steve 2026-09-28: "make it have nice sounds"; world/tempest.ts). All made in code
// (audio/aliveSounds.ts), each at a real place round Jef with its own reach:
// - the gusts: a roar with a howl in it, from upwind, as each front of wind comes down the street to him;
// - shutters and loose doors slamming on the house fronts; a slate sliding off a roof and breaking on the stones;
//   a shop sign squealing on its bracket; now and then an empty cask rolling and knocking over the open ground.
// More and more often the harder it blows; nothing at all on any other day. Nothing drawn: the leaves and the
// paper flying (leaves.ts), the rain, the sea and the lightning show it.

/** A house front round Jef: out along a random way from him to the first wall, 6 to 55 m off (a square is wide). */
function wallNear(ctx: Ctx, f: Frame): { x: number; z: number } | null {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let d = 2; d < 55; d += 0.8) {
      const fl = ctx.flags(f.eye.x + dx * d, f.eye.z + dz * d);
      if (fl === undefined || fl === 2 || fl === 4) break; // (water or outside the town: no house that way)
      if (fl === 1) {
        if (d < 6) break;
        // (a step back from the wall: the sound is on its face, not in it)
        return { x: f.eye.x + dx * (d - 0.4), z: f.eye.z + dz * (d - 0.4) };
      }
    }
  }
  return null;
}

/** Open ground 10 to 25 m off (a cask rolls there). */
function openNear(ctx: Ctx, f: Frame): { x: number; z: number } | null {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(10, 25);
    const x = f.eye.x + Math.cos(a) * d;
    const z = f.eye.z + Math.sin(a) * d;
    if (ctx.flags(x, z) === 0) return { x, z };
  }
  return null;
}

export function createGale(ctx: Ctx): Part {
  let on = true;
  const next = { bang: 3, slate: 12, sign: 6, cask: 40, gust: 0 };
  let lastGust = 0;
  const heard = { bang: 0, slate: 0, sign: 0, cask: 0, gust: 0 };
  let fury = 0;

  function update(f: Frame): void {
    fury = f.weather === "storm" ? tempest.level : 0;
    if (!on || fury < 0.12) return;
    const snd = ctx.sound();
    if (!snd) return;
    const dt = f.dt;
    // the gusts: a roar as each front comes to him (world/alive/wind.ts), from upwind
    const g = ctx.wind.gustAt(f.eye.x, f.eye.z);
    next.gust -= dt;
    if (g > 0.9 && lastGust <= 0.9 && next.gust <= 0) {
      next.gust = 2.5;
      const up = ctx.wind.dir;
      const at = { x: f.eye.x - up.x * 22, y: 7, z: f.eye.z - up.y * 22 };
      if (snd.placed(at, { ref: 30, reach: 400, max: 1e9, occl: 0, wet: 0.5, gain: 0.9 * fury, must: true }, gustRoar(Math.min(1, g / 2.4), rand(3, 5.5)))) heard.gust++;
    }
    lastGust = g;
    const tick = (k: keyof typeof next, gap: [number, number], play: () => boolean) => {
      next[k] -= dt;
      if (next[k] > 0) return;
      next[k] = rand(gap[0], gap[1]) / Math.max(0.25, fury);
      if (play()) heard[k as keyof typeof heard]++;
    };
    tick("bang", [1.2, 4.5], () => {
      const w = wallNear(ctx, f);
      return !!w && snd.placed({ x: w.x, y: rand(1.5, 5), z: w.z }, { ref: 4, reach: 60, max: 110, wet: 0.35 }, shutterBang(1 + Math.floor(Math.random() * 4)));
    });
    tick("slate", [7, 18], () => {
      const w = wallNear(ctx, f);
      return !!w && snd.placed({ x: w.x, y: 1, z: w.z }, { ref: 4, reach: 50, max: 90, wet: 0.3 }, slateCrash());
    });
    tick("sign", [4, 10], () => {
      const w = wallNear(ctx, f);
      return !!w && snd.placed({ x: w.x, y: 3.2, z: w.z }, { ref: 2.5, reach: 30, max: 45, wet: 0.25 }, signCreak());
    });
    tick("cask", [25, 60], () => {
      const o = openNear(ctx, f);
      return !!o && snd.placed({ x: o.x, y: 0.3, z: o.z }, { ref: 3, reach: 40, max: 60, wet: 0.2 }, rollingCask(rand(2.5, 5)));
    });
  }

  return {
    name: "gale",
    update,
    info: () => ({ fury: +fury.toFixed(2), heard: { ...heard } }),
    setOn: (v) => {
      on = v;
    },
  };
}

// ------------------------------------------------------------------ the surf against the quays

const SPRAY = 1400;
/** The splashes standing up the walls at once (each a sheet of white water, one draw call). */
const SHEETS = 6;

const SHEET_V = /* glsl */ `
  uniform float uT;
  uniform float uSeed;
  uniform float uH;
  uniform float uLean;
  varying vec2 vUv;
  varying float vFogDepth;
  float sh(float n) { return fract(sin(n) * 43758.5453); }
  void main() {
    vec3 p = position;
    // up the wall and down again; taller in the middle, in ragged jets along it
    float env = 1.0 - pow(abs(p.x) * 2.0, 2.0);
    float rise = sin(3.14159 * clamp(uT * 1.3, 0.0, 1.0));
    float c = (p.x + 0.5) * 11.0 + uSeed * 7.0;
    float jet = mix(sh(floor(c) + uSeed * 13.1), sh(floor(c) + 1.0 + uSeed * 13.1), smoothstep(0.0, 1.0, fract(c)));
    float h = uH * env * rise * (0.55 + 0.45 * jet);
    // the top is thrown over onto the quay by the gale
    vec3 w = vec3(p.x, p.y * h, p.y * p.y * uLean * h * 0.45);
    vec4 mv = modelViewMatrix * vec4(w, 1.0);
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
    vUv = vec2(p.x + 0.5, p.y);
  }`;

const SHEET_F = /* glsl */ `
  uniform vec3 uTint;
  uniform float uT;
  uniform float uSeed;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec2 vUv;
  varying float vFogDepth;
  float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hh(i), hh(i + vec2(1, 0)), f.x), mix(hh(i + vec2(0, 1)), hh(i + vec2(1, 1)), f.x), f.y);
  }
  void main() {
    // white water: streaks running up it, foam churning in it, a ragged top that tears into spray
    float streak = vn(vec2(vUv.x * 16.0 + uSeed * 9.0, vUv.y * 2.5 - uT * 5.0));
    float foam = vn(vec2(vUv.x * 34.0 + uSeed * 3.0, vUv.y * 10.0 - uT * 9.0));
    float a = smoothstep(1.0, 0.45, vUv.y + (streak - 0.5) * 0.6) * (0.5 + 0.5 * foam);
    a *= smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
    a *= 1.0 - smoothstep(0.5, 1.0, uT);
    a *= 0.9;
    if (a < 0.03) discard;
    vec3 col = uTint * (0.8 + 0.3 * foam);
    float f = smoothstep(fogNear, fogFar, vFogDepth);
    gl_FragColor = vec4(mix(col, fogColor, f * 0.85), a * (1.0 - f * 0.5));
    #include <colorspace_fragment>
  }`;


/**
 * The great storm's surf (Steve 2026-09-28: "water from the Schelde splashing up the walls"): the seas run at the
 * quay walls round Jef and burst up them, a sheet of white water thrown over the edge and blown onto the stones by
 * the wind, falling back in a hiss. Where: the nearest quay edges within 40 m (found by looking out from Jef to the
 * first water). How often: every half second to two, more the harder it blows. The puffs are the breath's mist
 * material (one shader), thicker and whiter; the slam is made in code (audio/aliveSounds.ts waveSlam).
 */
export function createSurf(ctx: Ctx): Part {
  let on = true;
  const pos = new Float32Array(SPRAY * 3);
  const age = new Float32Array(SPRAY).fill(-1);
  const size = new Float32Array(SPRAY).fill(1);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const tint = { value: new THREE.Color() };
  const pts = new THREE.Points(g, mistMaterial(tint, { value: 2.2 }));
  pts.frustumCulled = false;
  pts.name = "alive_surf";
  neverMirrored.push(pts);
  pts.renderOrder = 4;
  ctx.scene.add(pts);
  // the sheets of white water thrown up the walls (built at load, drawn while one stands)
  const sheetGeo = new THREE.PlaneGeometry(1, 1, 18, 8);
  sheetGeo.translate(0, 0.5, 0);
  const sheetBase = new THREE.ShaderMaterial({
    uniforms: { ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uT: { value: 0 }, uSeed: { value: 0 }, uH: { value: 3 }, uLean: { value: 0 }, uTint: tint },
    vertexShader: SHEET_V,
    fragmentShader: SHEET_F,
    transparent: true,
    depthWrite: false,
    fog: true,
  });
  sheetBase.name = "surf_sheet";
  const sheets = Array.from({ length: SHEETS }, () => {
    const m = sheetBase.clone();
    m.uniforms.uTint = tint;
    const mesh = new THREE.Mesh(sheetGeo, m);
    mesh.frustumCulled = false;
    mesh.visible = false;
    mesh.renderOrder = 4;
    mesh.name = "alive_surf_sheet";
    neverMirrored.push(mesh);
    ctx.scene.add(mesh);
    return { mesh, mat: m, t: -1, life: 2 };
  });
  interface Drop { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; floor: number }
  const drops: Drop[] = Array.from({ length: SPRAY }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: -1, life: 1, floor: 0 }));
  /** Quay edges near Jef: the last land before the water, and which way is inland. */
  let edges: Array<{ x: number; z: number; ix: number; iz: number; top: number }> = [];
  let look = 0;
  let next = 1;
  let bursts = 0;
  const w2 = new THREE.Vector2();
  const white = new THREE.Color(0.86, 0.88, 0.86);

  function findEdges(f: Frame): void {
    edges = [];
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const dx = Math.cos(a), dz = Math.sin(a);
      let land = false;
      for (let d = 1; d < 40; d += 0.7) {
        const fl = ctx.flags(f.eye.x + dx * d, f.eye.z + dz * d);
        if (fl === undefined || fl === 4) break;
        if (fl !== 2) land = true;
        else if (land) {
          // the wall's face exactly: from a step back on the quay, out in 5 cm steps to where the stone drops away
          // (Steve 2026-09-29: the spray came up a metre inland of the wall)
          const x0 = f.eye.x + dx * (d - 1.2), z0 = f.eye.z + dz * (d - 1.2);
          const top = ctx.world.baseAt(x0, z0);
          if (!Number.isFinite(top)) break;
          let face = -1;
          for (let s = 0; s < 2.4; s += 0.05) {
            // (groundAt: baseAt reads the quay's height over the water too; groundAt drops to the river bed at the face)
            const b = ctx.world.groundAt(x0 + dx * s, z0 + dz * s, 0.05, top);
            if (!Number.isFinite(b) || b < top - 0.6) {
              face = s;
              break;
            }
          }
          if (face >= 0) edges.push({ x: x0 + dx * face, z: z0 + dz * face, ix: -dx, iz: -dz, top });
          break;
        }
      }
    }
  }

  function burst(e: { x: number; z: number; ix: number; iz: number; top: number }, fury: number): void {
    const wl = ctx.world.waterLevel(e.x - e.ix * 0.8, e.z - e.iz * 0.8);
    const top = e.top;
    if (!Number.isFinite(wl) || !Number.isFinite(top)) return;
    const big = (0.5 + 0.5 * Math.random()) * fury;
    let n = Math.round(90 + 110 * big);
    // the sheet of white water up the wall's face
    const sh = sheets.find((q) => q.t < 0) ?? sheets.reduce((a, b) => (a.t > b.t ? a : b));
    const width = 4 + 5 * big + Math.random() * 2;
    sh.mesh.position.set(e.x - e.ix * 0.15, wl - 0.3, e.z - e.iz * 0.15);
    sh.mesh.rotation.set(0, Math.atan2(e.ix, e.iz), 0);
    sh.mesh.scale.set(width, 1, 1);
    sh.mat.uniforms.uH.value = top - wl + 0.3 + 1.2 + 3.8 * big;
    sh.mat.uniforms.uSeed.value = Math.random() * 100;
    const wd = ctx.wind.dir;
    sh.mat.uniforms.uLean.value = Math.max(0.15, wd.x * e.ix + wd.y * e.iz) * (0.6 + 0.6 * fury);
    sh.t = 0;
    sh.life = 1.7 + Math.random() * 0.8;
    sh.mesh.visible = true;
    // up the face: fast enough to clear the quay's top by a few metres
    const need = Math.sqrt(2 * 9.8 * Math.max(0.5, top - wl + 1.5 + 3 * big));
    for (let i = 0; i < SPRAY && n > 0; i++) {
      const q = drops[i];
      if (q.age >= 0) continue;
      const along = (Math.random() - 0.5) * width;
      q.p.set(e.x - e.ix * 0.2 - e.iz * along, wl + 0.2, e.z - e.iz * 0.2 + e.ix * along);
      const up = need * (0.55 + Math.random() * 0.6);
      const inl = 0.5 + Math.random() * 2.5;
      q.v.set(e.ix * inl + (Math.random() - 0.5) * 1.5, up, e.iz * inl + (Math.random() - 0.5) * 1.5);
      q.age = 0;
      q.life = 1.3 + Math.random() * 1.2;
      q.floor = wl;
      // fine drops over the sheet (a few soft clouds of spray at its top)
      size[i] = Math.random() < 0.08 ? 1.2 + Math.random() * 1.2 : 0.2 + Math.random() * 0.45;
      n--;
    }
    bursts++;
    ctx.sound()?.placed({ x: e.x, y: top + 0.5, z: e.z }, { ref: 5, reach: 70, max: 120, wet: 0.35, gain: 1.2 }, waveSlam(Math.min(1, 0.4 + big)));
  }

  function update(f: Frame): void {
    const fury = f.weather === "storm" ? tempest.level : 0;
    if (!on) return;
    const dt = Math.min(f.dt, 0.05);
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog) tint.value.copy(fog.color).lerp(white, 0.55 * (1 - 0.6 * f.night));
    if (fury > 0.2) {
      look -= dt;
      if (look <= 0) {
        look = 1;
        findEdges(f);
      }
      next -= dt;
      if (next <= 0 && edges.length) {
        next = rand(0.5, 2) / fury;
        burst(edges[Math.floor(Math.random() * edges.length)], fury);
      }
    }
    for (const q of sheets) {
      if (q.t < 0) continue;
      q.t += dt / q.life;
      if (q.t >= 1) {
        q.t = -1;
        q.mesh.visible = false;
        continue;
      }
      q.mat.uniforms.uT.value = q.t;
    }
    let live = 0;
    for (let i = 0; i < SPRAY; i++) {
      const q = drops[i];
      if (q.age >= 0) {
        q.age += dt / q.life;
        ctx.wind.at(q.p.x, q.p.z, w2);
        // thrown up, slowed by the air, carried onto the quay by the gale, down again
        q.v.x += (w2.x * 0.35 - q.v.x) * Math.min(1, dt * 0.9);
        q.v.z += (w2.y * 0.35 - q.v.z) * Math.min(1, dt * 0.9);
        q.v.y -= 9.8 * dt;
        q.p.addScaledVector(q.v, dt);
        const gy = ctx.flags(q.p.x, q.p.z) === 2 ? q.floor : ctx.world.baseAt(q.p.x, q.p.z);
        if (q.age >= 1 || (q.v.y < 0 && Number.isFinite(gy) && q.p.y < gy)) q.age = -1;
        else live++;
      }
      pos[i * 3] = q.p.x;
      pos[i * 3 + 1] = q.p.y;
      pos[i * 3 + 2] = q.p.z;
      age[i] = q.age;
    }
    pts.visible = live > 0;
    if (live > 0 || bursts) {
      g.attributes.position.needsUpdate = true;
      g.attributes.aAge.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    }
  }

  return {
    name: "surf",
    update,
    info: () => ({ edges: edges.length, bursts, live: drops.filter((q) => q.age >= 0).length, sheets: sheets.filter((q) => q.t >= 0).length, edge0: edges[0] ?? null }),
    setOn: (v) => {
      on = v;
      if (!v) pts.visible = false;
    },
    ...{ burstNow: () => edges.length && burst(edges[0], 1) },
  } as Part;
}

// ------------------------------------------------------------------ the street boiling with rain

const SPLASH = 900;

/**
 * The great storm's rain hitting the stones (Steve 2026-09-29: "rain is still tame"): round Jef, on open ground, every
 * drop that lands throws up a little white splash, so the street seems to boil and smoke a hand high. The breath's
 * mist material again (no new shader); nothing under a roof, nothing in a room.
 */
export function createSplash(ctx: Ctx): Part {
  let on = true;
  const pos = new Float32Array(SPLASH * 3);
  const age = new Float32Array(SPLASH).fill(-1);
  const size = new Float32Array(SPLASH).fill(0.4);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aAge", new THREE.BufferAttribute(age, 1));
  g.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  const tint = { value: new THREE.Color() };
  const pts = new THREE.Points(g, mistMaterial(tint, { value: 1.4 }));
  pts.frustumCulled = false;
  pts.name = "alive_splash";
  neverMirrored.push(pts);
  pts.renderOrder = 4;
  ctx.scene.add(pts);
  const vy = new Float32Array(SPLASH);
  const life = new Float32Array(SPLASH).fill(1);
  const white = new THREE.Color(0.8, 0.83, 0.84);
  let carry = 0;
  let next = 0;
  let spawned = 0;

  function update(f: Frame): void {
    if (!on) return;
    const fury = f.weather === "storm" && !tempest.indoors ? tempest.level * f.rain : 0;
    const dt = Math.min(f.dt, 0.05);
    const fog = ctx.scene.fog as THREE.Fog | null;
    if (fog) tint.value.copy(fog.color).lerp(white, 0.4 * (1 - 0.7 * f.night));
    carry += 1400 * fury * dt;
    let live = 0;
    for (let i = 0; i < SPLASH; i++) {
      if (age[i] < 0 && carry >= 1) {
        // a drop lands somewhere round him, on open ground (a disc 1.5 to 14 m out, more near)
        const a = Math.random() * Math.PI * 2;
        const r = 1.5 + Math.pow(Math.random(), 0.7) * 12.5;
        const x = f.eye.x + Math.cos(a) * r;
        const z = f.eye.z + Math.sin(a) * r;
        next = (next + 1) % 7;
        if (ctx.flags(x, z) === 0) {
          const y = ctx.world.baseAt(x, z);
          if (Number.isFinite(y)) {
            pos[i * 3] = x;
            pos[i * 3 + 1] = y + 0.03;
            pos[i * 3 + 2] = z;
            age[i] = 0;
            life[i] = 0.25 + Math.random() * 0.3;
            vy[i] = 0.5 + Math.random() * 0.9;
            size[i] = 0.25 + Math.random() * 0.35;
            spawned++;
          }
        }
        carry -= 1;
      }
      if (age[i] >= 0) {
        age[i] += dt / life[i];
        pos[i * 3 + 1] += vy[i] * dt;
        vy[i] -= 4 * dt;
        if (age[i] >= 1) age[i] = -1;
        else live++;
      }
    }
    carry = Math.min(carry, 50);
    pts.visible = live > 0;
    if (live > 0) {
      g.attributes.position.needsUpdate = true;
      g.attributes.aAge.needsUpdate = true;
      g.attributes.aSize.needsUpdate = true;
    }
  }

  return {
    name: "splash",
    update,
    info: () => ({ spawned, live: Array.from(age).filter((a) => a >= 0).length }),
    setOn: (v) => {
      on = v;
      if (!v) pts.visible = false;
    },
  };
}
