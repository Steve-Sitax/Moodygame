import * as THREE from "three";
import { jackdaw } from "../../audio/aliveSounds";
import { Flight, birdShape, type Ctx, type Frame, type Part } from "./common";
import { HOUSES, roofOf } from "./roofs";
import { dice, hash32, share, sharedSeconds } from "../../game/share";

// M7 alive: jackdaws on the roofs. They nest in the chimneys and the church lofts of old towns, and
// by day they sit about on the ridges and the chimney pots in twos and threes (a cold chimney: no
// smoke comes out under a bird), turn about, hop along the ridge, and now and then a few go up
// together, tumble round the roofs calling "tchak" and come down somewhere else. At dusk they go to
// roost and are gone by night. In the rain they sit it out, fewer and still. Only round Jef (the
// roofs within 70 m); the perches are chosen again when he has walked on 35 m.

const MAX = 26 * 3;
const NEAR = 70;
/**
 * M8f sync pass 3: the jackdaws are the town's, not this PC's. Their perches are grouped in cells of this size (m);
 * a cell's jackdaws sit in fours; each four goes up once in each EPOCH seconds of the shared clock (at a time of the
 * cell's own dice) and comes down on the ridge the dice give it (one four in a cell). Where each is at any moment is a sum of the clock and
 * the dice: two PCs, or one that comes by later, have the same bird on the same ridge (they were chosen round Jef by
 * this PC's dice, again each time he had walked on 35 m).
 */
const CELL = 70;
const EPOCH = 150;

interface Daw {
  cell: string;
  i: number;
  pos: THREE.Vector3;
  prev: THREE.Vector3;
  yaw: number;
  seed: number;
  inAir: boolean;
}

export function createJackdaws(ctx: Ctx): Part {
  const flight = new Flight(birdShape(0.68, [0.14, 0.14, 0.15], [0.1, 0.1, 0.11], [0.06, 0.06, 0.07], [0.08, 0.08, 0.08], 0.9, 1.3), MAX, "alive_jackdaws", 0.68);
  ctx.scene.add(flight.mesh);
  let on = true;
  let cells: Map<string, THREE.Vector3[]> | null = null;
  const daws = new Map<string, Daw[]>();
  let callWait = 3;
  const vel = new THREE.Vector3();
  const p0 = new THREE.Vector3();
  const p1 = new THREE.Vector3();
  const ctrl = new THREE.Vector3();

  /** Every ridge (three points along it) and every chimney that hardly ever smokes, by cell (made once). */
  function allPerches(): Map<string, THREE.Vector3[]> {
    const out = new Map<string, THREE.Vector3[]>();
    const add = (x: number, y: number, z: number) => {
      const key = `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
      const l = out.get(key) ?? [];
      l.push(new THREE.Vector3(x, y, z));
      out.set(key, l);
    };
    for (let i = 0; i < HOUSES.length; i++) {
      const h = HOUSES[i];
      if (!h.rect || !h.o) continue;
      const r = roofOf(i);
      if (!r || h.roof === "flat") continue;
      const y = r.H + r.rise + 0.03;
      for (const k of [0.12, 0.5, 0.88]) add(r.a[0] + (r.b[0] - r.a[0]) * k, y, r.a[1] + (r.b[1] - r.a[1]) * k);
    }
    // (a chimney a bird may sit on whatever the hour: one that is nearly never lit)
    for (const c of ctx.world.ambient.chimneys()) if (c.act > 0.97) add(c.x, c.y + 0.02, c.z);
    return out;
  }

  /** Where jackdaw i of a cell sits in epoch e (a four sits on neighbouring points of one ridge row). */
  function perchOf(list: THREE.Vector3[], cell: string, i: number, e: number): THREE.Vector3 {
    const g = Math.floor(i / 4);
    const a = hash32(`dawperch:${cell}`, g, e) % list.length;
    return list[(a + (i % 4)) % list.length];
  }

  function update(f: Frame): void {
    if (!on) return;
    // out by day; roosting from dusk (night > 0.5) until the morning
    const out = f.night < 0.5;
    flight.begin();
    if (!out) {
      flight.end();
      return;
    }
    if (!cells) {
      if (!ctx.world.ambient.chimneys().length) {
        flight.end();
        return;
      }
      cells = allPerches();
    }
    const S = sharedSeconds();
    const wet = f.rain > 0.3;
    // the cells within 70 m of any player
    const people = share.on ? share.players() : [f.eye];
    const want = new Set<string>();
    for (const q of people) {
      for (let i = Math.floor((q.x - NEAR) / CELL); i <= Math.floor((q.x + NEAR) / CELL); i++)
        for (let j = Math.floor((q.z - NEAR) / CELL); j <= Math.floor((q.z + NEAR) / CELL); j++) if (cells.has(`${i},${j}`)) want.add(`${i},${j}`);
    }
    for (const key of [...daws.keys()]) if (!want.has(key)) daws.delete(key);
    for (const key of want) {
      if (daws.has(key)) continue;
      const list = cells.get(key)!;
      const n = Math.min(4, Math.floor(list.length / 3)); // (a four a cell: about as many round a player as before)
      daws.set(key, Array.from({ length: n }, (_, i) => ({ cell: key, i, pos: new THREE.Vector3(NaN, 0, 0), prev: new THREE.Vector3(), yaw: dice(`dawyaw:${key}`, i) * 6.28, seed: dice(`dawseed:${key}`, i), inAir: false })));
    }
    const e = Math.floor(S / EPOCH);
    let inAir = 0;
    let ax = 0, ay = 0, az = 0;
    let all = 0;
    let pick: Daw | null = null;
    for (const [key, list] of daws) {
      const perches = cells.get(key)!;
      for (const d of list) {
        all++;
        const g = Math.floor(d.i / 4);
        const t0 = e * EPOCH + dice(`dawgo:${key}`, g, e) * (EPOCH - 25) + dice(`dawdelay:${key}`, d.i, e) * 1.2;
        const D = 9 + dice(`dawD:${key}`, d.i, e) * 10;
        const from = perchOf(perches, key, d.i, e - 1);
        const to = perchOf(perches, key, d.i, e);
        const wasPos = !Number.isNaN(d.pos.x);
        d.prev.copy(d.pos);
        let flap = 0;
        let fold = 1;
        let pitch = 0;
        let roll = 0;
        if (S < t0 || S >= t0 + D || from === to) {
          // sitting: a turn now and then, a hop along the ridge, a bob of the head
          const at = S < t0 ? from : to;
          d.pos.copy(at);
          d.inAir = false;
          const w = Math.floor(S / 5 + d.seed);
          d.yaw = dice(`dawyaw:${key}`, d.i) * 6.28 + (dice(`dawturn:${key}`, d.i, w) - 0.5) * 2.4;
          const hw = S / 12 + d.seed;
          const hk = (hw - Math.floor(hw)) * 12;
          if (!wet && hk < 0.35 && dice(`dawhop:${key}`, d.i, Math.floor(hw)) < 0.5) {
            d.pos.y = at.y + Math.sin((hk / 0.35) * Math.PI) * 0.12;
            flap = 0.6;
            fold = 0.4;
          }
          pitch = Math.max(0, Math.sin(f.t * 3 + d.seed * 30)) > 0.97 ? 0.4 : 0;
          if (!pick || dice("dawcall", all, Math.floor(S / 6)) < 0.2) pick = d;
        } else {
          // a curve up over the roofs and down; a tumble on the way (jackdaws play in the air)
          const k = Math.min(1, (S - t0) / D);
          const s = THREE.MathUtils.smootherstep(k, 0, 1);
          p0.copy(from);
          p1.copy(to);
          p1.x += (dice(`dawlx:${key}`, d.i, e) - 0.5) * 1.6;
          p1.z += (dice(`dawlz:${key}`, d.i, e) - 0.5) * 1.6;
          ctrl.set((from.x + to.x) / 2 + (dice(`dawcx:${key}`, g, e) - 0.5) * 30 + (dice(`dawcx2:${key}`, d.i, e) - 0.5) * 8, Math.max(from.y, to.y) + 8 + dice(`dawcy:${key}`, g, e) * 10 + (dice(`dawcy2:${key}`, d.i, e) - 0.5) * 4, (from.z + to.z) / 2 + (dice(`dawcz:${key}`, g, e) - 0.5) * 30 + (dice(`dawcz2:${key}`, d.i, e) - 0.5) * 8);
          const a = 1 - s;
          d.pos.set(a * a * p0.x + 2 * a * s * ctrl.x + s * s * p1.x, a * a * p0.y + 2 * a * s * ctrl.y + s * s * p1.y, a * a * p0.z + 2 * a * s * ctrl.z + s * s * p1.z);
          const wv = Math.sin(Math.PI * k);
          d.pos.x += Math.sin(S * 1.7 + d.seed * 20) * 2.2 * wv;
          d.pos.z += Math.cos(S * 1.3 + d.seed * 17) * 2.2 * wv;
          d.pos.y += Math.sin(S * 2.3 + d.seed * 11) * 0.8 * wv;
          flap = Math.sin(f.t * 18 + d.seed * 50) * (k < 0.15 || k > 0.85 ? 0.9 : 0.6);
          fold = 0;
          d.inAir = true;
          inAir++;
          ax += d.pos.x;
          ay += d.pos.y;
          az += d.pos.z;
          if (wasPos) {
            vel.subVectors(d.pos, d.prev);
            const hs = Math.hypot(vel.x, vel.z);
            if (hs > 1e-4) {
              const y = Math.atan2(vel.x, vel.z);
              let dy = y - d.yaw;
              dy = Math.atan2(Math.sin(dy), Math.cos(dy));
              roll = THREE.MathUtils.clamp((-dy / Math.max(f.dt, 1e-3)) * 0.3, -0.9, 0.9);
              d.yaw = y;
              pitch = -Math.atan2(vel.y, hs) * 0.6;
            }
          }
        }
        if (Math.hypot(d.pos.x - f.eye.x, d.pos.z - f.eye.z) > f.fogFar * 1.15 + 5) continue;
        flight.add(d.pos, d.yaw, pitch, roll, 1, flap, fold);
      }
    }
    flight.end();
    // their calls, from the ones in the air (or now and then from a roof)
    callWait -= f.dt;
    if (callWait <= 0) {
      callWait = inAir ? 0.8 + Math.random() * 1.5 : 6 + Math.random() * 14;
      let at: { x: number; y: number; z: number } | null = null;
      if (inAir) at = { x: ax / inAir, y: ay / inAir, z: az / inAir };
      else if (pick && !wet) at = { x: pick.pos.x, y: pick.pos.y, z: pick.pos.z };
      if (at) ctx.sound()?.placed(at, { ref: 3, reach: 60, max: 120, occl: 0.25 }, jackdaw());
    }
  }

  const allDaws = () => [...daws.values()].flat();
  return {
    name: "jackdaws",
    update,
    info: () => ({ birds: allDaws().length, cells: daws.size, drawn: flight.count, flying: allDaws().filter((d) => d.inAir).length, near: allDaws().slice(0, 3).map((d) => d.pos.toArray().map((v) => +v.toFixed(1))) }),
    setOn: (v) => {
      on = v;
      if (!v) {
        flight.begin();
        flight.end();
      }
    },
  };
}
