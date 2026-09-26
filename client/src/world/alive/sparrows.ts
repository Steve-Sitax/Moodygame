import * as THREE from "three";
import { chirp, wings } from "../../audio/aliveSounds";
import { Flight, birdShape, openAt, type Ctx, type Frame, type Part } from "./common";

// M7 alive: house sparrows in the street, where the horses leave oats and the market its crumbs.
// Three little flocks of five to nine round Jef (12-30 m off, on open ground near a wall), hopping
// with both feet, pecking, turning; they chirp. Come within 4 m (or run at them) and they flit off
// together, low, to another patch 8-15 m away from you. By day only, and not in heavy rain.

const FLOCKS = 3;
const MAX = 27;

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
  wait: number;
  seed: number;
}

interface Flock {
  c: THREE.Vector3;
  birds: Sparrow[];
  chirp: number;
}

export function createSparrows(ctx: Ctx): Part {
  const flight = new Flight(birdShape(0.26, [0.66, 0.54, 0.4], [0.52, 0.38, 0.24], [0.22, 0.16, 0.1], [0.3, 0.26, 0.2], 0.9, 2.2), MAX, "alive_sparrows", 0.26);
  ctx.scene.add(flight.mesh);
  let on = true;
  const flocks: Flock[] = [];
  const tmp = new THREE.Vector3();
  const lastEye = new THREE.Vector3();
  let eyeSpeed = 0;

  /** Open ground near a wall (within 3 m), 12-30 m from Jef, on his level. */
  function spot(f: Frame, near?: THREE.Vector3, away?: THREE.Vector3): THREE.Vector3 | null {
    for (let k = 0; k < 20; k++) {
      let x: number, z: number;
      if (near) {
        const a = Math.random() * Math.PI * 2;
        const d = 8 + Math.random() * 7;
        x = near.x + Math.cos(a) * d;
        z = near.z + Math.sin(a) * d;
        if (away && Math.hypot(x - away.x, z - away.z) < Math.hypot(near.x - away.x, near.z - away.z)) continue;
      } else {
        const a = Math.random() * Math.PI * 2;
        const d = 12 + Math.random() * 18;
        x = f.eye.x + Math.cos(a) * d;
        z = f.eye.z + Math.sin(a) * d;
      }
      if (!openAt(ctx.flags, x, z, 1.2)) continue;
      let wall = false;
      for (const [dx, dz] of [[3, 0], [-3, 0], [0, 3], [0, -3]]) if (ctx.flags(x + dx, z + dz) === 1) wall = true;
      if (!wall && Math.random() < 0.7) continue;
      const y = ctx.world.baseAt(x, z);
      if (!Number.isFinite(y) || Math.abs(y - (f.eye.y - 1.6)) > 2.5) continue;
      return new THREE.Vector3(x, y, z);
    }
    return null;
  }

  function place(fl: Flock, c: THREE.Vector3): void {
    fl.c.copy(c);
    for (const b of fl.birds) {
      for (let k = 0; k < 6; k++) {
        tmp.set(c.x + (Math.random() - 0.5) * 2.4, c.y, c.z + (Math.random() - 0.5) * 2.4);
        if (ctx.flags(tmp.x, tmp.z) === 0) break;
        tmp.copy(c);
      }
      b.pos.copy(tmp);
      b.fly = -1;
      b.hop = 0;
      b.yaw = Math.random() * 6.28;
    }
  }

  const newBird = (): Sparrow => ({ pos: new THREE.Vector3(), from: new THREE.Vector3(), to: new THREE.Vector3(), yaw: 0, fly: -1, flyS: 1, hop: 0, hopFrom: new THREE.Vector3(), hopTo: new THREE.Vector3(), peck: 0, wait: Math.random() * 2, seed: Math.random() });

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    const moved = f.eye.distanceTo(lastEye);
    eyeSpeed = dt > 0 && moved < 5 ? eyeSpeed + (moved / dt - eyeSpeed) * Math.min(1, dt * 4) : eyeSpeed;
    lastEye.copy(f.eye);
    flight.begin();
    const out = f.night < 0.35 && f.rain < 0.45 && f.weather !== "storm";
    if (!out || ctx.flags(f.eye.x, f.eye.z) === undefined) {
      flight.end();
      return;
    }
    while (flocks.length < FLOCKS) {
      const n = 5 + Math.floor(Math.random() * 5);
      flocks.push({ c: new THREE.Vector3(1e9, 0, 0), birds: Array.from({ length: n }, newBird), chirp: Math.random() * 3 });
    }
    for (const fl of flocks) {
      // too far (or never placed): a new patch round Jef
      if (fl.c.distanceTo(f.eye) > 38 && fl.birds.every((b) => b.fly < 0)) {
        const c = spot(f);
        if (c) place(fl, c);
        else continue;
      }
      // Jef close (or coming fast): up and away together
      const flushR = eyeSpeed > 2.5 ? 6.5 : 4;
      const close = fl.birds.some((b) => b.fly < 0 && Math.hypot(b.pos.x - f.eye.x, b.pos.z - f.eye.z) < flushR);
      if (close) {
        const to = spot(f, fl.c, f.eye);
        if (to) {
          fl.c.copy(to);
          for (const b of fl.birds) {
            b.from.copy(b.pos);
            b.to.set(to.x + (Math.random() - 0.5) * 2.4, to.y, to.z + (Math.random() - 0.5) * 2.4);
            if (ctx.flags(b.to.x, b.to.z) !== 0) b.to.copy(to);
            b.fly = 0;
            b.flyS = 1 / (1.4 + Math.random() * 0.8);
          }
          ctx.sound()?.placed({ x: fl.c.x, y: 0.5, z: fl.c.z }, { ref: 1.5, reach: 10, max: 18, gain: 0.3 }, wings(3));
        }
      }
      for (const b of fl.birds) {
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
            b.wait = 0.3 + Math.random();
          }
        } else if (b.hop > 0) {
          b.hop = Math.max(0, b.hop - dt * 5);
          const k = 1 - b.hop;
          b.pos.lerpVectors(b.hopFrom, b.hopTo, k);
          b.pos.y += Math.sin(Math.PI * k) * 0.06;
        } else {
          b.wait -= dt;
          if (b.peck > 0) {
            b.peck -= dt;
            pitch = Math.max(0, Math.sin(f.t * 18 + b.seed * 20)) * 0.7;
          }
          if (b.wait <= 0) {
            const r = Math.random();
            if (r < 0.55) {
              // a hop (both feet), a little turn first
              b.yaw += (Math.random() - 0.5) * 1.6;
              const d = 0.08 + Math.random() * 0.14;
              b.hopFrom.copy(b.pos);
              b.hopTo.set(b.pos.x + Math.sin(b.yaw) * d, b.pos.y, b.pos.z + Math.cos(b.yaw) * d);
              if (ctx.flags(b.hopTo.x, b.hopTo.z) === 0 && b.hopTo.distanceTo(fl.c) < 2.5) b.hop = 1;
              b.wait = 0.15 + Math.random() * 0.5;
            } else if (r < 0.85) {
              b.peck = 0.4 + Math.random() * 0.9;
              b.wait = b.peck;
            } else {
              b.yaw += (Math.random() - 0.5) * 3;
              b.wait = 0.4 + Math.random() * 1.2;
            }
          }
        }
        if (Math.hypot(b.pos.x - f.eye.x, b.pos.z - f.eye.z) > Math.min(45, f.fogFar * 1.1)) continue;
        tmp.copy(b.pos);
        tmp.y += 0.07; // (over the cobbles' relief: their tops stand up to ~6 cm, retro/psx.ts)
        flight.add(tmp, b.yaw, pitch, 0, 1, flap, fold);
      }
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
    info: () => ({ flocks: flocks.map((fl) => ({ at: fl.c.toArray().map((v) => +v.toFixed(1)), bird: fl.birds[0]?.pos.toArray().map((v) => +v.toFixed(2)), n: fl.birds.length, flying: fl.birds.filter((b) => b.fly >= 0).length })), drawn: flight.count }),
    setOn: (v) => {
      on = v;
      if (!v) {
        flight.begin();
        flight.end();
      }
    },
  };
}
