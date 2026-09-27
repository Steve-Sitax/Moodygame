import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { World, WalkArea } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { addMovingSource, newShipId, ropeMaterial, signal, type ModelSet, type MovingShip } from "../world/boats";
import { box, rod, type Rect } from "../world/geom";
import { addLantern, removeLantern, type LanternSource } from "../world/lanternLights";
import { LampGlow, LandingStage, bl, extra, haloTexture, loadFerrySet } from "../world/landingStage";
import { levelAt } from "../world/tide";
import { makeHuman, whenHumans, type Human, type HumanKind, type Motion } from "./humans";

// M7 ferry arrival (Steve, 2026-09-24: "The start of the game is: we step off a ferry and so enter
// the city. The ferry takes off when we are off."). A new game (server arrival.ts: stage "ferry")
// begins with Jef on the fore deck of the paddle ferry St. Anna from the left bank, lying at the head
// of the Werf landing stage at dawn. The ferryman runs the gangway out onto the stage; the foot
// passengers go ashore one after another down it; the ferryman stands by the gangway port. Jef walks
// down it himself (the deck is railed: the gangway is the only way off). The gangway stays down until
// the last of them (and Jef) has stepped onto the stage (Steve, 2026-09-26: "the bridge only goes up
// when all are off"); then the ferryman hauls it in, the ferry whistles and steams off down river
// into the fog. If he stays aboard, the ferryman tells him twice to get off, and then walks him down
// the plank. A save in progress (stage "ashore", or no key) is untouched; a reload before he stepped
// off plays the opening again.
//
// The ferry is her own model (ferry.glb "ferry", tools/blender/build_ferry.py; no longer boats.glb's
// paddle_tug), with her steaming light, side lights, lanterns and lit saloon windows at night. The
// stage is world/landingStage.ts. The deck is walked through World.addWalkArea (as the cathedral is):
// the fore deck's floor comes from the model itself (rays cast down onto it), the rails and benches
// are walls, the gangway a slope from the port's sill to the stage, the stage's head (past the walk
// map's end at z -58) a landing between the two. Everyone aboard stands on those floors: the
// passengers' feet follow the same floor Jef's do (World.baseAt), so they never walk on air; check()
// plays the opening through and measures every foot against the drawn boards.

/** The stage at the Werf (rijnkaai.ts PONTOON): its centre line, and where its walk map ends. */
const PONTOON_X = -249;
const PONTOON_WALK_END = -58;
/** Where the stage's head ends (build_ferry.py: 60 m from the quay). */
const PONTOON_END = -60;
/** The ferry (ferry.glb "ferry"), bow down river (-x), her port side to the stage's head. */
const FERRY = { x: -244.5, z: -63.25, yaw: -Math.PI / 2 };
/**
 * The gangway's foot rests on the edge of the stage's head (the plank rises to it from the ferry's
 * lower deck: past the edge it would dig into the boards), and its flap lies on the boards this far on.
 */
const LAND_Z = PONTOON_END + 0.02;
const LIP = 0.45;
/** Half the walkable width of the gangway (the body keeps 0.47 m off the sides: the drawn plank is 1 m). */
const GANG_HALF = 0.8;
/** The landing: the stage's head past its walk map, inside its head rail. */
// (a hair past the walk map's end: the pontoon's own rules start only beyond z -58, so no seam at -58)
const STRIP = { minX: PONTOON_X - 1.95, maxX: PONTOON_X + 1.95, minZ: PONTOON_END + 0.25, maxZ: PONTOON_WALK_END + 0.1 };
/** Jef is ashore once this far along the stage; a passenger is off the gangway (clear of its flap) at OFF_Z. */
const ASHORE_Z = LAND_Z + LIP + 0.6;
const OFF_Z = LAND_Z + LIP + 0.25;
/** The deck grid (model frame): cells, and the part forward of the paddle boxes that is walked. */
const CELL = 0.2;
/** Parts of the model a ray from above passes: the rigging, and the hull's lid for the water stencil. */
const SKIP = /rigging|_cap$/;
const GX0 = -3.4;
const GX1 = 3.4;
const GZ0 = 1.0;
const GZ1 = 10.6;
/** The ferryman's words when Jef stays aboard (active seconds), and when he is walked off. */
const NAG: Array<[number, string]> = [
  [35, 'The ferryman: "This is Antwerp. Down the plank with you, we go back across."'],
  [75, 'The ferryman: "Come on, off you get. I have the next crossing to make."'],
];
const WALK_OFF_AT = 115;
/** The gangway goes down in these seconds of the opening (the ferryman runs it out). */
const LOWER = [0.6, 3.4];
/** The gangway's raised angle (hauled in), rad. */
const UP_ANGLE = 1.2;
const HINT = "Step ashore: walk down the gangway onto the landing stage.";
const ASHORE_HINT = "Day work is given out at the Hessenatie's board on the Rijnkaai, along the quay past the Steen.";

type Stage = "waiting" | "moored" | "hauling" | "leaving" | "gone";

/**
 * M8d: whether this player comes in by the ferry (the server's word, asked once at the start): a guest's first
 * time in the game and a new man do. Played together, the guest is not put beside the host while it is so
 * (net/mp/together.ts). Resolves false when the server never answers.
 */
let askedDone: (onFerry: boolean) => void = () => {};
export const ferryAsked: Promise<boolean> = new Promise((ok) => (askedDone = ok));

interface Passenger {
  kind: HumanKind;
  human: Human | null;
  root: THREE.Object3D | null;
  x: number;
  z: number;
  facing: number;
  /** Seconds of the opening before they set off. */
  at: number;
  way: Array<[number, number]>;
  /** Waypoints reached (0: walking to the queue by the port, 1: to the port's sill, 2: down the plank ...). */
  step: number;
  speed: number;
  gone: boolean;
  mover: Rect;
  wait: number;
  /** Seconds left of squeezing past Jef after waiting for him. */
  push: number;
}

export interface FerryDeps {
  world: World;
  player: FirstPerson;
  say: (text: string) => void;
  /** The walk grid on land (crowd.pathOn): the passengers' way on from the quay. */
  path: (ax: number, az: number, bx: number, bz: number) => Array<{ x: number; z: number }> | null;
  /** How dark it is (0 day .. 1 night: main.ts lanternDark): the ferry's and the stage's lamps. */
  dark?: () => number;
  /** The server (the dev test stack or the game), for the stage. */
  fetch?: typeof fetch;
}

/** A foot measured against the drawn boards (check()): who, when, where, and how far off. */
interface FootMiss {
  who: string;
  t: number;
  x: number;
  z: number;
  off: number | null;
  on: string;
}

/**
 * Dev (check()): a mesh's triangles in 0.5 m cells of its own ground plan, so a ray straight down tests a
 * handful of them, not the whole stage (9000). Built once per mesh; the mesh may move (its matrix is read
 * at each ray).
 */
class TriGrid {
  private readonly cells = new Map<number, number[]>();
  private readonly pos: THREE.BufferAttribute;
  private readonly index: THREE.BufferAttribute | null;
  constructor(readonly mesh: THREE.Mesh) {
    const g = mesh.geometry;
    this.pos = g.getAttribute("position") as THREE.BufferAttribute;
    this.index = g.index;
    const n = this.index ? this.index.count / 3 : this.pos.count / 3;
    const a = new THREE.Vector3();
    for (let t = 0; t < n; t++) {
      let x0 = Infinity;
      let x1 = -Infinity;
      let z0 = Infinity;
      let z1 = -Infinity;
      for (let k = 0; k < 3; k++) {
        a.fromBufferAttribute(this.pos, this.vi(t * 3 + k));
        x0 = Math.min(x0, a.x);
        x1 = Math.max(x1, a.x);
        z0 = Math.min(z0, a.z);
        z1 = Math.max(z1, a.z);
      }
      for (let i = Math.floor(x0 / 0.5); i <= Math.floor(x1 / 0.5); i++)
        for (let j = Math.floor(z0 / 0.5); j <= Math.floor(z1 / 0.5); j++) {
          const key = (i + 5000) * 10000 + (j + 5000);
          let c = this.cells.get(key);
          if (!c) this.cells.set(key, (c = []));
          c.push(t);
        }
    }
  }
  private vi(k: number): number {
    return this.index ? this.index.getX(k) : k;
  }
  private readonly inv = new THREE.Matrix4();
  private readonly r = new THREE.Ray();
  private readonly A = new THREE.Vector3();
  private readonly B = new THREE.Vector3();
  private readonly C = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  /** The highest world y hit by a ray down from `from` within `far`, or null. */
  down(from: THREE.Vector3, far: number): number | null {
    this.mesh.updateWorldMatrix(true, false);
    this.inv.copy(this.mesh.matrixWorld).invert();
    this.r.origin.copy(from).applyMatrix4(this.inv);
    this.r.direction.set(0, -1, 0).transformDirection(this.inv);
    const key = (Math.floor(this.r.origin.x / 0.5) + 5000) * 10000 + (Math.floor(this.r.origin.z / 0.5) + 5000);
    const list = this.cells.get(key);
    if (!list) return null;
    let best: number | null = null;
    for (const t of list) {
      this.A.fromBufferAttribute(this.pos, this.vi(t * 3));
      this.B.fromBufferAttribute(this.pos, this.vi(t * 3 + 1));
      this.C.fromBufferAttribute(this.pos, this.vi(t * 3 + 2));
      // the boards' tops face up: both sides would find a board's underside too (FrontSide only)
      if (!this.r.intersectTriangle(this.A, this.B, this.C, true, this.hit)) continue;
      const y = this.hit.applyMatrix4(this.mesh.matrixWorld).y;
      if (from.y - y > far) continue;
      if (best === null || y > best) best = y;
    }
    return best;
  }
}

export class FerryArrival {
  private stage: Stage = "gone";
  private set: ModelSet | null = null;
  /** M8d: his man is made in the character sheet before the ferry comes in (a guest's first time, a new man). */
  private creator = false;
  private creatorOpen = false;
  private creatorShown = false;
  private outer: THREE.Object3D | null = null;
  private inner: THREE.Object3D | null = null;
  /** Seconds the opening has run with the game in hand (not behind the menu). */
  private t = 0;
  private idle = 0;
  private nagged = 0;
  private hinted = false;
  private placed = false;
  private guided: Array<[number, number]> | null = null;
  private stageT = 0;
  private ashoreSent = false;
  /** Jef has stepped off (the plank still waits for the passengers behind him). */
  private jefOff = false;
  /** The deck from the model: floor heights (over the waterline) and walkable cells. */
  private grid: { nx: number; nz: number; floor: Float32Array; walk: Uint8Array } | null = null;
  /** The gangway port (model frame): the hull's side there, the deck, the plank's inboard end. */
  private gang = { lxSide: 2.31, hDeck: 1.35, lx0: 2.0, lz: 4.5 };
  private plankPivot: THREE.Object3D | null = null;
  /** 1 hauled in (or not yet run out), 0 down on the stage. */
  private plankUp = 1;
  private lowered = false;
  private ferryman: { human: Human | null; root: THREE.Object3D; motion: Motion } | null = null;
  private helmsman: { human: Human | null; root: THREE.Object3D } | null = null;
  private passengers: Passenger[] = [];
  private stripOn = false;
  private deckOn = false;
  private areaAdded = false;
  private waterRect: Rect | null = null;
  private ship: MovingShip | null = null;
  private dropSound: (() => void) | null = null;
  private heading = FERRY.yaw;
  private speed = 0;
  private measureMs = 0;
  private readonly areaBox: Rect = { minX: FERRY.x - 11, maxX: FERRY.x + 11, minZ: FERRY.z - 11, maxZ: STRIP.maxZ + 0.05 };
  /** The Werf landing stage (always there: the opening only borrows its head). */
  readonly landing: LandingStage;
  /** `arc`: where a navigation light shows (1863 rules): "side" from ahead to two points abaft the beam on its own side, "mast" all round but astern. */
  private lamps: Array<{ glow: LampGlow; src: LanternSource | null; fl: number; arc?: "side" | "mast"; sx?: number }> = [];
  private windows: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial } | null = null;
  private lines: { obj: THREE.LineSegments; ends: Array<[THREE.Vector3, number]> } | null = null;
  private smoke: { sprites: THREE.Sprite[]; age: number[]; at: THREE.Vector3; next: number } | null = null;
  /** Dev (check()): the feet measured, and the order of things. */
  private feet: { on: boolean; misses: FootMiss[]; samples: number; log: string[]; lastT: number; clock: number } = { on: false, misses: [], samples: 0, log: [], lastT: -1, clock: 0 };

  constructor(private readonly d: FerryDeps) {
    this.landing = new LandingStage(d.world);
    // (the same file as the stage's: loaded for it anyway)
    void loadFerrySet().then((s) => (this.set = s)).catch(() => {});
    void this.ask();
  }

  /** On board (the opening runs)? */
  get active(): boolean {
    return this.stage !== "gone";
  }

  private async ask(): Promise<void> {
    // the page is busy loading the town at first: ask again a few times before giving up
    for (let i = 0; i < 6; i++) {
      try {
        const f = this.d.fetch ?? fetch;
        const r = await f("/api/arrival", { signal: AbortSignal.timeout(15000) });
        if (r.ok) {
          const v = (await r.json()) as { stage?: string; creator?: boolean };
          askedDone(v.stage === "ferry");
          if (v.stage !== "ferry") return;
          this.stage = "waiting";
          this.creator = v.creator === true;
          // keep him still where he is until the ferry is in the water
          this.d.player.frozen = true;
          return;
        }
      } catch {
        /* not yet: again below */
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    // no answer: the game starts as before
    askedDone(false);
  }

  /**
   * M8d: "Your character" before the ferry comes in (a guest's first time, a new man after his end): the sheet
   * saves his look and name on the server; done or put away, the server hears he is made and the deck is set.
   */
  private openCreator(): void {
    this.creatorOpen = true;
    this.creatorShown = false;
    document.exitPointerLock?.();
    const done = () => this.creatorDone();
    void import("../menu/character")
      .then((m) => {
        m.openCharacterCreator(() => done(), { onCancel: done });
        this.creatorShown = true;
      })
      .catch(done);
  }

  /** The sheet is done with (Start, Back, or Esc put it away): the server hears it, the ferry comes in. */
  private creatorDone(): void {
    if (!this.creatorOpen) return;
    this.creator = false;
    this.creatorOpen = false;
    const f = this.d.fetch ?? fetch;
    void f("/api/arrival/made", { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
  }

  // ------------------------------------------------------------------ setting the scene

  private setup(set: ModelSet): void {
    const { world, player } = this.d;
    const proto = set.protos.get("ferry");
    if (!proto) return;
    const outer = new THREE.Group();
    outer.name = "arrival_ferry";
    outer.position.set(FERRY.x, levelAt(FERRY.x, FERRY.z), FERRY.z);
    outer.rotation.y = FERRY.yaw;
    const inner = proto.clone();
    inner.name = "arrival_ferry_hull";
    outer.add(inner);
    world.scene.add(outer);
    this.outer = outer;
    this.inner = inner;
    this.heading = FERRY.yaw;
    this.speed = 0;
    const g = extra<{ y: number; x: number; deck: number }>(set, "ferry", "gangway", { y: -4.5, x: 2.31, deck: 1.35 });
    this.gang = { lxSide: g.x, hDeck: g.deck, lx0: g.x - 0.3, lz: -g.y };
    outer.updateMatrixWorld(true);
    const t0 = performance.now();
    this.measure();
    this.measureMs = performance.now() - t0;
    // the hull: solid for swimmers and rowing boats while she lies here
    this.waterRect = { minX: FERRY.x - 12.5, maxX: FERRY.x + 12.5, minZ: FERRY.z - 3.6, maxZ: FERRY.z + 3.6 };
    world.addWaterSolid(this.waterRect);
    this.plankUp = 1;
    this.lowered = false;
    this.buildPlank();
    this.buildLights(set);
    this.deckOn = true;
    this.stripOn = true;
    if (!this.areaAdded) {
      world.addWalkArea(this.area());
      this.areaAdded = true;
    }
    // Jef on the fore deck, forward of the gangway, looking over the stage at the town
    const [sx, sz] = this.snap(-0.2, 5.6);
    const [jx, jz] = this.toWorld(sx, sz);
    player.place(jx, jz, Math.PI + 0.25, -0.02);
    player.y = this.deckY(sx, sz);
    player.frozen = false;
    this.placed = true;
    this.addPeople();
    this.stage = "moored";
  }

  /** Model frame (x across, z along, bow +z) to world, and back. */
  private toWorld(lx: number, lz: number): [number, number] {
    const o = this.outer!;
    const c = Math.cos(o.rotation.y);
    const s = Math.sin(o.rotation.y);
    return [o.position.x + lx * c + lz * s, o.position.z - lx * s + lz * c];
  }

  private toLocal(x: number, z: number): [number, number] {
    const o = this.outer!;
    const c = Math.cos(o.rotation.y);
    const s = Math.sin(o.rotation.y);
    const dx = x - o.position.x;
    const dz = z - o.position.z;
    return [dx * c - dz * s, dx * s + dz * c];
  }

  /** The fore deck from the model: rays straight down on a 0.2 m grid. */
  private measure(): void {
    const outer = this.outer!;
    const inner = this.inner!;
    const nx = Math.round((GX1 - GX0) / CELL);
    const nz = Math.round((GZ1 - GZ0) / CELL);
    const floor = new Float32Array(nx * nz).fill(NaN);
    const high = new Uint8Array(nx * nz);
    const ray = new THREE.Raycaster();
    ray.far = 30;
    const down = new THREE.Vector3(0, -1, 0);
    const o = new THREE.Vector3();
    const n = new THREE.Vector3();
    const y0 = outer.position.y;
    const hitsAt = (lx: number, lz: number): number[] => {
      const [wx, wz] = this.toWorld(lx, lz);
      o.set(wx, y0 + 15, wz);
      ray.set(o, down);
      const out: number[] = [];
      for (const h of ray.intersectObject(inner, true)) {
        // the rigging is thin lines overhead, the cap only the hull's lid for the water stencil
        if (!h.face || SKIP.test(h.object.name) || h.object.userData.fx) continue;
        n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (n.y < 0.2) continue;
        out.push(h.point.y - y0);
      }
      return out;
    };
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const hs = hitsAt(GX0 + (i + 0.5) * CELL, GZ0 + (j + 0.5) * CELL);
        const deck = hs.filter((h) => h > 1.1); // (her deck is 1.35 m over the water; the wales and fenders lower)
        if (!deck.length) continue;
        const f = Math.min(...deck);
        floor[j * nx + i] = f;
        // anything over the deck lower than a man's head: a bench, a rail, a crate (the bridge is higher)
        if (deck.some((h) => h > f + 0.25 && h < f + 1.9)) high[j * nx + i] = 1;
      }
    // walkable: the lowest floor of its row (not a rail top), nothing over it, off the tall things
    const walk = new Uint8Array(nx * nz);
    for (let j = 0; j < nz; j++) {
      let low = Infinity;
      for (let i = 0; i < nx; i++) if (!Number.isNaN(floor[j * nx + i])) low = Math.min(low, floor[j * nx + i]);
      for (let i = 0; i < nx; i++) {
        const k = j * nx + i;
        if (!Number.isNaN(floor[k]) && !high[k] && floor[k] <= low + 0.12) walk[k] = 1;
      }
    }
    // only the deck he stands on: one piece, flooded from the middle of the fore deck
    const keep = new Uint8Array(nx * nz);
    const i0 = Math.floor((0 - GX0) / CELL);
    let j0 = Math.floor((this.gang.lz - GZ0) / CELL);
    while (j0 < nz - 1 && !walk[j0 * nx + i0]) j0++;
    const stack = [j0 * nx + i0];
    if (walk[stack[0]]) keep[stack[0]] = 1;
    while (stack.length) {
      const k = stack.pop()!;
      if (!walk[k]) continue;
      const i = k % nx;
      const j = (k - i) / nx;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
        const q = b * nx + a;
        if (walk[q] && !keep[q]) {
          keep[q] = 1;
          stack.push(q);
        }
      }
    }
    this.grid = { nx, nz, floor, walk: keep };
    // the deck at the port, as measured (the model's number if the ray found nothing)
    const k = this.cellAt(this.gang.lx0 - 0.3, this.gang.lz);
    if (k >= 0 && !Number.isNaN(floor[k])) this.gang.hDeck = floor[k];
  }

  /** The nearest walkable deck cell to (lx, lz), model frame, with room round it. */
  private snap(lx: number, lz: number): [number, number] {
    const g = this.grid;
    if (!g) return [lx, lz];
    let best: [number, number] = [lx, lz];
    let bd = Infinity;
    for (let j = 0; j < g.nz; j++)
      for (let i = 0; i < g.nx; i++) {
        if (!g.walk[j * g.nx + i]) continue;
        // well inside: every cell within 0.6 m walkable too (the body keeps 0.47 m off any wall)
        let ok = true;
        for (let dj = -3; dj <= 3 && ok; dj++)
          for (let di = -3; di <= 3 && ok; di++) {
            if (di * di + dj * dj > 9.5) continue;
            const a = i + di;
            const b = j + dj;
            ok = a >= 0 && b >= 0 && a < g.nx && b < g.nz && !!g.walk[b * g.nx + a];
          }
        if (!ok) continue;
        const cx = GX0 + (i + 0.5) * CELL;
        const cz = GZ0 + (j + 0.5) * CELL;
        const dd = (cx - lx) ** 2 + (cz - lz) ** 2;
        if (dd < bd) {
          bd = dd;
          best = [cx, cz];
        }
      }
    return best;
  }

  private cellAt(lx: number, lz: number): number {
    const g = this.grid;
    if (!g) return -1;
    const i = Math.floor((lx - GX0) / CELL);
    const j = Math.floor((lz - GZ0) / CELL);
    if (i < 0 || j < 0 || i >= g.nx || j >= g.nz) return -1;
    return j * g.nx + i;
  }

  /** The ferry's waterline now (she floats on the tide; the heave is a few cm). */
  private waterline(): number {
    return (this.outer?.position.y ?? 0) + (this.inner?.position.y ?? 0);
  }

  /** Deck height (world) at a model-frame point. */
  private deckY(lx: number, lz: number): number {
    const k = this.cellAt(lx, lz);
    const f = k >= 0 ? this.grid!.floor[k] : NaN;
    return this.waterline() + (Number.isNaN(f) ? this.gang.hDeck : f);
  }

  /** The stage's deck (world): rijnkaai.ts gives it past the plank's reach. */
  private pontoonY(): number {
    return this.d.world.baseAt(PONTOON_X, PONTOON_WALK_END + 0.5);
  }

  /** Along the gangway (world z): its inboard end on the port's sill, its foot on the stage, the lip's end. */
  private gangwayZ(): { zA: number; zB: number; zC: number } {
    const [, zA] = this.toWorld(this.gang.lx0, this.gang.lz);
    return { zA, zB: LAND_Z, zC: LAND_Z + LIP };
  }

  /** The gangway's top (a 6 cm plank): lying on the deck inside the port at its inboard end, on the stage's edge at its foot. */
  private plankEnds(): { hA: number; hB: number } {
    return { hA: this.waterline() + this.gang.hDeck + 0.06, hB: this.pontoonY() + 0.06 };
  }

  private onGangway(x: number, z: number): boolean {
    if (!this.deckOn || this.plankUp > 0.02) return false;
    const { zA, zC } = this.gangwayZ();
    return Math.abs(x - PONTOON_X) < GANG_HALF && z > zA && z <= zC;
  }

  /** Floor along the gangway: the plank from the sill to the stage, then its lip down to the boards. */
  private gangwayY(z: number): number {
    const { zA, zB, zC } = this.gangwayZ();
    const { hA, hB } = this.plankEnds();
    if (z <= zB) return hA + (hB - hA) * THREE.MathUtils.clamp((z - zA) / Math.max(0.3, zB - zA), 0, 1);
    return hB + (this.pontoonY() + 0.02 - hB) * THREE.MathUtils.clamp((z - zB) / (zC - zB), 0, 1);
  }

  private inStrip(x: number, z: number): boolean {
    return this.stripOn && x > STRIP.minX - 0.6 && x < STRIP.maxX + 0.6 && z > STRIP.minZ - 0.8 && z <= STRIP.maxZ;
  }

  private stripWalk(x: number, z: number): boolean {
    return x > STRIP.minX && x < STRIP.maxX && z > STRIP.minZ && z <= STRIP.maxZ;
  }

  private onDeckZone(x: number, z: number): boolean {
    if (!this.deckOn || !this.outer) return false;
    const [lx, lz] = this.toLocal(x, z);
    return Math.abs(lx) < 3.6 && lz > -12.5 && lz < 12.5;
  }

  private area(): WalkArea {
    return {
      box: this.areaBox,
      wood: true,
      has: (x, z) => this.inStrip(x, z) || this.onGangway(x, z) || this.onDeckZone(x, z),
      walkable: (x, z) => {
        if (this.onGangway(x, z)) return true;
        if (this.inStrip(x, z) && z > PONTOON_END - 0.2) return this.stripWalk(x, z);
        if (!this.onDeckZone(x, z)) return false;
        const [lx, lz] = this.toLocal(x, z);
        const k = this.cellAt(lx, lz);
        return k >= 0 && !!this.grid!.walk[k];
      },
      floor: (x, z) => {
        if (this.onGangway(x, z)) return this.gangwayY(z);
        if (this.inStrip(x, z) && z > PONTOON_END - 0.2) return this.pontoonY();
        const [lx, lz] = this.toLocal(x, z);
        return this.deckY(lx, lz);
      },
      hits: () => false,
    };
  }

  /**
   * The gangway: a stout plank with side stringers and cleats for the feet, stanchions with hand ropes,
   * rollers and a lip at its foot. It turns about its inboard end on the port's sill: up (hauled in, or
   * not yet run out) and down onto the stage.
   */
  private buildPlank(): void {
    const m = this.d.world.mats;
    const outer = this.outer!;
    const g = this.gang;
    // the model frame of its foot on the stage (the stage floats on the same river)
    const [lxLand] = this.toLocal(PONTOON_X, LAND_Z);
    const { hA, hB } = this.plankEnds();
    const y0 = outer.position.y;
    const dx = lxLand - g.lx0;
    const dy = hB - hA;
    const L = Math.hypot(dx, dy);
    // outer's own frame is the model frame (x across, z along): the pivot at the plank's top, inboard end
    const pivot = new THREE.Group();
    pivot.name = "arrival_gangway";
    pivot.position.set(g.lx0, hA - y0, g.lz);
    const plank = new THREE.Group();
    plank.rotation.z = Math.atan2(dy, dx);
    // the board (its top at the pivot's height), the stringers each side, cleats across
    plank.add(box(L, 0.06, 0.96, m.planks, L / 2, -0.03, 0, 1.2));
    for (const s of [-0.5, 0.5]) plank.add(box(L, 0.14, 0.06, m.darkWood, L / 2, -0.02, s, 1));
    for (let x = 0.2; x < L - 0.1; x += 0.32) plank.add(box(0.05, 0.03, 0.86, m.darkWood, x, 0.015, 0, 1));
    // stanchions and the hand ropes (the upper at 0.95 m, a lower one at 0.5 m)
    const ks = [0.06, 0.5, 0.94];
    for (const s of [-0.5, 0.5]) {
      for (const k of ks) plank.add(box(0.05, 1.0, 0.05, m.darkWood, L * k, 0.5, s, 1));
      for (const h of [0.97, 0.5]) plank.add(rod(new THREE.Vector3(L * ks[0], h, s), new THREE.Vector3(L * ks[2], h, s), h > 0.9 ? 0.022 : 0.016, m.rope));
    }
    // the lip at its foot: a tapered board down onto the boards, and two iron rollers under it
    // the flap: at the foot, lying level on the stage's boards, its top falling from the plank's to 2 cm
    const lip = new THREE.Group();
    lip.position.set(L, 0, 0);
    lip.rotation.z = -plank.rotation.z;
    const fg = new THREE.BoxGeometry(LIP, 0.06, 0.92);
    fg.translate(LIP / 2, -0.03, 0);
    const fp = fg.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < fp.count; i++) if (fp.getX(i) > LIP / 2 && fp.getY(i) > -0.03) fp.setY(i, fp.getY(i) - 0.04);
    fg.computeVertexNormals();
    lip.add(new THREE.Mesh(fg, m.planks));
    plank.add(lip);
    for (const s of [-0.3, 0.3]) {
      const r = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.16, 8), m.iron);
      r.rotation.x = Math.PI / 2;
      r.position.set(L - 0.1, -0.1, s);
      plank.add(r);
    }
    // one mesh per material (the gangway's two dozen boards, posts and ropes: four draw calls)
    plank.updateMatrixWorld(true);
    const inv = plank.matrixWorld.clone().invert();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    plank.traverse((o) => {
      const me = o as THREE.Mesh;
      if (!me.isMesh) return;
      const g = me.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, me.matrixWorld));
      const mat = me.material as THREE.Material;
      if (!byMat.has(mat)) byMat.set(mat, []);
      byMat.get(mat)!.push(g.index ? g.toNonIndexed() : g);
      me.geometry.dispose();
    });
    const merged = new THREE.Group();
    merged.rotation.z = plank.rotation.z;
    for (const [mat, geos] of byMat) {
      const g = mergeGeometries(geos, false);
      if (g) merged.add(new THREE.Mesh(g, mat));
    }
    pivot.add(merged);
    pivot.rotation.z = UP_ANGLE;
    outer.add(pivot);
    this.plankPivot = pivot;
  }

  /** The ferry's lamps (ferry.glb extras): the steaming light, the side lights, the lanterns, the saloon windows. */
  private buildLights(set: ModelSet): void {
    const inner = this.inner!;
    const L = extra<{ side: number[][]; mast: number[] | null; lanterns: number[][]; windows: number[][]; smoke: number[] }>(set, "ferry", "lights", {
      side: [],
      mast: null,
      lanterns: [],
      windows: [],
      smoke: [],
    });
    this.lamps = [];
    if (L.mast) {
      const src = addLantern({ power: 0.8 });
      src.on = 1;
      this.lamps.push({ glow: new LampGlow(inner, bl(L.mast), 0xfff2dc, { w: 0.27, h: 0.41 }, 1.6), src, fl: 0.2, arc: "mast" });
    }
    // port red on +x (the stage's side), starboard green on -x
    for (const p of L.side) this.lamps.push({ glow: new LampGlow(inner, bl(p), p[3] > 0 ? 0xff3322 : 0x33ff66, { w: 0.25, h: 0.37 }, 1.4), src: null, fl: 1.1, arc: "side", sx: p[3] });
    for (const p of L.lanterns) {
      const src = addLantern({ power: 1.6 });
      src.on = 1;
      this.lamps.push({ glow: new LampGlow(inner, bl(p), 0xffb060, { w: 0.21, h: 0.31 }, 1.1), src, fl: 2.3 + p[1] });
    }
    // the saloon's windows: one mesh of panes a hair off the walls, lit at dusk
    const geos: THREE.BufferGeometry[] = [];
    for (const [x, y, z, nx, ny, w, h] of L.windows) {
      const g = new THREE.PlaneGeometry(w * 0.86, h * 0.86);
      const n = new THREE.Vector3(nx, 0, -ny);
      g.lookAt(n);
      const c = bl([x, y, z]).addScaledVector(n, 0.012);
      g.translate(c.x, c.y, c.z);
      geos.push(g);
    }
    if (geos.length) {
      const merged = new THREE.BufferGeometry();
      const pos: number[] = [];
      for (const g of geos) {
        const gi = g.index ? g.toNonIndexed() : g;
        pos.push(...(gi.getAttribute("position").array as Float32Array));
      }
      merged.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
      const mesh = new THREE.Mesh(merged, mat);
      mesh.name = "ferry_windows_lit";
      mesh.userData.fx = true;
      mesh.visible = false;
      inner.add(mesh);
      this.windows = { mesh, mat };
    }
    if (L.smoke.length === 3) {
      const sprites: THREE.Sprite[] = [];
      const age: number[] = [];
      for (let i = 0; i < 10; i++) {
        const sm = new THREE.SpriteMaterial({ map: haloTexture(), color: 0x3c3a38, transparent: true, depthWrite: false, opacity: 0 });
        const s = new THREE.Sprite(sm);
        s.name = "ferry_smoke";
        s.userData.fx = true;
        s.visible = false;
        this.d.world.scene.add(s);
        sprites.push(s);
        age.push(-1);
      }
      this.smoke = { sprites, age, at: bl(L.smoke), next: 0 };
    }
  }

  private readonly tmpV = new THREE.Vector3();
  private readonly tmpC = new THREE.Color();
  private readonly tmpE = new THREE.Vector3();

  /** Lamps, windows, the mooring lines, the smoke: once a frame while she is here. */
  private updateLights(dt: number): void {
    const dark = this.d.dark?.() ?? 0;
    const fog = (this.d.world.scene.fog as THREE.Fog | null)?.color ?? new THREE.Color(0x808080);
    const inner = this.inner;
    if (!inner) return;
    inner.updateMatrixWorld(true);
    const t = this.t + this.stageT;
    // the eye in her own frame: the navigation lights show only over their arcs (their screens hide them)
    const eye = inner.worldToLocal(this.tmpE.copy(this.d.player.camera.position));
    for (const l of this.lamps) {
      const fl = 0.9 + Math.sin(t * 2.3 + l.fl * 3) * 0.05 + Math.sin(t * 10.1 + l.fl) * 0.04;
      let seen = 1;
      if (l.arc) {
        const p = l.glow.glass.position;
        const abaft = p.z - eye.z - Math.abs(eye.x - p.x) * 0.41; // > 0: more than two points abaft the beam
        if (abaft > 0 || (l.arc === "side" && eye.x * (l.sx ?? 1) < 0)) seen = 0;
      }
      l.glow.set(dark * fl * seen, fog);
      if (l.src) {
        this.tmpV.copy(l.glow.glass.position).applyMatrix4(inner.matrixWorld);
        l.src.pos.copy(this.tmpV);
        l.src.ground = this.waterline() + this.gang.hDeck;
      }
    }
    if (this.windows) {
      this.windows.mesh.visible = dark > 0.02;
      this.tmpC.setHex(0xe89a48).multiplyScalar(0.25 + 0.75 * dark);
      this.windows.mat.color.copy(this.tmpC);
    }
    // the lines to the stage's bollards, a little slack
    if (this.lines) {
      const pos = this.lines.obj.geometry.getAttribute("position") as THREE.BufferAttribute;
      let k = 0;
      for (const [local, bi] of this.lines.ends) {
        const b = this.landing.bollards()[bi];
        if (!b) continue;
        const a = this.tmpV.copy(local).applyMatrix4(inner.matrixWorld);
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 4; i++) {
          const f = i / 4;
          pts.push(new THREE.Vector3().lerpVectors(a, b, f).setY(a.y + (b.y - a.y) * f - 0.25 * Math.sin(Math.PI * f)));
        }
        for (let i = 0; i < 4; i++) {
          pos.setXYZ(k++, pts[i].x, pts[i].y, pts[i].z);
          pos.setXYZ(k++, pts[i + 1].x, pts[i + 1].y, pts[i + 1].z);
        }
      }
      pos.needsUpdate = true;
      this.lines.obj.geometry.computeBoundingSphere();
    }
    // smoke from the funnel: a lazy trail at the berth, thicker once she steams
    const sm = this.smoke;
    if (sm) {
      const top = this.tmpV.copy(sm.at).applyMatrix4(inner.matrixWorld);
      const rate = this.stage === "leaving" ? 0.45 : 1.3;
      sm.next -= dt;
      if (sm.next <= 0) {
        const i = sm.age.findIndex((a) => a < 0);
        if (i >= 0) {
          sm.age[i] = 0;
          sm.sprites[i].position.copy(top);
          sm.sprites[i].visible = true;
        }
        sm.next = rate;
      }
      for (let i = 0; i < sm.sprites.length; i++) {
        if (sm.age[i] < 0) continue;
        sm.age[i] += dt;
        const a = sm.age[i];
        const s = sm.sprites[i];
        if (a > 7) {
          sm.age[i] = -1;
          s.visible = false;
          continue;
        }
        s.position.y += dt * (0.9 - a * 0.06);
        s.position.x += dt * 0.35;
        s.scale.setScalar(0.9 + a * 0.55);
        (s.material as THREE.SpriteMaterial).opacity = Math.min(1, a * 2) * (1 - a / 7) * 0.55;
      }
    }
  }

  // ------------------------------------------------------------------ people aboard

  private addPeople(): void {
    const g = this.gang;
    const [qx, qz] = this.toWorld(g.lxSide - 1.05, g.lz);
    const [px, pz] = this.toWorld(g.lx0 + 0.05, g.lz);
    const shore: Array<[number, number]> = [
      [qx, qz], // the queue, on deck by the port
      [px, pz], // the port's sill: onto the plank
      [PONTOON_X, LAND_Z + LIP + 0.35], // down it, off its lip onto the stage
      [PONTOON_X + 0.5, -40],
      [PONTOON_X - 0.3, -20],
      [PONTOON_X, -6],
      [PONTOON_X, 1.5],
      [PONTOON_X, 4],
    ];
    // where each goes on land (the walk grid from the quay); far enough to fade into the fog
    const ends: Array<[number, number]> = [
      [-222, 10],
      [-276, 12],
      [-236, 24],
      [-258, 20],
      [-230, 14],
    ];
    const spots: Array<{ kind: HumanKind; l: [number, number]; at: number; speed: number }> = [
      { kind: "fishwife_a", l: [-0.6, 3.4], at: 4.2, speed: 1.05 },
      { kind: "old_man", l: [0.6, 6.0], at: 6.4, speed: 0.9 },
      { kind: "docker_sack", l: [-0.9, 6.2], at: 8.4, speed: 1.1 },
      { kind: "tourist_lady", l: [-0.3, 7.6], at: 10.6, speed: 0.95 },
      { kind: "gentleman", l: [0.5, 8.4], at: 12.6, speed: 1.1 },
    ];
    spots.forEach((s, i) => {
      const [lx, lz] = this.snap(s.l[0], s.l[1]);
      const [x, z] = this.toWorld(lx, lz);
      const way: Array<[number, number]> = [...shore];
      const end = ends[i % ends.length];
      const land = this.d.path(PONTOON_X, 4, end[0], end[1]);
      if (land && land.length) for (const p of land) way.push([p.x, p.z]);
      else way.push(end);
      const p: Passenger = {
        kind: s.kind,
        human: null,
        root: null,
        x,
        z,
        facing: Math.PI,
        at: s.at,
        way,
        step: 0,
        speed: s.speed,
        gone: false,
        mover: { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 },
        wait: 0,
        push: 0,
      };
      this.passengers.push(p);
      this.d.world.addMover(p.mover);
    });
    // the ferryman: on deck just aft of the port, facing it
    const inner = this.inner!;
    const root = new THREE.Group();
    const [fx, fz] = this.snap(g.lxSide - 0.95, g.lz - 1.2);
    root.position.set(fx, this.deckY(fx, fz) - this.waterline(), fz);
    root.rotation.y = Math.PI / 2; // model +x: toward the stage
    inner.add(root);
    this.ferryman = { human: null, root, motion: "behind" };
    // the man at the helm, on the bridge between the boxes, looking forward
    const helm = this.set ? extra<number[]>(this.set, "ferry", "helm", []) : [];
    if (helm.length === 3) {
      const hr = new THREE.Group();
      hr.position.copy(bl(helm));
      inner.add(hr);
      this.helmsman = { human: null, root: hr };
    }
    // the lines: the bow's bitts to the stage's -x bollard, a breast line by the port to the +x one
    const bitts = this.set ? extra<number[][]>(this.set, "ferry", "bitts", []) : [];
    const ends2: Array<[THREE.Vector3, number]> = [];
    if (bitts[0]) ends2.push([bl(bitts[0]), 1]);
    ends2.push([new THREE.Vector3(g.lxSide - 0.1, g.hDeck + 0.5, g.lz - 1.4), 0]);
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ends2.length * 8 * 3), 3));
    const lines = new THREE.LineSegments(lg, ropeMaterial());
    lines.name = "ferry_lines";
    lines.frustumCulled = false;
    this.d.world.scene.add(lines);
    this.lines = { obj: lines, ends: ends2 };
    const dress = () => {
      for (const q of this.passengers) {
        if (q.human || q.gone) continue;
        q.human = makeHuman(q.kind);
        if (q.human) {
          q.root = q.human.root;
          this.d.world.scene.add(q.root);
          q.human.play("idle", 0);
        }
      }
      if (this.ferryman && !this.ferryman.human) {
        const h = makeHuman("sailor_b");
        if (h) {
          this.ferryman.human = h;
          this.ferryman.root.add(h.root);
          FerryArrival.notFloor(h.root);
          h.play("behind", 0);
        }
      }
      if (this.helmsman && !this.helmsman.human) {
        const h = makeHuman("sailor");
        if (h) {
          this.helmsman.human = h;
          this.helmsman.root.add(h.root);
          FerryArrival.notFloor(h.root);
          h.play("behind", 0);
        }
      }
    };
    dress();
    whenHumans(dress);
  }

  /** The crew stand in the ferry's model: their bodies are not boards to stand on (the checks' rays pass them). */
  private static notFloor(root: THREE.Object3D): void {
    root.traverse((o) => (o.userData.fx = true));
  }

  /** On the ferry: her deck or the gangway, not yet on the stage (world point). */
  private isAboard(x: number, z: number): boolean {
    if (z < PONTOON_END - 0.05 && this.onDeckZone(x, z)) return true;
    return this.deckOn && Math.abs(x - PONTOON_X) < GANG_HALF + 0.3 && z >= this.gangwayZ().zA - 0.3 && z < ASHORE_Z;
  }

  private updatePassengers(dt: number): void {
    const { world, player } = this.d;
    const down = this.lowered && this.plankUp <= 0;
    this.passengers.forEach((p, idx) => {
      if (p.gone) return;
      let moving = false;
      if (this.t >= p.at && p.way.length) {
        const [tx, tz] = p.way[0];
        const dx = tx - p.x;
        const dz = tz - p.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.08) {
          p.way.shift();
          p.step++;
        } else {
          const ux = dx / len;
          const uz = dz / len;
          // one after another: not onto the port's sill before the gangway is down, and a pace behind the one ahead
          let hold = p.step >= 1 && p.step <= 2 && !down;
          const prev = this.passengers.slice(0, idx).reverse().find((q) => !q.gone);
          if (prev && prev.step >= p.step && prev.step <= p.step + 2 && Math.hypot(prev.x - p.x, prev.z - p.z) < 1.1) hold = true;
          // Jef in the way just ahead: wait a moment, then squeeze past
          const jx = player.x - p.x;
          const jz = player.z - p.z;
          const ahead = jx * ux + jz * uz;
          const side = Math.abs(jx * uz - jz * ux);
          const blocked = ahead > 0 && ahead < 1.0 && side < 0.6;
          if (hold) {
            p.facing = Math.atan2(ux, uz);
          } else if (blocked && p.push <= 0) {
            p.wait += dt;
            if (p.wait > 3) {
              p.push = 2;
              p.wait = 0;
            }
          } else {
            if (p.push > 0) p.push -= dt;
            if (!blocked) p.wait = 0;
            // careful on the plank
            const pace = p.step === 2 ? p.speed * 0.7 : p.speed;
            const step = Math.min(len, pace * dt);
            p.x += ux * step;
            p.z += uz * step;
            p.facing = Math.atan2(ux, uz);
            moving = true;
          }
        }
      }
      // at the end of the way, out in the fog (or far from Jef): gone
      if (!p.way.length && Math.hypot(player.x - p.x, player.z - p.z) > 22) {
        p.gone = true;
        world.removeMover(p.mover);
        if (p.human) p.human.dispose();
        else p.root?.removeFromParent();
        return;
      }
      // a body Jef bumps into, not walks through (only when he is not already inside it)
      const inside = Math.abs(player.x - p.x) < 0.6 && Math.abs(player.z - p.z) < 0.6;
      const r = inside ? 0 : 0.22;
      p.mover.minX = p.x - r;
      p.mover.maxX = p.x + r;
      p.mover.minZ = p.z - r;
      p.mover.maxZ = p.z + r;
      if (p.human && p.root) {
        p.human.play(moving ? "walk" : "idle", 0.25);
        if (moving) p.human.setPace(p.step === 2 ? p.speed * 0.7 : p.speed);
        p.human.update(dt);
        // the feet on the floor Jef walks on: the deck, the plank, the stage (World.baseAt)
        p.root.position.set(p.x, world.baseAt(p.x, p.z) + p.human.bob(), p.z);
        p.root.rotation.y = p.facing;
      }
    });
  }

  /** Everyone off the ferry and the gangway: the passengers on the stage (or gone on), Jef too. */
  private allOff(): boolean {
    if (!this.jefOff || this.aboard()) return false;
    return this.passengers.every((p) => p.gone || p.z > OFF_Z);
  }

  private updateFerryman(dt: number): void {
    const f = this.ferryman;
    if (this.helmsman?.human) this.helmsman.human.update(dt);
    if (!f?.human) return;
    let m: Motion = "behind";
    if (this.stage === "hauling" || (this.stage === "moored" && !this.lowered && this.t > LOWER[0] - 0.3)) m = "pull";
    else if (this.stage === "moored" && this.t - this.saidAt < 3) m = "talk";
    if (m !== f.motion) {
      f.motion = m;
      f.human.play(m, 0.3);
    }
    f.human.update(dt);
    // face Jef while he is aboard, the plank while he works it
    if (this.stage === "moored" && this.outer && this.lowered) {
      const [lx, lz] = this.toLocal(this.d.player.x, this.d.player.z);
      const want = Math.atan2(lx - f.root.position.x, lz - f.root.position.z);
      let d = want - f.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.root.rotation.y += d * Math.min(1, dt * 2.5);
    } else if (this.stage === "hauling" || !this.lowered) {
      const want = Math.atan2(this.gang.lx0 - f.root.position.x, this.gang.lz - f.root.position.z);
      let d = want - f.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.root.rotation.y += d * Math.min(1, dt * 3);
    }
  }

  private saidAt = -99;
  private say(text: string): void {
    this.saidAt = this.t;
    this.d.say(text);
  }

  // ------------------------------------------------------------------ the frame

  /** Jef on the ferry's deck or her gangway (not yet on the stage)? */
  private aboard(): boolean {
    return this.isAboard(this.d.player.x, this.d.player.z);
  }

  /** She floats on the tide and heaves a little (more once she is under way). */
  private float(): void {
    const o = this.outer;
    const inn = this.inner;
    if (!o || !inn) return;
    o.position.y = levelAt(o.position.x, o.position.z);
    const k = this.stage === "leaving" ? 1 : 0.45;
    const t = this.t + this.stageT;
    inn.position.y = k * (0.03 * Math.sin(t * 1.37) + 0.012 * Math.sin(t * 3.1 + 1.1));
    inn.rotation.z = k * 0.012 * Math.sin(t * 1.13 + 0.4);
    inn.rotation.x = k * 0.004 * Math.sin(t * 1.55 + 2.0);
  }

  update(dt: number): void {
    this.landing.update(dt, this.d.dark?.() ?? 0);
    if (this.stage === "gone") {
      this.tidy();
      // the passengers still walking into town go on to the end of their way
      if (this.passengers.length) {
        this.updatePassengers(dt);
        this.sampleFeet(dt);
        if (this.passengers.every((p) => p.gone)) this.passengers.length = 0;
      }
      return;
    }
    if (this.stage === "waiting") {
      // (M8d: the character sheet first, when the server asks for it)
      if (this.set && this.creator) {
        if (!this.creatorOpen) this.openCreator();
        // (Esc hides the sheet without a word: gone is done)
        else if (this.creatorShown && !document.querySelector(".char-sheet")) this.creatorDone();
        return;
      }
      if (this.set) this.setup(this.set);
      return;
    }
    const { player } = this.d;
    const inHand = player.locked || player.freeInput || player.testInput;
    if (inHand) this.t += dt;
    this.stageT += dt;
    this.float();
    if (this.stage === "moored") {
      // the ferryman runs the gangway out first
      if (!this.lowered) {
        this.plankUp = 1 - THREE.MathUtils.clamp((this.t - LOWER[0]) / (LOWER[1] - LOWER[0]), 0, 1);
        if (this.plankUp <= 0) {
          this.lowered = true;
          this.log("gangway down");
        }
      }
      if (inHand && !this.hinted && this.lowered) {
        this.hinted = true;
        this.d.say(HINT);
      }
      if (this.guided) this.walkOff(dt);
      else if (this.aboard()) {
        if (inHand) this.idle += dt;
        const n = NAG[this.nagged];
        if (n && this.idle >= n[0]) {
          this.nagged++;
          this.say(n[1]);
        } else if (this.idle >= WALK_OFF_AT && this.lowered) this.startWalkOff();
      }
      // off the deck and the plank: ashore (also when a dev jump took him elsewhere)
      if (this.placed && !this.aboard() && !this.guided && !this.jefOff) this.markAshore();
      // the gangway comes in only when the last of them is off
      if (this.lowered && this.allOff()) {
        this.stage = "hauling";
        this.stageT = 0;
        this.log("hauling in");
      }
    } else if (this.stage === "hauling") {
      this.plankUp = Math.min(1, this.plankUp + dt / 3.2);
      if (this.stageT > 4.2) {
        this.stage = "leaving";
        this.stageT = 0;
        this.castOff();
      }
    } else if (this.stage === "leaving") this.steam(dt);
    if (this.plankPivot) this.plankPivot.rotation.z = this.plankUp * UP_ANGLE;
    this.updatePassengers(dt);
    this.updateFerryman(dt);
    this.updateLights(dt);
    this.sampleFeet(dt);
  }

  private startWalkOff(): void {
    const { player } = this.d;
    const g = this.gang;
    const [lx, lz] = this.toLocal(player.x, player.z);
    const way: Array<[number, number]> = [];
    // round the deck to the queue by the port, over the sill, down the plank
    const [ax, az] = this.toWorld(Math.min(lx, g.lxSide - 1.2), g.lz + (lz > g.lz ? 0.3 : -0.3));
    const [qx, qz] = this.toWorld(g.lxSide - 1.05, g.lz);
    const [px, pz] = this.toWorld(g.lx0 + 0.05, g.lz);
    way.push([ax, az], [qx, qz], [px, pz], [PONTOON_X, LAND_Z + LIP + 0.3], [PONTOON_X, ASHORE_Z + 1.5]);
    this.guided = way;
    player.frozen = true;
    this.say("The ferryman takes you by the elbow and walks you down the plank.");
  }

  private walkOff(dt: number): void {
    const { player } = this.d;
    const way = this.guided!;
    const [tx, tz] = way[0];
    const dx = tx - player.x;
    const dz = tz - player.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) {
      way.shift();
      if (!way.length) {
        this.guided = null;
        player.frozen = false;
        this.markAshore();
      }
      return;
    }
    const step = Math.min(len, 1.1 * dt);
    player.x += (dx / len) * step;
    player.z += (dz / len) * step;
    // facing where he goes (yaw 0 looks along -z)
    player.yaw = Math.atan2(-dx, -dz);
  }

  /** Jef is off: the hint for the day, the server told once. The gangway waits for the rest. */
  private markAshore(): void {
    this.jefOff = true;
    this.log("Jef ashore");
    this.say(ASHORE_HINT);
    if (!this.ashoreSent) {
      this.ashoreSent = true;
      const f = this.d.fetch ?? fetch;
      void f("/api/arrival/ashore", { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
    }
  }

  private castOff(): void {
    const o = this.outer;
    if (!o) return;
    // nobody may stand on her now: the deck is no longer ground
    this.deckOn = false;
    this.log("cast off");
    this.lines?.obj.removeFromParent();
    this.lines = null;
    this.ship = { id: newShipId(), kind: "paddle_tug", x: o.position.x, z: o.position.z, heading: this.heading, speed: 0, steam: true };
    signal(this.ship, "bridge"); // the whistle as she casts off
    const ship = this.ship;
    this.dropSound = addMovingSource((out) => {
      if (this.stage === "leaving" && ship.speed > 0.1) out.push(ship);
    });
  }

  private steam(dt: number): void {
    const o = this.outer;
    const ship = this.ship;
    if (!o || !ship) return;
    // ahead, slowly at first, easing away from the stage and out down river
    // (a slow paddle ferry: 2.4 m/s, a minute to be lost in the fog; the ferryman's boathook pushes
    // her off the stage sideways at first, so her paddle box clears the stage's head)
    this.speed = Math.min(2.4, this.speed + dt * 0.16);
    const turn = THREE.MathUtils.clamp((this.stageT - 4) / 30, 0, 1) * 0.4;
    this.heading += (FERRY.yaw - turn - this.heading) * Math.min(1, dt * 0.4);
    o.rotation.y = this.heading;
    const push = 0.35 * (1 - THREE.MathUtils.clamp(this.stageT / 8, 0, 1));
    o.position.x += Math.sin(this.heading) * this.speed * dt;
    o.position.z += Math.cos(this.heading) * this.speed * dt - push * dt;
    ship.x = o.position.x;
    ship.z = o.position.z;
    ship.heading = this.heading;
    ship.speed = this.speed;
    if (this.waterRect) {
      this.waterRect.minX = o.position.x - 12.5;
      this.waterRect.maxX = o.position.x + 12.5;
      this.waterRect.minZ = o.position.z - 12.5;
      this.waterRect.maxZ = o.position.z + 12.5;
    }
    const { player } = this.d;
    const far = Math.hypot(player.x - o.position.x, player.z - o.position.z);
    if (far > 150 || o.position.x < -420 || this.stageT > 240) this.finish();
  }

  /** The ferry's own things gone: lamps, crew, lines, smoke, the model. */
  private teardown(): void {
    this.dropSound?.();
    this.dropSound = null;
    if (this.waterRect) this.d.world.removeWaterSolid(this.waterRect);
    this.waterRect = null;
    for (const l of this.lamps) {
      removeLantern(l.src);
      l.glow.dispose();
    }
    this.lamps = [];
    this.windows?.mat.dispose();
    this.windows = null;
    this.lines?.obj.removeFromParent();
    this.lines = null;
    for (const s of this.smoke?.sprites ?? []) {
      s.removeFromParent();
      (s.material as THREE.SpriteMaterial).dispose();
    }
    this.smoke = null;
    this.ferryman?.human?.dispose();
    this.ferryman = null;
    this.helmsman?.human?.dispose();
    this.helmsman = null;
    this.outer?.removeFromParent();
    this.outer = null;
    this.boards.clear();
    this.inner = null;
    this.plankPivot = null;
  }

  private finish(): void {
    this.stage = "gone";
    this.log("gone");
    this.teardown();
    // the landing at the stage's head goes back to the walk map (unless someone stands on it)
    this.tidy();
  }

  /** The strip stays ground while he (or a passenger) stands on it after the ferry has gone; this lets it go after. */
  tidy(): void {
    if (this.stage !== "gone" || !this.stripOn) return;
    const { x, z } = this.d.player;
    if (this.inStrip(x, z)) return;
    if (this.passengers.some((p) => !p.gone && this.inStrip(p.x, p.z))) return;
    this.stripOn = false;
  }

  /** The path check (__scheldemist.paths): while she lies at the stage, Jef's place on deck. */
  pathPoints(): Array<{ x: number; z: number; reach: number; label: string }> {
    if (!this.deckOn || !this.outer) return [];
    const [lx, lz] = this.snap(-0.2, 5.6);
    const [x, z] = this.toWorld(lx, lz);
    return [{ x, z, reach: 1.2, label: "the ferry's fore deck (the opening)" }];
  }

  // ------------------------------------------------------------------ dev: checks

  private log(what: string): void {
    if (this.feet.on) this.feet.log.push(`${this.t.toFixed(1)} ${what}`);
  }

  private quayGangway: THREE.Object3D | null = null;
  /** The boards' meshes (not the lamps' glow, the halos, the crew's bodies, the rigging), by the thing they belong to. */
  private boards = new Map<THREE.Object3D, TriGrid[]>();
  private meshesOf(root: THREE.Object3D): TriGrid[] {
    let list = this.boards.get(root);
    if (!list) {
      list = [];
      const walk = (o: THREE.Object3D) => {
        if (o.userData.fx) return;
        if ((o as THREE.Mesh).isMesh && !(o as THREE.SkinnedMesh).isSkinnedMesh && !SKIP.test(o.name)) list!.push(new TriGrid(o as THREE.Mesh));
        for (const c of o.children) walk(c);
      };
      walk(root);
      this.boards.set(root, list);
    }
    return list;
  }

  /** The drawn boards a foot at (x, z) may stand on: the ferry, her gangway, the stage, the quay's gangway. */
  private surfacesAt(x: number, z: number): Array<[string, TriGrid[]]> {
    const out: Array<[string, TriGrid[]]> = [];
    if (this.plankPivot && this.plankUp < 0.02 && Math.abs(x - PONTOON_X) < 1) out.push(["gangway", this.meshesOf(this.plankPivot)]);
    if (this.inner && this.onDeckZone(x, z)) out.push(["ferry", this.meshesOf(this.inner)]);
    if (this.landing.root && x > PONTOON_X - 2.4 && x < PONTOON_X + 2.4 && z < 0.2 && z > PONTOON_END - 0.1) out.push(["stage", this.meshesOf(this.landing.root)]);
    // rijnkaai.ts pontoonGangway: the gangway hinged at the quay edge, its foot on the stage
    if (!this.quayGangway) this.quayGangway = this.d.world.scene.getObjectByName("pontoon_gangway") ?? null;
    if (this.quayGangway && Math.abs(x - PONTOON_X) < 2 && z > -8 && z < 0.4) out.push(["quay gangway", this.meshesOf(this.quayGangway)]);
    return out;
  }

  private readonly ray = new THREE.Raycaster();
  /**
   * How far a foot is off the boards under it (+ above), or null if nothing is there within half a
   * metre. A sole, not a point: five rays over a hand's breadth (the stage's boards have gaps between
   * them), the board nearest the foot counts.
   */
  private footOff(x: number, y: number, z: number): { off: number | null; on: string } {
    const surf = this.surfacesAt(x, z);
    if (!surf.length) return { off: null, on: "nothing" };
    let best = null as { top: number; on: string } | null;
    const from = new THREE.Vector3();
    for (const [ox, oz] of [[0, 0], [0.07, 0], [-0.07, 0], [0, 0.07], [0, -0.07]]) {
      from.set(x + ox, y + 0.5, z + oz);
      for (const [name, grids] of surf)
        for (const g of grids) {
          const top = g.down(from, 1.0);
          // the board nearest the foot's height (by a step's edge the sole may reach over the next board)
          if (top !== null && (!best || Math.abs(y - top) < Math.abs(y - best.top))) best = { top, on: name };
        }
      // (the middle of the sole found a board: enough; the other four only over a gap)
      if (best && Math.abs(y - best.top) <= 0.1) break;
    }
    if (!best) return { off: null, on: surf.map((s) => s[0]).join("+") };
    return { off: y - best.top, on: best.on };
  }

  /** Every 0.1 s of the opening while check() runs: each foot against the boards. */
  private sampleFeet(dt: number): void {
    const F = this.feet;
    if (!F.on) return;
    F.clock += dt;
    if (F.clock - F.lastT < 0.1) return;
    F.lastT = F.clock;
    const probe = (who: string, x: number, y: number, z: number) => {
      if (z > 0.1) return; // on the quay's stones: the arrival's part is done
      F.samples++;
      const r = this.footOff(x, y, z);
      if (r.off === null || Math.abs(r.off) > 0.1) F.misses.push({ who, t: +this.t.toFixed(1), x: +x.toFixed(2), z: +z.toFixed(2), off: r.off === null ? null : +r.off.toFixed(3), on: r.on });
    };
    for (const p of this.passengers) if (!p.gone && p.root) probe(p.kind, p.x, p.root.position.y - (p.human?.bob() ?? 0), p.z);
    const pl = this.d.player;
    probe("Jef", pl.x, pl.y, pl.z);
    if (this.stage === "moored" || this.stage === "hauling") {
      for (const [who, c] of [["ferryman", this.ferryman], ["helmsman", this.helmsman]] as const) {
        if (!c) continue;
        const w = c.root.getWorldPosition(new THREE.Vector3());
        if (who === "ferryman") probe(who, w.x, w.y, w.z);
        else {
          // the helmsman stands on the bridge (not the deck): a ray from just over his feet
          this.ray.set(w.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, -1, 0));
          this.ray.camera = this.d.player.camera;
          this.ray.far = 1;
          const h = this.ray.intersectObject(this.inner!, true).find((i) => !i.object.userData.fx && (i.object as THREE.Mesh).isMesh);
          F.samples++;
          if (!h || Math.abs(w.y - h.point.y) > 0.1) F.misses.push({ who, t: +this.t.toFixed(1), x: +w.x.toFixed(2), z: +w.z.toFixed(2), off: h ? +(w.y - h.point.y).toFixed(3) : null, on: "bridge" });
        }
      }
    }
  }

  /**
   * Dev: plays the opening through at once (a new ferry, Jef aboard), 30 steps a second, and measures
   * every foot (the passengers', Jef's, the ferryman's, the helmsman's) against the drawn boards under
   * it every 0.1 s: more than 10 cm above or below, or nothing under it, is listed in `misses`.
   * Scenarios: "last" Jef waits and goes last, "first" he hurries down before them, "skip" a jump takes
   * him ashore at once, "stay" he stays aboard until the ferryman walks him off. Also checks the order:
   * nobody on the plank before it is down, and it comes in only when everyone is off.
   * `problems` must be empty. The opening is left played out (devReplay() for another look).
   */
  check(scenario: "last" | "first" | "skip" | "stay" = "last", maxS = 260): Record<string, unknown> {
    if (!this.set) return { error: "ferry.glb not loaded yet" };
    const pl = this.d.player;
    const keep = { x: pl.x, z: pl.z, y: pl.y, yaw: pl.yaw, test: pl.testInput, frozen: pl.frozen };
    this.devReplay();
    this.update(0);
    this.feet = { on: true, misses: [], samples: 0, log: [], lastT: -1, clock: 0 };
    pl.testInput = true;
    const problems: string[] = [];
    const dt = 1 / 30;
    let onPlankEarly = 0;
    let aboardAtHaul = -1;
    let prevStage = this.stage;
    for (let i = 0; i < maxS * 30; i++) {
      // Jef: his own feet follow the floor (the player's physics does that in the game)
      if (scenario === "first" && this.t > LOWER[1] + 0.2 && !this.guided && !this.jefOff && this.stage === "moored") this.startWalkOff();
      if (scenario === "last" && this.t > 26 && !this.guided && !this.jefOff) this.startWalkOff();
      if (scenario === "skip" && this.t > 1 && !this.jefOff) pl.place(-240, 8, 0, 0);
      if (scenario === "stay" && this.t > 60 && this.idle < 100) this.devIdle(60);
      this.update(dt);
      pl.y = this.d.world.baseAt(pl.x, pl.z);
      // the order of things
      for (const p of this.passengers) if (!p.gone && this.onGangway(p.x, p.z) && !this.lowered) onPlankEarly++;
      if (this.stage === "hauling" && prevStage !== "hauling") {
        aboardAtHaul = this.passengers.filter((p) => !p.gone && this.isAboard(p.x, p.z) && p.z <= OFF_Z).length + (this.aboard() ? 1 : 0);
      }
      prevStage = this.stage;
      if (this.stage === "gone" && this.passengers.every((p) => p.gone || p.z > 0.4)) break;
    }
    this.feet.on = false;
    pl.testInput = keep.test;
    pl.frozen = keep.frozen;
    if (onPlankEarly) problems.push(`${onPlankEarly} passenger steps on the gangway before it was down`);
    if (aboardAtHaul !== 0) problems.push(aboardAtHaul < 0 ? "the gangway never came in" : `${aboardAtHaul} still aboard when the gangway came in`);
    if (this.feet.misses.length) problems.push(`${this.feet.misses.length} feet off the boards`);
    if (this.stage !== "gone") problems.push(`the opening did not end (stage ${this.stage})`);
    const byWho: Record<string, number> = {};
    for (const m of this.feet.misses) byWho[m.who] = (byWho[m.who] ?? 0) + 1;
    return {
      scenario,
      problems,
      samples: this.feet.samples,
      misses: this.feet.misses.slice(0, 20),
      missesByWho: byWho,
      order: this.feet.log,
      seconds: +this.t.toFixed(1),
    };
  }

  /**
   * Dev: does anything of the ferry or the stage stand in the gangway's way (a rail, a post, a fender),
   * does the gangway lie on the ferry's sill and on the stage's boards, and does the ferry keep off the
   * stage and its piles? `problems` must be empty.
   */
  parts(): Record<string, unknown> {
    const problems: string[] = [];
    if (!this.outer || !this.inner || !this.plankPivot || this.plankUp > 0.02) return { error: "the ferry is not lying with her gangway down (devReplay(), then run 4 s)" };
    this.outer.updateMatrixWorld(true);
    const { zA, zB, zC } = this.gangwayZ();
    const { hA, hB } = this.plankEnds();
    const objs: Array<[string, THREE.Object3D]> = [["ferry", this.inner]];
    if (this.landing.root) objs.push(["stage", this.landing.root]);
    const ray = new THREE.Raycaster();
    ray.camera = this.d.player.camera;
    // 1. the way through: rays along the plank from 0.8 m inboard of its end to 0.8 m onto the stage,
    //    at the feet, the knees, the hands and the head, in the middle and at the hand ropes
    let clear = 0;
    for (const h of [0.12, 0.5, 1.0, 1.6])
      for (const s of [-0.4, 0, 0.4]) {
        const a = new THREE.Vector3(PONTOON_X + s, hA + h, zA - 0.8);
        const b = new THREE.Vector3(PONTOON_X + s, hB + h, zC + 0.8);
        ray.set(a, b.clone().sub(a).normalize());
        ray.far = a.distanceTo(b);
        for (const [name, o] of objs) {
          const hit = ray.intersectObject(o, true).find((i) => (i.object as THREE.Mesh).isMesh && !i.object.userData.fx && !SKIP.test(i.object.name));
          if (hit) problems.push(`the ${name}'s ${hit.object.name} in the gangway's way at ${h} m, ${s} m off its middle (z ${hit.point.z.toFixed(2)})`);
          else clear++;
        }
      }
    // 2. its ends: the inboard end on the sill, the foot on the stage's boards
    const down = new THREE.Vector3(0, -1, 0);
    const ends: Array<[string, number, number, THREE.Object3D | null]> = [
      ["inboard end on the sill", zA + 0.15, hA - 0.06, this.inner],
      ["flap on the stage", zB + LIP * 0.6, this.pontoonY(), this.landing.root],
    ];
    const ends2: string[] = [];
    for (const [what, z, bottom, o] of ends) {
      if (!o) continue;
      for (const s of [-0.35, 0.35]) {
        ray.set(new THREE.Vector3(PONTOON_X + s, bottom + 0.02, z), down);
        ray.far = 1;
        const hit = ray.intersectObject(o, true).find((i) => (i.object as THREE.Mesh).isMesh && !i.object.userData.fx && !SKIP.test(i.object.name));
        const gap = hit ? bottom - hit.point.y : null;
        ends2.push(`${what} ${s}: ${gap === null ? "nothing under it" : `${(gap * 100).toFixed(1)} cm`}`);
        if (gap === null || Math.abs(gap) > 0.05) problems.push(`gangway ${what} (${s} m): ${gap === null ? "nothing under it" : `${(gap * 100).toFixed(1)} cm off`}`);
      }
    }
    // 3. the ferry keeps off the stage (its head, fenders and rails) and the guide piles
    const box3 = new THREE.Box3();
    const stageBox = new THREE.Box3(new THREE.Vector3(PONTOON_X - 2.6, -99, PONTOON_END - 0.6), new THREE.Vector3(PONTOON_X + 2.6, 99, 0));
    const v = new THREE.Vector3();
    let inStage = 0;
    let nearPile = 0;
    const piles = this.landing.solids().piles;
    this.inner.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh || m.userData.fx || SKIP.test(m.name)) return;
      const pos = m.geometry.getAttribute("position");
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        if (stageBox.containsPoint(v)) inStage++;
        for (const p of piles) if (v.x > p.minX && v.x < p.maxX && v.z > p.minZ && v.z < p.maxZ) nearPile++;
      }
    });
    void box3;
    if (inStage) problems.push(`${inStage} points of the ferry inside the stage's head`);
    if (nearPile) problems.push(`${nearPile} points of the ferry in a guide pile`);
    return { problems, clearRays: clear, ends: ends2, gangway: { zA: +zA.toFixed(2), zB, zC, hA: +hA.toFixed(3), hB: +hB.toFixed(3) } };
  }

  /** Dev: the opening again from the start (on a test save only: the server is not asked). */
  devReplay(): void {
    this.teardown();
    for (const p of this.passengers) {
      this.d.world.removeMover(p.mover);
      if (p.human) p.human.dispose();
      else p.root?.removeFromParent();
    }
    this.passengers = [];
    this.stage = "waiting";
    this.t = 0;
    this.idle = 0;
    this.nagged = 0;
    this.hinted = false;
    this.placed = false;
    this.guided = null;
    this.stageT = 0;
    this.jefOff = false;
    this.ashoreSent = true; // a replay tells the server nothing
    this.plankUp = 1;
    this.lowered = false;
    this.feet.on = false;
    if (!this.set) void loadFerrySet().then((s) => (this.set = s));
  }

  /** Dev: where the opening stands, and the deck as text (# walkable, . deck not walked, space none). */
  info(map = false): Record<string, unknown> {
    const out: Record<string, unknown> = {
      stage: this.stage,
      measureMs: +this.measureMs.toFixed(0),
      t: +this.t.toFixed(1),
      idle: +this.idle.toFixed(1),
      aboard: this.placed ? this.aboard() : null,
      jefOff: this.jefOff,
      plankUp: +this.plankUp.toFixed(2),
      gangway: this.gang,
      ferry: this.outer ? [+this.outer.position.x.toFixed(1), +this.outer.position.z.toFixed(1)] : null,
      passengers: this.passengers.map((p) => `${p.kind} ${p.gone ? "gone" : `${p.x.toFixed(1)},${p.z.toFixed(1)} step ${p.step}`}`),
      landing: this.landing.info(),
    };
    if (map && this.grid) {
      const g = this.grid;
      const rows: string[] = [];
      for (let j = g.nz - 1; j >= 0; j--) {
        let r = "";
        for (let i = 0; i < g.nx; i++) {
          const k = j * g.nx + i;
          r += g.walk[k] ? "#" : Number.isNaN(g.floor[k]) ? " " : ".";
        }
        rows.push(`${(GZ0 + (j + 0.5) * CELL).toFixed(1).padStart(5)} ${r}`);
      }
      out.map = rows.join("\n");
    }
    return out;
  }

  /** Dev: what a ray straight down meets at a model-frame point (height over the waterline, the part's name). */
  probe(lx: number, lz: number): string[] {
    if (!this.outer || !this.inner) return [];
    const [wx, wz] = this.toWorld(lx, lz);
    const y0 = this.outer.position.y;
    const ray = new THREE.Raycaster(new THREE.Vector3(wx, y0 + 15, wz), new THREE.Vector3(0, -1, 0));
    ray.far = 30;
    return ray.intersectObject(this.inner, true).map((h) => `${(h.point.y - y0).toFixed(2)} ${h.object.name}`);
  }

  /** Dev: skip the wait (the ferryman's lines and the walk off come at once). */
  devIdle(seconds: number): void {
    this.idle += seconds;
  }
}
