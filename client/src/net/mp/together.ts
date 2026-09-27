// M8a multiplayer: "two in the fog" on this side (docs/multiplayer-plan.md, phase M8a; docs/milestones/M8a.md).
// Hung into main.ts by a few lines. It:
// - sends this player's own state 20 times a second (session.ts); his walking, jumping, swimming and looking
//   stay entirely his own PC's: nothing received ever moves him or his camera;
// - draws the others (remotes.ts: a jitter buffer, drawn about 100 ms in the past; figures.ts: their bodies
//   and names), on an omnibus in its frame on this PC's own copy of it;
// - played together, no pause: the menu opens over a running town and the player shows "away"; only the
//   host's "Pause all" stops everyone ("Paused by the host");
// - the Together panel in the menu: for the host the switches (together, open to the house), the address and
//   the join code, who is in, remove, admin, Pause all; for a guest his look and what he may do;
// - a small note in the corner of the host's screen while the house may join.

import * as THREE from "three";
import { BASE, baseId, baseIndex, baseKind, FLAG, MODES, type MpMode, type MpState, type MpText, type RosterEntry } from "../../../../shared/mpProtocol";
import type { FirstPerson } from "../../player/firstPerson";
import type { Surface } from "../../world/rijnkaai";
import { pause, real } from "../../game/pause";
import { identity, isGuest } from "./identity";
import { RemoteTrack, type Pose } from "./remotes";
import { figureKit, RemoteFigure } from "./figures";
import { Session } from "./session";
import { Street } from "./street";
import { WorldNet, type NetMover } from "./world";
import type { Town } from "../../game/town";
import type { Crowd } from "../../game/crowd";

interface BusLike {
  index: number;
  pose(): { x: number; y: number; z: number; yaw: number };
}

export interface TogetherDeps {
  scene: THREE.Scene;
  camera: THREE.Camera;
  player: FirstPerson;
  groundAt(x: number, z: number, r: number, feet: number): number;
  isFree(x: number, z: number, r: number, feet?: number): boolean;
  surfaceAt(x: number, z: number): Surface;
  /** The omnibuses of this PC (world.omnibus()?.buses). */
  buses(): BusLike[];
  /** The omnibus the player rides now (game/ride.ts), or null. */
  riding(): BusLike | null;
  /** The menu is up or the window lost the mouse. */
  away(): boolean;
  /** The game has been entered (the first screen is not "in the game"). */
  entered(): boolean;
  say(t: string): void;
  sound(): { footstep(s: Surface, hurry: boolean, puddle?: number, level?: number): void } | null;
  /** The menu's paper (the Together button goes on it) and the city's readiness. */
  paper: HTMLElement | null;
  cityReady: Promise<unknown>;
  /** M8b: the town and its crowd (the townspeople walked by one PC for all: street.ts). */
  town?: Town;
  crowd?: Crowd;
  /**
   * M8b: what this player rows, rides or pushes now (GEAR kind, `sub`: which boat of shared/smallBoats.ts
   * SMALL_KINDS; `heading`: where it points), or null.
   */
  gear?(): { kind: number; sub: number; heading: number } | null;
  /** M8b: a model of another player's gear (a boat of that kind, a velocipede, a handcart), and where to put it away. */
  gearModel?(kind: number, sub: number): Promise<GearModel | null>;
  /** M8b: the moving world's parts by key (net/mp/world.ts); null for one not loaded yet. */
  movers?(): Record<string, NetMover | null>;
  /** M8b: the movers as points for the host's town map (net/mp/world.ts WorldNetDeps.mapPoints). */
  mapPoints?(): Record<string, unknown[]>;
}

/** M8b: another player's boat, velocipede or handcart, drawn with him (figures.ts). */
export interface GearModel {
  /** Put it where he is: (x, y, z) his place, heading where it points, dt for the wheels. */
  place(x: number, y: number, z: number, heading: number, dt: number, shown: boolean): void;
  dispose(): void;
}

const RADIUS = 0.32;
const PUSH_M = 0.55;

export class Together {
  session: Session | null = null;
  /** M8b: the townspeople, one PC walking each for all (null alone). */
  street: Street | null = null;
  /** M8b: who runs the moving world now (0: nobody yet). */
  worldPc = 0;
  /** M8b: the moving world, run by one PC for all (null alone). */
  world: WorldNet | null = null;
  private readonly tracks = new Map<number, RemoteTrack>();
  private readonly figs = new Map<number, RemoteFigure>();
  private roster: RosterEntry[] = [];
  private kit: Awaited<ReturnType<typeof figureKit>> = null;
  private v = new THREE.Vector3();
  /** Own pose as of the last frame (server time) and the one before (for the velocity). */
  private now = { t: 0, x: 0, y: 0, z: 0 };
  private prev = { t: 0, x: 0, y: 0, z: 0 };
  private wasGrounded = true;
  private jumpedSince = false;
  private landedSince = false;
  private snapNext = false;
  private stepSince = false;
  private placedGuest = false;
  private card: HTMLDivElement | null = null;
  private corner: HTMLDivElement | null = null;
  private panel: HTMLDivElement | null = null;
  /** The harness's numbers: own camera jumps (must stay 0), remote position jumps between frames. */
  readonly meter = { frames: 0, camSnaps: 0, maxCamStep: 0, remote: new Map<number, { frames: number; maxStep: number; steps: number[]; lastX: number; lastZ: number }>() };
  private lastCam = new THREE.Vector3(NaN, 0, 0);

  constructor(private readonly d: TogetherDeps) {}

  /** Played together (the server's setting at the page's start, or since). */
  get on(): boolean {
    return identity.together;
  }

  start(): void {
    pause.setTogether(identity.together);
    this.mountButton();
    void figureKit().then((k) => {
      this.kit = k;
      this.dressAll();
    });
    if (!identity.together) return;
    this.session = new Session({
      sample: (t) => this.sample(t),
      onBatch: (list, _sn, recv) => {
        for (const e of list) {
          let tr = this.tracks.get(e.id);
          if (!tr) this.tracks.set(e.id, (tr = new RemoteTrack()));
          tr.push(e.s, recv);
        }
        this.placeGuest(list);
      },
      onRoster: (r) => {
        this.roster = r;
        this.dressAll();
        this.drawPanel();
        this.drawCorner();
      },
      onPuppets: (v, recv) => this.street?.onBatch(v, recv),
      onWelcome: (w) => {
        this.street?.reset();
        if (w.pose && !this.placedGuest) {
          this.placedGuest = true;
          void this.d.cityReady.then(() => {
            this.d.player.place(w.pose!.x, w.pose!.z, w.pose!.yaw);
            this.snapNext = true;
          });
        }
      },
      onText: (m) => this.text(m),
    });
    const sess = this.session;
    if (this.d.town && this.d.crowd) {
      const town = this.d.town;
      this.street = new Street({
        town,
        crowd: this.d.crowd,
        me: () => sess.id,
        host: () => !isGuest(),
        serverNow: () => sess.serverNow(),
        player: () => this.d.player,
        sendText: (m) => sess.sendText(m),
        sendBinary: (b) => sess.sendBinary(b),
      });
      town.net = this.street;
    }
    if (this.d.movers) {
      const movers = this.d.movers;
      this.world = new WorldNet({ me: () => sess.id, serverNow: () => sess.serverNow(), sendText: (m) => sess.sendText(m), movers, mapPoints: this.d.mapPoints });
    }
    this.session.open();
    this.drawCorner();
  }

  /** M8b: before the world moves: its movers run here (the world PC) or shown from the world PC's state. */
  worldFrame(dt: number): void {
    this.world?.frame(dt);
  }

  /** M8b: before the crowd moves and draws: the townspeople other PCs walk, where they had them. */
  streetApply(dt: number): void {
    this.street?.apply(dt);
  }

  /** M8b: after the town moved its people: send the ones this PC walks. */
  streetSend(dt: number): void {
    this.street?.send(dt);
  }

  /** A guest with no place of his own starts beside the host (once, when the host is first heard of). */
  private placeGuest(list: Array<{ id: number; s: MpState }>): void {
    if (this.placedGuest || !isGuest()) return;
    const host = list.find((e) => e.id === 1);
    if (!host) return;
    this.placedGuest = true;
    void this.d.cityReady.then(() => {
      const h = host.s;
      for (const [ox, oz] of [
        [1.6, 0],
        [-1.6, 0],
        [0, 1.6],
        [0, -1.6],
        [2.4, 2.4],
      ]) {
        const x = h.x + ox * Math.cos(h.yaw) + oz * Math.sin(h.yaw);
        const z = h.z - ox * Math.sin(h.yaw) + oz * Math.cos(h.yaw);
        if (this.d.isFree(x, z, RADIUS, h.y)) {
          this.d.player.place(x, z, h.yaw);
          this.snapNext = true;
          this.d.say("You come into the town next to the host.");
          return;
        }
      }
    });
  }

  private text(m: MpText): void {
    if (m.type === "owners") this.street?.onOwners(m);
    else if (m.type === "world") this.world?.onWorld(m, this.session?.serverNow() ?? 0);
    else if (m.type === "worldpc") {
      this.worldPc = m.id;
      this.world?.setPc(m.id);
    } else if (m.type === "went") {
      this.drop(m.id);
      this.d.say(`${m.name} went home.`);
    } else if (m.type === "pause_all") this.pauseAll(m.on);
    else if (m.type === "version") this.d.say(`A new version of the game is ready (${m.files} files). Reload the page (F5) at a quiet moment: only what changed is downloaded.`);
    else if (m.type === "old") {
      this.d.say("The host has a new version of the game. The page reloads to fetch it.");
      real.setTimeout(() => location.reload(), 3000);
    } else if (m.type === "kicked") this.d.say("The host took you out of the game.");
    else if (m.type === "refused") this.d.say(m.why);
  }

  private drop(id: number): void {
    this.dropGear(id);
    this.shown.delete(id);
    this.figs.get(id)?.dispose();
    this.figs.delete(id);
    this.tracks.delete(id);
  }

  private dressAll(): void {
    if (!this.kit) return;
    const online = new Set<number>();
    for (const r of this.roster) {
      if (r.id === this.session?.id || !r.online) continue;
      online.add(r.id);
      let f = this.figs.get(r.id);
      if (!f) this.figs.set(r.id, (f = new RemoteFigure(r.id, { scene: this.d.scene, groundAt: this.d.groundAt })));
      f.dress(this.kit, r);
    }
    for (const id of [...this.figs.keys()]) if (!online.has(id)) this.drop(id);
  }

  // ------------------------------------------------------------------ own state

  private mode(): MpMode {
    const p = this.d.player;
    if (p.fly) return "fly";
    if (p.rowing) return "row";
    if (p.bikeRiding) return "bike";
    if (p.riding) return p.rideSeat ? "sit" : "ride";
    if (p.climbLadder) return "ladder";
    if (p.climbing) return "climb";
    if (p.swimming) return "swim";
    if (p.crouching) return "crouch";
    return "walk";
  }

  /** After the player's update, each frame: his pose and its time. */
  /**
   * The time of each own frame on the server's clock, run on by the frames' own dt (the time the walk code moved
   * him by), and kept to the server's clock gently (a jump only if it drifted a quarter second): so the times and
   * the places sent always agree, even when frames come unevenly (a hitch, a burst of catch-up steps).
   */
  private gameT = 0;
  private anchor = NaN;
  private frameTime(dt: number): number {
    const now = this.session ? this.session.serverNow() : real.now();
    this.gameT += dt * 1000;
    const err = now - (this.anchor + this.gameT);
    if (Number.isNaN(this.anchor) || Math.abs(err) > 250) this.anchor = now - this.gameT;
    else this.anchor += Math.max(-dt * 50, Math.min(dt * 50, err));
    return this.anchor + this.gameT;
  }

  private ownFrame(dt: number): void {
    const p = this.d.player;
    const t = this.frameTime(dt);
    this.prev = this.now;
    this.now = { t, x: p.x, y: p.y, z: p.z };
    const grounded = (p as unknown as { grounded: boolean }).grounded;
    if (this.wasGrounded && !grounded && !p.swimming) this.jumpedSince = true;
    if (!this.wasGrounded && grounded) this.landedSince = true;
    this.wasGrounded = grounded;
    // a jump of place (a load, a ladder's top, the dev's jump): no in-between for the others
    const span = (this.now.t - this.prev.t) / 1000;
    if (this.prev.t && Math.hypot(this.now.x - this.prev.x, this.now.z - this.prev.z) > 1 + 8 * Math.max(0, span)) this.snapNext = true;
  }

  private sample(serverNow: number): Omit<MpState, "seq"> | null {
    if (!this.d.entered()) return null;
    const p = this.d.player;
    const mode = this.mode();
    // the pose's own time; a tab that draws no frames (hidden) says where it stands now
    const fresh = this.now.t > 0 && serverNow - this.now.t < 120;
    const t = fresh ? this.now.t : serverNow;
    if (!fresh) this.now = { t, x: p.x, y: p.y, z: p.z };
    const dt = Math.max(1e-3, (this.now.t - this.prev.t) / 1000);
    const grounded = (p as unknown as { grounded: boolean }).grounded;
    const vyPhys = (p as unknown as { vy: number }).vy;
    const moving = fresh && this.prev.t > 0 && !this.snapNext;
    let vx = moving ? (this.now.x - this.prev.x) / dt : 0;
    let vz = moving ? (this.now.z - this.prev.z) / dt : 0;
    const cap = 9;
    const h = Math.hypot(vx, vz);
    if (h > cap) (vx *= cap / h), (vz *= cap / h);
    const vy = !moving ? 0 : !grounded && !p.swimming ? vyPhys : Math.max(-8, Math.min(8, (this.now.y - this.prev.y) / dt));
    let flags = 0;
    if (grounded || p.swimming) flags |= FLAG.grounded;
    if (p.pressing("ShiftLeft") || p.pressing("ShiftRight")) flags |= FLAG.hurry;
    if (this.d.away()) flags |= FLAG.away;
    if (this.snapNext) flags |= FLAG.snap;
    if (this.jumpedSince) flags |= FLAG.jumped;
    if (this.landedSince) flags |= FLAG.landed;
    if (this.stepSince) flags |= FLAG.step;
    this.snapNext = this.jumpedSince = this.landedSince = this.stepSince = false;
    const s: Omit<MpState, "seq"> = { t, x: this.now.x, y: this.now.y, z: this.now.z, vx, vy, vz, yaw: p.yaw, pitch: p.pitch, mode: MODES.indexOf(mode), flags, base: 0, lx: 0, ly: 0, lz: 0, lyaw: 0 };
    // on an omnibus: also in its own frame (the others put him on their copy of it)
    const bus = mode === "ride" || mode === "sit" ? this.d.riding() : null;
    if (bus) {
      const a = bus.pose();
      const co = Math.cos(a.yaw);
      const si = Math.sin(a.yaw);
      const dx = s.x - a.x;
      const dz = s.z - a.z;
      s.base = baseId(BASE.omnibus, bus.index);
      s.lx = dx * co - dz * si;
      s.lz = dx * si + dz * co;
      s.ly = s.y - a.y;
      s.lyaw = s.yaw - a.yaw;
    }
    // M8b: what he rows, rides or pushes: the others draw it with him; its heading goes in lyaw (no platform then)
    const g = bus ? null : (this.d.gear?.() ?? null);
    if (g) {
      s.gear = (g.kind & 3) | ((g.sub & 63) << 2);
      s.lyaw = g.heading;
    }
    return s;
  }

  // ------------------------------------------------------------------ each frame

  /** Main calls this after the player's update. */
  frame(dt: number): void {
    this.ownFrame(dt);
    this.meterCamera();
    if (!this.session) {
      this.soloMap(dt);
      return;
    }
    // the others are drawn on the same frame clock (frame by frame as the frames' dt says: no bunching)
    const sn = this.now.t;
    const p = this.d.player;
    const snd = this.d.sound();
    for (const [id, tr] of this.tracks) {
      const f = this.figs.get(id);
      tr.adapt(dt * 1000);
      const pose = tr.sample(sn);
      if (!f || !pose) {
        f?.hide();
        this.gears.get(id)?.model?.place(0, 0, 0, 0, dt, false);
        continue;
      }
      this.onPlatform(pose);
      this.hideCorrection(id, pose, dt);
      f.place(pose, dt);
      this.placeGear(id, pose, dt, f.shown);
      this.meterRemote(id, f, dt);
      if (f.stepped && snd) {
        const d = Math.hypot(f.at.x - p.x, f.at.z - p.z);
        if (d < 14) snd.footstep(this.d.surfaceAt(f.at.x, f.at.z), f.hurry, 0, Math.pow(1 - d / 14, 2) * 0.8);
      }
      // a soft push: a late figure can never block a door; two men do not stand in each other
      if (!p.riding && !p.rowing && !p.climbing && !p.climbLadder && f.shown) {
        let dx = p.x - f.at.x;
        let dz = p.z - f.at.z;
        let dd = Math.hypot(dx, dz);
        if (dd < 1e-3) {
          // right on top of each other (both put on the same spot): the one with the higher id steps aside
          dx = (this.session.id > id ? 1 : -1) * Math.cos(p.yaw);
          dz = (this.session.id > id ? -1 : 1) * Math.sin(p.yaw);
          dd = 1e-3;
          dx *= dd;
          dz *= dd;
        }
        if (dd < PUSH_M && Math.abs(p.y - f.at.y) < 1.2) {
          const k = (PUSH_M - dd) * Math.min(1, dt * 6);
          const nx = p.x + (dx / dd) * k;
          const nz = p.z + (dz / dd) * k;
          if (this.d.isFree(nx, nz, RADIUS, p.y)) {
            p.x = nx;
            p.z = nz;
            this.now.x = nx;
            this.now.z = nz;
          }
        }
      }
    }
    if (this.figs.size) {
      this.d.camera.updateMatrixWorld(); // (the picture of this frame is drawn after: the tags go with it)
      for (const f of this.figs.values()) f.drawTag(this.d.camera, this.v);
    }
  }

  /**
   * A late state after a stall puts him somewhere other than where he was drawn going on (the guess ran out, or
   * guessed wrong). Never a snap: the difference is kept as an offset that fades in about a tenth of a second
   * (plan 4.1, "hiding corrections"). Not for a snap of his (a ladder, a seat): he is simply there.
   */
  private shown = new Map<number, { x: number; y: number; z: number; vx: number; vz: number; ex: number; ey: number; ez: number }>();
  private hideCorrection(id: number, p: Pose, dt: number): void {
    const last = this.shown.get(id);
    if (last && !(p.flags & FLAG.snap)) {
      // where he would be now had he gone on as drawn
      const gx = last.x - last.ex + last.vx * dt;
      const gz = last.z - last.ez + last.vz * dt;
      const jump = Math.hypot(p.x - gx, p.z - gz);
      if (jump > 0.04 && jump < 3) {
        last.ex += gx - p.x;
        last.ez += gz - p.z;
      }
      if (Math.abs(p.y - (last.y - last.ey)) > 0.25 && Math.abs(p.y - (last.y - last.ey)) < 2) last.ey += last.y - last.ey - p.y;
      const k = Math.exp(-dt / 0.1);
      last.ex *= k;
      last.ey *= k;
      last.ez *= k;
    }
    const e = last && !(p.flags & FLAG.snap) ? last : { ex: 0, ey: 0, ez: 0 };
    const out = { x: p.x + e.ex, y: p.y + e.ey, z: p.z + e.ez, vx: p.vx, vz: p.vz, ex: e.ex, ey: e.ey, ez: e.ez };
    this.shown.set(id, out);
    p.x = out.x;
    p.y = out.y;
    p.z = out.z;
  }

  /** M8b: each other player's boat, velocipede or handcart (made when he takes it, gone when he lets go). */
  private readonly gears = new Map<number, { code: number; model: GearModel | null; asking: boolean }>();

  private placeGear(id: number, p: Pose, dt: number, shown: boolean): void {
    let g = this.gears.get(id);
    if (!g || g.code !== p.gear) {
      g?.model?.dispose();
      g = { code: p.gear, model: null, asking: false };
      this.gears.set(id, g);
      if (p.gear && this.d.gearModel) {
        const want = g;
        want.asking = true;
        void this.d.gearModel(p.gear & 3, p.gear >> 2).then((m) => {
          want.asking = false;
          if (this.gears.get(id) === want) want.model = m;
          else m?.dispose();
        });
      }
    }
    g.model?.place(p.x, p.y, p.z, p.lyaw, dt, shown);
  }

  private dropGear(id: number): void {
    this.gears.get(id)?.model?.dispose();
    this.gears.delete(id);
  }

  /** On a platform: put him on this PC's own copy of it. */
  private onPlatform(p: Pose): void {
    if (!p.base || baseKind(p.base) !== BASE.omnibus) return;
    const bus = this.d.buses().find((b) => b.index === baseIndex(p.base));
    if (!bus) return;
    const a = bus.pose();
    const co = Math.cos(a.yaw);
    const si = Math.sin(a.yaw);
    p.x = a.x + p.lx * co + p.lz * si;
    p.z = a.z - p.lx * si + p.lz * co;
    p.y = a.y + p.ly;
    p.yaw = a.yaw + p.lyaw;
  }

  /** The others where they stand (the bridges do not open under them; the carts wait for them). */
  /** M8b: where the host is drawn on a guest's screen ([] on the host's own, or when he is not in view). */
  hostAt(): Array<{ x: number; z: number }> {
    if (!isGuest()) return [];
    const f = this.figs.get(1);
    return f?.shown ? [{ x: f.at.x, z: f.at.z }] : [];
  }

  positions(): Array<{ x: number; z: number }> {
    const out: Array<{ x: number; z: number }> = [];
    for (const f of this.figs.values()) if (f.shown) out.push({ x: f.at.x, z: f.at.z });
    return out;
  }

  /** The crowd's list with the other players in it (the same list when there are none). */
  withPeople<T extends { x: number; z: number }>(list: T[]): Array<T | { x: number; z: number }> {
    if (!this.figs.size) return list;
    const extra = this.positions();
    return extra.length ? [...list, ...extra] : list;
  }

  // ------------------------------------------------------------------ the harness's numbers

  private meterCamera(): void {
    const c = (this.d.camera as THREE.PerspectiveCamera).position;
    if (!Number.isNaN(this.lastCam.x)) {
      const step = c.distanceTo(this.lastCam);
      this.meter.maxCamStep = Math.max(this.meter.maxCamStep, step);
      // faster than any walk, hurry or fall could take it in one frame: a snap (a place() of the kit's is one too)
      if (step > 0.6) this.meter.camSnaps++;
    }
    this.meter.frames++;
    this.lastCam.copy(c);
  }

  private meterRemote(id: number, f: RemoteFigure, dt: number): void {
    let m = this.meter.remote.get(id);
    if (!m) this.meter.remote.set(id, (m = { frames: 0, maxStep: 0, steps: [], lastX: NaN, lastZ: NaN }));
    if (!Number.isNaN(m.lastX) && dt > 1e-4) {
      const s = Math.hypot(f.at.x - m.lastX, f.at.z - m.lastZ);
      m.maxStep = Math.max(m.maxStep, s);
      m.steps.push(s / dt); // his speed as drawn this frame (m/s)
      if (m.steps.length > 3600) m.steps.shift();
    }
    m.frames++;
    m.lastX = f.at.x;
    m.lastZ = f.at.z;
  }

  /** For the harness: the numbers so far, and each remote's jitter buffer. */
  report() {
    const remotes = [...this.meter.remote.entries()].map(([id, m]) => {
      // jitter: how far his drawn speed from frame to frame wanders from his steady pace (the median), m/s;
      // times the frame (1/60 s) it is the wobble in metres
      const sorted = [...m.steps].sort((a, b) => a - b);
      const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
      const d = m.steps.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
      const tr = this.tracks.get(id);
      return { id, frames: m.frames, pace: +med.toFixed(3), maxStep: +m.maxStep.toFixed(3), speedDevP95: +(d[Math.floor(d.length * 0.95)] ?? 0).toFixed(3), speedDevMax: +(d[d.length - 1] ?? 0).toFixed(3), jitterP95m: +((d[Math.floor(d.length * 0.95)] ?? 0) / 60).toFixed(4), delay: tr ? Math.round(tr.delay) : null, buffer: tr?.stats ?? null };
    });
    return { frames: this.meter.frames, camSnaps: this.meter.camSnaps, maxCamStep: +this.meter.maxCamStep.toFixed(3), rtt: this.session?.rtt ?? null, offset: this.session ? Math.round(this.session.offset) : null, session: this.session?.stats ?? null, remotes, street: this.street?.report() ?? null, worldPc: this.worldPc, world: this.world?.report() ?? null };
  }

  resetMeter(): void {
    this.meter.frames = this.meter.camSnaps = 0;
    this.meter.maxCamStep = 0;
    this.meter.remote.clear();
    this.lastCam.set(NaN, 0, 0);
    for (const tr of this.tracks.values()) tr.stats = { states: 0, dropped: 0, starved: 0, extrapolated: 0 };
  }

  // ------------------------------------------------------------------ pause all

  private pauseAll(on: boolean): void {
    if (!this.card) {
      const c = document.createElement("div");
      c.className = "pause-card pause-ui";
      c.innerHTML = `<div class="paper"><h1>Paused</h1><p class="sub">Paused by the host. The town waits for everyone.</p><p class="keys"></p></div>`;
      document.body.appendChild(c);
      this.card = c;
    }
    const keys = this.card.querySelector(".keys") as HTMLElement;
    keys.innerHTML = isGuest() ? "Esc: the menu" : `<button class="btn">Go on for everyone</button> &middot; Esc: the menu`;
    keys.querySelector("button")?.addEventListener("click", () => void this.setPauseAll(false));
    this.card.style.display = on ? "flex" : "none";
    pause.set("host", on);
  }

  async setPauseAll(on: boolean): Promise<void> {
    await real.fetch("/api/mp/pause-all", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ on }) }).catch(() => {});
  }

  // ------------------------------------------------------------------ the menu: Together

  private mountButton(): void {
    const paper = this.d.paper;
    if (!paper) return;
    const btn = document.createElement("button");
    btn.className = "settings-btn";
    btn.textContent = "Together";
    paper.appendChild(btn);
    const panel = document.createElement("div");
    panel.className = "settings paper mp-panel";
    panel.style.display = "none";
    document.body.appendChild(panel);
    this.panel = panel;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      panel.style.display = "block";
      void this.drawPanel(true);
    });
    panel.addEventListener("click", (e) => {
      e.stopPropagation();
      void this.panelClick(e.target as HTMLElement);
    });
    panel.addEventListener("mousedown", (e) => e.stopPropagation());
    this.mountMapButton(paper);
  }

  /**
   * The town map (docs/mapview.md): a button on the host's own PC (the page came from localhost) that opens the
   * map in a new tab. The map listens on this PC only, so a guest never gets the button.
   */
  /** The town map is on (its button shown): played alone, Jef's place goes to it once a second. */
  private mapOn = false;
  private mapAcc = 0;
  private soloMap(dt: number): void {
    if (!this.mapOn || !this.d.entered()) return;
    this.mapAcc += dt;
    if (this.mapAcc < 1) return;
    this.mapAcc = 0;
    const p = this.d.player;
    void real
      .fetch("/api/map/me", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, mode: this.mode(), away: this.d.away() }) })
      .catch(() => {});
  }

  private mountMapButton(paper: HTMLElement): void {
    if (!identity.local || isGuest()) return;
    void real
      .fetch("/api/map")
      .then(async (r) => {
        if (!r.ok) return;
        const { url } = (await r.json()) as { url?: string };
        if (!url || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\/?$/.test(url)) return;
        this.mapOn = true;
        const btn = document.createElement("button");
        btn.className = "settings-btn";
        btn.textContent = "Town map";
        btn.title = "The whole town from above, live, in a new tab";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          window.open(url, "scheldemist-map", "noopener");
        });
        paper.appendChild(btn);
      })
      .catch(() => {});
  }

  private hostView: { multiplayer: boolean; lan: boolean; open: string[]; code: string; urls: string[]; players: RosterEntry[]; pausedAll: boolean } | null = null;

  private async drawPanel(fetchNow = false): Promise<void> {
    const panel = this.panel;
    if (!panel || panel.style.display === "none") return;
    const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    if (isGuest()) {
      const host = this.roster.find((r) => r.host);
      panel.innerHTML = `<h2>Together</h2>
        <p>You are a guest in ${esc(host?.name ?? "the host")}'s town.</p>
        <p class="note-small">For now guests walk, jump, swim and look. Work, talk and buying come in a later version. Only the host changes the town's settings.</p>
        <p class="row"><b>Here now</b> ${this.roster.filter((r) => r.online).map((r) => esc(r.name) + (r.away ? " (away)" : "")).join(", ") || "only you"}</p>
        <p class="row"><button data-mp="look">Your look</button></p>
        <button name="back">Back</button>`;
      return;
    }
    if (fetchNow || !this.hostView) {
      try {
        this.hostView = (await (await real.fetch("/api/mp/host")).json()) as NonNullable<typeof this.hostView>;
      } catch {
        this.hostView = null;
      }
    }
    const h = this.hostView;
    if (!h) {
      panel.innerHTML = `<h2>Together</h2><p>The server does not answer.</p><button name="back">Back</button>`;
      return;
    }
    const players = (this.roster.length ? this.roster : h.players).filter((r) => !r.host);
    panel.innerHTML = `<h2>Together</h2>
      <p class="row"><b>Play together</b> <button data-mp="together">${h.multiplayer ? "On" : "Off"}</button>
        <span class="note-small">${h.multiplayer ? "No pause: the menu opens over a running town." : "Alone: pause and sleep as always."}</span></p>
      <p class="row"><b>Open to the house</b> <button data-mp="lan">${h.lan ? "On" : "Off"}</button>
        <span class="note-small">${h.lan ? (h.open.length ? "Others in the house can join." : "Could not listen on the home network (see docs/milestones/M8a.md).") : "Off: only this PC."}</span></p>
      ${h.lan ? `<p class="row"><b>Address</b> ${h.urls.map((u) => `<code>${esc(u)}</code>`).join(" or ")}</p>` : ""}
      ${h.multiplayer ? `<p class="row"><b>Join code</b> <code style="font-size:1.4em;letter-spacing:0.1em">${esc(h.code)}</code> <button data-mp="code">New code</button></p>` : ""}
      ${
        players.length
          ? `<p class="row"><b>Players</b></p><ul class="mp-players">${players
              .map(
                (r) =>
                  `<li>${esc(r.name)} <span class="note-small">${r.online ? (r.away ? "away" : "in the town") : "not here"}${r.admin ? ", may change settings" : ""}</span>
                   <button data-mp="admin" data-id="${r.id}" data-on="${r.admin ? 0 : 1}">${r.admin ? "No settings" : "May change settings"}</button>
                   <button data-mp="kick" data-id="${r.id}">Remove</button></li>`,
              )
              .join("")}</ul>`
          : h.multiplayer
            ? `<p class="note-small">Nobody has joined yet.</p>`
            : ""
      }
      ${h.multiplayer ? `<p class="row"><b>Pause all</b> <button data-mp="pauseall">${h.pausedAll ? "Go on for everyone" : "Pause the town for everyone"}</button></p>` : ""}
      <p class="note-small">Changing "Play together" reloads the page.</p>
      <button name="back">Back</button>`;
  }

  private async panelClick(el: HTMLElement): Promise<void> {
    const b = el.closest("button") as HTMLButtonElement | null;
    if (!b || !this.panel) return;
    if (b.name === "back") {
      this.panel.style.display = "none";
      return;
    }
    const post = (url: string, body: unknown) => real.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);
    const act = b.dataset.mp;
    const h = this.hostView;
    if (act === "look") {
      const { openCharacterCreator } = await import("../../menu/character");
      openCharacterCreator(() => this.d.say("Your new look is on its way to the others."));
      return;
    }
    if (!h) return;
    if (act === "together") {
      await post("/api/mp/config", { multiplayer: !h.multiplayer, lan: h.multiplayer ? false : h.lan });
      location.reload();
      return;
    }
    if (act === "lan") {
      const was = h.multiplayer;
      await post("/api/mp/config", { lan: !h.lan });
      if (!was) {
        location.reload();
        return;
      }
    } else if (act === "code") await post("/api/mp/code", {});
    else if (act === "kick") await post("/api/mp/kick", { id: Number(b.dataset.id) });
    else if (act === "admin") await post("/api/mp/admin", { id: Number(b.dataset.id), on: b.dataset.on === "1" });
    else if (act === "pauseall") await this.setPauseAll(!h.pausedAll);
    await this.drawPanel(true);
    this.drawCorner();
  }

  /** The host's corner note while the house may join: the address and the code. */
  private drawCorner(): void {
    if (isGuest() || !identity.together) {
      this.corner?.remove();
      this.corner = null;
      return;
    }
    void real
      .fetch("/api/mp/host")
      .then((r) => r.json())
      .then((h: { lan: boolean; urls: string[]; code: string; multiplayer: boolean }) => {
        if (!h.multiplayer) return;
        if (!this.corner) {
          const c = document.createElement("div");
          c.className = "mp-corner";
          c.style.cssText = "position:fixed;right:10px;top:8px;z-index:30;pointer-events:none;font:12px var(--f-print,Georgia,serif);color:#221b15;background:rgba(233,225,203,0.8);padding:2px 8px;border:1px solid rgba(34,27,21,0.35)";
          document.body.appendChild(c);
          this.corner = c;
        }
        const n = this.roster.filter((r) => r.online && !r.host).length;
        this.corner.textContent = `${h.lan ? `Open to the house: ${h.urls[0] ?? ""}` : "Together (this PC only)"} · code ${h.code}${n ? ` · ${n} guest${n > 1 ? "s" : ""}` : ""}`;
      })
      .catch(() => {});
  }
}
