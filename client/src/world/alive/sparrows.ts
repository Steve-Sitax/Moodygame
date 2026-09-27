import * as THREE from "three";
import { chirp, wings } from "../../audio/aliveSounds";
import { Flight, birdShape, openAt, type Ctx, type Frame, type Part } from "./common";
import { dice, hash32, seeded, share, sharedSeconds } from "../../game/share";

// M7 alive: house sparrows in the street, where the horses leave oats and the market its crumbs.
// Three little flocks of five to nine round Jef (12-30 m off, on open ground near a wall), hopping
// with both feet, pecking, turning; they chirp. Come within 4 m (or run at them) and they flit off
// together, low, to another patch 8-15 m away from you. By day only, and not in heavy rain.

/** M8f sync pass 3: a flock may have its patch in each cell of this size (m), by the cell's own dice. */
const CELL = 24;
const MAX = 27 * 3;

interface Sparrow {
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  yaw: number;
  /** -1 on the ground, else 0..1 of a flit; hop 0..1 of a hop. */
  fly: number;
  flyS: number;
  hop: number;
  hopFrom: THREE.Vector3;
  hopTo: THREE.Vector3;
  peck: number;
  /** The step of the shared clock it last decided at; its spot in the flock. */
  step: number;
  ox: number;
  oz: number;
  seed: number;
}

interface Flock {
  key: string;
  c: THREE.Vector3;
  birds: Sparrow[];
  chirp: number;
}

export function createSparrows(ctx: Ctx): Part {
  const flight = new Flight(birdShape(0.26, [0.66, 0.54, 0.4], [0.52, 0.38, 0.24], [0.22, 0.16, 0.1], [0.3, 0.26, 0.2], 0.9, 2.2), MAX, "alive_sparrows", 0.26);
  ctx.scene.add(flight.mesh);
  let on = true;
  // M8f sync pass 3: the flocks' patches are fixed by the town (a cell's own dice: open ground near a wall), and a
  // flock is about while any player is within 38 m of it; every player flushes it, and where it lands and what each
  // bird does come from the flock, the bird and the clock every PC shares: the same sparrows on every screen (they
  // were three flocks round Jef, placed and moved by this PC's dice)
  const flocks = new Map<string, Flock>();
  const homes = new Map<string, THREE.Vector3 | null>();
  const tmp = new THREE.Vector3();
  const lastEye = new THREE.Vector3();
  let eyeSpeed = 0;

  /** Open ground near a wall (within 3 m) from a row of dice, round (x0, z0) at rMin..rMax (away from `away`, if given). */
  function spot(rng: () => number, x0: number, z0: number, rMin: number, rMax: number, away?: { x: number; z: number }): THREE.Vector3 | null {
    for (let k = 0; k < 20; k++) {
      const a = rng() * Math.PI * 2;
      const d = rMin + rng() * (rMax - rMin);
      const x = x0 + Math.cos(a) * d;
      const z = z0 + Math.sin(a) * d;
      if (away && Math.hypot(x - away.x, z - away.z) < Math.hypot(x0 - away.x, z0 - away.z)) continue;
      if (!openAt(ctx.flags, x, z, 1.2)) continue;
      let wall = false;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (ctx.flags(x + dx, z + dz) === 1) wall = true;
      if (!wall && rng() < 0.7) continue;
      const y = ctx.world.baseAt(x, z);
      if (!Number.isFinite(y)) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  /** The cell's patch (null: none in it). */
  function homeOf(ci: number, cj: number): THREE.Vector3 | null {
    const key = `${ci},${cj}`;
    if (homes.has(key)) return homes.get(key)!;
    let h: THREE.Vector3 | null = null;
    if (ctx.flags((ci + 0.5) * CELL, (cj + 0.5) * CELL) !== undefined && dice("sparrows", ci, cj) < 0.45) h = spot(seeded(hash32("sparrowhome", ci, cj)), (ci + 0.5) * CELL, (cj + 0.5) * CELL, 0, CELL * 0.5);
    homes.set(key, h);
    return h;
  }

  function newFlock(key: string, ci: number, cj: number, home: THREE.Vector3): Flock {
    const r = seeded(hash32("sparrowflock", ci, cj));
    const n = 5 + Math.floor(r() * 5);
    const birds: Sparrow[] = Array.from({ length: n }, () => ({ pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), yaw: 0, fly: -1, flyS: 1, hop: 0, hopFrom: new THREE.Vector3(), hopTo: new THREE.Vector3(), peck: 0, step: -1, ox: (r() - 0.5) * 2.4, oz: (r() - 0.5) * 2.4, seed: r() }));
    const fl: Flock = { key, c: home.clone(), birds, chirp: r() * 3 };
    for (const b of birds) {
      tmp.set(home.x + b.ox, home.y, home.z + b.oz);
      if (ctx.flags(tmp.x, tmp.z) !== 0) tmp.copy(home);
      b.pos.copy(tmp);
      b.yaw = b.seed * 6.28;
    }
    return fl;
  }

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    const moved = f.eye.distanceTo(lastEye);
    eyeSpeed = dt > 0 && moved < 5 ? eyeSpeed + (moved / dt - eyeSpeed) * Math.min(1, dt * 4) : eyeSpeed;
    lastEye.copy(f.eye);
    flight.begin();
    const out = f.night < 0.35 && f.rain < 0.45 && f.weather !== "storm";
    if (!out || ctx.flags(f.eye.x, f.eye.z) === undefined) {
      flocks.clear();
      flight.end();
      return;
    }
    const people = share.on ? share.players() : [f.eye];
    const S = sharedSeconds();
    // the flocks near any player (within 38 m of one: kept to 45 m), the others gone once they sit
    const want = new Set<string>();
    for (const q of people) {
      const i0 = Math.floor((q.x - 38) / CELL), i1 = Math.floor((q.x + 38) / CELL);
      const j0 = Math.floor((q.z - 38) / CELL), j1 = Math.floor((q.z + 38) / CELL);
      for (let i = i0; i <= i1; i++)
        for (let j = j0; j <= j1; j++) {
          const h = homeOf(i, j);
          if (!h) continue;
          const key = `${i},${j}`;
          const fl = flocks.get(key);
          const at = fl?.c ?? h;
          if (Math.hypot(at.x - q.x, at.z - q.z) < (fl ? 45 : 38)) want.add(key);
          else if (!fl) continue;
          if (!fl) flocks.set(key, newFlock(key, i, j, h));
        }
    }
    for (const [key, fl] of [...flocks]) if (!want.has(key) && fl.birds.every((b) => b.fly < 0)) flocks.delete(key);
    for (const fl of flocks.values()) {
      // a player close (or coming fast: this one's own pace): up and away together, to a patch 8-15 m off
      const own = eyeSpeed > 2.5 ? 6.5 : 4;
      let by: { x: number; z: number } | null = null;
      for (let i = 0; i < people.length && !by; i++) {
        const q = people[i];
        if (fl.birds.some((b) => b.fly < 0 && Math.hypot(b.pos.x - q.x, b.pos.z - q.z) < (i === 0 ? own : 4))) by = q;
      }
      if (by) {
        const to = spot(seeded(hash32(`sparrowflit:${fl.key}`, Math.floor(S / 3))), fl.c.x, fl.c.z, 8, 15, by);
        if (to) {
          fl.c.copy(to);
          for (const b of fl.birds) {
            b.from.copy(b.pos);
            b.to.set(to.x + b.ox, to.y, to.z + b.oz);
            if (ctx.flags(b.to.x, b.to.z) !== 0) b.to.copy(to);
            b.fly = 0;
            b.flyS = 1 / (1.4 + b.seed * 0.8);
          }
          ctx.sound()?.placed({ x: fl.c.x, y: 0.5, z: fl.c.z }, { ref: 1.5, reach: 10, max: 18, gain: 0.3 }, wings(3));
        }
      }
      fl.birds.forEach((b, bi) => {
        let flap = 0;
        let fold = 1;
        let pitch = 0;
        if (b.fly >= 0) {
          b.fly = Math.min(1, b.fly + dt * b.flyS);
          const k = b.fly;
          b.pos.lerpVectors(b.from, b.to, k);
          b.pos.y += Math.sin(Math.PI * k) * (1.6 + b.seed * 1.2);
          b.yaw = Math.atan2(b.to.x - b.from.x, b.to.z - b.from.z);
          flap = Math.sin(f.t * 40 + b.seed * 30) * 0.9;
          fold = 0;
          if (k >= 1) {
            b.fly = -1;
            b.pos.copy(b.to);
          }
        } else if (b.hop > 0) {
          b.hop = Math.max(0, b.hop - dt * 5);
          const k = 1 - b.hop;
          b.pos.lerpVectors(b.hopFrom, b.hopTo, k);
          b.pos.y += Math.sin(Math.PI * k) * 0.06;
        } else {
          if (b.peck > 0) {
            b.peck -= dt;
            pitch = Math.max(0, Math.sin(f.t * 18 + b.seed * 20)) * 0.7;
          }
          // a step of the shared clock each half second (each bird its own phase): a hop to a spot of its own
          // round its place in the flock, a peck or a turn
          const step = Math.floor(S * 2 + b.seed);
          if (step !== b.step) {
            b.step = step;
            const r = dice(`sparrow:${fl.key}`, bi, step);
            if (r < 0.55) {
              const a = dice(`sparrowa:${fl.key}`, bi, step) * Math.PI * 2;
              const d = dice(`sparrowd:${fl.key}`, bi, step) * 0.35;
              b.hopFrom.copy(b.pos);
              b.hopTo.set(fl.c.x + b.ox + Math.sin(a) * d, b.pos.y, fl.c.z + b.oz + Math.cos(a) * d);
              if (ctx.flags(b.hopTo.x, b.hopTo.z) === 0 && b.hopTo.distanceTo(b.pos) > 0.01) {
                b.yaw = Math.atan2(b.hopTo.x - b.pos.x, b.hopTo.z - b.pos.z);
                b.hop = 1;
              }
            } else if (r < 0.85) b.peck = 0.4 + dice(`sparrowp:${fl.key}`, bi, step) * 0.5;
            else b.yaw = dice(`sparrowy:${fl.key}`, bi, step) * 6.28;
          }
        }
        if (Math.hypot(b.pos.x - f.eye.x, b.pos.z - f.eye.z) > Math.min(45, f.fogFar * 1.1)) return;
        tmp.copy(b.pos);
        tmp.y += 0.07; // (over the cobbles' relief: their tops stand up to ~6 cm, retro/psx.ts)
        flight.add(tmp, b.yaw, pitch, 0, 1, flap, fold);
      });
      // their chirps, within 15 m
      fl.chirp -= dt;
      if (fl.chirp <= 0) {
        fl.chirp = 1.5 + Math.random() * 4;
        if (fl.c.distanceTo(f.eye) < 18) ctx.sound()?.placed({ x: fl.c.x, y: 0.3, z: fl.c.z }, { ref: 1.5, reach: 10, max: 18 }, chirp());
      }
    }
    flight.end();
  }

  return {
    name: "sparrows",
    update,
    info: () => ({ flocks: [...flocks.values()].map((fl) => ({ key: fl.key, at: fl.c.toArray().map((v) => +v.toFixed(1)), bird: fl.birds[0]?.pos.toArray().map((v) => +v.toFixed(2)), n: fl.birds.length, flying: fl.birds.filter((b) => b.fly >= 0).length })), drawn: flight.count }),
    setOn: (v) => {
      on = v;
      if (!v) {
        flight.begin();
        flight.end();
      }
    },
  };
}
