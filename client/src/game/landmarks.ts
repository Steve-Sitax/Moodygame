import * as THREE from "three";
import "./landmarks.css";
import type { FirstPerson } from "../player/firstPerson";
import type { JobsPayload, Pt } from "../net/api";
import { landmarksApi, type DoorNow, type HushResult, type InPerson, type LandmarkNow, type SermonView } from "../net/landmarksApi";
import { CANDLE_C, CLOSED_TEXT, LANDMARK_LABEL, type LandmarkId } from "../../../shared/landmarks";
import type { LandmarkRoom, Mark } from "../world/landmarkRooms";
import { hallsInWorld } from "../world/landmarkHalls";
import type { HallInWorld } from "../world/hallInWorld";
import { Builder, type Seat } from "../world/rooms";
import { isHumanKind, makeHuman, type Human, type HumanKind, type Motion } from "./humans";
import type { Interiors } from "./interiors";
import type { Jobs } from "./jobs";
import type { Action, Sfx } from "./runs";
import { pick, type Target } from "./facing";
import type { RideWalk } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import type { InWorld } from "../world/inworld";
import { createCathedralInWorld, type CathedralInWorld } from "../world/cathedralInWorld";
import { loadCathedralOutside } from "../world/cathedralOutside";
import { loadVleeshuisShell } from "../world/vleeshuisShell"; // the Vleeshuis in detail (vleeshuis.glb)
import { loadStadhuisShell } from "../world/stadhuisShell"; // the town hall in detail (stadhuis.glb)
import * as PLAN from "../../../shared/cathedralPlan";
import * as HP from "../../../shared/hallPlan";
import { makeCoffin, makeWear, type WardrobeRole } from "./wardrobe";
import { BIER_TOP, makeBier, type Bier } from "../world/bier";

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
//
// M7: the cathedral is no longer a room of its own. Its hall stands in the world inside its shell
// (world/cathedralInWorld.ts): Jef walks in through the open west door and runs as anywhere; its
// people walk in from the square; while he is near, its life runs here as for the other halls.
// Running in the nave with people near: a hiss, heads turn, the kerk's trust (the engine's, hush.ts),
// and the third time the beadle walks him out.

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
  /** M7 funeral: walk by these points (local) last, round something the walking graph does not know (the bier). */
  via?: P2[];
}

/**
 * M7 funeral: the bier stands in the nave's middle aisle, a third of the way up (the mourners in the
 * rows behind it): near enough to the door that the coffin is carried in within half a minute.
 */
const BIER_Z = 33.6;

const ROLES: Record<LandmarkId, Record<string, RoleSpec>> = {
  cathedral: {
    celebrant: { at: "altar", motion: "idle", appear: true },
    wedding_priest: { at: "choirFront", motion: "talk", appear: true },
    sexton: { at: "server", motion: "fold", appear: true },
    // M6 sermon: the other priest waits by the pulpit at Sunday high mass, then climbs it to preach
    preacher: { at: "preacherWait", motion: "fold", appear: true },
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
    // M7 funeral: the requiem (server landmarks/life.ts): the priest at the coffin's head facing the people,
    // the bearers by the bier, the widow and the mourners in the front rows
    requiem_priest: { at: "requiemPriest", motion: "talk", speed: 1.2, via: [[0, BIER_Z - 3.8], [1.0, BIER_Z - 2.4], [1.0, BIER_Z + 1.9]] },
    bearer0: { at: "bearer0", motion: "fold", speed: 1.15 },
    bearer1: { at: "bearer1", motion: "fold", speed: 1.15 },
    bearer2: { at: "bearer2", motion: "fold", speed: 1.15 },
    bearer3: { at: "bearer3", motion: "fold", speed: 1.15 },
    widow: { set: "funeralChairs", front: true, motion: "sit", sit: 0.46, standBack: 0.62, speed: 1.2 },
    mourner: { set: "funeralChairs", front: true, motion: "sit", sit: 0.46, standBack: 0.62, speed: 1.35 },
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
  /** M6 sermon: held at a place and pose by a scene (the preacher on the pulpit's stair and in it). */
  hold?: { x: number; z: number; y: number; yaw: number; motion: Motion } | null;
  /** M7: seconds left turning to look at Jef (he ran). */
  look?: number;
  /** M7 funeral: where a bearer walks in the coffin's four (a shift from the path they share). */
  ox?: number;
  oz?: number;
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
/** M6 sermon: the preacher stands this high in the pulpit's tub (its floor; he shows from the chest up over the rim). */
const PULPIT_UP = 2.8;
const TALK_R = 1.7;
const REACH_DOOR = 2.0;

function hash(s: string): number {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619) >>> 0;
  return h;
}

const UNLOADED: Record<string, string> = { docker_sack: "docker_b", porter: "docker_c", carter: "docker_a", sentry: "soldier" };

// M7 funeral: the requiem's places, in the nave's frame: the bier on the axis of the middle aisle,
// the coffin along it (its foot to the west); the priest at its head, facing the people; the bearers
// two by two in the aisle behind it, the mourners in the rows behind them (the set "funeralChairs").
// Added to the cathedral's marks and sets while a funeral is in.
const FUNERAL_MARKS: Record<string, Mark> = {
  requiemPriest: { x: 0, z: BIER_Z + 1.9, yaw: Math.PI },
  bearer0: { x: -0.42, z: BIER_Z - 1.75, yaw: 0 },
  bearer1: { x: 0.42, z: BIER_Z - 1.75, yaw: 0 },
  bearer2: { x: -0.42, z: BIER_Z - 2.9, yaw: 0 },
  bearer3: { x: 0.42, z: BIER_Z - 2.9, yaw: 0 },
};
/** The parts of a town event inside (they go out by the door when it moves on). */
const EVENT_ROLES = new Set(["requiem_priest", "bearer0", "bearer1", "bearer2", "bearer3", "widow", "mourner", "groom", "bride", "guest", "wedding_priest"]);
/** The street's wardrobe for the event's parts inside too (game/wardrobe.ts): the veils, the armbands, the surplice. */
const WEAR_INSIDE: Record<string, WardrobeRole> = {
  groom: "groom",
  bride: "bride",
  wedding_priest: "priest",
  requiem_priest: "priest",
  widow: "widow",
  bearer0: "bearers",
  bearer1: "bearers",
  bearer2: "bearers",
  bearer3: "bearers",
};

export class Landmarks {
  private doors: DoorNow[] = [];
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
  /** M6 sermon: this Sunday's words and how far the preacher is with them; who nods; the whisper. */
  private sermon: { key: string; view: SermonView | null; loading: boolean; stage: "wait" | "climb" | "preach" | "down" | "done"; i: number; t: number; fig: string | null; from: { x: number; z: number } } | null = null;
  private readonly caption = document.createElement("div");
  private nods = new Map<string, number>();
  private whisper: { el: HTMLDivElement; who: string; t: number } | null = null;
  /** M7: the cathedral in the world (world/cathedralInWorld.ts); its life runs while Jef is near it. */
  private cath: CathedralInWorld | null = null;
  /** `here` is a building in the world (the cathedral, or a hall of M7 halls), not an instanced hall. */
  private inWorldHere = false;
  /** M7 halls: the town hall, the Vleeshuis, the Oostershuis and the Steen in the world (world/hallInWorld.ts). */
  private halls: HallInWorld[] = [];
  /** The hall whose life runs now (null: none, or the cathedral's). */
  private hall: HallInWorld | null = null;
  /** Jef is in the nave (not on the square); when he was last welcomed. */
  private jefIn = false;
  private welcomedAt = -1e9;
  /** Jef's chair in the world's cathedral. */
  private jefSeat: Seat | null = null;
  private firstSync = false;
  /** Running: for how long now, when he was last hissed at, where he stood a frame ago; the hiss's bubble. */
  private runT = 0;
  private hushAt = -1e9;
  private hushBusy = false;
  private lastPos: { x: number; z: number } | null = null;
  private hushBubble: { el: HTMLDivElement; who: string; t: number } | null = null;
  /** M7: the nave's sound as Jef goes in and out (set by main: the soundscape's interior). */
  roomSound: (k: string | null) => void = () => {};
  /** M7 funeral: the bier and the coffin of a requiem, the collider that keeps Jef off them, the murmur's clock, where in it Jef has been told. */
  private bier: Bier | null = null;
  private fcoffin: THREE.Group | null = null;
  private bierRect: { minX: number; maxX: number; minZ: number; maxZ: number } | null = null;
  private world: World | null = null;
  private requiemT = 0;
  private requiemTold = "";
  /** M7 funeral: a slot near the door for this sync's leavers (Jef on the square: they come down the last of the nave). */
  private doorK = 0;
  /** M7: the day's light (0 night .. 1 noon) and the weather's (1 clear .. 0.5 storm), for the glass (set by main). */
  daylight: () => { day: number; sky: number } = () => ({ day: 1, sky: 1 });

  constructor(
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly interiors: Interiors,
  ) {
    this.caption.className = "sermon-caption";
    document.body.appendChild(this.caption);
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
    if (this.inWorldHere) return this.jefIn ? (this.here?.id ?? null) : null;
    return this.here?.id ?? null;
  }

  /** M7: stand the cathedral's hall in the world (main, once, after the world is built). */
  attachWorld(world: World, inWorld: InWorld): void {
    this.cath = createCathedralInWorld(world, inWorld);
    // M7 the cathedral outside: its own model in detail (world/cathedralOutside.ts, cathedral.glb)
    loadCathedralOutside(world);
    this.world = world;
    // M7 halls: the other landmarks stand in the world too, walked into through their doors
    this.halls = hallsInWorld(world, inWorld);
    loadVleeshuisShell(world.scene); // the Vleeshuis in detail: its own model, the old one of landmarks.glb hidden
    loadStadhuisShell(world.scene); // the town hall in detail: its own model, the old one of landmarks.glb hidden
  }

  /** M7 funeral: is this person's figure in the hall now (a townsperson of an event walks out of the street only once it has walked out)? */
  hasFig(id: string): boolean {
    return this.figs.has(id);
  }

  /** M7: Jef is in the cathedral's nave. */
  get inCathedral(): boolean {
    return this.jefIn && this.here?.id === "cathedral";
  }

  /** M7 halls: Jef is inside a building in the world (the cathedral or a hall): the footsteps' echo. */
  get indoors(): boolean {
    return this.jefIn;
  }

  /** How many people are in the hall Jef is in (not those walking out): the room's murmur follows. */
  get peopleInside(): number {
    let n = 0;
    for (const f of this.figs.values()) if (!f.leaving) n++;
    return n;
  }

  /** M7 halls: the halls in the world, for the dev checks. */
  get inWorldHalls(): HallInWorld[] {
    return this.halls;
  }

  /**
   * M7 halls: the building in the world whose life runs now, as one shape for the cathedral and the
   * halls: its frame, its floors for Jef's feet, where Jef is put out and let in.
   */
  private iw(): InWorldNow | null {
    if (!this.inWorldHere || !this.here) return null;
    if (this.hall) return hallNow(this.hall);
    return this.cath ? cathNow(this.cath) : null;
  }

  /** M7: the cathedral in the world, for the dev checks. */
  get cathedral(): CathedralInWorld | null {
    return this.cath;
  }

  private async loadDoors(): Promise<void> {
    try {
      // an answer without a list (a dropped connection) keeps the old list: updateCathedral reads it every frame
      this.doors = (await landmarksApi.doors()).doors ?? this.doors;
    } catch {
      /* the server is not up yet: again in a moment */
    }
  }

  // ------------------------------------------------------------------ in the street

  keys(x: number, z: number): { only?: Action[]; options?: Array<[number, Action]>; extra?: Action[] } {
    if (this.interiors.inside || this.busy) return {};
    // M7: in the cathedral in the world: its keys (talk, sit, a candle, the confessional, what to look at)
    const iwk = this.iw();
    if (iwk) {
      if (this.panel.isOpen) return { only: [] };
      if (this.jefSeat) return { only: [{ key: "KeyE", text: "stand up", run: () => this.standInWorld(), self: true }] };
      if (!this.player.riding && iwk.insideness(x, z) > 0.3) {
        const [lx, lz] = iwk.local(x, z);
        const r = this.insideKeys(lx, lz);
        const seat = this.freeSeatNear(lx, lz);
        if (seat) r.options.push([seat.d + 0.1, { key: "KeyE", text: "sit down", run: () => this.sitInWorld(seat.s), at: this.pt(seat.s.x, seat.s.z, seat.s.h) }]);
        return r;
      }
    }
    if (this.player.riding || this.player.swimming || this.player.climbing || this.player.bikeRiding) return {};
    const options: Array<[number, Action]> = [];
    // M7: before the cathedral's shut leaves, in the porch
    if (this.cath && !this.cath.doorOpen) {
      const [lx, lz] = this.cath.local(x, z);
      if (Math.abs(lx) < 3 && lz > -1.5 && lz < PLAN.DOORWAY.z0) options.push([0.1, { key: "KeyE", text: `try the door of ${LANDMARK_LABEL.cathedral}`, run: () => this.say(CLOSED_TEXT.cathedral), at: this.cathDoor() }]);
    }
    for (const d of this.doors) {
      // M7: the cathedral's west door stands open by day: walk in (M7 halls: and every hall's street doors)
      if (d.landmark === "cathedral" && this.cath && d.open) continue;
      if (d.open && this.halls.some((h) => h.plan.doors.some((q) => q.id === d.id))) continue;
      const dist = Math.hypot(d.step[0] - x, d.step[1] - z);
      if (dist > REACH_DOOR || Math.abs(this.player.y - d.y) > 1.2) continue;
      // the door itself, a step in from the step, at chest height: Jef must look at it (game/facing.ts)
      const at = { x: d.step[0] - d.out[0], y: d.y + 1.2, z: d.step[1] - d.out[1] };
      options.push([
        dist - 0.25,
        d.open ? { key: "KeyE", text: `go into ${d.label}`, run: () => void this.enter(d.id), at } : { key: "KeyE", text: `try the door of ${LANDMARK_LABEL[d.landmark]}`, run: () => this.say(CLOSED_TEXT[d.landmark]), at },
      ]);
    }
    return { options };
  }

  /** For the path check: every landmark door must be reachable on foot. */
  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const out = this.doors.map((d) => ({ label: `landmark door: ${d.label}`, x: d.step[0], z: d.step[1], reach: 1.6 }));
    // M7: in through the west door to the cathedral's places (by day, when the door stands open)
    if (this.cath?.doorOpen) {
      const m = PLAN.MARKS;
      const pts: Array<[string, number, number, number]> = [
        ["the cathedral's nave", 0, PLAN.ROW0 - 1.5, 1.2],
        ["the cathedral's chairs (a row's end)", 0.6, PLAN.ROW0 + 5 * PLAN.ROWD, 1.0],
        ["the curate's confessional", m.penitent.x, m.penitent.z, 1.0],
        ["the candle stand at the Lady altar", PLAN.SETS.standAt[2].x, PLAN.SETS.standAt[2].z, 1.2],
        ["the communion rail", m.railN.x, m.railN.z, 1.2],
        ["the Elevation of the Cross", PLAN.NORTH * PLAN.TRIPTYCH_X, PLAN.CROSS1 - 3.2, 1.5],
        ["the Descent from the Cross", -PLAN.NORTH * PLAN.TRIPTYCH_X, PLAN.CROSS1 - 3.2, 1.5],
        ["the pulpit", PLAN.PULPIT.x + 1.6, PLAN.PULPIT.z, 1.5],
        ["the ambulatory behind the high altar", 0, PLAN.AC + 9, 1.5],
      ];
      for (const [label, lx, lz, reach] of pts) {
        const [x, z] = PLAN.toWorld(lx, lz);
        out.push({ label: `in the cathedral: ${label}`, x, z, reach });
      }
    }
    // M7 halls: in through the street doors to each hall's places on its ground floor (by day, when they stand open)
    for (const h of this.halls) {
      if (!h.doorOpen) continue;
      for (const q of h.points) {
        const [x, z] = h.world(q.x, q.z);
        out.push({ label: `in ${LANDMARK_LABEL[h.id]}: ${q.label}`, x, z, reach: q.reach });
      }
    }
    return out;
  }

  /**
   * Dev: into a landmark by a door. M7 halls: every landmark stands in the world now (the cathedral, M7; the
   * town hall, the Vleeshuis, the Oostershuis and the Steen, world/hallInWorld.ts) and is walked into; the
   * fade into a room of its own is gone. This puts Jef just inside the door.
   */
  async enter(doorId: string): Promise<boolean> {
    if (this.busy || this.interiors.inside) return false;
    const d = this.doors.find((q) => q.id === doorId);
    if (!d) return false;
    if (d.landmark === "cathedral" && this.cath) {
      const [x, z] = PLAN.toWorld(0, PLAN.W0 + 6);
      this.player.place(x, z, Math.PI, 0.03);
      return true;
    }
    const hw = this.halls.find((h) => h.id === d.landmark);
    if (!hw) return false;
    const p = hallNow(hw).inside;
    this.player.place(p.x, p.z, p.yaw, 0.03);
    return true;
  }

  private welcome(n: LandmarkNow): string {
    switch (n.id) {
      case "cathedral":
        if (n.wedding && n.wedding.stage === "vows") return `A wedding: ${n.wedding.groom} and ${n.wedding.bride} stand at the altar rail. The organ plays.`;
        if (n.funeral) return `A requiem. The coffin lies on a bier before the choir under a black pall, a candle burning at each corner${n.funeral.widow ? `; ${n.funeral.widow} sits in the front row in black` : ""}. The organ plays low.`;
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
    this.caption.classList.remove("on");
    this.whisper?.el.remove();
    this.whisper = null;
    this.hushBubble?.el.remove();
    this.hushBubble = null;
    this.inWorldHere = false;
    this.hall = null;
    if (this.sermon && this.sermon.stage !== "done" && this.sermon.stage !== "wait") this.sermon.stage = "done";
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
    this.dropBier();
  }

  // ------------------------------------------------------------------ the people

  private sync(n: LandmarkNow, first: boolean): void {
    const here = this.here;
    if (!here) return;
    const room = here.room;
    const want = new Map(n.people.map((p) => [p.id, p]));
    this.doorK = 0;
    if (n.funeral) this.funeralPlaces(room);
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
        // M7 funeral: Jef on the square sees only the last of the nave through the door: an event's people
        // come down it from there (the coffin first), not from the choir a minute's walk away
        const near = this.nearDoor(f);
        if (near) {
          f.x = near.x;
          f.z = near.z;
          f.path = room.path([f.x, f.z], [room.entry.x, room.entry.z]);
        } else f.path = f.spec.via ? [...[...f.spec.via].reverse(), ...room.path(f.spec.via[0], [room.entry.x, room.entry.z])] : room.path([f.x, f.z], [room.entry.x, room.entry.z]);
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
      // M7 funeral: an event's people come in through the street's door; with Jef out on the square they are simply in their places
      this.place(f, first || !!spec.appear || (this.inWorldHere && !this.jefIn && EVENT_ROLES.has(p.role)));
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
    } else if (s.via?.length) f.path = [...room.path([f.x, f.z], s.via[0]), ...s.via.slice(1), [spot.x, spot.z]];
    else f.path = room.path([f.x, f.z], [spot.x, spot.z]);
  }

  /** M7 funeral: where an event's figure starts its way out when Jef is outside (null: from where it is). */
  private nearDoor(f: Fig): { x: number; z: number } | null {
    if (!this.inWorldHere || this.jefIn || !EVENT_ROLES.has(f.p.role)) return null;
    const b = /^bearer(\d)$/.exec(f.p.role);
    if (b) {
      const n = Number(b[1]);
      return { x: n % 2 ? 0.4 : -0.4, z: 8.4 + (n >= 2 ? 1.3 : 0) };
    }
    const k = this.doorK++;
    return { x: k % 2 ? 0.7 : -0.7, z: 11.6 + Math.floor(k / 2) * 0.9 };
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
          // M7 funeral: the event's parts wear their things inside too (the widow's veil, the bearers' armbands)
          const wr = WEAR_INSIDE[f.p.role];
          if (wr) h.root.add(makeWear(wr, h.scale).root);
        }
      }
      // M6 sermon: a scene holds them (the preacher climbing and in the pulpit)
      if (f.hold) {
        const h = f.human;
        [f.x, f.z, f.y, f.yaw] = [f.hold.x, f.hold.z, f.hold.y, f.hold.yaw];
        f.path = [];
        if (h) {
          h.play(f.hold.motion);
          if (f.hold.motion === "walk") h.setPace(0.6);
          h.root.position.set(f.x, f.y + h.bob(), f.z);
          h.root.rotation.set(0, f.yaw, 0);
          h.update(dt);
        }
        continue;
      }
      // M7 funeral: a town event's people cover the long nave quickly where Jef is not (more than 20 m
      // off), and walk at their own pace near him (the coffin passing him, the couple at the rail)
      const jl = EVENT_ROLES.has(f.p.role) ? this.jefLocal() : null;
      const hurry = jl && Math.hypot(jl.x - f.x, jl.z - f.z) > 20 ? 2.4 : 1;
      const pace = (f.spec.speed ?? WALK) * (f.leaving ? 1.1 : 1) * hurry;
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
      // M7 funeral: the four bearers share one way in and out; they walk it two by two under the coffin
      const bn = walking ? /^bearer(\d)$/.exec(f.p.role) : null;
      if (bn) {
        const n = Number(bn[1]);
        const side = n % 2 ? 0.34 : -0.34;
        const back = n >= 2 ? 1.2 : 0;
        f.ox = Math.cos(f.yaw) * side - Math.sin(f.yaw) * back;
        f.oz = -Math.sin(f.yaw) * side - Math.cos(f.yaw) * back;
      } else f.ox = f.oz = 0;
      h.root.position.set(f.x + (f.ox ?? 0), f.y + (f.seated ? h.sitDrop(f.spec.sit!) : 0) + h.bob(), f.z + (f.oz ?? 0));
      h.root.rotation.y = f.yaw;
      // M7: they turn to look at the one who ran (seated ones turn in the chair)
      if (f.look && f.look > 0) {
        f.look -= dt;
        const j = this.jefLocal();
        if (j && !walking) h.root.rotation.y = f.yaw + Math.atan2(Math.sin(Math.atan2(j.x - f.x, j.z - f.z) - f.yaw), Math.cos(Math.atan2(j.x - f.x, j.z - f.z) - f.yaw)) * (f.seated ? 0.5 : 1);
      }
      // M6 sermon: a nod of agreement from the pious (the whole figure dips a little, twice)
      const nod = this.nods.get(id) ?? 0;
      h.root.rotation.x = nod > 0 ? Math.max(0, Math.sin((1.4 - nod) * 9)) * 0.08 : 0;
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
      this.organ(n.organ && this.hears);
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
    for (const [door, s] of this.inWorldHere ? [] : Object.entries(room.exits)) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < 1.3) options.push([d, { key: "KeyE", text: door === "main" ? "go out into the street" : "go out by the north door", run: () => this.leaveBy(door), self: true }]);
    }
    // M7 halls: Jef's floor in the hall's frame (in the world: his feet, so the storey he is on)
    const iwn = this.iw();
    const py = iwn ? this.player.y - iwn.anchor.y : this.player.rideWalk ? (room.floor?.(x, z) ?? 0) : 0;
    for (const l of room.looks) {
      const d = Math.hypot(l.x - x, l.z - z);
      if (d < l.r && Math.abs((l.y ?? 0) - py) < 2) options.push([d + 0.4, { key: "KeyE", text: l.label, run: () => this.look(l.id, l.text), at: this.pt(l.x, l.z) }]);
    }
    // the one Jef looks at, nearest the crosshair (game/facing.ts)
    const who = pick(this.figs.values(), (f) => {
      if (f.leaving || f.spec.noTalk) return null;
      const d = Math.hypot(f.x - x, f.z - z);
      return d < TALK_R && Math.abs(f.y - py) < 1.5 ? { d, at: this.pt(f.x, f.z, f.y + (f.seated ? 1.0 : 1.3)) } : null;
    });
    if (who) {
      const b = who.it;
      options.push([who.d + 0.1, { key: "KeyE", text: `talk to ${b.p.name}`, run: () => this.talkTo(b), at: who.at }]);
    }
    if (here.id === "cathedral") {
      const st = room.marks.stand;
      if (st && Math.hypot(st.x - x, st.z - z) < 1.8) extra.push({ key: "KeyF", text: `light a candle (${CANDLE_C} c)`, run: () => void this.candle(), at: this.pt(st.x, st.z) });
      const pen = room.marks.penitent;
      if (pen && Math.hypot(pen.x - x, pen.z - z) < 1.4) {
        const at = this.pt(pen.x, pen.z);
        if (this.now?.confession.open) options.push([0.05, { key: "KeyE", text: "kneel at the confessional", run: () => void this.confess(), at }]);
        else options.push([0.3, { key: "KeyE", text: "look at the confessional", run: () => this.say("The curate's confessional. The little door is shut; nobody is inside now. He hears confession in the morning and the afternoon, when there is no mass."), at }]);
      }
    }
    return { options, extra };
  }

  /** A point of the hall (its frame; y over its ground floor when given) in the world, for looking at it (game/facing.ts). */
  private pt(x: number, z: number, y?: number): Target {
    const iwn = this.iw();
    if (iwn) {
      const [wx, wz] = iwn.world(x, z);
      return y === undefined ? { x: wx, z: wz } : { x: wx, y: iwn.anchor.y + y, z: wz };
    }
    const room = this.here?.room;
    if (room) {
      const p = room.toWorld(x, z, y ?? 0);
      return y === undefined ? { x: p.x, z: p.z } : { x: p.x, y: p.y, z: p.z };
    }
    return { x, z };
  }

  /** The cathedral's shut west door (world), for looking at it. */
  private cathDoor(): Target {
    const [x, z] = PLAN.toWorld(0, PLAN.DOORWAY.z0);
    return { x, z };
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
    const w = this.jefLocal();
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
    if (!s || this.here?.id !== "cathedral" || !this.now?.service || this.now.service.kind === "wedding" || this.now.service.kind === "funeral") return;
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
    if (!room || !pen || (!w && !this.inWorldHere)) return;
    try {
      const b = await landmarksApi.begin();
      // kneel at the grille, facing it
      if (this.inWorldHere) this.rideInWorld(pen.x, pen.z, 0.98);
      else if (w) {
        w.x = pen.x;
        w.z = pen.z;
        this.player.rideSeat = { x: pen.x, y: 0, z: pen.z, eye: 0.98 };
      }
      const f = room.toWorld(pen.x + Math.sin(pen.yaw), pen.z + Math.cos(pen.yaw));
      const p = room.toWorld(pen.x, pen.z);
      this.player.yaw = Math.atan2(-(f.x - p.x), -(f.z - p.z));
      this.player.pitch = 0.05;
      this.panel.open(b.line, () => {
        if (this.inWorldHere) this.standInWorld();
        else this.player.rideSeat = null;
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
    this.updateCathedral(dt);
    const here = this.here;
    if (!here) return;
    if (!this.inWorldHere && (!this.interiors.inside || this.interiors.placeId !== `landmark:${here.id}`)) {
      // taken out some other way (the night): forget it
      this.gone();
      void landmarksApi.here(null).catch(() => {});
      return;
    }
    if (!this.jobs.talk.isOpen) this.talking = null;
    here.room.animate?.(this.t, dt);
    this.updatePeople(dt);
    this.updateHushBubble(dt);
    if (here.id === "cathedral") this.updateSermon(dt);
    if (here.id === "cathedral") this.updateFuneral(dt);
    // the altar bell at the elevation, once a mass (M6: not while the sermon is preached)
    if (here.id === "cathedral" && this.now?.service && this.now.service.kind !== "vespers" && !this.preaching) {
      const key = `${this.serviceKey}`;
      if (this.phase() > 0.5 && this.bellRung !== key) {
        this.bellRung = key;
        if (this.hears) {
          this.altarBell();
          this.sayOnce("The small bell rings at the altar. Heads bow along the rows.");
        }
      }
    }
    // the theatre upstairs: the society's lines while Jef is up there
    if (here.id === "vleeshuis" && this.now?.theatre && this.jefLevel() === 1) {
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
          // M7: the cathedral in the world: its door follows the server; at closing time Jef is shown out
          // (M7 halls: the halls' doors alike)
          const iwn = this.iw();
          if (iwn) {
            iwn.doorOpen = n.open || !!n.wedding;
            const first = this.firstSync;
            this.firstSync = false;
            const wasService = !!this.now?.service;
            this.now = n;
            if (!iwn.doorOpen && this.jefIn) this.putOut(CLOSING[id]);
            this.sync(n, first);
            this.applyNow(n);
            if (this.jefIn && !wasService && !first && n.service && n.service.kind !== "wedding" && n.service.kind !== "funeral") this.sayOnce(n.service.kind === "high" ? "The bell for high mass. The priest comes out of the sacristy; the organ begins." : "A little bell from the sacristy: mass is beginning.");
            return;
          }
          if (!n.open && !n.people.length) {
            this.say(id === "cathedral" ? "The sexton rattles his keys: the church is closing. You go out." : id === "townhall" ? "The porter calls out: the offices are closing. You go out." : "They are locking up. You go out.");
            this.leaveBy("main");
            return;
          }
          const wasService = !!this.now?.service;
          this.now = n;
          this.sync(n, false);
          this.applyNow(n);
          if (id === "cathedral" && !wasService && n.service && n.service.kind !== "wedding" && n.service.kind !== "funeral") this.sayOnce(n.service.kind === "high" ? "The bell for high mass. The priest comes out of the sacristy; the organ begins." : "A little bell from the sacristy: mass is beginning.");
        })
        .catch(() => {});
    }
  }

  // ------------------------------------------------------------------ M7: the cathedral in the world

  /** The hall's words and sounds reach Jef: always in an instanced hall; in the world's cathedral, in the nave. */
  private get hears(): boolean {
    return !this.inWorldHere || this.jefIn;
  }

  /** Where Jef stands in the hall's frame (the world's cathedral or hall, or the room walked in). */
  private jefLocal(): { x: number; z: number } | null {
    const iwn = this.iw();
    if (iwn) {
      const [x, z] = iwn.local(this.player.x, this.player.z);
      return { x, z };
    }
    const w = this.player.rideWalk;
    return w ? { x: w.x, z: w.z } : null;
  }

  /** M7 halls: the storey Jef is on (0 the ground floor, -1 on a stair). */
  private jefLevel(): number {
    const iwn = this.iw();
    if (iwn) return iwn.levelAt(...iwn.local(this.player.x, this.player.z), this.player.y - iwn.anchor.y);
    return this.here?.room.levels?.level ?? 0;
  }

  /** Each frame: the leaves and the glass; the hall's life starts when Jef comes near and stops when he goes. */
  private updateCathedral(dt: number): void {
    const cath = this.cath;
    if (!cath) return;
    // the west door: the doors' list says open or shut until the hall's own word comes (a wedding keeps it open)
    const west = this.doors.find((d) => d.id === "cathedral_west");
    if (west && !(this.inWorldHere && !this.hall && this.now)) cath.doorOpen = west.open;
    const { day, sky } = this.daylight();
    cath.update(this.t, dt, day, sky, this.inWorldHere && !this.hall);
    // M7 halls: their leaves, lights and glass; their doors from the list until the hall's own word comes
    for (const h of this.halls) {
      const d = this.doors.find((q) => q.landmark === h.id);
      if (d && !(this.hall === h && this.now)) h.doorOpen = d.open;
      h.update(this.t, dt, day, sky);
    }
    // whose life runs: the building Jef is in, else the nearest near him (the cathedral within 200 m of its
    // west door, a hall within 150 m of a door); another must be nearer by 15 m to take over (no flicker)
    const px = this.player.x;
    const pz = this.player.z;
    const cathD = () => (cath.near(px, pz) ? Math.hypot(px - PLAN.ORIGIN.x, pz - (PLAN.ORIGIN.z + PLAN.SHELL.door.z)) : null);
    let want: LandmarkId | null = this.jefIn && this.here ? this.here.id : null;
    if (!want && !this.interiors.inside) {
      let best = Infinity;
      const dc0 = cathD();
      if (dc0 !== null) [want, best] = ["cathedral", dc0];
      for (const h of this.halls) {
        const d = h.near(px, pz);
        if (d !== null && d < best) [want, best] = [h.id, d];
      }
      const cur = this.inWorldHere ? (this.here?.id ?? null) : null;
      if (cur && want && cur !== want) {
        const dc = cur === "cathedral" ? cathD() : (this.halls.find((h) => h.id === cur)?.near(px, pz) ?? null);
        if (dc !== null && dc < best + 15) want = cur;
      }
    }
    if (this.inWorldHere && this.here?.id !== want) this.depart();
    if (want && !this.here) this.arrive(want);
    if (!this.inWorldHere) return;
    // in or out (a little either way so it never flickers at the threshold)
    const iwn = this.iw();
    if (!iwn) return;
    const k = iwn.insideness(px, pz);
    const inNow = this.jefIn ? k > 0.35 : k > 0.55;
    if (inNow !== this.jefIn) this.crossed(inNow);
    if (this.here?.id === "cathedral") this.updateHush(dt, k);
  }

  private arrive(id: LandmarkId = "cathedral"): void {
    const door = id === "cathedral" ? this.doors.find((d) => d.id === "cathedral_west") : this.doors.find((d) => d.landmark === id && d.entry === "main");
    const hall = id === "cathedral" ? null : (this.halls.find((h) => h.id === id) ?? null);
    const room = id === "cathedral" ? this.cath?.room : hall?.room;
    if (!door || !room) return; // the doors are not in yet: next frame
    this.clear();
    this.here = { id, room, door };
    this.hall = hall;
    this.inWorldHere = true;
    this.now = null;
    this.firstSync = true;
    this.syncT = 0;
  }

  private depart(): void {
    if (this.jefIn) this.crossed(false);
    this.gone();
    this.inWorldHere = false;
    this.hall = null;
  }

  /** Jef went into the nave or out onto the square (M7 halls: into a hall or out into the street). */
  private crossed(inNow: boolean): void {
    this.jefIn = inNow;
    const id = this.here?.id ?? null;
    void landmarksApi.here(inNow ? id : null).catch(() => {});
    this.roomSound(inNow ? (this.here?.room.sound ?? "church") : null);
    this.organ(inNow && id === "cathedral" && !!this.now?.organ);
    if (!inNow) {
      this.caption.classList.remove("on");
      return;
    }
    const n = this.now;
    if (n?.barred) return this.putOut('The beadle stands in the doorway, his staff across it. "Not today, young man. You had your chance."');
    if (n && this.t - this.welcomedAt > 90) {
      this.welcomedAt = this.t;
      this.say(this.welcome(n));
    }
  }

  /** Out onto the square before the west door (the church closing, the beadle), facing the square (M7 halls: before a hall's main door). */
  private putOut(text: string): void {
    if (text) this.say(text);
    this.panel.close(true);
    if (this.player.riding) this.standInWorld();
    const [cx, cz] = PLAN.toWorld(1.2, -1.2);
    const o = this.iw()?.outside ?? { x: cx, z: cz, yaw: 0 };
    this.player.place(o.x, o.z, o.yaw, 0);
    if (this.jefIn) this.crossed(false);
  }

  /** Carried in the hall's frame (a chair, the kneeler): its origin and turn (M7 halls: the town hall's is turned half round), its floor. */
  private rideInWorld(x: number, z: number, eye: number): void {
    const room = this.here!.room;
    const iwn = this.iw()!;
    // the floor at the seat on Jef's own storey (M7 halls: a chair upstairs)
    const y = iwn.floorAt(x, z, this.player.y - iwn.anchor.y);
    const anchor = { ...iwn.anchor, speed: 0 };
    const walk: RideWalk = { x, z, walk: room.walk, floor: () => y, pace: room.pace, eye: room.eye, surface: "stone" };
    this.player.rideStart(() => anchor, undefined, walk);
    this.player.rideSeat = { x, y, z, eye };
  }

  /** A free chair for Jef close by (the row ends); M7 halls: on his storey. */
  private freeSeatNear(x: number, z: number): { s: Seat; d: number } | null {
    const iwn = this.iw();
    const feet = iwn ? this.player.y - iwn.anchor.y : 0;
    // the free seat Jef looks at (game/facing.ts)
    const r = pick(this.here?.room.seats ?? [], (s) => {
      const d = Math.hypot(s.x - x, s.z - z);
      if (iwn && this.hall && Math.abs(iwn.floorAt(s.x, s.z, feet) - feet) > 0.4) return null;
      return d < 0.9 && !this.seatHeld(s) ? { d, at: this.pt(s.x, s.z, s.h) } : null;
    });
    return r ? { s: r.it, d: r.d } : null;
  }

  private sitInWorld(s: Seat): void {
    this.rideInWorld(s.x, s.z, s.h + 0.72);
    this.jefSeat = s;
    // facing the way the seat faces, in the world (the frame's own turn added)
    const fy = this.iw()?.anchor.yaw ?? 0;
    this.player.yaw = Math.atan2(-Math.sin(s.yaw + fy), -Math.cos(s.yaw + fy));
    this.player.pitch = 0.05;
    this.onSeat(s);
  }

  /** Up from the chair into the walk, or up from the kneeler. */
  private standInWorld(): void {
    const s = this.jefSeat;
    this.jefSeat = null;
    if (!this.player.riding) return;
    const w = this.player.rideWalk;
    const iwn = this.iw();
    if (iwn && this.hall) {
      // M7 halls: up beside the seat on its storey: in front of it, else to a side, else behind
      const sx = s?.x ?? w?.x ?? 0;
      const sz = s?.z ?? w?.z ?? 0;
      const fy = this.player.y - iwn.anchor.y;
      const yaw0 = s?.yaw ?? 0;
      let at: [number, number] = [sx, sz];
      for (const [f, side] of [[0.75, 0], [0, 0.75], [0, -0.75], [-0.75, 0], [0.75, 0.75], [0.75, -0.75]]) {
        const cx = sx + Math.sin(yaw0) * f + Math.cos(yaw0) * side;
        const cz = sz + Math.cos(yaw0) * f - Math.sin(yaw0) * side;
        if (iwn.free(cx, cz, fy)) {
          at = [cx, cz];
          break;
        }
      }
      const [x, z] = iwn.world(...at);
      const floor = iwn.floorAt(at[0], at[1], fy);
      const yaw = this.player.yaw;
      this.player.rideEnd(x, z);
      this.player.y = iwn.anchor.y + floor;
      this.player.yaw = yaw;
      if (s) this.onSeat(null);
      return;
    }
    let lx = w?.x ?? 0;
    let lz = w?.z ?? PLAN.W0 + 2;
    if (s) lx = Math.sign(s.x) * 0.6;
    else lx -= 0.8; // back from the confessional's grille
    const [x, z] = PLAN.toWorld(lx, lz);
    const yaw = this.player.yaw;
    this.player.rideEnd(x, z);
    this.player.yaw = yaw;
    if (s) this.onSeat(null);
  }

  /**
   * Running in the nave with people near: the engine decides (server/src/landmarks/hush.ts); here
   * the hiss over the beadle or a churchgoer, the heads turning, and the beadle walking Jef out.
   */
  private updateHush(dt: number, k: number): void {
    const p = { x: this.player.x, z: this.player.z };
    const last = this.lastPos;
    this.lastPos = p;
    if (!last || k < 0.6 || this.player.riding || !this.here || !this.cath || this.here.id !== "cathedral") {
      this.runT = 0;
      return;
    }
    const v = Math.hypot(p.x - last.x, p.z - last.z) / Math.max(dt, 1e-3);
    this.runT = v > 2.5 && v < 12 ? this.runT + dt : Math.max(0, this.runT - dt * 2);
    if (this.runT < 0.5 || this.hushBusy || this.t - this.hushAt < 6) return;
    const [jx, jz] = this.cath.local(p.x, p.z);
    const R = this.now?.service ? 22 : 14;
    const near = [...this.figs.values()].filter((f) => !f.leaving && f.y < 2 && Math.hypot(f.x - jx, f.z - jz) < R).sort((a, b) => Math.hypot(a.x - jx, a.z - jz) - Math.hypot(b.x - jx, b.z - jz));
    if (!near.length) return;
    this.hushAt = this.t;
    this.hushBusy = true;
    landmarksApi
      .ran(near.length)
      .then((r) => {
        this.jobs.refresh(r as JobsPayload);
        this.hushed(r, near, jx, jz);
      })
      .catch(() => {})
      .finally(() => (this.hushBusy = false));
  }

  private hushed(r: HushResult, near: Fig[], jx: number, jz: number): void {
    if (!r.counted || !this.inWorldHere) return;
    // heads turn along the rows
    for (const f of this.figs.values()) if (!f.leaving && Math.hypot(f.x - jx, f.z - jz) < 16) f.look = 3.5;
    const beadle = [...this.figs.values()].find((f) => /^beadle/.test(f.p.role) && !f.leaving && Math.hypot(f.x - jx, f.z - jz) < 30);
    const who = r.speaker === "beadle" && beadle ? beadle : (near.find((f) => this.figs.has(f.p.id)) ?? beadle);
    if (who) {
      this.hushBubble?.el.remove();
      const el = document.createElement("div");
      el.className = "bubble hush";
      el.innerHTML = `<b>${esc(who.p.name)}${/^beadle/.test(who.p.role) ? ", the beadle" : ""}</b>${esc(r.line)}`;
      document.body.appendChild(el);
      this.hushBubble = { el, who: who.p.id, t: 4.5 };
      const at = this.here!.room.toWorld(who.x, who.z);
      this.speak({ x: at.x, z: at.z }, { sex: who.p.sex, age: who.p.age }, 1.8);
      who.look = 4.5;
    }
    if (r.text) this.say(r.text);
    if (r.leave) {
      // the beadle comes down the nave to him, then walks him out; nobody fights
      if (beadle) {
        beadle.loop = null;
        beadle.path = this.here!.room.path([beadle.x, beadle.z], [jx - 0.6, jz]);
      }
      setTimeout(() => {
        if (this.inWorldHere && this.jefIn) this.putOut("");
      }, 2600);
    }
  }

  private updateHushBubble(dt: number): void {
    const b = this.hushBubble;
    if (!b) return;
    b.t -= dt;
    const f = this.figs.get(b.who);
    const room = this.here?.room;
    if (b.t <= 0 || !f || !room) {
      b.el.remove();
      this.hushBubble = null;
      return;
    }
    const cam = this.player.camera;
    cam.updateMatrixWorld();
    const v = room.toWorld(f.x, f.z, f.y + (f.seated ? 1.35 : 1.85)).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return void b.el.classList.remove("on");
    b.el.style.left = `${(((v.x + 1) / 2) * window.innerWidth).toFixed(0)}px`;
    b.el.style.top = `${(((1 - v.y) / 2) * window.innerHeight).toFixed(0)}px`;
    b.el.classList.add("on");
  }

  /** Dev: the hiss on screen (for scripted checks: the bubble's text is read from the page). */
  get hushInfo() {
    return { runT: +this.runT.toFixed(2), bubble: this.hushBubble ? this.hushBubble.el.textContent : null, shown: !!this.hushBubble?.el.classList.contains("on"), jefIn: this.jefIn, k: this.cath ? +this.cath.insideness(this.player.x, this.player.z).toFixed(2) : 0 };
  }

  // ------------------------------------------------------------------ the Sunday sermon (M6)

  /** Is the preacher on the stair or in the pulpit now? */
  private get preaching(): boolean {
    return this.sermon?.stage === "climb" || this.sermon?.stage === "preach";
  }

  /**
   * At Sunday high mass: fetch the sermon (the server's words, server/src/ballads/sermon.ts); a
   * little into the mass the preacher climbs the pulpit and says it line by line (a caption and
   * the murmur of his voice); the pious nod, a gossip whispers to her neighbour; at the end the
   * server hears that Jef was there (the kerk's trust, the engine's rule), and he climbs down.
   */
  private updateSermon(dt: number): void {
    for (const [id, t] of this.nods) {
      if (t - dt <= 0) this.nods.delete(id);
      else this.nods.set(id, t - dt);
    }
    this.updateWhisper(dt);
    const n = this.now;
    const room = this.here?.room;
    const high = !!n?.service && n.service.kind === "high";
    // once begun, the sermon is preached to its end even if the mass's hour runs out (a game hour is two real minutes)
    const going = !!this.sermon && (this.sermon.stage === "climb" || this.sermon.stage === "preach" || this.sermon.stage === "down");
    if (!n || !room || (!high && !going)) {
      if (this.sermon && this.sermon.stage !== "done" && this.sermon.stage !== "wait") this.endSermon();
      return;
    }
    const key = `${n.day}`;
    if (!going && (!this.sermon || this.sermon.key !== key)) this.sermon = { key, view: null, loading: false, stage: "wait", i: -1, t: 0, fig: null, from: { x: 0, z: 0 } };
    const s = this.sermon;
    if (!s) return;
    if (!s.view && !s.loading) {
      s.loading = true;
      landmarksApi
        .sermon()
        .then((v) => {
          if (this.sermon === s) s.view = v;
        })
        .catch(() => {})
        .finally(() => {
          // again in a while if it failed
          setTimeout(() => {
            if (this.sermon === s) s.loading = false;
          }, 8000);
        });
    }
    const pulpit = room.marks.pulpit;
    const foot = room.marks.pulpitFoot ?? pulpit;
    const fig = s.fig ? this.figs.get(s.fig) : null;
    switch (s.stage) {
      case "wait": {
        if (!s.view || this.phase() < 0.06 || !pulpit) return;
        const f = [...this.figs.values()].find((q) => q.p.role === "preacher" && !q.leaving) ?? [...this.figs.values()].find((q) => q.p.role === "celebrant" && !q.leaving);
        if (!f) return;
        s.fig = f.p.id;
        s.from = { x: f.x, z: f.z };
        s.stage = "climb";
        s.t = 0;
        if (this.hears) this.sayOnce(`${f.p.first}, ${f.p.title ?? "the priest"}, climbs the pulpit. The chairs creak as the rows turn toward him.`);
        return;
      }
      case "climb": {
        if (!fig || !pulpit) return this.endSermon();
        s.t += dt;
        // to the foot of the stair, then round the pier and up into the tub
        const k1 = Math.min(1, s.t / 2);
        const k2 = Math.max(0, Math.min(1, (s.t - 2) / 3));
        const x = k2 > 0 ? foot.x + (pulpit.x - foot.x) * k2 : s.from.x + (foot.x - s.from.x) * k1;
        const z = k2 > 0 ? foot.z + (pulpit.z - foot.z) * k2 : s.from.z + (foot.z - s.from.z) * k1;
        fig.hold = { x, z, y: PULPIT_UP * k2, yaw: k2 > 0 ? Math.PI * (0.5 + (1 - k2) * 1.5) : Math.atan2(foot.x - s.from.x, foot.z - s.from.z), motion: "walk" };
        if (k2 >= 1) {
          s.stage = "preach";
          s.i = -1;
          s.t = 1.2;
          fig.hold = { x: pulpit.x, z: pulpit.z, y: PULPIT_UP, yaw: pulpit.yaw, motion: "idle" };
        }
        return;
      }
      case "preach": {
        if (!fig || !s.view || !pulpit) return this.endSermon();
        s.t -= dt;
        if (s.t > 0) return;
        s.i++;
        const lines = s.view.lines;
        if (s.i >= lines.length) {
          this.caption.classList.remove("on");
          s.stage = "down";
          s.t = 0;
          if (this.hears) this.heard();
          return;
        }
        const text = lines[s.i];
        // six to ten lines fit easily in high mass (two game hours are four real minutes since M7)
        s.t = Math.max(3, Math.min(4.6, 2.2 + text.length / 55));
        this.caption.innerHTML = `<b>${esc(fig.p.first)}, from the pulpit</b>${esc(text)}`;
        this.caption.classList.toggle("on", this.hears);
        fig.hold = { x: pulpit.x, z: pulpit.z, y: PULPIT_UP, yaw: pulpit.yaw + (s.i % 2 ? 0.35 : -0.35), motion: "talk" };
        const at = room.toWorld(pulpit.x, pulpit.z);
        if (this.hears) this.speak({ x: at.x, z: at.z }, { sex: fig.p.sex, age: fig.p.age }, Math.min(s.t - 0.4, 5));
        // the pious nod along; halfway through, the gossip whispers
        const present = s.view.nodders.filter((id) => this.figs.has(id));
        for (let k = 0; k < 2 && present.length; k++) this.nods.set(present[(s.i * 3 + k * 5) % present.length], 1.4);
        if (s.i === Math.floor(lines.length / 2) && s.view.gossip && this.figs.has(s.view.gossip.id)) this.startWhisper(s.view.gossip);
        return;
      }
      case "down": {
        if (!fig || !pulpit) return this.endSermon();
        s.t += dt;
        const k = Math.min(1, s.t / 3);
        const back = room.marks.preacherWait ?? s.from;
        fig.hold = { x: pulpit.x + (back.x - pulpit.x) * k, z: pulpit.z + (back.z - pulpit.z) * k, y: PULPIT_UP * (1 - k), yaw: Math.PI * (1.5 - k * 0.5), motion: "walk" };
        if (k >= 1) this.endSermon();
        return;
      }
    }
  }

  private endSermon(): void {
    const s = this.sermon;
    if (!s) return;
    const f = s.fig ? this.figs.get(s.fig) : null;
    if (f) {
      f.hold = null;
      f.y = 0;
      this.place(f, true);
    }
    s.stage = "done";
    this.caption.classList.remove("on");
  }

  /** The sermon is over with Jef in the nave: the server applies the kerk's trust (once a Sunday). */
  private heard(): void {
    landmarksApi
      .heard()
      .then((r) => {
        this.jobs.refresh(r as JobsPayload);
        if (r.text) this.say(r.text);
      })
      .catch(() => {});
  }

  private startWhisper(g: NonNullable<SermonView["gossip"]>): void {
    this.whisper?.el.remove();
    const el = document.createElement("div");
    el.className = "bubble whisper";
    el.innerHTML = `<b>${esc(g.name)}, in a whisper</b>${esc(g.text)}`;
    document.body.appendChild(el);
    this.whisper = { el, who: g.id, t: 4.5 };
    const f = this.figs.get(g.id);
    const room = this.here?.room;
    if (f && room) {
      const at = room.toWorld(f.x, f.z);
      this.speak({ x: at.x, z: at.z }, { sex: f.p.sex, age: f.p.age }, 1.6);
      // the one she whispers to leans in
      if (g.to) this.nods.set(g.to, 1.4);
    }
  }

  private updateWhisper(dt: number): void {
    const w = this.whisper;
    if (!w) return;
    w.t -= dt;
    const f = this.figs.get(w.who);
    const room = this.here?.room;
    if (w.t <= 0 || !f || !room) {
      w.el.remove();
      this.whisper = null;
      return;
    }
    const cam = this.player.camera;
    cam.updateMatrixWorld();
    const v = room.toWorld(f.x, f.z, f.y + (f.seated ? 1.35 : 1.8)).project(cam);
    if (!this.hears || v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return void w.el.classList.remove("on");
    w.el.style.left = `${(((v.x + 1) / 2) * window.innerWidth).toFixed(0)}px`;
    w.el.style.top = `${(((1 - v.y) / 2) * window.innerHeight).toFixed(0)}px`;
    w.el.classList.add("on");
  }

  /** Dev: the sermon's state. */
  get sermonInfo() {
    const s = this.sermon;
    return s
      ? {
          stage: s.stage,
          line: s.i,
          of: s.view?.lines.length ?? 0,
          source: s.view?.source ?? null,
          preacher: s.fig,
          hint: s.view?.hint ?? null,
          caption: this.caption.classList.contains("on") ? this.caption.textContent : null,
          whisper: this.whisper ? this.whisper.el.textContent : null,
          nods: [...this.nods.keys()],
        }
      : null;
  }

  private sayOnce(t: string): void {
    if (this.t - this.sayT < 4) return;
    this.sayT = this.t;
    this.say(t);
  }

  // ------------------------------------------------------------------ M7 funeral: the requiem

  /**
   * A town funeral in the cathedral (the server's word, now.funeral): the bier before the choir, the
   * coffin carried in on the bearers' shoulders and set on it, carried out again; the priest's voice
   * and the mourners' answer as a murmur, and a line or two for Jef in the nave.
   */
  private updateFuneral(dt: number): void {
    const room = this.here?.room;
    const fu = this.now?.funeral ?? null;
    if (!room || !fu) {
      this.dropBier();
      return;
    }
    this.funeralPlaces(room);
    if (!this.bier) {
      this.bier = makeBier();
      this.bier.group.position.set(0, room.peopleFloor?.(0, BIER_Z) ?? 0, BIER_Z);
      room.group.add(this.bier.group);
      this.fcoffin = makeCoffin();
      room.group.add(this.fcoffin);
      // Jef walks round it (the world's cathedral: a collider in the street's frame)
      if (this.inWorldHere && this.world) {
        const [x0, z0] = PLAN.toWorld(-0.8, BIER_Z - 1.45);
        const [x1, z1] = PLAN.toWorld(0.8, BIER_Z + 1.45);
        this.bierRect = { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
        this.world.addCollider(this.bierRect);
      }
    }
    this.bier.update(this.t);
    const coffin = this.fcoffin!;
    const floor = room.peopleFloor?.(0, BIER_Z) ?? 0;
    // the bearers inside: carrying it while they walk, else it lies on the bier
    const bearers = [...this.figs.values()].filter((f) => /^bearer\d$/.test(f.p.role) && f.human).sort((a, b) => a.p.role.localeCompare(b.p.role));
    const walking = bearers.some((f) => f.path.length > 0 || f.leaving);
    const px = (f: Fig) => f.x + (f.ox ?? 0);
    const pz = (f: Fig) => f.z + (f.oz ?? 0);
    if (walking && bearers.length >= 2) {
      const cx = bearers.reduce((a, f) => a + px(f), 0) / bearers.length;
      const cz = bearers.reduce((a, f) => a + pz(f), 0) / bearers.length;
      const front = bearers.slice(0, 2);
      const back = bearers.slice(2);
      const fx = front.reduce((a, f) => a + px(f), 0) / front.length;
      const fz = front.reduce((a, f) => a + pz(f), 0) / front.length;
      const bx = back.length ? back.reduce((a, f) => a + px(f), 0) / back.length : cx;
      const bz = back.length ? back.reduce((a, f) => a + pz(f), 0) / back.length : cz;
      const yaw = Math.hypot(fx - bx, fz - bz) > 0.4 ? Math.atan2(fx - bx, fz - bz) : bearers[0].yaw;
      const s = bearers[0].human!.scale || 1;
      coffin.visible = bearers.every((f) => Math.hypot(px(f) - cx, pz(f) - cz) < 3);
      coffin.position.set(cx, (room.peopleFloor?.(cx, cz) ?? 0) + 1.5 * s, cz);
      coffin.rotation.set(0, yaw, 0);
    } else if (walking) {
      // one bearer in so far: the coffin is still at the door with the others
      coffin.visible = false;
    } else {
      // on the bier: once the bearers have set it down (or, come upon late, the requiem well begun), and while they stand by it going out
      coffin.visible = bearers.length > 0 || (fu.part === "in" && this.phase() > 0.25);
      coffin.position.set(0, floor + BIER_TOP + 0.18, BIER_Z);
      coffin.rotation.set(0, 0, 0);
    }
    // in the nave: the priest's voice and the answer, and where the requiem has got to
    if (!this.jefIn || fu.part !== "in") return;
    const ph = this.phase();
    const key = `${fu.event}:${ph >= 0.75 ? 2 : ph >= 0.3 ? 1 : 0}`;
    if (key !== this.requiemTold && ph >= 0.3) {
      this.requiemTold = key;
      this.sayOnce(ph >= 0.75 ? "The absolution: the priest goes round the coffin with the holy water and the incense. The organ, low." : "The priest sings the requiem at the coffin's head; the mourners answer him, low.");
    }
    this.requiemT -= dt;
    if (this.requiemT > 0) return;
    const priest = [...this.figs.values()].find((f) => f.p.role === "requiem_priest" && !f.path.length);
    const mourners = [...this.figs.values()].filter((f) => (f.p.role === "mourner" || f.p.role === "widow") && !f.path.length);
    const answer = mourners.length && Math.random() < 0.35;
    const who = answer ? mourners[Math.floor(Math.random() * mourners.length)] : priest;
    this.requiemT = answer ? 3 + Math.random() * 2 : 5 + Math.random() * 3;
    if (!who) return;
    const at = room.toWorld(who.x, who.z);
    this.speak({ x: at.x, z: at.z }, { sex: who.p.sex, age: who.p.age }, answer ? 1.4 : 2.6);
  }

  /** The requiem's marks and the mourners' rows behind the bier (their order kept: the front rows are the set's end). */
  private funeralPlaces(room: LandmarkRoom): void {
    Object.assign(room.marks, FUNERAL_MARKS);
    if (!room.sets.funeralChairs) room.sets.funeralChairs = (room.sets.chairs ?? []).filter((c) => c.z < BIER_Z - 1.6 && Math.abs(c.x) > 1);
  }

  /** The bier and the coffin away (the funeral has gone, or Jef has). */
  private dropBier(): void {
    this.bier?.dispose();
    this.bier = null;
    this.fcoffin?.removeFromParent();
    this.fcoffin = null;
    if (this.bierRect && this.world) this.world.removeCollider(this.bierRect);
    this.bierRect = null;
  }

  // ------------------------------------------------------------------ dev

  /** Dev: go straight in by a door ("cathedral_west", or a landmark id). */
  async devEnter(id: string): Promise<string> {
    if (this.interiors.inside) this.interiors.leave(true);
    // M7: the cathedral is in the world: stand in its nave, looking at the altar
    if ((id === "cathedral" || id === "cathedral_west") && this.cath) {
      const [x, z] = PLAN.toWorld(0, PLAN.W0 + 6);
      this.player.place(x, z, Math.PI, 0.03);
      return "in the nave of the cathedral";
    }
    // M7 halls: the halls are in the world too: stand inside the main door, looking in
    const hw = this.halls.find((h) => h.id === id || h.plan.doors.some((q) => q.id === id));
    if (hw) {
      const p = hallNow(hw).inside;
      this.player.place(p.x, p.z, p.yaw, 0.03);
      return `inside ${LANDMARK_LABEL[hw.id]}`;
    }
    this.gone();
    await this.loadDoors();
    const d = this.doors.find((q) => q.id === id) ?? this.doors.find((q) => q.landmark === id);
    if (!d) return `no such door: ${id}`;
    this.player.rideEnd(d.step[0], d.step[1]);
    const ok = await this.enter(d.id);
    return ok ? `inside ${d.label}` : "not let in";
  }

  /** Dev: walk Jef to a point of the hall (M7 halls: `y`, near the storey's floor there, local). */
  devGo(x: number, z: number, y = 0): void {
    const iwn = this.iw();
    if (iwn) {
      if (this.player.riding) this.standInWorld();
      const [wx, wz] = iwn.world(x, z);
      this.player.place(wx, wz, this.player.yaw, this.player.pitch);
      if (this.hall) this.player.y = iwn.anchor.y + iwn.floorAt(x, z, y);
      return;
    }
    const w = this.player.rideWalk;
    if (!w) return;
    this.player.rideSeat = null;
    w.x = x;
    w.z = z;
  }

  debug() {
    const w = this.jefLocal();
    return {
      inside: this.here?.id ?? null,
      inWorld: this.inWorldHere,
      jefIn: this.jefIn,
      seated: !!this.jefSeat,
      doorOpen: this.iw()?.doorOpen ?? this.cath?.doorOpen ?? null,
      barred: this.now?.barred ?? false,
      jef: w ? [+w.x.toFixed(2), +w.z.toFixed(2), +(this.iw() ? this.player.y - this.iw()!.anchor.y : (this.here?.room.floor?.(w.x, w.z) ?? 0)).toFixed(2)] : null,
      level: this.jefLevel(),
      service: this.now?.service ?? null,
      phase: +this.phase().toFixed(2),
      organ: this.now?.organ ?? false,
      confession: this.now?.confession ?? null,
      wedding: this.now?.wedding ?? null,
      funeral: this.now?.funeral ?? null,
      bier: !!this.bier,
      coffin: this.fcoffin ? { shown: this.fcoffin.visible, at: [+this.fcoffin.position.x.toFixed(1), +this.fcoffin.position.z.toFixed(1), +this.fcoffin.position.y.toFixed(2)] } : null,
      civil: this.now?.civil ?? null,
      theatre: this.now?.theatre ?? null,
      register: this.now?.register ?? [],
      posters: (this.now?.posters ?? []).length,
      people: [...this.figs.values()].map((f) => ({ name: f.p.name, role: f.p.role, kind: f.kind, at: [+f.x.toFixed(1), +f.z.toFixed(1), +f.y.toFixed(2)], walking: f.path.length > 0, seated: f.seated, model: !!f.human })),
      keys: this.interiors.inside || this.inWorldHere ? (this.here ? this.insideKeys(w?.x ?? 0, w?.z ?? 0).options.map(([d, a]) => `${d.toFixed(2)} ${a.key.slice(3)}: ${a.text}`) : []) : [],
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
    if (this.cath && !this.interiors.inside) {
      // M7: the cathedral's frame in the world (y up from the nave's floor); M7 halls: the hall whose life runs
      const room = this.hall?.room ?? this.cath.room;
      cam.position.copy(room.toWorld(from[0], from[2], from[1]));
      cam.lookAt(room.toWorld(to[0], to[2], to[1]));
      cam.updateMatrixWorld();
      return true;
    }
    return this.interiors.devCamera(cam, from, to);
  }

  /** Dev: world point of a hall point (for sound checks). */
  worldOf(x: number, z: number): Pt | null {
    const r = this.here?.room ?? this.hall?.room ?? this.cath?.room;
    if (!r) return null;
    const v = r.toWorld(x, z);
    return [v.x, v.z];
  }
}

// ------------------------------------------------------------------ M7 halls: a building in the world, one shape

/** The cathedral or a hall in the world, as the life here uses it. */
interface InWorldNow {
  id: LandmarkId;
  local(x: number, z: number): [number, number];
  world(x: number, z: number): [number, number];
  insideness(x: number, z: number): number;
  doorOpen: boolean;
  /** The frame's origin and turn, and the ground floor's height (world): the ride frame of a chair. */
  anchor: { x: number; y: number; z: number; yaw: number };
  /** The floor at a hall point for feet at `feet` (local y), the storey (-1 a stair), free for Jef there. */
  floorAt(x: number, z: number, feet: number): number;
  levelAt(x: number, z: number, feet: number): number;
  free(x: number, z: number, feet: number): boolean;
  /** Where Jef stands when he is put out (world) and faces; where the dev puts him in. */
  outside: { x: number; z: number; yaw: number };
  inside: { x: number; z: number; yaw: number };
}

function cathNow(c: CathedralInWorld): InWorldNow {
  const [ox, oz] = PLAN.toWorld(1.2, -1.2);
  const [ix, iz] = PLAN.toWorld(0, PLAN.W0 + 6);
  return {
    id: "cathedral",
    local: (x, z) => c.local(x, z),
    world: (x, z) => c.world(x, z),
    insideness: (x, z) => c.insideness(x, z),
    get doorOpen() {
      return c.doorOpen;
    },
    set doorOpen(v: boolean) {
      c.doorOpen = v;
    },
    anchor: { x: PLAN.ORIGIN.x, y: PLAN.FLOOR_Y, z: PLAN.ORIGIN.z, yaw: 0 },
    floorAt: (x, z) => c.room.floor?.(x, z) ?? 0,
    levelAt: () => 0,
    free: (x, z) => PLAN.freeAt(x, z, 0.3, true),
    outside: { x: ox, z: oz, yaw: 0 },
    inside: { x: ix, z: iz, yaw: Math.PI },
  };
}

const hallCache = new WeakMap<HallInWorld, InWorldNow>();
function hallNow(h: HallInWorld): InWorldNow {
  const had = hallCache.get(h);
  if (had) return had;
  const p = h.plan;
  const d = p.doors[0];
  // put out on the step before the main door, facing the street; let in a few metres past its doorway, facing in
  const [ox, oz] = h.world(d.step.x, d.step.z);
  const [ix, iz] = h.world(d.x, d.inner + d.dir * 2);
  const yawOut = p.yaw + (d.dir > 0 ? 0 : Math.PI);
  const n: InWorldNow = {
    id: h.id,
    local: (x, z) => h.local(x, z),
    world: (x, z) => h.world(x, z),
    insideness: (x, z) => h.insideness(x, z),
    get doorOpen() {
      return h.doorOpen;
    },
    set doorOpen(v: boolean) {
      h.doorOpen = v;
    },
    anchor: { x: p.origin.x, y: p.floorY, z: p.origin.z, yaw: p.yaw },
    floorAt: (x, z, feet) => HP.floorAt(p, x, z, feet),
    levelAt: (x, z, feet) => HP.levelAt(p, x, z, feet),
    free: (x, z, feet) => HP.freeAt(p, x, z, 0.3, true, () => true, feet),
    outside: { x: ox, z: oz, yaw: yawOut },
    inside: { x: ix, z: iz, yaw: yawOut + Math.PI },
  };
  hallCache.set(h, n);
  return n;
}

/** What Jef hears when a building in the world closes with him inside (he is put out on the step). */
const CLOSING: Record<LandmarkId, string> = {
  cathedral: "The sexton rattles his keys: the church is closing. You go out, and the west door shuts behind you.",
  townhall: "The porter calls out: the offices are closing. You go out, and the door shuts behind you.",
  vleeshuis: "The cellar master rattles his keys: they are locking up. You go out, and the door is barred behind you.",
  steen: "The attendant rings his hand bell: the museum is closing. You go out into the courtyard.",
  oostershuis: "The storekeeper swings the gate to: the warehouse is closing. You go out onto the quay.",
};

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

  get isOpen(): boolean {
    return this.openNow;
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
