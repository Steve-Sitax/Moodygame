import * as THREE from "three";
import { psx } from "../../retro/psx";
import { wings } from "../../audio/aliveSounds";
import { Flight, birdShape, hours, mulberry, srgb, type Ctx, type Frame, type Part } from "./common";
import { HOUSES, P, roofOf, roofY, type Roof } from "./roofs";
import { dice, share, sharedSeconds } from "../../game/share";

// M7 alive: racing pigeons (Antwerp was where pigeon racing began: the first society met in a tavern
// from 1825, and by 1870 Belgium had some ten thousand lofts; FARO 2000/3, see M7-alive.md). A loft
// is a plank hut on the back slope of a cottage roof in the gangen (or on a flat roof), with a
// landing board and two dark flight holes. Twice a day, on a dry day, each loft's flock is let out
// for its round: 16-24 birds go up off the board in a clatter of wings, and circle the roofs in a
// tight flock for half a game hour, wheeling, swooping and climbing, then come down onto the board
// and the hut roof and go in by ones and twos. Between rounds a few sit on the board. Only the lofts
// within 220 m fly (for the eye); the huts are one merged mesh.

const MAX_LOFTS = 12;
const SPACING = 60;
const FLOCK = [16, 24];
/** A round is this many game hours; the flock circles this far out and high. */
const ROUND_H = 0.5;
const NEAR = 220;

interface Loft {
  roof: Roof;
  /** The board's middle (world), the way it faces (unit, out of the hut), the hut roof's middle. */
  board: THREE.Vector3;
  out: THREE.Vector2;
  top: THREE.Vector3;
  /** Round starts (game hours). */
  rounds: number[];
  birds: Pigeon[];
  state: "home" | "out";
  /** Seconds into the round, the flock's angle and its turn. */
  clock: number;
  th: number;
  w: number;
  seed: number;
  forced: number;
}

interface Pigeon {
  /** Place in the flock (metres, flock frame), and on the loft when sitting (0 board, 1 roof). */
  off: THREE.Vector3;
  perch: THREE.Vector3;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  from: THREE.Vector3;
  yaw: number;
  /** 0 inside, 1 sitting, 2 going up, 3 flying, 4 landing. */
  mode: number;
  k: number;
  delay: number;
  col: THREE.Color;
  seed: number;
}

function hutGeometry(lofts: Loft[]): THREE.BufferGeometry {
  const P3: number[] = [];
  const C: number[] = [];
  const quad = (a: number[], b: number[], c: number[], d: number[], col: number[]) => {
    P3.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) C.push(...col);
  };
  for (const L of lofts) {
    // the hut's frame: across (along the ridge) and out (down the slope, towards the board)
    const [ox, oz] = [L.out.x, L.out.y];
    const [ax, az] = [-oz, ox];
    const cx = L.board.x - ox * 0.45;
    const cz = L.board.z - oz * 0.45;
    const W = 2.0;
    const Dp = 1.4;
    const yLow = L.board.y - 0.35 - 0.3;
    const yTop = L.top.y;
    const p = (u: number, v: number, y: number) => [cx + ax * u + ox * v, y, cz + az * u + oz * v];
    const wood = srgb(0.5, 0.45, 0.37);
    const wood2 = srgb(0.42, 0.37, 0.3);
    const dark = srgb(0.04, 0.035, 0.03);
    const tar = srgb(0.12, 0.12, 0.13);
    const u0 = -W / 2, u1 = W / 2, v0 = -Dp, v1 = 0;
    const yb = yLow - 1.2; // buried in the roof
    // front (the board side), back, sides: upright boards, weathered, a dark gap between each
    const planks = (a: number[], b: number[], c: number[], d: number[]) => {
      const L = Math.hypot(b[0] - a[0], b[2] - a[2]);
      const n = Math.max(2, Math.round(L / 0.16));
      const lerp = (x: number[], y: number[], k: number) => [x[0] + (y[0] - x[0]) * k, x[1] + (y[1] - x[1]) * k, x[2] + (y[2] - x[2]) * k];
      for (let i = 0; i < n; i++) {
        const k0 = i / n;
        const k1 = (i + 0.88) / n;
        const k2 = (i + 1) / n;
        const j = 0.85 + ((i * 7919 + Math.round(a[0] * 13)) % 7) / 20;
        const col = (i % 2 ? wood : wood2).map((v) => v * j);
        quad(lerp(a, b, k0), lerp(a, b, k1), lerp(d, c, k1), lerp(d, c, k0), col);
        quad(lerp(a, b, k1), lerp(a, b, k2), lerp(d, c, k2), lerp(d, c, k1), dark);
      }
    };
    planks(p(u0, v1, yb), p(u1, v1, yb), p(u1, v1, yTop - 0.1), p(u0, v1, yTop - 0.1));
    planks(p(u1, v0, yb), p(u0, v0, yb), p(u0, v0, yTop + 0.15), p(u1, v0, yTop + 0.15));
    planks(p(u0, v0, yb), p(u0, v1, yb), p(u0, v1, yTop - 0.1), p(u0, v0, yTop + 0.15));
    planks(p(u1, v1, yb), p(u1, v0, yb), p(u1, v0, yTop + 0.15), p(u1, v1, yTop - 0.1));
    // roof: tarred boards, sloping to the front, overhanging
    quad(p(u0 - 0.12, v1 + 0.2, yTop - 0.14), p(u1 + 0.12, v1 + 0.2, yTop - 0.14), p(u1 + 0.12, v0 - 0.12, yTop + 0.19), p(u0 - 0.12, v0 - 0.12, yTop + 0.19), tar);
    // two flight holes over the board, a little out from the front
    const yb0 = L.board.y + 0.04;
    for (const uc of [-0.4, 0.4]) quad(p(uc - 0.22, v1 + 0.04, yb0), p(uc + 0.22, v1 + 0.04, yb0), p(uc + 0.22, v1 + 0.04, yb0 + 0.3), p(uc - 0.22, v1 + 0.04, yb0 + 0.3), dark);
    // the landing board (top and front edge) and its two brackets
    const by = L.board.y;
    quad(p(u0, v1, by), p(u1, v1, by), p(u1, v1 + 0.5, by), p(u0, v1 + 0.5, by), wood);
    quad(p(u0, v1 + 0.5, by), p(u1, v1 + 0.5, by), p(u1, v1 + 0.5, by - 0.05), p(u0, v1 + 0.5, by - 0.05), wood2);
    for (const uc of [u0 + 0.1, u1 - 0.1]) quad(p(uc, v1, by - 0.4), p(uc, v1 + 0.45, by - 0.02), p(uc, v1 + 0.45, by - 0.05), p(uc, v1, by - 0.45), wood2);
    // a pole with a flag of rag (the fancier's sign to come home) at the back corner
    quad(p(u1 - 0.05, v0 + 0.05, yTop), p(u1 - 0.02, v0 + 0.05, yTop), p(u1 - 0.02, v0 + 0.05, yTop + 1.4), p(u1 - 0.05, v0 + 0.05, yTop + 1.4), wood2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(P3, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** Pick the lofts: cottages of the gangen and flat roofs, seeded, spread out. */
function pickLofts(flags: Ctx["flags"]): Loft[] {
  const r = mulberry(1825);
  const cand: Array<{ roof: Roof; w: number }> = [];
  HOUSES.forEach((h, i) => {
    if (!h.rect || h.gone || h.h > 14) return;
    if (h.roof !== "side" && h.roof !== "flat") return;
    const roof = roofOf(i);
    if (!roof) return;
    const D = h.t[1] - h.t[0];
    const W = h.s[1] - h.s[0];
    if (W < 3.2 || (h.roof === "side" && D < 4)) return;
    cand.push({ roof, w: (h.alley ? 3 : 1) * r() });
  });
  cand.sort((a, b) => b.w - a.w);
  const out: Loft[] = [];
  for (const { roof } of cand) {
    if (out.length >= MAX_LOFTS) break;
    const h = roof.h;
    const [s0, s1] = h.s;
    const [t0, t1] = h.t;
    const sc = s0 + (s1 - s0) * (0.35 + r() * 0.3);
    let side = 1;
    let tA = 0, tB = 0;
    if (h.roof === "side") {
      // the back slope: away from the street front (street[0] is the front wall at t0)
      side = h.street[2] && !h.street[0] ? -1 : 1;
      const tm = (t0 + t1) / 2;
      tA = tm + side * 0.25;
      tB = tm + side * 1.55;
    } else {
      const tm = (t0 + t1) / 2;
      tA = tm - 0.6;
      tB = tm + 0.7;
    }
    const [bx, bz] = P(h, sc, tB + side * 0.45);
    const [cx, cz] = P(h, sc, (tA + tB) / 2);
    if (out.some((L) => Math.hypot(L.board.x - bx, L.board.z - bz) < SPACING)) continue;
    // the board must hang over the roof (a flat roof) or the slope, not past the eaves
    if (h.roof === "side" && Math.abs(tB + side * 0.5 - (t0 + t1) / 2) > (t1 - t0) / 2 - 0.3) continue;
    const yFar = roofY(roof, sc, tB);
    const ridge = roof.H + roof.rise;
    const top = h.roof === "flat" ? roof.H + 1.9 : Math.max(ridge + 0.5, yFar + 1.6);
    const board = new THREE.Vector3(bx, Math.max(yFar + 0.5, top - 1.25), bz);
    const outDir = new THREE.Vector2(h.n[0] * side, h.n[1] * side).normalize();
    void flags;
    const seed = r();
    const L: Loft = {
      roof,
      board,
      out: outDir,
      top: new THREE.Vector3(cx, top, cz),
      rounds: [7.6 + seed * 1.8, 14.8 + ((seed * 7.1) % 1) * 1.8],
      birds: [],
      state: "home",
      clock: 0,
      th: r() * Math.PI * 2,
      w: (r() < 0.5 ? -1 : 1) * (0.16 + r() * 0.08),
      seed,
      forced: 0,
    };
    const n = FLOCK[0] + Math.floor(r() * (FLOCK[1] - FLOCK[0] + 1));
    for (let k = 0; k < n; k++) {
      const hue = r();
      // blue bars and chequers mostly, a few reds and pieds
      const col0 = hue < 0.7 ? new THREE.Color(0.45 + r() * 0.08, 0.48 + r() * 0.08, 0.56 + r() * 0.08) : hue < 0.85 ? new THREE.Color(0.55, 0.36, 0.3) : hue < 0.95 ? new THREE.Color(0.85, 0.84, 0.82) : new THREE.Color(0.2, 0.2, 0.22);
      const col = new THREE.Color().setRGB(col0.r, col0.g, col0.b, THREE.SRGBColorSpace);
      const onRoof = k % 2 === 1;
      const u = (r() - 0.5) * 1.5;
      const perch = onRoof
        ? new THREE.Vector3(L.top.x + -outDir.y * u, top + 0.08, L.top.z + outDir.x * u)
        : new THREE.Vector3(board.x + -outDir.y * u, board.y + 0.01, board.z + outDir.x * u).addScaledVector(new THREE.Vector3(outDir.x, 0, outDir.y), 0.1 + r() * 0.25);
      L.birds.push({
        off: new THREE.Vector3((r() - 0.5) * 9, (r() - 0.5) * 3, (r() - 0.5) * 7),
        perch,
        pos: perch.clone(),
        prev: perch.clone(),
        from: perch.clone(),
        yaw: Math.atan2(outDir.x, outDir.y) + (r() - 0.5),
        mode: k < 4 ? 1 : 0,
        k: 0,
        delay: 0,
        col,
        seed: r(),
      });
    }
    out.push(L);
  }
  return out;
}

export function createLofts(ctx: Ctx): Part {
  const lofts = pickLofts(ctx.flags);
  const huts = new THREE.Mesh(hutGeometry(lofts), psx(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })));
  huts.name = "alive_lofts";
  ctx.scene.add(huts);
  const flight = new Flight(birdShape(0.64, [0.97, 0.97, 0.97], [0.9, 0.9, 0.9], [0.3, 0.3, 0.32], [0.6, 0.5, 0.5], 1, 1.4), 80, "alive_pigeons", 0.64);
  ctx.scene.add(flight.mesh);
  let on = true;
  const fc = new THREE.Vector3();
  const tmp = new THREE.Vector3();
  const vel = new THREE.Vector3();
  let flying = 0;

  function flockCentre(L: Loft, t: number, out: THREE.Vector3): THREE.Vector3 {
    const R = 34 + 18 * Math.sin(t * 0.05 + L.seed * 9) + 8 * Math.sin(t * 0.13);
    const ang = L.th;
    // climb out, circle, and come down at the end of the round
    const k = L.clock / (ROUND_H * 120);
    const high = Math.min(1, L.clock / 20) * Math.min(1, (ROUND_H * 120 - L.clock) / 25);
    const swoop = 7 * Math.pow(Math.max(0, Math.sin(t * 0.11 + L.seed * 5)), 6);
    out.set(L.board.x + Math.cos(ang) * R * high, L.board.y + (16 + 9 * Math.sin(t * 0.07 + L.seed * 3) - swoop) * high + 2, L.board.z + Math.sin(ang) * R * high);
    void k;
    return out;
  }

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    flight.begin();
    flying = 0;
    const dry = f.weather !== "rain" && f.weather !== "storm" && f.weather !== "fog" && f.rain < 0.1;
    const daylight = f.night < 0.4;
    // M8f sync pass 3: by the clock every PC shares, and near any player: the same round of the same flock on every
    // screen (a round's start and its flight from the game's clock; were this PC's own time and dice)
    const S = sharedSeconds() % 1e6;
    const people = share.on ? share.players() : [f.eye];
    let li = 0;
    for (const L of lofts) {
      li++;
      const d = Math.hypot(L.board.x - f.eye.x, L.board.z - f.eye.z);
      let dAny = d;
      for (const q of people) dAny = Math.min(dAny, Math.hypot(L.board.x - q.x, L.board.z - q.z));
      const h0 = L.rounds.find((h) => hours(f.hour, h, h + ROUND_H, 0.01) > 0);
      const due = L.forced > 0 || (dry && daylight && h0 !== undefined);
      if (L.forced > 0) L.forced -= dt;
      if (due && L.state === "home" && dAny < NEAR) {
        L.state = "out";
        // (seconds since the round began by the clock: a player who comes by in the middle of it finds them up)
        const since = h0 !== undefined && !(L.forced > 0) ? ((((f.hour - h0) % 24) + 24) % 24) * 120 : 0;
        L.clock = since;
        // out they go: off the board one after another
        L.birds.forEach((b, k) => {
          if (b.mode === 0) b.pos.copy(L.board);
          b.mode = since > 8 ? 3 : 2;
          b.k = since > 8 ? 1 : 0;
          b.delay = since > 8 ? 0 : k * 0.12 + dice("loftgo", li, k) * 0.2;
          if (since > 8) {
            flockCentre(L, S, fc);
            b.pos.copy(b.off).add(fc);
          }
        });
        ctx.sound()?.placed({ x: L.board.x, y: L.board.y, z: L.board.z }, { ref: 3, reach: 30, max: 60, occl: 0.3 }, wings(L.birds.length));
      }
      if (L.state === "out") {
        L.clock += dt;
        // (round the loft at its own pace by the shared clock, its speed swelling and easing as before; it no longer
        // turns the other way now and then: that was a dice roll of this PC's)
        L.th = L.seed * 6.28 + L.w * (S + (0.4 / 0.2) * -Math.cos(S * 0.2 + L.seed * 4));
        const endS = ROUND_H * 120;
        if ((!due && L.clock > 30) || L.clock > endS || dAny > NEAR * 1.3) {
          // home: they come down onto the board and the roof
          let k = 0;
          for (const b of L.birds) if (b.mode === 3 || b.mode === 2) {
            b.mode = 4;
            b.k = 0;
            b.delay = dice("lofthome", li, k++) * 3;
          }
          L.state = "home";
        }
      }
      if (d > NEAR * 1.3) continue;
      flockCentre(L, S, fc);
      // the flock's heading, for the birds' yaw
      const vx = -Math.sin(L.th) * Math.sign(L.w);
      const vz = Math.cos(L.th) * Math.sign(L.w);
      const flockYaw = Math.atan2(vx, vz);
      for (const b of L.birds) {
        b.prev.copy(b.pos);
        let flap = 0;
        let fold = 1;
        let pitch = 0;
        let roll = 0;
        if (b.mode === 0) continue;
        if (b.delay > 0) {
          b.delay -= dt;
          if (b.mode === 2) continue; // still inside
        } else if (b.mode === 2) {
          // up off the board into the flock
          b.k += dt / 3.5;
          tmp.copy(b.off).applyAxisAngle(THREE.Object3D.DEFAULT_UP, flockYaw).add(fc);
          b.pos.lerpVectors(L.board, tmp, THREE.MathUtils.smootherstep(b.k, 0, 1));
          b.pos.y += Math.sin(Math.PI * Math.min(1, b.k)) * 3;
          flap = Math.sin(f.t * 26 + b.seed * 40) * 0.9;
          fold = 0;
          if (b.k >= 1) b.mode = 3;
        } else if (b.mode === 3) {
          tmp.copy(b.off).applyAxisAngle(THREE.Object3D.DEFAULT_UP, flockYaw).add(fc);
          tmp.y += Math.sin(f.t * 1.3 + b.seed * 20) * 0.6;
          b.pos.lerp(tmp, Math.min(1, dt * 2.5));
          flap = Math.sin(f.t * 22 + b.seed * 40) * (0.35 + 0.5 * Math.max(0, Math.sin(f.t * 0.9 + b.seed * 7)));
          fold = 0;
        } else if (b.mode === 4) {
          if (b.delay > 0) {
            tmp.copy(b.off).applyAxisAngle(THREE.Object3D.DEFAULT_UP, flockYaw).add(fc);
            b.pos.lerp(tmp, Math.min(1, dt * 2.5));
            flap = Math.sin(f.t * 22 + b.seed * 40) * 0.5;
            fold = 0;
          } else {
            if (b.k === 0) b.from.copy(b.pos);
            b.k = Math.min(1, b.k + dt / 4);
            b.pos.lerpVectors(b.from, b.perch, THREE.MathUtils.smootherstep(b.k, 0, 1));
            b.pos.y += Math.sin(Math.PI * b.k) * 1.5;
            flap = Math.sin(f.t * 26 + b.seed * 40) * 0.9;
            fold = 0;
            if (b.k >= 1) {
              b.pos.copy(b.perch);
              b.mode = 1;
              b.k = 0;
              // most go in after a while
              b.delay = 20 + dice("loftin", Math.floor(b.seed * 1e6)) * 60;
            }
          }
        } else if (b.mode === 1) {
          // sitting: a turn now and then; after a round most go in
          const kb = Math.floor(b.seed * 1e6);
          const w4 = Math.floor(S / 4 + b.seed);
          if (b.k !== w4) {
            b.k = w4;
            if (dice("loftyaw", kb, w4) < 0.63) b.yaw = dice("loftyaw2", kb) * 6.28 + (dice("loftyaw3", kb, w4) - 0.5) * 1.5;
            if (b.delay <= 0 && L.state === "home" && L.birds.filter((q) => q.mode === 1).length > 4 && dice("loftgoin", kb, w4) < 0.4) b.mode = 0;
          }
        }
        const air = b.mode >= 2 && !(b.mode === 2 && b.delay > 0);
        if (air) {
          vel.subVectors(b.pos, b.prev);
          const hs = Math.hypot(vel.x, vel.z);
          if (hs > 1e-4) {
            const y = Math.atan2(vel.x, vel.z);
            let dy = y - b.yaw;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            roll = THREE.MathUtils.clamp(-dy / Math.max(dt, 1e-3) * 0.3, -0.8, 0.8);
            b.yaw = y;
            pitch = -Math.atan2(vel.y, hs) * 0.6;
          }
          flying++;
        }
        const far = Math.hypot(b.pos.x - f.eye.x, b.pos.z - f.eye.z) > f.fogFar * 1.15 + 10;
        // at night they are all in the loft
        if (far || (b.mode === 1 && f.night > 0.5)) continue;
        flight.add(b.pos, b.yaw, pitch, roll, 1, flap, fold, b.col);
      }
    }
    flight.end();
  }

  return {
    name: "lofts",
    update,
    info: () => ({
      lofts: lofts.length,
      flying,
      drawn: flight.count,
      at: lofts.map((L) => ({ house: L.roof.i, board: [+L.board.x.toFixed(1), +L.board.y.toFixed(1), +L.board.z.toFixed(1)], state: L.state, rounds: L.rounds.map((h) => +h.toFixed(2)) })),
    }),
    setOn: (v) => {
      on = v;
      huts.visible = v;
      if (!v) {
        flight.begin();
        flight.end();
      }
    },
    // dev: a round now at the nearest loft
    ...{ fly: (eye: { x: number; z: number }) => {
      const L = [...lofts].sort((a, b) => Math.hypot(a.board.x - eye.x, a.board.z - eye.z) - Math.hypot(b.board.x - eye.x, b.board.z - eye.z))[0];
      if (L) L.forced = 60;
      return L ? L.roof.i : -1;
    } },
  } as Part;
}
