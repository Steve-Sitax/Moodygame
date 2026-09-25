import * as THREE from "three";
import { api, type Convo, type JobsPayload, type PublicAction, type PushMsg, type TownEvent } from "../net/api";
import type { FogDay, LampRound } from "../../../server/src/town/lampround";
import { psx } from "../retro/psx";
import { createFires, type Fires, type FireSpot } from "../world/fire";
import { loadProps, type Props } from "../world/props3d";
import { createPumpCart, type PumpCart } from "../world/pumpcart";
import type { World } from "../world/rijnkaai";
import type { Rect } from "../world/geom";
import type { Action } from "./runs";
import type { Crowd } from "./crowd";
import type { Events } from "./events";
import { Lamplighters } from "./lamplighter";
import type { Town } from "./town";
import { REAL_S_PER_GAME_MIN } from "../../../shared/clock"; // M7 clock: 1/3 -> 2 real s a game minute

// Town life on the client (M6): the lamplighters (game/lamplighter.ts), the house fire and the
// naties' hiring at dawn. The server plans and settles everything (director/fire.ts,
// director/hiring.ts); this side shows it near Jef and lets him take part:
//
// - The fire: the alarm bell from the cathedral tower; flames at the windows and over the roof,
//   a column of smoke (world/fire.ts, scaled up), dying down through the bucket chain and the
//   last stage, steam as the water hits; the pump driven along the engine's path from the fire
//   post by two horses (world/pumpcart.ts), its brakes worked by the firemen (leads dressed by
//   wardrobe.ts), a hose to the door; buckets passed hand to hand up the full line and back down
//   the empty one; a soot mark on the front that fades over three days. E at the line: take a
//   place in the chain (walk away to step out); the engine says what it earns.
// - The hiring: the men stand facing their foreman; E among them: stand for hire; the call and
//   the foreman's remarks as bubbles over him; Jef's answer as a line.

export interface TownLifeData {
  day: number;
  rounds: LampRound[];
  /** M7 fog lamps: today's fog as the lamplighters see it. */
  fog?: FogDay;
  soot: Array<{ house: number; door: [number, number]; out: [number, number]; storeys: number; day: number; event: number }>;
}

export interface FireView {
  owner: string;
  owner_name: string;
  door: [number, number];
  out: [number, number];
  step: [number, number];
  storeys: number;
  water: [number, number];
  chain: Array<[number, number]>;
  full: number;
  chain_ids: string[];
  station: [number, number];
  pump_path: Array<[number, number]>;
  pump_at: [number, number, number];
  firemen: string[];
  jef: { slot: number; in: boolean } | null;
  settled: string | null;
}

export interface HiringView {
  called: boolean;
  spots: Array<{
    id: string;
    label: string;
    x: number;
    z: number;
    yaw: number;
    foreman: string | null;
    ship: string;
    men: number;
    picked: string[];
    jef: boolean;
    jef_result: { picked: boolean; text: string } | null;
    call: string | null;
    remarks: string[];
    to_jef: string | null;
    source: string | null;
  }>;
}

/** The storey heights of the city build (tools/city/plan.py): ground 3.8 m, then 3 m. */
const GROUND_H = 3.8;
/** The houses' window bays (tools/blender/build_city.py BAY). */
const HOUSE_BAY_M = 3.0;
const STOREY_H = 3.0;
const SOOT_DAYS = 3;
/** Where the alarm is rung: the cathedral tower (the soundscape rings it there whatever the point). */
const TOWER = { x: -266, z: 158 };
const SEE_M = 140;
const CHAIN_REACH = 2.4;
const CHAIN_LEAVE = 2.8;
/** A chain member this near their place steps onto it; farther, and standing, they have given up on the way. */
const CHAIN_STEP_IN = 4;
/** One still walking this far off, out of sight, is put in place. */
const CHAIN_SNAP = 6;
const HIRE_REACH = 11;

interface FireLive {
  id: number;
  view: FireView;
  fx: Fires | null;
  pump: PumpCart | null;
  /** The pump standing at work is solid (fixes 2026-09-24: the crowd stood all over it and hid it). */
  pumpRect?: Rect | null;
  hosed: boolean;
  soot: THREE.Mesh | null;
  alarmed: boolean;
  level: number;
}

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

let sootTex: THREE.Texture | null = null;
/** Soot streaks up a front, from the windows and the door: a canvas made once. */
function sootTexture(): THREE.Texture {
  if (sootTex) return sootTex;
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 64, 128);
  // the whole front dulled by the smoke, darkest high up
  const base = g.createLinearGradient(0, 128, 0, 0);
  base.addColorStop(0, "rgba(10,8,6,0.12)");
  base.addColorStop(1, "rgba(10,8,6,0.5)");
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 128);
  let s = 7;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // a plume up from each window column and over the top
  for (const cx of [14, 32, 50]) {
    for (let i = 0; i < 40; i++) {
      const x = cx + (r() - 0.5) * 16;
      const y0 = 40 + r() * 80;
      const len = 20 + r() * 50;
      const grd = g.createLinearGradient(0, y0, 0, y0 - len);
      grd.addColorStop(0, "rgba(10,8,6,0)");
      grd.addColorStop(0.3, `rgba(12,10,8,${0.4 + r() * 0.3})`);
      grd.addColorStop(1, "rgba(10,8,6,0.15)");
      g.fillStyle = grd;
      g.fillRect(x - 2 - r() * 3, y0 - len, 4 + r() * 5, len);
    }
  }
  const top = g.createLinearGradient(0, 0, 0, 50);
  top.addColorStop(0, "rgba(8,6,5,0.95)");
  top.addColorStop(1, "rgba(8,6,5,0)");
  g.fillStyle = top;
  g.fillRect(0, 0, 64, 50);
  sootTex = new THREE.CanvasTexture(c);
  sootTex.magFilter = THREE.NearestFilter;
  return sootTex;
}

export class TownLife {
  readonly lamplighters: Lamplighters;
  private data: TownLifeData | null = null;
  private fires = new Map<number, FireLive>();
  private oldSoot = new Map<number, THREE.Mesh>();
  private props: Props | null = null;
  private clock = 0;
  private pollT = 0;
  private buckets: THREE.InstancedMesh;
  private readonly M = new THREE.Matrix4();
  /** Jef in a chain: the event and his place. */
  private inChain: { ev: number; slot: number; x: number; z: number } | null = null;
  private busy = false;
  private told = new Set<string>();
  /** Set by main. */
  say: (t: string) => void = () => {};
  refresh: (p: JobsPayload) => void = () => {};
  showLines: (c: Convo) => void = () => {};
  actions: () => PublicAction[] = () => [];

  constructor(
    private readonly world: World,
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly events: Events,
  ) {
    this.lamplighters = new Lamplighters(town, crowd, world.gasLamps);
    const bucketMat = psx(new THREE.MeshLambertMaterial({ color: 0x9a7448 }));
    this.buckets = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.16, 0.12, 0.32, 7), bucketMat, 64);
    this.buckets.count = 0;
    this.buckets.frustumCulled = false;
    this.buckets.name = "chain_buckets";
    world.scene.add(this.buckets);
    loadProps()
      .then((p) => (this.props = p))
      .catch(() => {});
  }

  async load(): Promise<void> {
    const d = await api.townlife();
    this.data = d;
    this.lamplighters.setRounds(d.rounds);
    this.drawOldSoot();
  }

  handlePush(m: PushMsg): void {
    if (m.type !== "events") return;
    const settled = (m as { fire_settled?: string }).fire_settled;
    if (settled && this.inChainOrWas) this.say(settled);
    this.pollT = Math.min(this.pollT, 1);
  }
  private inChainOrWas = false;
  /** Chain people sent on their way again (event:npc -> clock). */
  private resent = new Map<string, number>();
  /** Dev: how many stand in the chain now. */
  private chainHands = 0;

  /** M7 fog lamps: today's fog from the latest clock payload (main.ts: jobs.day); else the last poll's. */
  fogDay: () => FogDay | null | undefined = () => null;

  update(dt: number, player: { x: number; z: number }, hour: number): void {
    this.clock += dt;
    this.lamplighters.fog = this.fogDay() ?? this.data?.fog ?? null;
    this.lamplighters.update(dt, player, hour);
    this.pollT -= dt;
    if (this.pollT <= 0) {
      this.pollT = 20;
      api
        .townlife()
        .then((d) => {
          this.data = d;
          this.drawOldSoot();
        })
        .catch(() => {});
    }
    const seen = new Set<number>();
    let bucketN = 0;
    for (const ev of this.events.list) {
      if (ev.template === "house_fire" && ev.fire && ev.status === "running") {
        seen.add(ev.id);
        bucketN = this.fire(ev, ev.fire, dt, player, bucketN);
      }
      if (ev.template === "hiring" && ev.hiring && ev.status === "running") this.hiring(ev, ev.hiring);
    }
    for (const [id, f] of this.fires) if (!seen.has(id)) this.endFire(f);
    this.buckets.count = bucketN;
    this.buckets.instanceMatrix.needsUpdate = true;
    // Jef walked out of the chain
    if (this.inChain && dist(player.x, player.z, this.inChain.x, this.inChain.z) > CHAIN_LEAVE) {
      this.inChain = null;
      void this.post(() => api.fireLeave());
    }
  }

  // ------------------------------------------------------------------ the fire

  private stageMinutes(ev: TownEvent): { t: number; since: number } {
    const st = ev.stages[ev.stage];
    const m = st?.minutes ?? 1;
    const t = Math.max(0, Math.min(1, 1 - ev.stage_left / m));
    return { t, since: (m - ev.stage_left) * REAL_S_PER_GAME_MIN };
  }

  private fire(ev: TownEvent, v: FireView, _dt: number, player: { x: number; z: number }, bucketN: number): number {
    let f = this.fires.get(ev.id);
    if (!f) {
      f = { id: ev.id, view: v, fx: null, pump: null, hosed: false, soot: null, alarmed: false, level: 0 };
      this.fires.set(ev.id, f);
    }
    f.view = v;
    const act = ev.acts?.[ev.stage] ?? null;
    const { t, since } = this.stageMinutes(ev);
    // the alarm: once, heard across the town (the bell from the cathedral tower)
    if (!f.alarmed && act === "fire_start") {
      f.alarmed = true;
      this.events.eventSound("alarm", TOWER, Math.max(12, (ev.stage_left || 45) * REAL_S_PER_GAME_MIN));
      if (dist(player.x, player.z, v.step[0], v.step[1]) < 260) this.say(`Fire! The alarm bell rings: ${v.owner_name}'s house is burning.`);
    }
    // how fierce: it takes, burns, dies under the water, goes out
    let flame = 0;
    let smoke = 0;
    if (act === "fire_start") [flame, smoke] = [0.35 + 0.6 * t, 1.3 + 0.6 * t];
    else if (act === "fire_brigade") [flame, smoke] = [1, 2];
    else if (act === "fire_chain") [flame, smoke] = [1 - 0.55 * t, 2 + 0.4 * t];
    else if (act === "fire_down") [flame, smoke] = [0.45 * (1 - t), 2.4 * (1 - t) + 0.2];
    f.level = flame;
    const near = dist(player.x, player.z, v.step[0], v.step[1]) < SEE_M;
    if (near && !f.fx) f.fx = createFires(this.world.scene, this.fireSpots(v), { smoke: 18 });
    if (!near && f.fx) {
      f.fx.dispose();
      f.fx = null;
    }
    f.fx?.setLevel(flame, smoke);
    f.fx?.update(this.clock);
    // the front blackens as it burns
    const burnt = act === "fire_start" ? 0.15 * t : act === "fire_brigade" ? 0.15 + 0.2 * t : act === "fire_chain" ? 0.35 + 0.4 * t : 0.75 + 0.1 * t;
    if (near && !f.soot) f.soot = this.sootMesh(v.door, v.out, v.storeys);
    if (f.soot) (f.soot.material as THREE.MeshLambertMaterial).opacity = burnt;
    // the pump: from the fire post along the engine's way, then at work
    const stageNo = ev.stage;
    const brigadeAt = ev.acts?.indexOf("fire_brigade") ?? 1;
    if (near && stageNo >= brigadeAt && !f.pump && this.props) f.pump = createPumpCart(this.world.scene, this.props);
    if (f.pump) {
      const path = v.pump_path;
      let len = 0;
      for (let i = 1; i < path.length; i++) len += dist(path[i][0], path[i][1], path[i - 1][0], path[i - 1][1]);
      // from the fire post it comes at a fast trot; a long way is mostly done out of sight, so it
      // is seen for the last 150 m at most
      const from = Math.max(0, len - 150);
      const speed = Math.max(3.5, (len - from) / 16);
      const went = stageNo > brigadeAt ? len : Math.min(len, from + since * speed);
      const arrived = went >= len - 0.05;
      if (arrived) {
        f.pump.set(v.pump_at[0], v.pump_at[1], v.pump_at[2], 0, this.clock, flame > 0.04, this.world.groundAt(v.pump_at[0], v.pump_at[1], 0.3, 0));
        if (!f.hosed) {
          f.hosed = true;
          f.pump.hoseTo({ x: v.step[0] + v.out[0] * 0.4, z: v.step[1] + v.out[1] * 0.4 });
        }
        if (!f.pumpRect) {
          const c = Math.abs(Math.cos(v.pump_at[2]));
          const sn = Math.abs(Math.sin(v.pump_at[2]));
          const hx = 0.75 * c + 1.4 * sn;
          const hz = 0.75 * sn + 1.4 * c;
          f.pumpRect = { minX: v.pump_at[0] - hx, maxX: v.pump_at[0] + hx, minZ: v.pump_at[1] - hz, maxZ: v.pump_at[1] + hz };
          this.world.addCollider(f.pumpRect);
        }
      } else {
        const [x, z] = along(path, went);
        const [ax, az] = along(path, Math.min(len, went + 1.5));
        f.pump.set(x, z, Math.atan2(ax - x, az - z), 1, this.clock, false, this.world.groundAt(x, z, 0.3, 0));
      }
    }
    // the bucket chain: the street lines up while the pump comes, then full buckets go up to the
    // door and empties back to the water; after, they stand and watch it die
    if (act === "fire_brigade" || act === "fire_chain" || act === "fire_down") bucketN = this.chain(ev, v, bucketN, act === "fire_chain" ? "pass" : act === "fire_brigade" ? "line" : "watch", _dt);
    return bucketN;
  }

  /** Where the flames come from: the upper windows either side of the door, and over the roof. */
  private fireSpots(v: FireView): FireSpot[] {
    const [dx, dz] = v.door;
    const [ox, oz] = v.out;
    const sx = -oz;
    const sz = ox;
    const st = Math.max(2, Math.min(5, v.storeys));
    const eaves = GROUND_H + STOREY_H * (st - 1);
    const out: FireSpot[] = [];
    const at = (side: number, outM: number, y: number, size: number) => out.push({ x: dx + sx * side + ox * outM, y, z: dz + sz * side + oz * outM, size });
    // flames lick out of the windows and up the wall, and stand in a band over the roof. (Fixes
    // 2026-09-24: they came out at 1.5 m from the door, between the windows, a column of puffs
    // up the bare wall.) The houses are built in bays of about 3 m (tools/blender/build_city.py
    // BAY), the door in the middle bay: a window in the bays either side of it on the ground
    // floor, and one in every bay above. Two tongues' roots across each window opening.
    const win = (side: number, y: number, size: number) => {
      for (const d of [-0.32, 0.32]) at(side + d, 0.3, y, size);
    };
    win(-HOUSE_BAY_M, 1.6, 0.95);
    win(HOUSE_BAY_M, 1.6, 1.05);
    for (let k = 1; k < Math.min(st, 4); k++) {
      const y = GROUND_H + STOREY_H * (k - 1) + 1.0;
      win(-HOUSE_BAY_M, y, 1.3);
      win(0, y, 1.45);
      win(HOUSE_BAY_M, y, 1.35);
    }
    for (const side of [-3.3, -1.1, 1.1, 3.3]) at(side, -2.4 - Math.abs(side) * 0.15, eaves + 1.0, 2.5 + (side > 0 ? 0.3 : 0));
    return out;
  }

  private sootMesh(door: [number, number], outv: [number, number], storeys: number): THREE.Mesh {
    const st = Math.max(2, Math.min(5, storeys));
    const h = GROUND_H + STOREY_H * (st - 1) + 1;
    const mat = psx(new THREE.MeshLambertMaterial({ map: sootTexture(), transparent: true, opacity: 0, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), { affine: 0.3 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4, h), mat);
    m.position.set(door[0] + outv[0] * 0.06, h / 2, door[1] + outv[1] * 0.06);
    m.rotation.y = Math.atan2(outv[0], outv[1]);
    m.renderOrder = 2;
    m.name = "soot";
    this.world.scene.add(m);
    return m;
  }

  private endFire(f: FireLive): void {
    f.fx?.dispose();
    f.pump?.dispose();
    if (f.pumpRect) this.world.removeCollider(f.pumpRect);
    f.soot?.removeFromParent();
    this.fires.delete(f.id);
    if (this.inChain?.ev === f.id) this.inChain = null;
    this.pollT = Math.min(this.pollT, 2);
  }

  /** The soot of fires past (from the server's list), fading over three days. */
  private drawOldSoot(): void {
    const d = this.data;
    if (!d) return;
    const want = new Set<number>();
    for (const s of d.soot) {
      if (this.fires.has(s.event)) continue;
      want.add(s.event);
      let m = this.oldSoot.get(s.event);
      if (!m) {
        m = this.sootMesh(s.door, s.out, s.storeys);
        this.oldSoot.set(s.event, m);
      }
      (m.material as THREE.MeshLambertMaterial).opacity = 0.85 * Math.max(0, 1 - (d.day - s.day) / SOOT_DAYS) + 0.05;
    }
    for (const [id, m] of this.oldSoot)
      if (!want.has(id)) {
        m.removeFromParent();
        this.oldSoot.delete(id);
      }
  }

  /**
   * The chain's people and the buckets. QA 2026-09-24: the chain never formed (people stopped
   * a step and a half off their places, or were still walking, and a bucket moved only between two
   * neighbours both exactly in place, so none moved). Now: whoever has arrived near their place
   * steps onto it, so the two lines stand straight from the water to the door; one stuck out of
   * sight is put in place; and the buckets go hand to hand along whoever stands in the line,
   * across a gap if one is still coming.
   */
  private chain(ev: TownEvent, v: FireView, bucketN: number, mode: "line" | "pass" | "watch", dt: number): number {
    const slots = v.chain;
    const F = v.full;
    const passing = mode === "pass";
    const hands: Array<{ x: number; z: number } | null> = new Array(slots.length).fill(null);
    for (const a of this.actions()) {
      if (a.event_id !== ev.id || a.role !== "chain" || a.target_x === null || a.target_z === null) continue;
      const p = this.town.puppet(a.npc);
      const k = slots.findIndex(([x, z]) => Math.abs(x - a.target_x!) < 0.05 && Math.abs(z - a.target_z!) < 0.05);
      if (!p || k < 0 || !this.crowd.alive(p)) continue;
      const [sx, sz] = slots[k];
      let d = dist(p.x, p.z, sx, sz);
      if (this.crowd.puppetBusy(p)) {
        // still walking: one held up out of Jef's sight near the end of the way is simply there
        if (d > CHAIN_SNAP && this.crowd.isHidden(p.x, p.z) && this.crowd.isHidden(sx, sz)) this.snapTo(p, sx, sz);
        else continue;
        d = 0;
      } else if (d > CHAIN_STEP_IN) {
        // standing, but far from the place (given up on the way): out of sight, put in place; else on its way again
        if (this.crowd.isHidden(p.x, p.z) && this.crowd.isHidden(sx, sz)) {
          this.snapTo(p, sx, sz);
          d = 0;
        } else {
          const key = `${ev.id}:${a.npc}`;
          const t = this.resent.get(key) ?? -99;
          if (this.clock - t > 6) {
            this.resent.set(key, this.clock);
            this.crowd.puppetGo(p, sx, sz, 1.6);
          }
          continue;
        }
      } else if (d > 0.08) {
        // the last steps onto the place itself (the crowd's paths stop short of it)
        const step = Math.min(d, 1.2 * dt);
        const nx = p.x + ((sx - p.x) / d) * step;
        const nz = p.z + ((sz - p.z) / d) * step;
        if (this.world.isFree(nx, nz, 0.2)) {
          p.x = nx;
          p.z = nz;
          d -= step;
        }
      }
      hands[k] = { x: p.x, z: p.z };
      // face the other line across (the two lines pass to each other), a bucket in both hands
      const i = k < F ? k : k - F;
      const other = k < F ? slots[F + i] : slots[i];
      const [ax, az] = slots[Math.max(0, Math.min(F - 1, i))];
      const [bx, bz] = slots[Math.max(0, Math.min(F - 1, i + 1))];
      let yaw = other ? Math.atan2(other[0] - p.x, other[1] - p.z) : Math.atan2(-(bz - az), bx - ax);
      if (mode === "watch") yaw = Math.atan2(v.step[0] - p.x, v.step[1] - p.z);
      const want = passing ? "carry" : "idle";
      if (p.pmotion !== want || Math.abs(Math.atan2(Math.sin((p.pyaw ?? yaw) - yaw), Math.cos((p.pyaw ?? yaw) - yaw))) > 0.3) this.crowd.puppetStand(p, want, yaw);
    }
    if (this.inChain?.ev === ev.id) hands[this.inChain.slot] = { x: this.inChain.x, z: this.inChain.z };
    this.chainHands = hands.filter(Boolean).length;
    if (!passing) return bucketN;
    // buckets hand to hand along whoever stands in each line (a gap is passed across): two
    // places apart up the full line, three apart down the empty one, a place every 0.7 s
    const fullLine = [...Array(F).keys()].map((k) => hands[k]).filter((h): h is { x: number; z: number } => !!h);
    const backLine = [...Array(slots.length - F).keys()].map((k) => hands[F + k]).filter((h): h is { x: number; z: number } => !!h).reverse();
    const put = (line: Array<{ x: number; z: number }>, u: number) => {
      const i = Math.floor(u);
      const fr = u - i;
      const a = line[i];
      const b = line[Math.min(line.length - 1, i + 1)];
      if (!a || !b || bucketN >= 64) return;
      this.M.makeTranslation(a.x + (b.x - a.x) * fr, 0.95 + Math.sin(fr * Math.PI) * 0.12, a.z + (b.z - a.z) * fr);
      this.buckets.setMatrixAt(bucketN++, this.M);
    };
    const step = this.clock / 0.7;
    if (fullLine.length >= 2) for (let j = 0; j < fullLine.length; j += 2) put(fullLine, (step + j) % (fullLine.length - 1));
    if (backLine.length >= 2) for (let j = 0; j < backLine.length; j += 3) put(backLine, (step + j) % (backLine.length - 1));
    return bucketN;
  }

  /** Put a chain puppet on its place at once (only ever out of Jef's sight). */
  private snapTo(p: { x: number; z: number }, x: number, z: number): void {
    const q = this.world.isFree(x, z, 0.2) ? { x, z } : this.crowd.openNear(x, z);
    if (!q) return;
    p.x = q.x;
    p.z = q.z;
    this.crowd.puppetStand(p as Parameters<Crowd["puppetStand"]>[0], "idle", null);
  }

  // ------------------------------------------------------------------ the hiring

  private hiring(ev: TownEvent, h: HiringView): void {
    const act = ev.acts?.[ev.stage] ?? null;
    for (const sp of h.spots) {
      // the men face their foreman while they wait
      if (act === "hire_gather") {
        for (const a of this.actions()) {
          if (a.event_id !== ev.id || a.role !== "dockers" || a.target_x === null || a.target_z === null) continue;
          if (dist(a.target_x, a.target_z, sp.x, sp.z) > 12) continue;
          const p = this.town.puppet(a.npc);
          if (!p || this.crowd.puppetBusy(p) || dist(p.x, p.z, a.target_x, a.target_z) > 1.5) continue;
          const yaw = Math.atan2(sp.x - p.x, sp.z - p.z);
          if (Math.abs(Math.atan2(Math.sin((p.pyaw ?? 99) - yaw), Math.cos((p.pyaw ?? 99) - yaw))) > 0.3) this.crowd.puppetStand(p, p.pmotion ?? "idle", yaw);
        }
      }
      // the call, as bubbles over the foreman; Jef's answer as a line
      if (sp.call && sp.foreman) {
        const key = `${ev.id}:${sp.id}:${sp.source}`;
        if (!this.told.has(key) && !this.told.has(`${ev.id}:${sp.id}:claude`)) {
          this.told.add(key);
          const who = sp.foreman;
          const name = this.town.info(who)?.first ?? "The foreman";
          const lines = [{ who, name, text: sp.call }, ...sp.remarks.map((text) => ({ who, name, text }))];
          this.showLines({ id: -1000 - ev.id * 10 - h.spots.indexOf(sp), a: who, b: who, a_name: name, b_name: name, purpose: "scene", lines, source: sp.source ?? "engine", outcome: "", at: Date.now(), event_id: ev.id });
        }
        const jk = `${ev.id}:${sp.id}:jef`;
        if (sp.jef_result && !this.told.has(jk)) {
          this.told.add(jk);
          this.say(sp.jef_result.text);
          if (sp.to_jef) window.setTimeout(() => this.say(`${this.town.info(sp.foreman!)?.first ?? "The foreman"}: "${sp.to_jef}"`), 2500);
          void api.jobs().then((p) => this.refresh(p)).catch(() => {});
        }
      }
    }
  }

  // ------------------------------------------------------------------ Jef's keys

  keys(x: number, z: number): { options?: Array<[number, Action]> } {
    const options: Array<[number, Action]> = [];
    for (const ev of this.events.list) {
      if (ev.status !== "running") continue;
      const act = ev.acts?.[ev.stage] ?? null;
      if (ev.fire && act === "fire_chain") {
        if (this.inChain?.ev === ev.id) {
          options.push([0.5, { key: "KeyE", text: "step out of the bucket chain", run: () => this.leaveChain(), self: true }]);
          continue;
        }
        let best = -1;
        let bd = CHAIN_REACH;
        ev.fire.chain.forEach(([cx, cz], k) => {
          const d = dist(cx, cz, x, z);
          if (d < bd) {
            bd = d;
            best = k;
          }
        });
        if (best >= 0) {
          const [cx, cz] = ev.fire.chain[best];
          options.push([bd, { key: "KeyE", text: "take a place in the bucket chain", run: () => this.joinChain(ev.id, x, z), at: { x: cx, z: cz } }]);
        }
      }
      if (ev.hiring && act === "hire_gather" && !ev.hiring.spots.some((s) => s.jef)) {
        const sp = ev.hiring.spots.find((s) => dist(s.x, s.z, x, z) < HIRE_REACH);
        if (sp) options.push([dist(sp.x, sp.z, x, z), { key: "KeyE", text: "stand with the men to be hired", run: () => this.stand(x, z), self: true }]);
      }
    }
    return options.length ? { options } : {};
  }

  private async post(f: () => Promise<JobsPayload & { result: { ok: boolean; text?: string; why?: string } }>): Promise<{ ok: boolean; text?: string; why?: string } | null> {
    if (this.busy) return null;
    this.busy = true;
    try {
      const r = await f();
      this.refresh(r);
      return r.result;
    } catch (e) {
      this.say(`${(e as Error).message}.`);
      return null;
    } finally {
      this.busy = false;
    }
  }

  private async joinChain(ev: number, x: number, z: number): Promise<void> {
    const r = await this.post(() => api.fireJoin(x, z));
    if (!r) return;
    if (r.ok) {
      this.inChain = { ev, slot: (r as { slot?: number }).slot ?? 0, x, z };
      this.inChainOrWas = true;
      this.say(r.text ?? "You take a bucket.");
    } else this.say(r.why ?? "No.");
  }

  private async leaveChain(): Promise<void> {
    this.inChain = null;
    const r = await this.post(() => api.fireLeave());
    if (r?.ok) this.say(r.text ?? "You step out of the chain.");
  }

  private async stand(x: number, z: number): Promise<void> {
    const r = await this.post(() => api.hiringStand(x, z));
    if (!r) return;
    this.say(r.ok ? (r.text ?? "") : (r.why ?? ""));
  }

  /** The path check (CLAUDE.md): where each lamplighter stands at each lamp of his round. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out: Array<{ label: string; x: number; z: number; reach: number }> = [];
    for (const r of this.data?.rounds ?? []) for (const l of r.lamps) out.push({ label: `lamplighter's stand at lamp ${l.id}`, x: l.sx, z: l.sz, reach: 1.6 });
    return out;
  }

  /** Dev: what burns and who is hired. */
  info() {
    return {
      lamps: this.world.gasLamps.info(),
      lamplighters: this.lamplighters.info(),
      fires: [...this.fires.values()].map((f) => ({ id: f.id, level: +f.level.toFixed(2), flames: !!f.fx, pump: !!f.pump, soot: !!f.soot, chain: f.view.chain.length, full: f.view.full, owner: f.view.owner_name })),
      buckets: this.buckets.count,
      chainHands: this.chainHands,
      inChain: this.inChain,
      oldSoot: this.oldSoot.size,
    };
  }
}

/** The point this far along a polyline. */
function along(path: Array<[number, number]>, d: number): [number, number] {
  let left = d;
  for (let i = 1; i < path.length; i++) {
    const L = dist(path[i][0], path[i][1], path[i - 1][0], path[i - 1][1]);
    if (left <= L) {
      const k = L > 0 ? left / L : 0;
      return [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
    }
    left -= L;
  }
  return path[path.length - 1] ?? [0, 0];
}
