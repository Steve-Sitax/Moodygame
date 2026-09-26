import * as THREE from "three";
import { jackdaw } from "../../audio/aliveSounds";
import { Flight, birdShape, type Ctx, type Frame, type Part } from "./common";
import { HOUSES, roofOf } from "./roofs";

// M7 alive: jackdaws on the roofs. They nest in the chimneys and the church lofts of old towns, and
// by day they sit about on the ridges and the chimney pots in twos and threes (a cold chimney: no
// smoke comes out under a bird), turn about, hop along the ridge, and now and then a few go up
// together, tumble round the roofs calling "tchak" and come down somewhere else. At dusk they go to
// roost and are gone by night. In the rain they sit it out, fewer and still. Only round Jef (the
// roofs within 70 m); the perches are chosen again when he has walked on 35 m.

const MAX = 26;
const NEAR = 70;

interface Daw {
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  p0: THREE.Vector3;
  p1: THREE.Vector3;
  ctrl: THREE.Vector3;
  yaw: number;
  /** -1 sitting, else seconds in the air of `D`. */
  air: number;
  D: number;
  delay: number;
  seed: number;
  hop: number;
}

export function createJackdaws(ctx: Ctx): Part {
  const flight = new Flight(birdShape(0.68, [0.14, 0.14, 0.15], [0.1, 0.1, 0.11], [0.06, 0.06, 0.07], [0.08, 0.08, 0.08], 0.9, 1.3), MAX, "alive_jackdaws", 0.68);
  ctx.scene.add(flight.mesh);
  let on = true;
  const daws: Daw[] = [];
  let perches: THREE.Vector3[] = [];
  const picked = new THREE.Vector3(1e9, 0, 0);
  let flockWait = 8;
  let callWait = 3;
  const vel = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  /** Ridges and cold chimney tops round Jef. */
  function findPerches(f: Frame): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const amb = ctx.world.ambient;
    const level = amb.smokeLevel();
    for (const c of amb.chimneys()) {
      if (Math.hypot(c.x - f.eye.x, c.z - f.eye.z) > NEAR) continue;
      if (c.act < level + 0.08) continue; // it smokes
      out.push(new THREE.Vector3(c.x, c.y + 0.02, c.z));
    }
    for (let i = 0; i < HOUSES.length; i++) {
      const h = HOUSES[i];
      if (!h.rect || !h.o) continue;
      if (Math.abs(h.o[0] - f.eye.x) > NEAR + 20 || Math.abs(h.o[1] - f.eye.z) > NEAR + 20) continue;
      const r = roofOf(i);
      if (!r || h.roof === "flat") continue;
      const y = r.H + r.rise + 0.03;
      for (const k of [0.12, 0.5, 0.88]) {
        const x = r.a[0] + (r.b[0] - r.a[0]) * k;
        const z = r.a[1] + (r.b[1] - r.a[1]) * k;
        if (Math.hypot(x - f.eye.x, z - f.eye.z) < NEAR) out.push(new THREE.Vector3(x, y, z));
      }
    }
    return out;
  }

  const pick = () => perches[Math.floor(Math.random() * perches.length)];

  function update(f: Frame): void {
    if (!on) return;
    const dt = f.dt;
    // out by day; roosting from dusk (night > 0.5) until the morning
    const out = f.night < 0.5;
    if (picked.distanceTo(f.eye) > 35) {
      perches = findPerches(f);
      picked.copy(f.eye);
      daws.length = 0;
      const n = Math.min(MAX, Math.floor(perches.length / 3));
      for (let i = 0; i < n; i++) {
        const p = pick().clone();
        daws.push({ pos: p.clone(), prev: p.clone(), p0: p.clone(), p1: p.clone(), ctrl: p.clone(), yaw: Math.random() * 6.28, air: -1, D: 1, delay: 0, seed: Math.random(), hop: 0 });
      }
    }
    flight.begin();
    if (!out || !perches.length) {
      flight.end();
      return;
    }
    const wet = f.rain > 0.3;
    // a few go up together now and then
    flockWait -= dt;
    if (flockWait <= 0 && daws.length) {
      flockWait = wet ? 50 + Math.random() * 60 : 12 + Math.random() * 30;
      const lead = daws[Math.floor(Math.random() * daws.length)];
      const group = daws.filter((d) => d.air < 0 && d.pos.distanceTo(lead.pos) < 14).slice(0, 3 + Math.floor(Math.random() * 6));
      const land = pick();
      const high = new THREE.Vector3((lead.pos.x + land.x) / 2 + (Math.random() - 0.5) * 30, Math.max(lead.pos.y, land.y) + 8 + Math.random() * 10, (lead.pos.z + land.z) / 2 + (Math.random() - 0.5) * 30);
      for (const d of group) {
        d.air = 0;
        d.D = 9 + Math.random() * 10;
        d.delay = Math.random() * 1.2;
        d.p0.copy(d.pos);
        d.p1.copy(land).add(tmp.set((Math.random() - 0.5) * 1.6, 0, (Math.random() - 0.5) * 1.6));
        // (land on the ridge line: the same height as the perch)
        d.p1.y = land.y;
        d.ctrl.copy(high).add(tmp.set((Math.random() - 0.5) * 8, (Math.random() - 0.5) * 4, (Math.random() - 0.5) * 8));
      }
      if (group.length) callWait = 0.3;
    }
    let inAir = 0;
    let ax = 0, ay = 0, az = 0;
    for (const d of daws) {
      d.prev.copy(d.pos);
      let flap = 0;
      let fold = 1;
      let pitch = 0;
      let roll = 0;
      if (d.air < 0) {
        // sitting: a turn, a hop along the ridge, a bob of the head
        if (Math.random() < dt / 5) d.yaw += (Math.random() - 0.5) * 2.4;
        if (!wet && d.hop <= 0 && Math.random() < dt / 12) d.hop = 0.35;
        if (d.hop > 0) {
          d.hop -= dt;
          d.pos.y = d.p0.y + Math.sin((1 - d.hop / 0.35) * Math.PI) * 0.12;
          flap = 0.6;
          fold = 0.4;
        }
        pitch = Math.max(0, Math.sin(f.t * 3 + d.seed * 30)) > 0.97 ? 0.4 : 0;
      } else if (d.delay > 0) {
        d.delay -= dt;
      } else {
        d.air += dt;
        const k = Math.min(1, d.air / d.D);
        const s = THREE.MathUtils.smootherstep(k, 0, 1);
        // a curve up over the roofs and down; a tumble on the way (jackdaws play in the air)
        const a = 1 - s;
        d.pos.set(a * a * d.p0.x + 2 * a * s * d.ctrl.x + s * s * d.p1.x, a * a * d.p0.y + 2 * a * s * d.ctrl.y + s * s * d.p1.y, a * a * d.p0.z + 2 * a * s * d.ctrl.z + s * s * d.p1.z);
        const w = Math.sin(Math.PI * k);
        d.pos.x += Math.sin(f.t * 1.7 + d.seed * 20) * 2.2 * w;
        d.pos.z += Math.cos(f.t * 1.3 + d.seed * 17) * 2.2 * w;
        d.pos.y += Math.sin(f.t * 2.3 + d.seed * 11) * 0.8 * w;
        flap = Math.sin(f.t * 18 + d.seed * 50) * (k < 0.15 || k > 0.85 ? 0.9 : 0.6);
        fold = 0;
        if (k >= 1) {
          d.air = -1;
          d.p0.copy(d.p1);
          d.pos.copy(d.p1);
        }
        inAir++;
        ax += d.pos.x;
        ay += d.pos.y;
        az += d.pos.z;
      }
      if (d.air >= 0 && d.delay <= 0) {
        vel.subVectors(d.pos, d.prev);
        const hs = Math.hypot(vel.x, vel.z);
        if (hs > 1e-4) {
          const y = Math.atan2(vel.x, vel.z);
          let dy = y - d.yaw;
          dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          roll = THREE.MathUtils.clamp(-dy / Math.max(dt, 1e-3) * 0.3, -0.9, 0.9);
          d.yaw = y;
          pitch = -Math.atan2(vel.y, hs) * 0.6;
        }
      }
      if (Math.hypot(d.pos.x - f.eye.x, d.pos.z - f.eye.z) > f.fogFar * 1.15 + 5) continue;
      flight.add(d.pos, d.yaw, pitch, roll, 1, flap, fold);
    }
    flight.end();
    // their calls, from the ones in the air (or now and then from a roof)
    callWait -= dt;
    if (callWait <= 0) {
      callWait = inAir ? 0.8 + Math.random() * 1.5 : 6 + Math.random() * 14;
      let at: { x: number; y: number; z: number } | null = null;
      if (inAir) at = { x: ax / inAir, y: ay / inAir, z: az / inAir };
      else if (daws.length && !wet) {
        const d = daws[Math.floor(Math.random() * daws.length)];
        at = { x: d.pos.x, y: d.pos.y, z: d.pos.z };
      }
      if (at) ctx.sound()?.placed(at, { ref: 3, reach: 60, max: 120, occl: 0.25 }, jackdaw());
    }
  }

  return {
    name: "jackdaws",
    update,
    info: () => ({ birds: daws.length, perches: perches.length, drawn: flight.count, flying: daws.filter((d) => d.air >= 0).length, near: daws.slice(0, 3).map((d) => d.pos.toArray().map((v) => +v.toFixed(1))) }),
    setOn: (v) => {
      on = v;
      if (!v) {
        flight.begin();
        flight.end();
      }
    },
  };
}
