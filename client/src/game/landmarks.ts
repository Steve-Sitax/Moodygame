import * as THREE from "three";
import "./landmarks.css";
import type { FirstPerson } from "../player/firstPerson";
import type { JobsPayload, Pt } from "../net/api";
import { landmarksApi, type DoorNow, type InPerson, type LandmarkNow } from "../net/landmarksApi";
import { CANDLE_C, CLOSED_TEXT, LANDMARK_LABEL, type LandmarkId } from "../../../shared/landmarks";
import { buildCathedral, type LandmarkRoom, type Mark } from "../world/landmarkRooms";
import { buildOostershuis, buildSteen, buildTownhall, buildVleeshuis } from "../world/landmarkHalls";
import { Builder, type Seat } from "../world/rooms";
import { isHumanKind, makeHuman, type Human, type HumanKind, type Motion } from "./humans";
import type { Interiors } from "./interiors";
import type { Jobs } from "./jobs";
import type { Action, Sfx } from "./runs";

// Inside the landmarks (M6 landmark interiors): E at the cathedral's west door, the town hall's
// door, the Vleeshuis's two doors, the museum door in the Steen's courtyard or the Oostershuis's
// gate takes Jef into its hall (world/landmarkRooms.ts, landmarkHalls.ts), by the interiors' own
// way in (game/interiors.ts enterOwn): the fade, room-frame walking, the street muffled through
// the walls and the hall's own echo.
//
// Who is inside is the server's word (server/src/landmarks/life.ts), asked every few seconds:
// the curate, the organist, the beadle and the chair woman, the pious at mass or at prayer, the
// couple and the guests of a wedding; the clerks, callers and a civil wedding in the town hall;
// the cellarmen, the painter and the theatre society in the Vleeshuis; the attendant and the
// visitors in the Steen; the storekeeper and the natie men in the Oostershuis. Each has a role;
// the client gives each role a place and a small routine (a walk round, a seat, a stand) and
// walks them there from the door. Talk as usual (E). The confessional has its own panel: Jef's
// words go to the server and are kept nowhere.

type P2 = [number, number];

interface RoleSpec {
  /** A named place (room.marks), a list to pick from (room.sets), or a round to walk (room.sets). */
  at?: string;
  set?: string;
  /** Pick the set from its end (the front rows of chairs first). */
  front?: boolean;
  loop?: string;
  /** Seconds at each stop of a round; walking pace (m/s). */
  pause?: number;
  speed?: number;
  /** At rest: how they stand, and the seat height if they sit (the women stand). */
  motion: Motion;
  sit?: number;
  /** Appear at the place (the clergy from the sacristy, the organist in his loft) instead of walking in. */
  appear?: boolean;
  /** Women stand this far behind a chair. */
  standBack?: number;
  /** Carrying a load as they walk the round (the natie men's sacks). */
  laden?: boolean;
  /** Not to be talked to from the floor (the organist up in the loft). */
  noTalk?: boolean;
}

const ROLES: Record<LandmarkId, Record<string, RoleSpec>> = {
  cathedral: {
    celebrant: { at: "altar", motion: "idle", appear: true },
    wedding_priest: { at: "choirFront", motion: "talk", appear: true },
    sexton: { at: "server", motion: "fold", appear: true },
    beadle_mass: { at: "beadleMass", motion: "behind" },
    beadle: { loop: "beadleRound", pause: 7, speed: 0.75, motion: "behind" },
    chairs: { at: "chairsPost", motion: "fold" },
    chairs_collect: { loop: "chairsWalk", pause: 1.5, speed: 0.45, motion: "fold" },
    organist: { at: "organist", motion: "sit", sit: 0.5, appear: true, noTalk: true },
    confessor: { at: "confessor", motion: "sit", sit: 0.45, appear: true, noTalk: true },
    sacristy: { loop: "curateWalk", pause: 6, speed: 0.6, motion: "fold", appear: true },
    worshipper: { set: "chairs", front: true, motion: "sit", sit: 0.46, standBack: 0.62 },
    prayer: { set: "chairs", motion: "sit", sit: 0.46, standBack: 0.62 },
    candle: { set: "standAt", motion: "fold" },
    chapel: { set: "chapels", motion: "fold" },
    groom: { at: "railS", motion: "fold" },
    bride: { at: "railN", motion: "fold" },
    guest: { set: "chairs", front: true, motion: "sit", sit: 0.46, standBack: 0.62 },
  },
  townhall: {
    concierge: { at: "lodge", motion: "sit", sit: 0.48 },
    clerk: { set: "desks", motion: "sit", sit: 0.5 },
    registrar: { at: "registrar", motion: "write" },
    alderman: { at: "alderman", motion: "sit", sit: 0.5 },
    caller: { at: "counter", motion: "talk" },
    waiting: { set: "bench", motion: "sit", sit: 0.45 },
    alderman_wed: { at: "weddingTable", motion: "talk" },
    registrar_wed: { at: "weddingClerk", motion: "write" },
    c_groom: { at: "cGroom", motion: "fold" },
    c_bride: { at: "cBride", motion: "fold" },
    witness: { set: "witnesses", motion: "fold" },
    c_guest: { set: "weddingChairs", motion: "sit", sit: 0.46, standBack: 0.55 },
  },
  vleeshuis: {
    cellarmaster: { at: "cellarDesk", motion: "write" },
    cellarman: { loop: "barrelRun", pause: 3, speed: 0.8, motion: "idle" },
    painter: { at: "easel", motion: "talk" },
    prompter: { at: "prompter", motion: "sit", sit: 0.48 },
    actor: { set: "stage", motion: "talk" },
    audience: { set: "theatreSeats", front: true, motion: "sit", sit: 0.46, standBack: 0.5 },
  },
  steen: {
    custodian: { loop: "custodianRound", pause: 9, speed: 0.55, motion: "behind" },
    visitor: { loop: "cases", pause: 7, speed: 0.45, motion: "behind" },
  },
  oostershuis: {
    storekeeper: { at: "storeDesk", motion: "write" },
    porter: { loop: "sackRun", pause: 2.5, speed: 0.9, motion: "idle", laden: true },
  },
};

interface Fig {
  p: InPerson;
  spec: RoleSpec;
  human: Human | null;
  kind: HumanKind;
  x: number;
  z: number;
  y: number;
  yaw: number;
  path: P2[];
  /** Where they rest (a mark), and how. */
  rest: Mark | null;
  seated: boolean;
  /** A round: its stops and where they are in it; the wait at a stop. */
  loop: Mark[] | null;
  li: number;
  wait: number;
  leaving: boolean;
  /** Which place of a set they hold. */
  holds: { set: string; i: number } | null;
  arrived: boolean;
  /** A cellarman's barrel, rolled along the floor ahead of him. */
  barrel: { outer: THREE.Group; inner: THREE.Group; roll: number } | null;
}

/** A barrel lying on its side, to roll (the Vleeshuis's cellarmen). */
function rollingBarrel(): { outer: THREE.Group; inner: THREE.Group; roll: number } {
  const outer = new THREE.Group();
  const inner = new THREE.Group();
  new Builder(inner).barrel(0, 0, 0, true, false);
  outer.add(inner);
  return { outer, inner, roll: 0 };
}

/** The theatre society at rehearsal (our own lines: a Flemish history drama of the kind they played). */
const REHEARSAL: Array<{ who: "prompter" | "actor"; text: string }> = [
  { who: "prompter", text: "From the top of the second act, please. And louder: the back row is deaf." },
  { who: "actor", text: "Father! The Spanish soldiers are at the city gate!" },
  { who: "actor", text: "Then bar the door, my daughter, and hide the silver in the well." },
  { who: "actor", text: "I would rather die than see Antwerp in chains!" },
  { who: "prompter", text: "In chains, not in trains. Again, with feeling." },
  { who: "actor", text: "Who knocks at this hour? Friend or Spaniard?" },
  { who: "actor", text: "A friend, and a Fleming, with news from Ghent!" },
  { who: "actor", text: "Then come in out of the fog, and speak low. The walls have ears." },
  { who: "prompter", text: "Stop. The walls have ears, not the audience. Face the hall when you say it." },
  { who: "actor", text: "Oh, my heart! He is alive, and the town is free!" },
  { who: "prompter", text: "Good. Nobody will weep, but it is good. Once more, from the knock." },
];

const WALK = 1.0;
const TALK_R = 1.7;
const REACH_DOOR = 2.0;

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const UNLOADED: Record<string, string> = { docker_sack: "docker_b", porter: "docker_c", carter: "docker_a", sentry: "soldier" };

export class Landmarks {
  private doors: DoorNow[] = [];
  private rooms = new Map<LandmarkId, LandmarkRoom>();
  private here: { id: LandmarkId; room: LandmarkRoom; door: DoorNow } | null = null;
  private now: LandmarkNow | null = null;
  private figs = new Map<string, Fig>();
  private taken = new Map<string, Set<number>>();
  private busy = false;
  private t = 0;
  private syncT = 0;
  private doorsT = 0;
  private serviceKey = "";
  private bellRung = "";
  private panel: ConfessionPanel;
  private sayT = 0;
  say: (t: string) => void = () => {};
  sfx: (name: Sfx) => void = () => {};
  /** The organ and the altar bell (the soundscape), set by main. */
  organ: (on: boolean) => void = () => {};
  altarBell: () => void = () => {};
  /** A voice in the hall (the murmur of speech, made in code by the soundscape), set by main. */
  speak: (at: { x: number; z: number }, voice: { sex: "m" | "f"; age: number }, seconds: number) => void = () => {};
  private lineT = 4;
  private lineI = 0;

  constructor(
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly interiors: Interiors,
  ) {
    interiors.landmarkKeys = (x, z) => this.insideKeys(x, z);
    interiors.seatBusy = (s) => this.seatHeld(s);
    interiors.onSeat = (s) => this.onSeat(s);
    this.panel = new ConfessionPanel(player);
    this.panel.say = (t) => this.say(t);
    // the night sheet takes Jef out of any room: forget the hall
    const sheet = jobs.day.onSheet;
    jobs.day.onSheet = () => {
      sheet();
      this.panel.close(true);
      if (this.here) this.gone();
    };
    void this.loadDoors();
  }

  get inside(): LandmarkId | null {
    return this.here?.id ?? null;
  }

  private async loadDoors(): Promise<void> {
    try {
      this.doors = (await landmarksApi.doors()).doors;
    } catch {
      /* the server is not up yet: again in a moment */
    }
  }

  // ------------------------------------------------------------------ in the street

  keys(x: number, z: number): { options?: Array<[number, Action]> } {
    if (this.interiors.inside || this.busy) return {};
    if (this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeRiding) return {};
    const options: Array<[number, Action]> = [];
    for (const d of this.doors) {
      const dist = Math.hypot(d.step[0] - x, d.step[1] - z);
      if (dist > REACH_DOOR || Math.abs(this.player.y - d.y) > 1.2) continue;
      options.push([
        dist - 0.25,
        d.open ? { key: "KeyE", text: `go into ${d.label}`, run: () => void this.enter(d.id) } : { key: "KeyE", text: `try the door of ${LANDMARK_LABEL[d.landmark]}`, run: () => this.say(CLOSED_TEXT[d.landmark]) },
      ]);
    }
    return { options };
  }

  /** For the path check: every landmark door must be reachable on foot. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    return this.doors.map((d) => ({ label: `landmark door: ${d.label}`, x: d.step[0], z: d.step[1], reach: 1.6 }));
  }

  private roomFor(id: LandmarkId, d: DoorNow): LandmarkRoom {
    let r = this.rooms.get(id);
    if (r) return r;
    // every door of one landmark leads into the same hall, framed at its main door
    const main = this.doors.find((q) => q.landmark === id && q.entry === "main") ?? d;
    const f = this.interiors.frameOf(main.step, main.out);
    const opts = { origin: f.origin, yaw: f.yaw };
    r = id === "cathedral" ? buildCathedral(opts) : id === "townhall" ? buildTownhall(opts) : id === "vleeshuis" ? buildVleeshuis(opts) : id === "steen" ? buildSteen(opts) : buildOostershuis(opts);
    this.rooms.set(id, r);
    return r;
  }

  async enter(doorId: string): Promise<boolean> {
    if (this.busy || this.interiors.inside) return false;
    const d = this.doors.find((q) => q.id === doorId);
    if (!d) return false;
    if (this.jobs.goods.carried) {
      this.say("Not with that in your arms. Set it down first.");
      return false;
    }
    this.busy = true;
    try {
      const now = await landmarksApi.now(d.landmark);
      if (!now.open) {
        this.say(CLOSED_TEXT[d.landmark]);
        return false;
      }
      const room = this.roomFor(d.landmark, d);
      const main = this.doors.find((q) => q.landmark === d.landmark && q.entry === "main") ?? d;
      const entry = room.entries[d.entry] ?? room.entry;
      room.entry = entry;
      room.levels?.reset(0);
      const ok = await this.interiors.enterOwn(
        room,
        { place: `landmark:${d.landmark}`, label: LANDMARK_LABEL[d.landmark], step: main.step, out: main.out },
        () => {
          this.here = { id: d.landmark, room, door: d };
          this.now = now;
          this.clear();
          this.sync(now, true);
          this.applyNow(now);
        },
        false,
        "landmark",
      );
      if (!ok) return false;
      void landmarksApi.here(d.landmark).catch(() => {});
      this.say(this.welcome(now));
      return true;
    } catch (e) {
      this.say(String((e as Error).message ?? e));
      return false;
    } finally {
      this.busy = false;
    }
  }

  private welcome(n: LandmarkNow): string {
    switch (n.id) {
      case "cathedral":
        if (n.wedding && n.wedding.stage === "vows") return `A wedding: ${n.wedding.groom} and ${n.wedding.bride} stand at the altar rail. The organ plays.`;
        if (n.service) return n.service.kind === "high" ? "High mass. The nave is full, the organ fills the vault, incense hangs in the light." : n.service.kind === "vespers" ? "Vespers. The organ, a few voices, the chairs half full." : "A low mass at the high altar. A handful of the faithful on the chairs. Your steps sound too loud.";
        return "The cathedral. Cold stone, the smell of wax, light high up in the glass. A few people pray; somebody coughs, and the vault sends it back.";
      case "townhall":
        return n.civil ? `The town hall. Up the stairs, in the wedding hall, the alderman marries ${n.civil.groom} and ${n.civil.bride}.` : "The town hall: a porter's lodge, a great staircase under a glass roof, clerks' pens scratching behind a counter.";
      case "vleeshuis":
        return n.theatre ? (n.theatre.kind === "performance" ? "The Vleeshuis. Upstairs in the theatre hall the society plays tonight; the stairs creak with people." : "The Vleeshuis at night. From upstairs, voices: the theatre society at rehearsal.") : "The old meat hall, full of wine: barrels in rows under the brick vaults, a smell of oak and must. Peyrot's cellarmen roll them along the floor.";
      case "steen":
        return "The Museum of Antiquities in the old castle: glass cases, old stones, rusted arms. The attendant nods. Speak softly.";
      case "oostershuis":
        return "The Oostershuis, the old house of the Hanse: a hall like a church of timber, stacked with sacks, bales and crates in the State's keeping.";
    }
  }

  private leaveBy(door: string): void {
    const d = this.doors.find((q) => q.landmark === this.here?.id && q.entry === door);
    const id = this.here?.id;
    this.panel.close(true);
    this.gone();
    if (d) this.interiors.leave(false, { step: d.step, out: d.out });
    else this.interiors.leave();
    if (id) void landmarksApi.here(null).catch(() => {});
  }

  /** Forget the people and the hall's state (out, or taken out by the night). */
  private gone(): void {
    this.clear();
    this.organ(false);
    this.here = null;
    this.now = null;
  }

  private clear(): void {
    for (const f of this.figs.values()) {
      f.human?.dispose();
      f.barrel?.outer.removeFromParent();
    }
    this.figs.clear();
    this.taken.clear();
  }

  // ------------------------------------------------------------------ the people

  private sync(n: LandmarkNow, first: boolean): void {
    const here = this.here;
    if (!here) return;
    const room = here.room;
    const want = new Map(n.people.map((p) => [p.id, p]));
    for (const f of this.figs.values()) {
      const p = want.get(f.p.id);
      if (p && p.role === f.p.role) continue;
      if (p && p.role !== f.p.role) {
        // a new part (the mass is over, the confessor goes to the altar): walk there
        this.release(f);
        f.p = p;
        f.spec = ROLES[here.id][p.role] ?? { motion: "idle" };
        this.place(f, false);
        continue;
      }
      if (!f.leaving) {
        f.leaving = true;
        if (f.y >= 2) {
          // upstairs: gone when Jef next looks
          f.human?.dispose();
          this.release(f);
          this.figs.delete(f.p.id);
          continue;
        }
        this.release(f);
        f.loop = null;
        f.seated = false;
        f.path = room.path([f.x, f.z], [room.entry.x, room.entry.z]);
      }
    }
    for (const p of n.people) {
      if (this.figs.has(p.id)) continue;
      const spec = ROLES[here.id][p.role] ?? { motion: "idle" };
      const k = UNLOADED[p.kind] && !spec.laden ? UNLOADED[p.kind] : p.kind;
      const kind: HumanKind = isHumanKind(k) ? k : p.sex === "f" ? "wife_a" : p.age < 16 ? "boy" : "docker_a";
      const f: Fig = { p, spec, human: null, kind, x: room.entry.x, z: room.entry.z, y: 0, yaw: 0, path: [], rest: null, seated: false, loop: null, li: 0, wait: 0, leaving: false, holds: null, arrived: false, barrel: null };
      if (p.role === "cellarman") {
        f.barrel = rollingBarrel();
        room.group.add(f.barrel.outer);
      }
      this.figs.set(p.id, f);
      this.place(f, first || !!spec.appear);
    }
  }

  private release(f: Fig): void {
    if (f.holds) this.taken.get(f.holds.set)?.delete(f.holds.i);
    f.holds = null;
  }

  /** Where this person goes and how they come there (at once, or walking in from the door). */
  private place(f: Fig, at: boolean): void {
    const room = this.here!.room;
    const s = f.spec;
    f.rest = null;
    f.loop = null;
    f.seated = false;
    f.arrived = false;
    if (s.at) f.rest = room.marks[s.at] ?? null;
    else if (s.set) {
      const list = room.sets[s.set] ?? [];
      const used = this.taken.get(s.set) ?? new Set<number>();
      this.taken.set(s.set, used);
      const n = list.length;
      if (n) {
        let i = s.front ? n - 1 - (hash(f.p.id) % Math.min(n, 12)) : hash(f.p.id + (this.now?.day ?? 0)) % n;
        for (let k = 0; k < n && used.has(i); k++) i = s.front ? (i - 1 + n) % n : (i + 7) % n;
        used.add(i);
        f.holds = { set: s.set, i };
        f.rest = list[i];
      }
    } else if (s.loop) {
      f.loop = room.sets[s.loop] ?? null;
      f.li = f.loop ? hash(f.p.id) % f.loop.length : 0;
      f.rest = f.loop?.[f.li] ?? null;
      f.wait = (hash(f.p.id) % 5) + 1;
    }
    const spot = this.restSpot(f);
    if (!spot) return;
    // upstairs (the wedding hall, the theatre, the studio): they are simply there, not walked up the stairs
    if ((spot.y ?? 0) >= 2) at = true;
    if (at) {
      f.x = spot.x;
      f.z = spot.z;
      f.yaw = spot.yaw;
      f.path = [];
      f.arrived = true;
    } else f.path = room.path([f.x, f.z], [spot.x, spot.z]);
  }

  /** The point they rest at: a woman stands behind a chair rather than on it. */
  private restSpot(f: Fig): Mark | null {
    const r = f.rest;
    if (!r) return null;
    if (f.spec.sit && f.spec.standBack && !this.canSit(f)) return { ...r, z: r.z - Math.cos(r.yaw) * f.spec.standBack, x: r.x - Math.sin(r.yaw) * f.spec.standBack };
    return r;
  }

  private canSit(f: Fig): boolean {
    return f.human ? f.human.canSit : !(f.p.sex === "f" || ["baker", "shopkeeper", "publican"].includes(f.kind));
  }

  private seatHeld(s: Seat): boolean {
    // Jef's seats are the chairs at the row ends: held if someone sits there
    for (const f of this.figs.values()) if (f.rest && Math.hypot(f.rest.x - s.x, f.rest.z - s.z) < 0.3 && !f.leaving) return true;
    return false;
  }

  private updatePeople(dt: number): void {
    const room = this.here!.room;
    for (const [id, f] of this.figs) {
      if (!f.human) {
        const h = makeHuman(f.kind);
        if (h) {
          f.human = h;
          room.group.add(h.root);
        }
      }
      const pace = (f.spec.speed ?? WALK) * (f.leaving ? 1.1 : 1);
      if (f.path.length) {
        const [tx, tz] = f.path[0];
        const dx = tx - f.x;
        const dz = tz - f.z;
        const d = Math.hypot(dx, dz);
        const step = pace * dt;
        if (d <= step) {
          f.x = tx;
          f.z = tz;
          f.path.shift();
          if (!f.path.length) {
            if (f.leaving) {
              f.human?.dispose();
              f.barrel?.outer.removeFromParent();
              this.figs.delete(id);
              continue;
            }
            const spot = this.restSpot(f);
            if (spot) f.yaw = spot.yaw;
            if (!f.arrived) {
              f.arrived = true;
              if (f.p.role === "candle") room.addCandle?.();
            }
          }
        } else {
          f.x += (dx / d) * step;
          f.z += (dz / d) * step;
          f.yaw = Math.atan2(dx, dz);
        }
      } else if (f.loop && f.loop.length > 1 && !f.leaving) {
        f.wait -= dt;
        if (f.wait <= 0) {
          f.li = (f.li + 1) % f.loop.length;
          f.rest = f.loop[f.li];
          f.path = room.path([f.x, f.z], [f.rest.x, f.rest.z]);
          f.wait = (f.spec.pause ?? 5) * (0.7 + ((hash(f.p.id + f.li) % 60) / 100));
        }
      }
      const walking = f.path.length > 0;
      const rest = this.restSpot(f);
      const atRest = !walking && !!rest && Math.hypot(rest.x - f.x, rest.z - f.z) < 0.2;
      f.seated = atRest && !!f.spec.sit && this.canSit(f);
      // floor: the room's, or the mark's own (a loft, a stage)
      const markY = atRest && rest?.y !== undefined ? rest.y : null;
      f.y = markY ?? room.peopleFloor?.(f.x, f.z) ?? 0;
      const h = f.human;
      if (!h) continue;
      if (walking) {
        h.play(f.spec.laden ? "carry" : "walk");
        h.setPace(pace);
      } else if (f.seated) h.play("sit");
      else h.play(this.talking === id ? "talk" : this.motionNow(f));
      h.root.position.set(f.x, f.y + (f.seated ? h.sitDrop(f.spec.sit!) : 0) + h.bob(), f.z);
      h.root.rotation.y = f.yaw;
      h.update(dt);
      // the cellarman's barrel rolls ahead of him as he walks, and lies by him when he stops
      const b = f.barrel;
      if (b) {
        const ahead = walking ? 0.72 : 0.9;
        const side = walking ? 0 : 0.5;
        const nx = f.x + Math.sin(f.yaw) * ahead + Math.cos(f.yaw) * side;
        const nz = f.z + Math.cos(f.yaw) * ahead - Math.sin(f.yaw) * side;
        const moved = Math.hypot(nx - b.outer.position.x, nz - b.outer.position.z);
        if (walking && moved < 1) b.roll += moved / 0.34;
        b.outer.position.set(nx, 0.36, nz);
        b.outer.rotation.y = f.yaw;
        b.inner.rotation.x = b.roll;
      }
    }
  }

  private talking: string | null = null;

  /** The rest pose, with the celebrant's turns to the people. */
  private motionNow(f: Fig): Motion {
    if (f.p.role === "celebrant" && this.now?.service) {
      const ph = this.phase();
      const turned = (ph > 0.2 && ph < 0.24) || (ph > 0.55 && ph < 0.59) || (ph > 0.86 && ph < 0.9);
      f.yaw = turned ? Math.PI : 0;
      return turned ? "talk" : "idle";
    }
    if (!f.spec.sit || this.canSit(f)) return f.spec.motion;
    return f.p.sex === "f" ? "fold" : "idle";
  }

  /** How far through the service (0..1), by the game clock. */
  private phase(): number {
    const s = this.now?.service;
    if (!s) return 0;
    const h = this.jobs.day.hourF;
    return Math.max(0, Math.min(1, (h - s.from) / Math.max(0.1, s.to - s.from)));
  }

  /** The mass's moments: the candles lit, the bell at the elevation, the organ. */
  private applyNow(n: LandmarkNow): void {
    const room = this.here?.room;
    if (!room) return;
    if (n.id === "vleeshuis") room.setLit?.(!!n.theatre);
    if (n.id === "cathedral") {
      room.setLit?.(!!n.service);
      this.organ(n.organ);
      const key = n.service ? `${n.day}:${n.service.kind}:${n.service.from}` : "";
      if (key !== this.serviceKey) this.serviceKey = key;
    }
  }

  // ------------------------------------------------------------------ keys inside

  private insideKeys(x: number, z: number): { options: Array<[number, Action]>; extra: Action[] } {
    const here = this.here;
    const options: Array<[number, Action]> = [];
    const extra: Action[] = [];
    if (!here) return { options, extra };
    const room = here.room;
    for (const [door, s] of Object.entries(room.exits)) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < 1.3) options.push([d, { key: "KeyE", text: door === "main" ? "go out into the street" : "go out by the north door", run: () => this.leaveBy(door) }]);
    }
    for (const l of room.looks) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < l.r) options.push([d + 0.4, { key: "KeyE", text: l.label, run: () => this.look(l.id, l.text) }]);
    }
    let best: Fig | null = null;
    let bd = TALK_R;
    const py = this.player.rideWalk ? (room.floor?.(x, z) ?? 0) : 0;
    for (const f of this.figs.values()) {
      if (f.leaving || f.spec.noTalk) continue;
      const d = Math.hypot(f.x - x, f.z - z);
      if (d < bd && Math.abs(f.y - py) < 1.5) [best, bd] = [f, d];
    }
    if (best) {
      const b = best;
      options.push([bd + 0.1, { key: "KeyE", text: `talk to ${b.p.name}`, run: () => this.talkTo(b) }]);
    }
    if (here.id === "cathedral") {
      const st = room.marks.stand;
      if (st && Math.hypot(st.x - x, st.z - z) < 1.8) extra.push({ key: "KeyF", text: `light a candle (${CANDLE_C} c)`, run: () => void this.candle() });
      const pen = room.marks.penitent;
      if (pen && Math.hypot(pen.x - x, pen.z - z) < 1.4) {
        if (this.now?.confession.open) options.push([0.05, { key: "KeyE", text: "kneel at the confessional", run: () => void this.confess() }]);
        else options.push([0.3, { key: "KeyE", text: "look at the confessional", run: () => this.say("The curate's confessional. The little door is shut; nobody is inside now. He hears confession in the morning and the afternoon, when there is no mass.") }]);
      }
    }
    return { options, extra };
  }

  private look(id: string, text: string): void {
    const n = this.now;
    if (id === "board") {
      const ps = n?.posters ?? [];
      this.say(ps.length ? `The notice board: ${ps.slice(0, 3).map((p) => `"${p.heading}" ${p.body}`.trim()).join(" | ")}` : text);
      return;
    }
    if (id === "register") {
      const r = n?.register ?? [];
      this.say(r.length ? `The register of the civil state, today: ${r.join(" ")}` : text);
      return;
    }
    this.say(text);
  }

  private talkTo(f: Fig): void {
    this.talking = f.p.id;
    this.jobs.talk.open({ id: f.p.id, def: { name: f.p.name, title: f.p.title } });
    const w = this.player.rideWalk;
    if (w && !f.seated && !f.path.length) f.yaw = Math.atan2(w.x - f.x, w.z - f.z);
  }

  private async candle(): Promise<void> {
    try {
      const r = await landmarksApi.candle();
      this.jobs.refresh(r as JobsPayload);
      this.here?.room.addCandle?.();
      this.sfx("coins");
      this.say(r.text);
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  private onSeat(s: Seat | null): void {
    if (!s || this.here?.id !== "cathedral" || !this.now?.service || this.now.service.kind === "wedding") return;
    landmarksApi
      .chair()
      .then((r) => {
        this.jobs.refresh(r as JobsPayload);
        if (r.text) this.say(r.text);
      })
      .catch(() => {});
  }

  private async confess(): Promise<void> {
    const room = this.here?.room;
    const pen = room?.marks.penitent;
    const w = this.player.rideWalk;
    if (!room || !pen || !w) return;
    try {
      const b = await landmarksApi.begin();
      // kneel at the grille, facing it
      w.x = pen.x;
      w.z = pen.z;
      this.player.rideSeat = { x: pen.x, y: 0, z: pen.z, eye: 0.98 };
      const f = room.toWorld(pen.x + Math.sin(pen.yaw), pen.z + Math.cos(pen.yaw));
      const p = room.toWorld(pen.x, pen.z);
      this.player.yaw = Math.atan2(-(f.x - p.x), -(f.z - p.z));
      this.player.pitch = 0.05;
      this.panel.open(b.line, () => {
        this.player.rideSeat = null;
      });
    } catch (e) {
      this.say(String((e as Error).message ?? e));
    }
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    this.t += dt;
    this.doorsT -= dt;
    if (this.doorsT <= 0) {
      this.doorsT = 12;
      void this.loadDoors();
    }
    const here = this.here;
    if (!here) return;
    if (!this.interiors.inside || this.interiors.placeId !== `landmark:${here.id}`) {
      // taken out some other way (the night): forget it
      this.gone();
      void landmarksApi.here(null).catch(() => {});
      return;
    }
    if (!this.jobs.talk.isOpen) this.talking = null;
    here.room.animate?.(this.t, dt);
    this.updatePeople(dt);
    // the altar bell at the elevation, once a mass
    if (here.id === "cathedral" && this.now?.service && this.now.service.kind !== "vespers") {
      const key = `${this.serviceKey}`;
      if (this.phase() > 0.5 && this.bellRung !== key) {
        this.bellRung = key;
        this.altarBell();
        this.sayOnce("The small bell rings at the altar. Heads bow along the rows.");
      }
    }
    // the theatre upstairs: the society's lines while Jef is up there
    if (here.id === "vleeshuis" && this.now?.theatre && (here.room.levels?.level ?? 0) === 1) {
      this.lineT -= dt;
      if (this.lineT <= 0) {
        this.lineT = 7 + Math.random() * 3;
        const line = REHEARSAL[this.lineI++ % REHEARSAL.length];
        const cast = [...this.figs.values()].filter((f) => f.p.role === line.who);
        const f = cast[this.lineI % Math.max(1, cast.length)];
        if (f) {
          this.say(`${f.p.first}${line.who === "prompter" ? ", the prompter" : ", on the stage"}: "${line.text}"`);
          const at = here.room.toWorld(f.x, f.z);
          this.speak({ x: at.x, z: at.z }, { sex: f.p.sex, age: f.p.age }, 2.5);
        }
      }
    }
    this.syncT -= dt;
    if (this.syncT <= 0) {
      this.syncT = 3;
      const id = here.id;
      landmarksApi
        .now(id)
        .then((n) => {
          if (this.here?.id !== id) return;
          if (!n.open && !n.people.length) {
            this.say(id === "cathedral" ? "The sexton rattles his keys: the church is closing. You go out." : id === "townhall" ? "The porter calls out: the offices are closing. You go out." : "They are locking up. You go out.");
            this.leaveBy("main");
            return;
          }
          const wasService = !!this.now?.service;
          this.now = n;
          this.sync(n, false);
          this.applyNow(n);
          if (id === "cathedral" && !wasService && n.service && n.service.kind !== "wedding") this.sayOnce(n.service.kind === "high" ? "The bell for high mass. The priest comes out of the sacristy; the organ begins." : "A little bell from the sacristy: mass is beginning.");
        })
        .catch(() => {});
    }
  }

  private sayOnce(t: string): void {
    if (this.t - this.sayT < 4) return;
    this.sayT = this.t;
    this.say(t);
  }

  // ------------------------------------------------------------------ dev

  /** Dev: go straight in by a door ("cathedral_west", or a landmark id). */
  async devEnter(id: string): Promise<string> {
    if (this.interiors.inside) this.interiors.leave(true);
    this.gone();
    await this.loadDoors();
    const d = this.doors.find((q) => q.id === id) ?? this.doors.find((q) => q.landmark === id);
    if (!d) return `no such door: ${id}`;
    this.player.rideEnd(d.step[0], d.step[1]);
    const ok = await this.enter(d.id);
    return ok ? `inside ${d.label}` : "not let in";
  }

  /** Dev: walk Jef to a point of the hall. */
  devGo(x: number, z: number): void {
    const w = this.player.rideWalk;
    if (!w) return;
    this.player.rideSeat = null;
    w.x = x;
    w.z = z;
  }

  debug() {
    const w = this.player.rideWalk;
    return {
      inside: this.here?.id ?? null,
      jef: w ? [+w.x.toFixed(2), +w.z.toFixed(2), +(this.here?.room.floor?.(w.x, w.z) ?? 0).toFixed(2)] : null,
      level: this.here?.room.levels?.level ?? 0,
      service: this.now?.service ?? null,
      phase: +this.phase().toFixed(2),
      organ: this.now?.organ ?? false,
      confession: this.now?.confession ?? null,
      wedding: this.now?.wedding ?? null,
      civil: this.now?.civil ?? null,
      theatre: this.now?.theatre ?? null,
      register: this.now?.register ?? [],
      posters: (this.now?.posters ?? []).length,
      people: [...this.figs.values()].map((f) => ({ name: f.p.name, role: f.p.role, kind: f.kind, at: [+f.x.toFixed(1), +f.z.toFixed(1), +f.y.toFixed(2)], walking: f.path.length > 0, seated: f.seated, model: !!f.human })),
      keys: this.interiors.inside ? this.insideKeys(w?.x ?? 0, w?.z ?? 0).options.map(([d, a]) => `${d.toFixed(2)} ${a.key.slice(3)}: ${a.text}`) : [],
      doors: this.doors.map((d) => ({ id: d.id, open: d.open, step: d.step })),
    };
  }

  /** Dev: the confession panel's last lines (for scripted checks). */
  get confessionLines(): string[] {
    return this.panel.history;
  }
  /** Dev: say a line at the grille as if typed. */
  async devConfess(text: string): Promise<string> {
    return this.panel.send(text);
  }

  /** Dev: a picture of the hall from `from` to `to` in its own frame (y up). */
  camera(cam: THREE.PerspectiveCamera, from: [number, number, number], to: [number, number, number]): boolean {
    return this.interiors.devCamera(cam, from, to);
  }

  /** Dev: world point of a hall point (for sound checks). */
  worldOf(x: number, z: number): Pt | null {
    const r = this.here?.room;
    if (!r) return null;
    const v = r.toWorld(x, z);
    return [v.x, v.z];
  }
}

// ------------------------------------------------------------------ the confessional

class ConfessionPanel {
  private el = document.createElement("div");
  private input = document.createElement("input");
  private lines: Array<{ who: string; text: string }> = [];
  private busy = false;
  private openNow = false;
  private penance: string | null = null;
  private onClose: (() => void) | null = null;
  history: string[] = [];
  say: (t: string) => void = () => {};

  constructor(private readonly player: FirstPerson) {
    this.el.className = "talk paper confession";
    this.el.style.display = "none";
    this.input.className = "talk-input";
    this.input.maxLength = 300;
    this.input.placeholder = "Say it in your own words, then Enter";
    document.body.appendChild(this.el);
    window.addEventListener("keydown", (e) => this.onKey(e), true);
  }

  open(first: string, onClose: () => void): void {
    this.lines = [{ who: "", text: first }];
    this.history = [first];
    this.penance = null;
    this.onClose = onClose;
    this.openNow = true;
    this.player.frozen = true;
    this.el.style.display = "block";
    this.render(true);
  }

  close(quiet = false): void {
    if (!this.openNow) return;
    this.openNow = false;
    this.player.frozen = false;
    this.el.style.display = "none";
    this.onClose?.();
    this.onClose = null;
    if (!quiet && this.penance) this.say(this.penance);
  }

  private async absolve(): Promise<void> {
    if (this.busy) return;
    if (!this.penance) return this.close();
    this.busy = true;
    try {
      const r = await landmarksApi.end();
      this.lines.push({ who: "", text: `${this.penance} ${r.line}` });
      this.history.push(r.line);
      this.render(false);
      setTimeout(() => this.close(true), 3500);
    } catch {
      this.close(true);
    } finally {
      this.busy = false;
    }
  }

  /** Send a line (typed, or the dev's). Returns the priest's answer. */
  async send(text: string): Promise<string> {
    if (this.busy || !this.openNow) return "";
    this.busy = true;
    this.lines.push({ who: "You", text });
    this.render(false);
    try {
      const r = await landmarksApi.confess(text);
      if (!r.line) {
        this.lines.pop();
        this.lines.push({ who: "", text: r.gated === "too fast" ? "(Catch your breath first.)" : r.gated === "too long" ? "(Too many words at once.)" : "" });
        return "";
      }
      this.lines.push({ who: "The priest", text: r.line });
      this.history.push(r.line);
      if (r.penance) this.penance = r.penance;
      return r.line;
    } catch (e) {
      this.lines.push({ who: "", text: String((e as Error).message ?? e) });
      return "";
    } finally {
      this.busy = false;
      this.render(true);
    }
  }

  private render(typing: boolean): void {
    const body = this.lines
      .slice(-5)
      .filter((l) => l.text)
      .map((l) => (l.who ? `<p class="${l.who === "You" ? "you" : "them"}"><b>${esc(l.who)}:</b> ${esc(l.text)}</p>` : `<p class="them"><i>${esc(l.text)}</i></p>`))
      .join("");
    const wait = this.busy ? `<p class="them wait">The priest ...</p>` : "";
    this.el.innerHTML = `<div class="who">The confessional<span class="title">, behind the grille</span></div>${body}${wait}
      <p class="keys">${this.busy ? "" : `Enter  say it &middot; Esc  ${this.penance ? "ask for absolution" : "get up"}`}<br><span class="secret">What you say here stays behind the grille: it is never told or kept.</span></p>`;
    if (typing && !this.busy) {
      this.el.appendChild(this.input);
      this.input.focus();
    }
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.openNow) return;
    if (e.code === "Enter") {
      const t = this.input.value.trim();
      this.input.value = "";
      if (t) void this.send(t);
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    if (e.code === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      void this.absolve();
      return;
    }
    e.stopPropagation(); // letters go to the input, not to the game
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
