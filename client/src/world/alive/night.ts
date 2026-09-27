import * as THREE from "three";
import CITY from "../../../../shared/city.json";
import { hiss, owl } from "../../audio/aliveSounds";
import { FCOMMON, Flight, VCOMMON, birdShape, hours, openAt, pointMat, type Ctx, type Frame, type Part } from "./common";
import { dice, hash32, seeded, share, sharedSeconds } from "../../game/share";

// M7 alive: the dark's small life, for "a bit dangerous".
// - Cats' eyes: in the dark lanes and yards at night, a pair of green-gold points low by a wall
//   (or on a sill), looking at Jef, blinking now and then; come within 5 m and they are gone (a hiss,
//   sometimes, heard within 6 m), and turn up somewhere else. Never near a lit lamp.
// - Bats at dusk and before dawn, over the water, the moat and the trees: small dark shapes that
//   flit and jink at roof height. Not in rain or a gale.
// - Moths round the lit gas lamps on a still night: a few pale specks circling each glass.
// - A tawny owl in the trees of the ramparts and the squares, heard (not seen) now and then at night.

const TREES = ((CITY as unknown as { decor: { trees?: number[][] } }).decor.trees ?? []).concat((CITY as unknown as { decor: { trees_wild?: number[][] } }).decor.trees_wild ?? []);

// ------------------------------------------------------------------ cats' eyes

const PAIRS = 6;

export function createEyes(ctx: Ctx): Part {
  const pos = new Float32Array(PAIRS * 2 * 3);
  const vis = new Float32Array(PAIRS * 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("aVis", new THREE.BufferAttribute(vis, 1));
  const mat = pointMat({
    additive: true,
    fogReach: 1.2,
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute float aVis;
      varying float vVis;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = max(1.5, uViewH / 270.0 * 2.0);
        vVis = aVis;
        if (aVis < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      varying float vVis;
      void main() {
        // eyeshine carries further than the fog lets a wall be seen: half the fog only
        float f = fogK() * 0.6;
        gl_FragColor = vec4(vec3(0.75, 0.95, 0.35) * vVis * (1.0 - f), 1.0);
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = "alive_cat_eyes";
  pts.renderOrder = 3;
  ctx.scene.add(pts);
  let on = true;
  // M8f sync pass 3: the cats' spots are the town's (a spot by a wall in each cell of 10 m that has one, by the cell's
  // own dice), and a cat is there in a stretch of the shared clock by the same dice; a player within 5 m sends it off
  // for the rest of the stretch, on every PC. Each PC shows the nearest ones 7-26 m from its own eye (they were placed
  // round Jef by this PC's dice).
  const CELL = 10;
  const SLOT = 40;
  interface Cat { key: string; at: THREE.Vector3; on: number; seed: number }
  const cats: Array<Cat | null> = Array.from({ length: PAIRS }, () => null);
  const spots = new Map<string, THREE.Vector3 | null>();
  const fade = new Map<string, number>();
  const spooked = new Map<string, number>();
  const side = new THREE.Vector3();
  const lamps = () => ctx.world.gasLamps.lamps();

  /** The cell's spot: open ground by a wall, most in a narrow lane or a yard, away from lit lamps (null: none). */
  function spotOf(ci: number, cj: number): THREE.Vector3 | null {
    const key = `${ci},${cj}`;
    if (spots.has(key)) return spots.get(key)!;
    let out: THREE.Vector3 | null = null;
    const r = seeded(hash32("cateyes", ci, cj));
    const L = lamps();
    for (let k = 0; k < 16 && !out; k++) {
      const x = (ci + r()) * CELL;
      const z = (cj + r()) * CELL;
      const narrowRoll = r();
      const up = r();
      const upH = r();
      if (!openAt(ctx.flags, x, z, 0.3)) continue;
      // by a wall (a cat keeps to the foot of the wall) or in a narrow lane
      let wall = 0;
      for (const [dx, dz] of [[1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]]) if (ctx.flags(x + dx, z + dz) === 1) wall++;
      if (!wall) continue;
      // a narrow lane or a yard (walls on two sides within 4 m) most of the time: the dark places
      let narrow = false;
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        let a = false, b = false;
        for (let q = 0.5; q <= 4; q += 0.5) {
          a ||= ctx.flags(x + dx * q, z + dz * q) === 1;
          b ||= ctx.flags(x - dx * q, z - dz * q) === 1;
        }
        narrow ||= a && b;
      }
      if (!narrow && narrowRoll < 0.75) continue;
      if (L.some((l) => Math.hypot(l.x - x, l.z - z) < 11)) continue;
      const y = ctx.world.baseAt(x, z);
      if (!Number.isFinite(y)) continue;
      // most on the ground, some up on a sill or a wall's coping
      out = new THREE.Vector3(x, y + (up < 0.75 ? 0.24 : 0.9 + upH * 0.6), z);
    }
    if (L.length) spots.set(key, out); // (the lamps are in: the spot is for good)
    return out;
  }

  function update(f: Frame): void {
    if (!on) return;
    const dark = f.night > 0.75 && f.weather !== "storm" && f.rain < 0.6;
    const S = sharedSeconds();
    const people = share.on ? share.players() : [f.eye];
    const found: Cat[] = [];
    if (dark) {
      const ci0 = Math.floor((f.eye.x - 26) / CELL), ci1 = Math.floor((f.eye.x + 26) / CELL);
      const cj0 = Math.floor((f.eye.z - 26) / CELL), cj1 = Math.floor((f.eye.z + 26) / CELL);
      for (let i = ci0; i <= ci1; i++)
        for (let j = cj0; j <= cj1; j++) {
          const key = `${i},${j}`;
          const slot = Math.floor(S / SLOT + dice("cateyephase", i, j));
          if (dice("cateye", i, j, slot) > 0.5) continue;
          const at = spotOf(i, j);
          if (!at) continue;
          if (Math.abs(at.y - (f.eye.y - 1.6)) > 3) continue;
          // gone: slunk off when a player came within 5 m (sometimes with a hiss); back in the next stretch
          if (spooked.get(key) === slot) continue;
          if (people.some((q) => Math.hypot(q.x - at.x, q.z - at.z) < 5)) {
            spooked.set(key, slot);
            if ((fade.get(key) ?? 0) > 0 && Math.hypot(f.eye.x - at.x, f.eye.z - at.z) < 6 && dice("hiss", i, j, slot) < 0.35) ctx.sound()?.placed({ x: at.x, y: at.y, z: at.z }, { ref: 1, reach: 5, max: 7 }, hiss());
            continue;
          }
          const d = Math.hypot(at.x - f.eye.x, at.z - f.eye.z);
          if (d < 7 || d > 26) continue;
          found.push({ key, at, on: 0, seed: dice("cateyeseed", i, j) });
        }
    }
    found.sort((a, b) => Math.hypot(a.at.x - f.eye.x, a.at.z - f.eye.z) - Math.hypot(b.at.x - f.eye.x, b.at.z - f.eye.z));
    const keep = new Set<string>();
    for (let i = 0; i < PAIRS; i++) {
      const c = found[i] ?? null;
      cats[i] = c;
      let v = 0;
      if (c) {
        keep.add(c.key);
        const o = Math.min(1, (fade.get(c.key) ?? 0) + f.dt * 1.5);
        fade.set(c.key, o);
        // a blink now and then (by the clock)
        const bw = (S + c.seed * 7) % 5;
        v = bw < 0.15 ? 0 : o;
        // two eyes 7 cm apart, square to the line to Jef
        side.set(f.eye.z - c.at.z, 0, -(f.eye.x - c.at.x)).normalize().multiplyScalar(0.035);
        pos.set([c.at.x + side.x, c.at.y, c.at.z + side.z], i * 6);
        pos.set([c.at.x - side.x, c.at.y, c.at.z - side.z], i * 6 + 3);
      }
      vis[i * 2] = v;
      vis[i * 2 + 1] = v;
    }
    for (const k of [...fade.keys()]) if (!keep.has(k)) fade.delete(k);
    g.attributes.position.needsUpdate = true;
    g.attributes.aVis.needsUpdate = true;
  }

  return {
    name: "eyes",
    update,
    info: () => ({ shown: cats.filter((c) => c).length, at: cats.filter((c): c is Cat => !!c).map((c) => c.at.toArray().map((v) => +v.toFixed(2))) }),
    setOn: (v) => {
      on = v;
      pts.visible = v;
    },
  };
}

// ------------------------------------------------------------------ bats

const BATS = 6;

export function createBats(ctx: Ctx): Part {
  const shape = birdShape(0.32, [0.12, 0.09, 0.08], [0.1, 0.08, 0.07], [0.08, 0.06, 0.05], [0.1, 0.08, 0.07], 0.6);
  const flight = new Flight(shape, BATS, "alive_bats", 0.32);
  ctx.scene.add(flight.mesh);
  let on = true;
  interface Bat { c: THREE.Vector3; pos: THREE.Vector3; prev: THREE.Vector3; seed: number; yaw: number }
  const bats: Bat[] = Array.from({ length: BATS }, () => ({ c: new THREE.Vector3(1e5, 0, 0), pos: new THREE.Vector3(), prev: new THREE.Vector3(), seed: Math.random() * 100, yaw: 0 }));
  const vel = new THREE.Vector3();

  /**
   * Over water or by trees: where bats hunt. M8f sync pass 3: the town's own (one in a cell of 20 m that has water or
   * trees, by the cell's dice); each PC shows the nearest to its eye, flying by the shared clock: the same bats
   * for two players in one place (they were placed round Jef by this PC's dice).
   */
  const haunts = new Map<string, THREE.Vector3 | null>();
  function hauntOf(ci: number, cj: number): THREE.Vector3 | null {
    const key = `${ci},${cj}`;
    if (haunts.has(key)) return haunts.get(key)!;
    let out: THREE.Vector3 | null = null;
    const r = seeded(hash32("bathaunt", ci, cj));
    if (r() < 0.5) {
      for (let k = 0; k < 20 && !out; k++) {
        const x = (ci + r()) * 20;
        const z = (cj + r()) * 20;
        const hy = r();
        const fl = ctx.flags(x, z);
        if (fl === undefined || fl === 1) continue;
        const water = (fl & 2) !== 0;
        const tree = TREES.some((t) => Math.abs(t[0] - x) < 12 && Math.abs(t[1] - z) < 12);
        if (!water && !tree) continue;
        const y = ctx.world.baseAt(x, z);
        out = new THREE.Vector3(x, (Number.isFinite(y) ? y : 0) + 3.5 + hy * 4, z);
      }
    }
    haunts.set(key, out);
    return out;
  }
  function nearHaunts(f: Frame): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (let i = Math.floor((f.eye.x - 30) / 20); i <= Math.floor((f.eye.x + 30) / 20); i++)
      for (let j = Math.floor((f.eye.z - 30) / 20); j <= Math.floor((f.eye.z + 30) / 20); j++) {
        const h = hauntOf(i, j);
        if (h && Math.hypot(h.x - f.eye.x, h.z - f.eye.z) < 30 && Math.abs(h.y - f.eye.y) < 12) out.push(h);
      }
    return out.sort((a, b) => Math.hypot(a.x - f.eye.x, a.z - f.eye.z) - Math.hypot(b.x - f.eye.x, b.z - f.eye.z));
  }

  function update(f: Frame): void {
    flight.begin();
    if (!on) return flight.end();
    // dusk and before dawn; not in rain, a gale or a cold wind
    const when = Math.max(hours(f.hour, 17.4, 19.9, 0.4), hours(f.hour, 4.9, 6.4, 0.4));
    const ok = when > 0 && f.rain < 0.15 && f.weather !== "storm" && ctx.wind.speed < 1.3;
    const n = ok ? Math.round(BATS * when * (f.weather === "fog" ? 0.5 : 1)) : 0;
    const hs = n ? nearHaunts(f) : [];
    const t = sharedSeconds() % 1e5;
    for (let i = 0; i < BATS; i++) {
      const b = bats[i];
      const h = i < n ? hs[i] : undefined;
      if (!h) {
        b.c.set(1e5, 0, 0);
        continue;
      }
      if (!b.c.equals(h)) {
        b.c.copy(h);
        b.seed = (h.x * 0.37 + h.z * 0.71) % 100;
        b.pos.set(NaN, 0, 0);
      }
      b.prev.copy(b.pos);
      // a beat of loops and sudden turns (a bat hunting moths): several sines, one fast
      const s = b.seed;
      b.pos.set(
        b.c.x + Math.sin(t * 0.9 + s) * 5 + Math.sin(t * 2.7 + s * 3) * 1.6 + Math.sin(t * 7.3 + s * 5) * 0.35,
        b.c.y + Math.sin(t * 1.3 + s * 2) * 1.2 + Math.sin(t * 5.1 + s) * 0.3,
        b.c.z + Math.cos(t * 0.7 + s * 1.7) * 5 + Math.cos(t * 3.1 + s * 2.3) * 1.4 + Math.cos(t * 6.7 + s * 4) * 0.35,
      );
      if (Number.isNaN(b.prev.x)) b.prev.copy(b.pos);
      vel.subVectors(b.pos, b.prev);
      if (vel.lengthSq() > 1e-8) b.yaw = Math.atan2(vel.x, vel.z);
      if (Math.hypot(b.pos.x - f.eye.x, b.pos.z - f.eye.z) > f.fogFar * 1.1) continue;
      flight.add(b.pos, b.yaw, -Math.atan2(vel.y, Math.hypot(vel.x, vel.z) + 1e-5) * 0.5, Math.sin(t * 4 + s) * 0.5, 1, Math.sin(t * 48 + s * 9) * 1.1, 0);
    }
    flight.end();
  }

  return {
    name: "bats",
    update,
    info: () => ({ drawn: flight.count, at: bats.filter((b) => b.c.x < 1e4).map((b) => b.pos.toArray().map((v) => +v.toFixed(1))) }),
    setOn: (v) => {
      on = v;
    },
  };
}

// ------------------------------------------------------------------ moths round the lamps

const MOTH_LAMPS = 10;
const PER_LAMP = 5;

export function createMoths(ctx: Ctx): Part {
  const N = MOTH_LAMPS * PER_LAMP;
  const centre = new Float32Array(N * 3);
  const seed = new Float32Array(N);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(centre, 3));
  g.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  for (let i = 0; i < N; i++) seed[i] = Math.random();
  const level = { value: 0 };
  const mat = pointMat({
    fogReach: 1,
    uniforms: { uLevel: level },
    vertexShader: /* glsl */ `
      ${VCOMMON}
      attribute float aSeed;
      uniform float uLevel;
      varying float vA;
      void main() {
        // an uneven orbit round the glass, now in, now out; darting
        float s = aSeed * 43.0;
        float a = uTime * (2.2 + aSeed * 2.5) * (aSeed > 0.5 ? 1.0 : -1.0) + s;
        float r = 0.25 + 0.3 * abs(sin(uTime * 1.3 + s)) + 0.1 * sin(uTime * 9.0 + s * 2.0);
        vec3 p = position + vec3(cos(a) * r, 0.2 * sin(uTime * 3.1 + s) + 0.12 * sin(uTime * 11.0 + s), sin(a * 1.1) * r);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vFogDepth = -mv.z;
        gl_Position = psxSnap(projectionMatrix * mv);
        gl_PointSize = clamp(pointPx(0.05, gl_Position), 1.5, 4.0);
        // wings catch the light: a flicker
        vA = uLevel * (0.55 + 0.45 * sin(uTime * 30.0 + s * 7.0));
        if (position.y < -100.0 || uLevel < 0.01) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      ${FCOMMON}
      varying float vA;
      void main() {
        float f = fogK();
        gl_FragColor = vec4(mix(vec3(1.0, 0.9, 0.7), fogColor, f), vA * (1.0 - f));
      }`,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.name = "alive_moths";
  ctx.scene.add(pts);
  let on = true;
  let wait = 0;
  let used = 0;

  function update(f: Frame): void {
    if (!on) return;
    // a still, dry night; October: fewer on a cold one
    const still = ctx.wind.speed < 1.0 && f.rain < 0.05 && f.weather !== "storm";
    level.value += ((f.night > 0.7 && still ? 1 - 0.5 * f.cold : 0) - level.value) * Math.min(1, f.dt);
    wait -= f.dt;
    if (wait > 0) return;
    wait = 0.5;
    const list: Array<{ x: number; y: number; z: number; d: number }> = [];
    for (const l of ctx.world.gasLamps.lamps()) {
      const d = Math.hypot(l.x - f.eye.x, l.z - f.eye.z);
      if (d < 28) list.push({ x: l.x, y: ctx.world.baseAt(l.x, l.z) + 3.65, z: l.z, d });
    }
    for (const l of ctx.world.lamps) {
      const d = Math.hypot(l.pos.x - f.eye.x, l.pos.z - f.eye.z);
      if (d < 28 && l.level > 0.3) list.push({ x: l.pos.x, y: l.pos.y, z: l.pos.z, d });
    }
    list.sort((a, b) => a.d - b.d);
    used = Math.min(MOTH_LAMPS, list.length);
    for (let i = 0; i < MOTH_LAMPS; i++) {
      const l = list[i];
      for (let k = 0; k < PER_LAMP; k++) {
        const j = (i * PER_LAMP + k) * 3;
        if (l && Number.isFinite(l.y)) centre.set([l.x, l.y, l.z], j);
        else centre.set([0, -999, 0], j);
      }
    }
    g.attributes.position.needsUpdate = true;
  }

  return {
    name: "moths",
    update,
    info: () => ({ lamps: used, level: +level.value.toFixed(2) }),
    setOn: (v) => {
      on = v;
      pts.visible = v;
    },
  };
}

// ------------------------------------------------------------------ the owl

export function createOwl(ctx: Ctx): Part {
  let on = true;
  let wait = 20;
  let hoots = 0;
  function update(f: Frame): void {
    if (!on) return;
    if (!(hours(f.hour, 19.5, 5.5, 0.01) > 0) || f.rain > 0.2 || f.weather === "storm") return;
    wait -= f.dt;
    if (wait > 0) return;
    wait = 35 + Math.random() * 80;
    // a tree 60-180 m off (the ramparts' rows, the squares)
    const cand = TREES.filter((t) => {
      const d = Math.hypot(t[0] - f.eye.x, t[1] - f.eye.z);
      return d > 60 && d < 180;
    });
    if (!cand.length) return;
    const t = cand[Math.floor(Math.random() * cand.length)];
    if (ctx.sound()?.placed({ x: t[0], y: 9, z: t[1] }, { ref: 5, reach: 120, max: 260, occl: 0.5, wet: 0.5 }, owl())) hoots++;
  }
  return {
    name: "owl",
    update,
    info: () => ({ hoots, next: +wait.toFixed(1) }),
    setOn: (v) => {
      on = v;
    },
  };
}
