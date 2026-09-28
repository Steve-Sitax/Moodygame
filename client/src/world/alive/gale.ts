import * as THREE from "three";
import { gustRoar, rollingCask, shutterBang, signCreak, slateCrash, waveSlam } from "../../audio/aliveSounds";
import { mistMaterial } from "./air";
import { rand, type Ctx, type Frame, type Part } from "./common";
import { tempest } from "../tempest";

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
      if (snd.placed(at, { ref: 30, reach: 400, max: 1e9, occl: 0, wet: 0.5, gain: 0.9 * fury }, gustRoar(Math.min(1, g / 2.4), rand(3, 5.5)))) heard.gust++;
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
  pts.renderOrder = 4;
  ctx.scene.add(pts);
  interface Drop { p: THREE.Vector3; v: THREE.Vector3; age: number; life: number; floor: number }
  const drops: Drop[] = Array.from({ length: SPRAY }, () => ({ p: new THREE.Vector3(), v: new THREE.Vector3(), age: -1, life: 1, floor: 0 }));
  /** Quay edges near Jef: the last land before the water, and which way is inland. */
  let edges: Array<{ x: number; z: number; ix: number; iz: number }> = [];
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
          // the wall's face: a step back onto the land, inland is back toward Jef
          edges.push({ x: f.eye.x + dx * (d - 0.5), z: f.eye.z + dz * (d - 0.5), ix: -dx, iz: -dz });
          break;
        }
      }
    }
  }

  function burst(e: { x: number; z: number; ix: number; iz: number }, fury: number): void {
    const wl = ctx.world.waterLevel(e.x - e.ix * 0.8, e.z - e.iz * 0.8);
    const top = ctx.world.baseAt(e.x, e.z);
    if (!Number.isFinite(wl) || !Number.isFinite(top)) return;
    const big = (0.5 + 0.5 * Math.random()) * fury;
    let n = Math.round(110 + 150 * big);
    // up the face: fast enough to clear the quay's top by a few metres
    const need = Math.sqrt(2 * 9.8 * Math.max(0.5, top - wl + 1.5 + 3 * big));
    for (let i = 0; i < SPRAY && n > 0; i++) {
      const q = drops[i];
      if (q.age >= 0) continue;
      const along = (Math.random() - 0.5) * (3 + 4 * big);
      q.p.set(e.x - e.ix * 0.6 - e.iz * along, wl + 0.2, e.z - e.iz * 0.6 + e.ix * along);
      const up = need * (0.55 + Math.random() * 0.6);
      const inl = 0.5 + Math.random() * 2.5;
      q.v.set(e.ix * inl + (Math.random() - 0.5) * 1.5, up, e.iz * inl + (Math.random() - 0.5) * 1.5);
      q.age = 0;
      q.life = 1.3 + Math.random() * 1.2;
      q.floor = wl;
      // many small: a sheet of spray, not balls of it (a few bigger clouds of it in the middle)
      size[i] = Math.random() < 0.12 ? 1.6 + Math.random() * 1.6 : 0.35 + Math.random() * 0.9;
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
    info: () => ({ edges: edges.length, bursts, live: drops.filter((q) => q.age >= 0).length }),
    setOn: (v) => {
      on = v;
      if (!v) pts.visible = false;
    },
    ...{ burstNow: () => edges.length && burst(edges[0], 1) },
  } as Part;
}
