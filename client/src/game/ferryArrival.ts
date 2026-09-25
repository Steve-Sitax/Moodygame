import * as THREE from "three";
import type { World, WalkArea } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import { addMovingSource, newShipId, signal, type Boats, type MovingShip } from "../world/boats";
import { box, rod, type Rect } from "../world/geom";
import { makeHuman, whenHumans, type Human, type HumanKind, type Motion } from "./humans";

// M7 ferry arrival (Steve, 2026-09-24: "The start of the game is: we step off a ferry and so enter
// the city. The ferry takes off when we are off."). A new game (server arrival.ts: stage "ferry")
// begins with Jef on the fore deck of the paddle ferry from the left bank, lying at the river end
// of the Werf pontoon at dawn, her gangway down onto the pontoon. A few passengers go ashore first;
// the ferryman stands at the rail by the gangway. Jef walks down it himself (the deck is railed: the
// gangway is the only way off). Once he is on the pontoon the ferryman hauls the plank in, the ferry
// whistles and steams off down river into the fog. If he stays aboard, the ferryman tells him twice
// to get off, and then walks him down the plank. A save in progress (stage "ashore", or no key) is
// untouched; a reload before he stepped off plays the opening again.
//
// The deck is walked through World.addWalkArea (as the cathedral is): the fore deck's floor comes
// from the model itself (rays cast down onto boats.glb's paddle_tug), the rails and the deck house
// are walls, the gangway a slope from the rail to the pontoon, and the pontoon's last two metres
// (past the walk map's end at z -58) a landing between the two.

/** The pontoon at the Werf (rijnkaai.ts PONTOON): its centre line, and where its walk map ends. */
const PONTOON_X = -249;
const PONTOON_WALK_END = -58;
/** Where the pontoon's last section ends (boats.ts pontoon: six 10 m sections from the quay). */
const PONTOON_END = -60;
/** The ferry: a paddle steamer (boats.glb paddle_tug), bow down river (-x), her side to the pontoon's end. */
const FERRY = { x: -244.5, z: -64.15, yaw: -Math.PI / 2 };
/** Along the ferry (model frame, bow +z): where the gangway leaves her rail. */
const GANGWAY_LZ = 4.5;
/** The gangway lands this far onto the pontoon. */
const LAND_Z = PONTOON_END + 0.45;
/** Half the walkable width of the gangway (the body keeps 0.47 m off the sides: the drawn plank is 1 m). */
const GANG_HALF = 0.8;
/** The landing: the pontoon's end past its walk map, between its rails. */
// (a hair past the walk map's end: the pontoon's own rules start only beyond z -58, so no seam at -58)
const STRIP = { minX: PONTOON_X - 1.95, maxX: PONTOON_X + 1.95, minZ: PONTOON_END + 0.05, maxZ: PONTOON_WALK_END + 0.1 };
/** Jef is ashore once he is this far along the pontoon. */
const ASHORE_Z = LAND_Z + 0.9;
/** The deck grid (model frame): cells, and the part forward of the deck house that is walked. */
const CELL = 0.2;
/** Parts of the model a ray from above passes: the rigging, and the hull's lid for the water stencil. */
const SKIP = /rigging|_cap$/;
const GX0 = -3.4;
const GX1 = 3.4;
const GZ0 = 1.0;
const GZ1 = 10.0;
/** The ferryman's words when Jef stays aboard (active seconds), and when he is walked off. */
const NAG: Array<[number, string]> = [
  [35, 'The ferryman: "This is Antwerp. Down the plank with you, we go back across."'],
  [75, 'The ferryman: "Come on, off you get. I have the next crossing to make."'],
];
const WALK_OFF_AT = 115;
const HINT = "Step ashore: walk down the gangway onto the landing.";
const ASHORE_HINT = "Day work is given out at the Hessenatie's board on the Rijnkaai, along the quay past the Steen.";

type Stage = "waiting" | "moored" | "hauling" | "leaving" | "gone";

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
  /** The server (the dev test stack or the game), for the stage. */
  fetch?: typeof fetch;
}

export class FerryArrival {
  private stage: Stage = "gone";
  private boats: Boats | null = null;
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
  /** The deck from the model: floor heights (over the waterline) and walkable cells. */
  private grid: { nx: number; nz: number; floor: Float32Array; walk: Uint8Array } | null = null;
  /** Gangway numbers (model frame x across, heights over the ferry's waterline). */
  private gang = { lxRail: 1.8, hDeck: 0.6, hRail: 1.35, lxIn: 1.0 };
  private plankPivot: THREE.Object3D | null = null;
  private plankUp = 0;
  private ferryman: { human: Human | null; root: THREE.Object3D; motion: Motion } | null = null;
  private passengers: Passenger[] = [];
  private stripOn = false;
  private deckOn = false;
  private waterRect: Rect | null = null;
  private ship: MovingShip | null = null;
  private dropSound: (() => void) | null = null;
  private heading = FERRY.yaw;
  private speed = 0;
  private measureMs = 0;
  private readonly areaBox: Rect = { minX: FERRY.x - 11, maxX: FERRY.x + 11, minZ: FERRY.z - 11, maxZ: STRIP.maxZ + 0.05 };

  constructor(private readonly d: FerryDeps) {
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
          const v = (await r.json()) as { stage?: string };
          if (v.stage !== "ferry") return;
          this.stage = "waiting";
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
  }

  // ------------------------------------------------------------------ setting the scene

  private setup(b: Boats): void {
    this.boats = b;
    const { world, player } = this.d;
    const outer = b.place("paddle_tug", FERRY.x, FERRY.z, FERRY.yaw, world.scene);
    outer.name = "arrival_ferry";
    this.outer = outer;
    this.inner = outer.children[0] ?? outer;
    outer.updateMatrixWorld(true);
    const t0 = performance.now();
    this.measure();
    this.measureMs = performance.now() - t0;
    // the hull: solid for swimmers and rowing boats while she lies here
    this.waterRect = { minX: FERRY.x - 10, maxX: FERRY.x + 10, minZ: FERRY.z - 3.3, maxZ: FERRY.z + 3.3 };
    world.addWaterSolid(this.waterRect);
    this.buildPlank();
    this.deckOn = true;
    this.stripOn = true;
    world.addWalkArea(this.area());
    // Jef on the fore deck, forward of the gangway, looking over the pontoon at the town
    const [sx, sz] = this.snap(-0.2, 5.4);
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
        if (!h.face || SKIP.test(h.object.name)) continue;
        n.copy(h.face.normal).transformDirection(h.object.matrixWorld);
        if (n.y < 0.2) continue;
        out.push(h.point.y - y0);
      }
      return out;
    };
    for (let j = 0; j < nz; j++)
      for (let i = 0; i < nx; i++) {
        const hs = hitsAt(GX0 + (i + 0.5) * CELL, GZ0 + (j + 0.5) * CELL);
        const deck = hs.filter((h) => h > 0.15);
        if (!deck.length) continue;
        const f = Math.min(...deck);
        floor[j * nx + i] = f;
        if (deck.some((h) => h > f + 0.25)) high[j * nx + i] = 1;
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
    // the mast: a thin spar a ray from above rarely meets; the tall things' 1 m cells (boats.ts tall)
    // searched on a 0.1 m grid for what stands high, and the deck cells round it shut
    for (const [tx, tz] of this.boats!.tall("paddle_tug", 3.0)) {
      if (tz < GZ0 - 0.5 || tz > GZ1 + 0.5) continue;
      for (let a = -0.45; a <= 0.46; a += 0.1)
        for (let b = -0.45; b <= 0.46; b += 0.1) {
          const px = tx + a;
          const pz = tz + b;
          if (!hitsAt(px, pz).some((h) => h > 2.6)) continue;
          for (let j = 0; j < nz; j++)
            for (let i = 0; i < nx; i++) {
              const lx = GX0 + (i + 0.5) * CELL;
              const lz = GZ0 + (j + 0.5) * CELL;
              if (Math.abs(lx - px) < 0.2 && Math.abs(lz - pz) < 0.2) walk[j * nx + i] = 0;
            }
        }
    }
    // only the deck he stands on: one piece, flooded from the middle of the fore deck
    const keep = new Uint8Array(nx * nz);
    const i0 = Math.floor((0 - GX0) / CELL);
    let j0 = Math.floor((GANGWAY_LZ - GZ0) / CELL);
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
    // the gangway's row: the deck, the rail on the pontoon side (+x), the rail's top
    const jg = Math.floor((GANGWAY_LZ - GZ0) / CELL);
    let deckH = NaN;
    let lxIn = 0;
    for (let i = 0; i < nx; i++) {
      const lx = GX0 + (i + 0.5) * CELL;
      if (lx >= 0 && keep[jg * nx + i]) {
        deckH = Number.isNaN(deckH) ? floor[jg * nx + i] : deckH;
        lxIn = lx;
      }
    }
    let lxRail = lxIn + 0.4;
    let hRail = Number.isNaN(deckH) ? 1.35 : deckH + 0.75;
    for (let i = nx - 1; i >= 0; i--) {
      const lx = GX0 + (i + 0.5) * CELL;
      const hs = hitsAt(lx, GANGWAY_LZ).filter((h) => h > 0.15);
      if (lx > lxIn && hs.length) {
        lxRail = lx;
        hRail = Math.max(...hs);
        break;
      }
    }
    if (!Number.isNaN(deckH)) this.gang = { lxRail, hDeck: deckH, hRail: Math.min(hRail, deckH + 1.1), lxIn: Math.max(0.2, Math.min(lxIn - 0.5, lxRail - 1.5)) };
    // (the inboard step: 1.5 m of run for the rail's 0.75 m, so no rise over a step of 0.36 m per half metre)
  }

  /** The nearest walkable deck cell to (lx, lz), model frame. */
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

  /** The ferry's waterline now (her float rides the tide; the bob is a few cm). */
  private waterline(): number {
    return (this.outer?.position.y ?? 0) + (this.inner?.position.y ?? 0);
  }

  /** Deck height (world) at a model-frame point. */
  private deckY(lx: number, lz: number): number {
    const k = this.cellAt(lx, lz);
    const f = k >= 0 ? this.grid!.floor[k] : NaN;
    return this.waterline() + (Number.isNaN(f) ? this.gang.hDeck : f);
  }

  /** The pontoon's deck (world): rijnkaai.ts gives it past the plank's reach. */
  private pontoonY(): number {
    return this.d.world.baseAt(PONTOON_X, PONTOON_WALK_END + 0.5);
  }

  /** On the gangway's line (world): z from the inboard foot to the landing. */
  private gangwayZ(): { zIn: number; zRail: number; zLand: number } {
    const [, zIn] = this.toWorld(this.gang.lxIn, GANGWAY_LZ);
    const [, zRail] = this.toWorld(this.gang.lxRail, GANGWAY_LZ);
    return { zIn, zRail, zLand: LAND_Z };
  }

  private onGangway(x: number, z: number): boolean {
    if (!this.deckOn || this.plankUp > 0.02) return false;
    const { zIn } = this.gangwayZ();
    return Math.abs(x - PONTOON_X) < GANG_HALF && z > zIn && z <= PONTOON_END + 0.1;
  }

  /** Floor along the gangway: up the inboard step to the rail's top, then the plank to the pontoon. */
  private gangwayY(z: number): number {
    const { zIn, zRail } = this.gangwayZ();
    const w = this.waterline();
    const hIn = w + this.gang.hDeck;
    const hRail = w + this.gang.hRail;
    const hLand = this.pontoonY();
    if (z <= zRail) return hIn + (hRail - hIn) * THREE.MathUtils.clamp((z - zIn) / Math.max(0.3, zRail - zIn), 0, 1);
    return hRail + (hLand - hRail) * THREE.MathUtils.clamp((z - zRail) / Math.max(0.3, LAND_Z - zRail), 0, 1);
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
    return Math.abs(lx) < 4.2 && lz > -10.5 && lz < 10.8;
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
        if (this.onGangway(x, z)) return z > LAND_Z ? this.pontoonY() : this.gangwayY(z);
        if (this.inStrip(x, z) && z > PONTOON_END - 0.2) return this.pontoonY();
        const [lx, lz] = this.toLocal(x, z);
        return this.deckY(lx, lz);
      },
      hits: () => false,
    };
  }

  /** The gangway: a short step inboard up to the rail, and the plank from the rail to the pontoon. */
  private buildPlank(): void {
    const m = this.d.world.mats;
    const outer = this.outer!;
    const g = this.gang;
    // model frame of the plank's far end: the landing on the pontoon (the pontoon floats on the same river)
    const [lxLand] = this.toLocal(PONTOON_X, LAND_Z);
    const hLand = this.pontoonY() - outer.position.y;
    const dx = lxLand - g.lxRail;
    const dy = hLand - g.hRail;
    const L = Math.hypot(dx, dy);
    // outer's own frame is the model frame (x across, z along): the pivot at the rail's top
    const pivot = new THREE.Group();
    pivot.position.set(g.lxRail, g.hRail, GANGWAY_LZ);
    const plank = new THREE.Group();
    plank.rotation.z = Math.atan2(dy, dx);
    plank.add(box(L + 0.2, 0.08, 1.0, m.planks, L / 2, -0.03, 0, 1.5));
    for (let i = 1; i < 8; i++) plank.add(box(0.07, 0.05, 0.9, m.darkWood, (L * i) / 8, 0.03, 0, 1));
    for (const s of [-0.5, 0.5]) {
      plank.add(rod(new THREE.Vector3(0, 0.95, s), new THREE.Vector3(L, 0.95, s), 0.025, m.rope));
      for (const k of [0.04, 0.5, 0.96]) plank.add(box(0.05, 0.95, 0.05, m.darkWood, L * k, 0.47, s, 1));
    }
    pivot.add(plank);
    outer.add(pivot);
    this.plankPivot = pivot;
    // the inboard step: a box of treads from the deck up to the rail's top
    const rise = Math.max(0.1, g.hRail - g.hDeck);
    const run = Math.max(0.3, g.lxRail - g.lxIn);
    const step = new THREE.Group();
    const n = Math.max(2, Math.round(rise / 0.25));
    for (let i = 0; i < n; i++) {
      const h = (rise * (i + 1)) / n;
      const x0 = g.lxIn + (run * i) / n;
      step.add(box(g.lxRail - x0, h, 1.0, m.darkWood, (x0 + g.lxRail) / 2, g.hDeck + h / 2, GANGWAY_LZ, 1));
    }
    step.name = "arrival_step";
    outer.add(step);
  }

  // ------------------------------------------------------------------ people aboard

  private addPeople(): void {
    const { zIn } = this.gangwayZ();
    const shore: Array<[number, number]> = [
      [PONTOON_X, zIn - 0.1],
      [PONTOON_X, LAND_Z + 0.4],
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
    ];
    const spots: Array<{ kind: HumanKind; l: [number, number]; at: number; speed: number }> = [
      { kind: "fishwife_a", l: [-0.6, 3.6], at: 2, speed: 1.05 },
      { kind: "old_man", l: [0.9, 5.2], at: 5.5, speed: 0.95 },
      { kind: "docker_b", l: [-0.9, 5.4], at: 8.5, speed: 1.25 },
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
        speed: s.speed,
        gone: false,
        mover: { minX: x - 0.25, maxX: x + 0.25, minZ: z - 0.25, maxZ: z + 0.25 },
        wait: 0,
        push: 0,
      };
      this.passengers.push(p);
      this.d.world.addMover(p.mover);
    });
    // the ferryman: at the rail by the gangway's inboard foot, facing the pontoon
    const root = new THREE.Group();
    const [fx, fz] = this.snap(this.gang.lxIn - 0.2, GANGWAY_LZ - 1.1);
    const fy = this.deckY(fx, fz) - this.outer!.position.y;
    root.position.set(fx, fy, fz);
    root.rotation.y = Math.PI / 2; // model +x: toward the pontoon
    this.outer!.add(root);
    this.ferryman = { human: null, root, motion: "behind" };
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
          h.play("behind", 0);
        }
      }
    };
    dress();
    whenHumans(dress);
  }

  private updatePassengers(dt: number): void {
    const { world, player } = this.d;
    for (const p of this.passengers) {
      if (p.gone) continue;
      let moving = false;
      if (this.t >= p.at && p.way.length) {
        const [tx, tz] = p.way[0];
        const dx = tx - p.x;
        const dz = tz - p.z;
        const len = Math.hypot(dx, dz);
        if (len < 0.08) p.way.shift();
        else {
          const ux = dx / len;
          const uz = dz / len;
          // Jef in the way just ahead: wait a moment, then squeeze past
          const jx = player.x - p.x;
          const jz = player.z - p.z;
          const ahead = jx * ux + jz * uz;
          const side = Math.abs(jx * uz - jz * ux);
          const blocked = ahead > 0 && ahead < 1.0 && side < 0.6;
          if (blocked && p.push <= 0) {
            p.wait += dt;
            if (p.wait > 3) {
              p.push = 2;
              p.wait = 0;
            }
          } else {
            if (p.push > 0) p.push -= dt;
            if (!blocked) p.wait = 0;
            const step = Math.min(len, p.speed * dt);
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
        continue;
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
        if (moving) p.human.setPace(p.speed);
        p.human.update(dt);
        p.root.position.set(p.x, world.baseAt(p.x, p.z) + p.human.bob(), p.z);
        p.root.rotation.y = p.facing;
      }
    }
  }

  private updateFerryman(dt: number): void {
    const f = this.ferryman;
    if (!f?.human) return;
    let m: Motion = "behind";
    if (this.stage === "hauling") m = "pull";
    else if (this.stage === "moored" && this.t - this.saidAt < 3) m = "talk";
    if (m !== f.motion) {
      f.motion = m;
      f.human.play(m, 0.3);
    }
    f.human.update(dt);
    // face Jef while he is aboard
    if (this.stage === "moored" && this.outer) {
      const [lx, lz] = this.toLocal(this.d.player.x, this.d.player.z);
      const want = Math.atan2(lx - f.root.position.x, lz - f.root.position.z);
      let d = want - f.root.rotation.y;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      f.root.rotation.y += d * Math.min(1, dt * 2.5);
    }
  }

  private saidAt = -99;
  private say(text: string): void {
    this.saidAt = this.t;
    this.d.say(text);
  }

  // ------------------------------------------------------------------ the frame

  /** Jef on the ferry's deck or her gangway (not yet on the pontoon)? */
  private aboard(): boolean {
    const { x, z } = this.d.player;
    if (z < PONTOON_END - 0.05 && this.onDeckZone(x, z)) return true;
    return this.deckOn && Math.abs(x - PONTOON_X) < GANG_HALF && z >= this.gangwayZ().zIn && z < ASHORE_Z;
  }

  update(dt: number): void {
    if (this.stage === "gone") {
      this.tidy();
      // the passengers still walking into town go on to the end of their way
      if (this.passengers.length) {
        this.updatePassengers(dt);
        if (this.passengers.every((p) => p.gone)) this.passengers.length = 0;
      }
      return;
    }
    if (this.stage === "waiting") {
      const b = this.d.world.boats();
      if (b) this.setup(b);
      return;
    }
    const { player } = this.d;
    const inHand = player.locked || player.freeInput || player.testInput;
    if (inHand) this.t += dt;
    this.stageT += dt;
    if (this.stage === "moored") {
      if (inHand && !this.hinted) {
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
        } else if (this.idle >= WALK_OFF_AT) this.startWalkOff();
      }
      // off the deck and the plank: ashore (also when a dev jump took him elsewhere)
      if (this.placed && !this.aboard() && !this.guided) this.goAshore();
    } else if (this.stage === "hauling") {
      this.plankUp = Math.min(1, this.plankUp + dt / 3.2);
      if (this.plankPivot) this.plankPivot.rotation.z = this.plankUp * 1.2;
      if (this.stageT > 4.2) {
        this.stage = "leaving";
        this.stageT = 0;
        this.castOff();
      }
    } else if (this.stage === "leaving") this.steam(dt);
    this.updatePassengers(dt);
    this.updateFerryman(dt);
  }

  private startWalkOff(): void {
    const { player } = this.d;
    const { zIn } = this.gangwayZ();
    const [lx, lz] = this.toLocal(player.x, player.z);
    const way: Array<[number, number]> = [];
    // round the deck to the gangway's foot, then down it
    const [ax, az] = this.toWorld(Math.min(lx, this.gang.lxIn - 0.4), GANGWAY_LZ + (lz > GANGWAY_LZ ? 0.3 : -0.3));
    way.push([ax, az], [PONTOON_X, zIn - 0.1], [PONTOON_X, LAND_Z + 0.2], [PONTOON_X, ASHORE_Z + 1.5]);
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
        this.goAshore();
      }
      return;
    }
    const step = Math.min(len, 1.1 * dt);
    player.x += (dx / len) * step;
    player.z += (dz / len) * step;
    // facing where he goes (yaw 0 looks along -z)
    player.yaw = Math.atan2(-dx, -dz);
  }

  private goAshore(): void {
    this.stage = "hauling";
    this.stageT = 0;
    this.say(ASHORE_HINT);
    if (!this.ashoreSent) {
      this.ashoreSent = true;
      const f = this.d.fetch ?? fetch;
      void f("/api/arrival/ashore", { method: "POST", signal: AbortSignal.timeout(8000) }).catch(() => {});
    }
  }

  private castOff(): void {
    const b = this.boats;
    const o = this.outer;
    if (!b || !o) return;
    // nobody may stand on her now: the deck is no longer ground
    this.deckOn = false;
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
    // ahead, slowly at first, easing away from the pontoon's barges and out down river
    // (a slow paddle ferry: 2.4 m/s, a minute to be lost in the fog; the ferryman's boathook pushes
    // her off the pontoon sideways at first, so her paddle box clears the barges' ends)
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
      this.waterRect.minX = o.position.x - 10;
      this.waterRect.maxX = o.position.x + 10;
      this.waterRect.minZ = o.position.z - 10;
      this.waterRect.maxZ = o.position.z + 10;
    }
    const { player } = this.d;
    const far = Math.hypot(player.x - o.position.x, player.z - o.position.z);
    if (far > 150 || o.position.x < -420 || this.stageT > 240) this.finish();
  }

  private finish(): void {
    this.stage = "gone";
    this.dropSound?.();
    this.dropSound = null;
    if (this.waterRect) this.d.world.removeWaterSolid(this.waterRect);
    this.waterRect = null;
    this.ferryman?.human?.dispose();
    this.outer?.removeFromParent();
    // the landing at the pontoon's end goes back to the walk map (unless he stands on it)
    const { x, z } = this.d.player;
    if (!this.inStrip(x, z)) this.stripOn = false;
  }

  /** The strip stays ground while he stands on it after the ferry has gone; this lets it go when he leaves. */
  tidy(): void {
    if (this.stage === "gone" && this.stripOn) {
      const { x, z } = this.d.player;
      if (!this.inStrip(x, z)) this.stripOn = false;
    }
  }

  /** The path check (__scheldemist.paths): while she lies at the pontoon, Jef's place on deck. */
  pathPoints(): Array<{ x: number; z: number; reach: number; label: string }> {
    if (!this.deckOn || !this.outer) return [];
    const [lx, lz] = this.snap(-0.2, 5.4);
    const [x, z] = this.toWorld(lx, lz);
    return [{ x, z, reach: 1.2, label: "the ferry's fore deck (the opening)" }];
  }

  /** Dev: where the opening stands, and the deck as text (# walkable, . deck not walked, space none). */
  info(map = false): Record<string, unknown> {
    const out: Record<string, unknown> = {
      stage: this.stage,
      measureMs: +this.measureMs.toFixed(0),
      t: +this.t.toFixed(1),
      idle: +this.idle.toFixed(1),
      aboard: this.placed ? this.aboard() : null,
      gangway: this.gang,
      ferry: this.outer ? [+this.outer.position.x.toFixed(1), +this.outer.position.z.toFixed(1)] : null,
      passengers: this.passengers.map((p) => `${p.kind} ${p.gone ? "gone" : `${p.x.toFixed(1)},${p.z.toFixed(1)}`}`),
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
