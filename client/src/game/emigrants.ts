import * as THREE from "three";
import type { Convo, Pt, PushMsg, TownResident } from "../net/api";
import type { FirstPerson } from "../player/firstPerson";
import type { World } from "../world/rijnkaai";
import { psx } from "../retro/psx";
import { omnibusKeepOut } from "../world/omnibus";
import { trackKeepOut, type TrackData } from "../world/tracks";
import { marketKeepOut } from "./market";
import { makeGoods } from "./props";
import { makeHuman, type Human, type HumanKind } from "./humans";
import type { Bubbles } from "./bubbles";
import type { Crowd, Puppet } from "./crowd";
import type { Jobs } from "./jobs";
import type { Town } from "./town";
import CITY from "../../../shared/city.json";

// Emigrants on the Rijnkaai (M6; server town/emigrants.ts owns every fact and number).
//
// This side shows them: the families' chests, bundles, rolled featherbeds and baskets on the quay
// (the men sit on the chests, the women stand by them, a mother rocks her baby, the children play
// tag round the heap: town.ts walks the people), the Logement's sign and the Red Star Line's
// notice board, the runner at a family's elbow with his papers, and the boarding: on the ship's
// day, when a lighter lies at the berth (world/anchorage.ts), the family walks down to the quay
// edge, the chests are lowered, and they stand on the lighter's deck and wave as she goes out to
// the Kempenland. The client says when a family went down into a lighter; the server checks it.

interface CampProp {
  kind: "chest" | "bundle" | "featherbed" | "basket";
  x: number;
  z: number;
  yaw: number;
}
interface FamView {
  n: number;
  household: number;
  surname: string;
  from: string;
  country: string;
  slot: number;
  members: string[];
  head: string;
  baby: { mother: string; child: string } | null;
  props: CampProp[];
  board_day: number;
  boarding_today: boolean;
  waiting_for_jef: boolean;
  arrived_at: number;
  luggage: "offered" | "taken" | "done" | null;
}
interface View {
  day: number;
  hour: number;
  ship: { today: boolean; from: number; to: number; next: number };
  logement: { house: number; step: Pt; wall: Pt; out: Pt; label: string; shared: boolean };
  keeper: string;
  arrival: Pt;
  camps: Array<{ slot: number; x: number; z: number; yaw: number }>;
  families: FamView[];
  runner: { id: string; jailed: boolean; working: number | null; state: string | null };
  residents: TownResident[];
}

/** The lighters as world/anchorage.ts shows them (its dev object; see docs/milestones/M6-emigrants.md for the hook asked of main). */
interface TowInfo {
  phase: "run" | "in" | "dwell" | "out";
  to: "liner" | "quay";
  dwell: number;
  crab: number;
  x: number;
  z: number;
}
interface AnchorageDev {
  tows(): TowInfo[];
  hulls(): THREE.Object3D[];
}
const anchorage = (): AnchorageDev | null => (window as unknown as { __anchorage?: AnchorageDev }).__anchorage ?? null;

/** Where Jef can see the berth from (the boarding is played out in the street only within this). */
const BERTH: Pt = [28, 4];
const SEE_BERTH = 75;
/** On the lighter's deck (her frame: +x is the side against the quay at the berth, +z her bow). */
const DECK_Y = 0.62;
const DECK_PEOPLE: Pt[] = [
  // by the rail on the quay side, both ends in turn (the cargo lies amidships)
  [1.45, -7.2], [1.45, 7.2], [1.45, -6.2], [1.45, 6.2], [0.5, -7.8], [0.5, 7.7], [1.45, -5.3], [1.45, 5.3], [-0.4, -7.2], [-0.4, 7.2], [0.4, -6.5], [0.4, 6.6],
];
const DECK_CHESTS: Pt[] = [[-1.3, -8.2], [-1.3, 8.1], [-1.3, -7.2], [-1.3, 7.1], [-0.2, -8.5], [-0.2, 8.4]];
const WALK_TIMEOUT = 45;

const dist = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The server's answer as a view, or null when it is not one (empty, an error page, a half answer). */
function sane(raw: unknown): View | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Partial<View>;
  if (!Array.isArray(v.families)) return null;
  const families = v.families.filter((f): f is FamView => !!f && typeof f === "object" && typeof f.household === "number" && Array.isArray(f.members));
  for (const f of families) if (!Array.isArray(f.props)) f.props = [];
  return {
    ...(v as View),
    families,
    residents: Array.isArray(v.residents) ? v.residents : [],
    camps: Array.isArray(v.camps) ? v.camps : [],
  };
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string; why?: string };
  if (!res.ok) throw new Error(data.error ?? data.why ?? `HTTP ${res.status}`);
  return data;
}

interface Camp {
  fam: FamView;
  group: THREE.Group;
  chests: THREE.Object3D[];
  rest: THREE.Object3D[];
}

interface Boarding {
  fam: FamView;
  tow: number;
  t: number;
  walkers: Map<string, { p: Puppet; to: Pt }>;
  aboard: string[];
  chestsLowered: boolean;
  reported: boolean;
}

interface DeckFolk {
  human: Human;
  at: Pt;
  wave: number;
  arm: THREE.Object3D | null;
}
interface Deck {
  group: THREE.Group;
  folk: DeckFolk[];
  chests: THREE.Object3D[];
  /** Lowering chests: from (world) to their slot on deck, t 0..1. */
  lowering: Array<{ obj: THREE.Object3D; from: THREE.Vector3; slot: Pt; t: number }>;
  left: boolean;
}

export class Emigrants {
  view: View | null = null;
  private loaded = false;
  private readonly group = new THREE.Group();
  private camps = new Map<number, Camp>();
  private babies = new Map<string, THREE.Object3D>();
  private boarding = new Map<number, Boarding>();
  /** Residents gone down into a lighter here (the server may not know yet): never put back in the town. */
  private leaving = new Set<string>();
  private decks = new Map<number, Deck>();
  private pollT = 0;
  private thinkT = 0;
  private runnerHeld: { id: string; household: number; talkT: number; line: number } | null = null;
  private board: { mesh: THREE.Mesh; tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; text: string } | null = null;
  private signs: THREE.Object3D[] = [];
  private kinds = new Map<string, string>();
  private t = 0;
  private busy = false;
  /** Dev: what happened, newest last. */
  readonly log: string[] = [];
  /** Dev: camp props that fell on a rail, the omnibus lane or a market (never placed). */
  skipped: string[] = [];

  constructor(
    private readonly world: World,
    private readonly player: FirstPerson,
    private readonly jobs: Jobs,
    private readonly town: Town,
    private readonly crowd: Crowd,
    private readonly bubbles: Bubbles,
  ) {
    this.group.name = "emigrants";
    world.scene.add(this.group);
    void this.refresh();
  }

  handlePush(m: PushMsg): void {
    if (m.type === "emigrants") void this.refresh();
  }

  /** The one wait for the town to load (a push meanwhile does not start a second loop). */
  private retry = 0;
  async refresh(): Promise<void> {
    if (this.busy) return;
    if (!this.town.data) {
      if (!this.retry)
        this.retry = window.setTimeout(() => {
          this.retry = 0;
          void this.refresh();
        }, 1500);
      return;
    }
    this.busy = true;
    try {
      this.apply(await call<unknown>("GET", "/api/emigrants"));
    } catch {
      /* the next poll tries again */
    } finally {
      this.busy = false;
    }
  }

  // ------------------------------------------------------------------ the families in town

  private apply(raw: unknown): void {
    // a bad or empty answer (QA 2026-09-24): keep the last good view, and the next poll tries again
    const v = sane(raw);
    if (!v) return;
    const first = !this.loaded;
    this.view = v;
    for (const r of v.residents) if (r?.id) this.kinds.set(r.id, r.kind);
    // new people come in from the station road; a changed record (the runner in the cell) takes effect
    const fresh = v.residents.filter((r) => r?.id && !this.leaving.has(r.id));
    const known = fresh.filter((r) => this.town.has(r.id));
    const newcomers = fresh.filter((r) => !this.town.has(r.id));
    this.town.upsertResidents(known);
    if (newcomers.length) {
      const added = this.town.upsertResidents(newcomers, first ? undefined : v.arrival);
      if (added.length && !first) this.note(`arrived: ${added.join(", ")}`);
    }
    // families gone (the last lighter, or another client): out of the town
    const here = new Set(v.families.map((f) => f.household));
    for (const [hh, c] of this.camps) {
      if (here.has(hh) || this.boarding.has(hh)) continue;
      for (const id of c.fam.members) this.town.dropResident(id);
      this.removeCamp(hh);
    }
    for (const f of v.families) {
      const c = this.camps.get(f.household);
      if (c) c.fam = f;
      else if (!this.boarding.has(f.household)) this.buildCamp(f);
    }
    this.buildSigns(v);
    this.loaded = true;
  }

  private note(s: string): void {
    this.log.push(`${this.jobs.day.dayNum} ${this.jobs.day.hourF.toFixed(2)} ${s}`);
    if (this.log.length > 40) this.log.shift();
  }

  // ------------------------------------------------------------------ their things on the quay

  private mats: Record<string, THREE.Material> | null = null;
  private geos: Record<string, THREE.BufferGeometry> | null = null;
  private parts() {
    this.mats ??= {
      linenBlue: psx(new THREE.MeshLambertMaterial({ color: 0x4d5a78 })),
      linenRed: psx(new THREE.MeshLambertMaterial({ color: 0x7a3d32 })),
      linenGrey: psx(new THREE.MeshLambertMaterial({ color: 0x6e695c })),
      ticking: psx(new THREE.MeshLambertMaterial({ color: 0xcfc6b0 })),
      cord: psx(new THREE.MeshLambertMaterial({ color: 0x3a3024 })),
      wicker: psx(new THREE.MeshLambertMaterial({ color: 0x86683c })),
      shawl: psx(new THREE.MeshLambertMaterial({ color: 0xddd3bc })),
      face: psx(new THREE.MeshLambertMaterial({ color: 0xc89c80 })),
      board: psx(new THREE.MeshLambertMaterial({ color: 0x3b2c20 })),
    };
    this.geos ??= {
      bundle: new THREE.IcosahedronGeometry(0.3, 0).scale(1.25, 0.75, 1).translate(0, 0.22, 0),
      knot: new THREE.IcosahedronGeometry(0.08, 0).translate(0, 0.47, 0),
      bed: new THREE.CylinderGeometry(0.3, 0.3, 1.15, 7).rotateZ(Math.PI / 2).translate(0, 0.3, 0),
      band: new THREE.CylinderGeometry(0.315, 0.315, 0.05, 7).rotateZ(Math.PI / 2).translate(0, 0.3, 0),
      basket: new THREE.CylinderGeometry(0.22, 0.16, 0.26, 7).translate(0, 0.13, 0),
      handle: new THREE.TorusGeometry(0.17, 0.02, 3, 8, Math.PI).translate(0, 0.26, 0),
      baby: new THREE.IcosahedronGeometry(0.12, 0).scale(1, 0.8, 1.7),
      head: new THREE.IcosahedronGeometry(0.055, 0),
    };
    return { m: this.mats, g: this.geos };
  }

  private propMesh(p: CampProp, i: number): THREE.Object3D {
    const { m, g } = this.parts();
    const o = new THREE.Group();
    switch (p.kind) {
      case "chest":
        o.add(makeGoods("chests", this.world.mats));
        break;
      case "bundle": {
        const cloth = [m.linenBlue, m.linenRed, m.linenGrey][i % 3];
        o.add(new THREE.Mesh(g.bundle, cloth), new THREE.Mesh(g.knot, cloth));
        break;
      }
      case "featherbed": {
        o.add(new THREE.Mesh(g.bed, m.ticking));
        for (const x of [-0.35, 0.35]) {
          const b = new THREE.Mesh(g.band, m.cord);
          b.position.x = x;
          o.add(b);
        }
        break;
      }
      case "basket":
        o.add(new THREE.Mesh(g.basket, m.wicker), new THREE.Mesh(g.handle, m.wicker));
        break;
    }
    o.position.set(p.x, 0, p.z);
    o.rotation.y = p.yaw;
    return o;
  }

  private keepOuts: Array<{ minX: number; maxX: number; minZ: number; maxZ: number }> | null = null;
  /** Off the rails, the omnibus lane and the markets, and on open ground (the task: keep the props clear). */
  private clear(x: number, z: number): string | null {
    this.keepOuts ??= [...omnibusKeepOut(), ...trackKeepOut((CITY as unknown as { decor: TrackData }).decor), ...marketKeepOut()];
    if (this.keepOuts.some((r) => x > r.minX - 0.4 && x < r.maxX + 0.4 && z > r.minZ - 0.4 && z < r.maxZ + 0.4)) return "keep-out";
    if (z < 12) return "berth"; // the quay edge, the crane rails and the berth are for the lighters
    if (!this.world.isFree(x, z, 0.3)) return "solid";
    return null;
  }

  private buildCamp(f: FamView): void {
    const group = new THREE.Group();
    group.name = `emigrants_${f.surname}`;
    const chests: THREE.Object3D[] = [];
    const rest: THREE.Object3D[] = [];
    f.props.forEach((p, i) => {
      const why = this.clear(p.x, p.z);
      if (why) {
        this.skipped.push(`${f.surname} ${p.kind} at (${p.x}, ${p.z}): ${why}`);
        return;
      }
      const o = this.propMesh(p, i);
      group.add(o);
      (p.kind === "chest" ? chests : rest).push(o);
    });
    this.group.add(group);
    this.camps.set(f.household, { fam: f, group, chests, rest });
    if (f.baby) {
      const { m, g } = this.parts();
      const b = new THREE.Group();
      const body = new THREE.Mesh(g.baby, m.shawl);
      const head = new THREE.Mesh(g.head, m.face);
      head.position.set(0, 0.04, 0.17);
      b.add(body, head);
      b.visible = false;
      this.group.add(b);
      this.babies.set(f.baby.mother, b);
    }
  }

  private removeCamp(hh: number): void {
    const c = this.camps.get(hh);
    if (!c) return;
    c.group.removeFromParent();
    if (c.fam.baby) {
      this.babies.get(c.fam.baby.mother)?.removeFromParent();
      this.babies.delete(c.fam.baby.mother);
    }
    this.camps.delete(hh);
  }

  // ------------------------------------------------------------------ signs

  private buildSigns(v: View): void {
    if (!this.signs.length && v.logement?.wall && v.logement.out) {
      const lg = v.logement;
      this.signs.push(this.sign(lg.wall, lg.out, ["LOGEMENT", "BEDS FOR EMIGRANTS"], "#2d3a4a", 3.3));
    }
    if (!v.ship) return;
    const next = v.ship.today && v.hour < v.ship.to ? "TODAY" : (DAYS[(((v.ship.next - 1) % 7) + 7) % 7] ?? "SOON").toUpperCase();
    const text = `RED STAR LINE|ANTWERP - PHILADELPHIA|S.S. KEMPENLAND AT ANCHOR|EMIGRANTS BOARD ${next}|LIGHTERS FROM THIS QUAY`;
    if (!this.board) this.board = this.noticeBoard();
    if (this.board.text !== text) {
      this.board.text = text;
      const g = this.board.ctx;
      g.fillStyle = "#d9cfae";
      g.fillRect(0, 0, 256, 320);
      g.strokeStyle = "#5a4a30";
      g.lineWidth = 6;
      g.strokeRect(6, 6, 244, 308);
      g.textAlign = "center";
      g.textBaseline = "middle";
      const lines = text.split("|");
      g.fillStyle = "#8a1e1a";
      g.font = "bold 30px 'Scheldemist Print', Georgia, 'Times New Roman', serif";
      g.fillText(lines[0], 128, 42);
      // the red star
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 11 : 26;
        g.lineTo(128 + Math.cos(a) * r, 98 + Math.sin(a) * r);
      }
      g.fill();
      g.fillStyle = "#2a2018";
      g.font = "bold 19px 'Scheldemist Print', Georgia, serif";
      lines.slice(1).forEach((l, i) => g.fillText(l, 128, 150 + i * 40));
      this.board.tex.needsUpdate = true;
    }
  }

  private sign(wall: Pt, out: Pt, lines: string[], bg: string, y: number): THREE.Object3D {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d")!;
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 128);
    g.strokeStyle = "#c9b27a";
    g.lineWidth = 6;
    g.strokeRect(8, 8, 496, 112);
    g.fillStyle = "#e3cf94";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = "bold 50px 'Scheldemist Print', Georgia, 'Times New Roman', serif";
    g.fillText(lines[0], 256, 48);
    g.font = "bold 26px 'Scheldemist Print', Georgia, 'Times New Roman', serif";
    g.fillText(lines[1] ?? "", 256, 96);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 0.7), psx(new THREE.MeshLambertMaterial({ map: tex }), { affine: 0.5 }));
    m.position.set(wall[0] + out[0] * 0.42, y, wall[1] + out[1] * 0.42);
    m.rotation.y = Math.atan2(out[0], out[1]);
    this.group.add(m);
    return m;
  }

  /** The Red Star Line's notice on a board on two posts, behind the families' places. */
  private boardAt: Pt = [24, 33];
  private noticeBoard(): { mesh: THREE.Mesh; tex: THREE.CanvasTexture; ctx: CanvasRenderingContext2D; text: string } {
    const { m } = this.parts();
    for (const [x, z] of [[24, 33], [37.5, 32], [24, 30.5], [16, 30]] as Pt[]) {
      if (!this.clear(x, z) && this.world.isFree(x, z, 0.9)) {
        this.boardAt = [x, z];
        break;
      }
    }
    const [x, z] = this.boardAt;
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 320;
    const ctx = c.getContext("2d")!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = false;
    const g = new THREE.Group();
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 1.0), psx(new THREE.MeshLambertMaterial({ map: tex }), { affine: 0.5 }));
    face.position.set(0, 1.55, -0.04);
    face.rotation.y = Math.PI; // facing the quay (-z)
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.1, 0.05), m.board);
    back.position.y = 1.55;
    g.add(back, face);
    for (const px of [-0.4, 0.4]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.1, 0.08), m.board);
      post.position.set(px, 1.05, 0);
      g.add(post);
    }
    g.position.set(x, 0, z);
    this.group.add(g);
    this.world.addCollider({ minX: x - 0.5, maxX: x + 0.5, minZ: z - 0.15, maxZ: z + 0.15 });
    return { mesh: face, tex, ctx, text: "" };
  }

  // ------------------------------------------------------------------ per frame

  update(dt: number): void {
    // the poll first: one bad or empty answer must never stop it (QA 2026-09-24)
    if ((this.pollT -= dt) <= 0) {
      this.pollT = 6;
      void this.refresh();
    }
    const v = this.view;
    if (!v?.families) return;
    this.t += dt;
    const hour = this.jobs.day.hourF;
    const px = this.player.x;
    const pz = this.player.z;
    // the things on the quay: out by day (and while anyone of the family sits there), in at night
    for (const c of this.camps.values()) {
      const f = c.fam;
      const near = dist(px, pz, c.group.children[0]?.position.x ?? 0, c.group.children[0]?.position.z ?? 0) < 90;
      const someone = f.members.some((id) => {
        const q = this.town.position(id);
        return q && dist(q.x, q.z, f.props[0]?.x ?? 0, f.props[0]?.z ?? 0) < 8;
      });
      const day = (hour >= 7.25 && hour < 18.25) || someone;
      c.group.visible = near && day && !this.boarding.has(f.household);
      const chestsAway = f.luggage === "taken" || f.luggage === "done";
      for (const o of c.chests) o.visible = !chestsAway;
    }
    this.rockBabies(dt);
    if ((this.thinkT -= dt) <= 0) {
      this.thinkT = 0.5;
      this.startBoardings(v, hour);
      this.runnerScene(v);
    }
    this.walkBoardings(dt);
    this.updateDecks(dt);
  }

  /** A mother with her baby in her arms: the bundle before her, rocking; now and then she hushes it. */
  private rockBabies(dt: number): void {
    for (const [mother, b] of this.babies) {
      const p = this.town.puppet(mother);
      // (not tied to p.shown: a small mesh, and a picture from another camera must still show it)
      if (!p || !this.crowd.alive(p)) {
        b.visible = false;
        continue;
      }
      b.visible = true;
      const s = p.human.scale * p.size;
      const fx = Math.sin(p.yaw);
      const fz = Math.cos(p.yaw);
      const walking = this.crowd.puppetBusy(p);
      const sway = walking ? 0 : Math.sin(this.t * 2.2 + mother.length) * 0.18;
      b.position.set(p.x + fx * 0.2 * s, 1.08 * s + p.drop, p.z + fz * 0.2 * s);
      b.rotation.set(0, p.yaw + Math.PI / 2, sway * 0.6);
      b.rotateX(0.35);
      // hush: turn to the child and murmur, a few seconds in every twenty
      const phase = (this.t + mother.length * 3.7) % 20;
      if (!walking && phase < dt * 1.5) this.town.gesture(mother, p.x + fx * 2, p.z + fz * 2, 3);
    }
  }

  // ------------------------------------------------------------------ the runner at a family's elbow

  private runnerScene(v: View): void {
    if (!v.runner?.id) return;
    const id = v.runner.id;
    const hh = v.runner.working;
    const fam = hh !== null ? v.families.find((f) => f.household === hh) : undefined;
    const held = this.runnerHeld;
    if (!fam || v.runner.jailed) {
      if (held) {
        this.town.release(held.id);
        this.runnerHeld = null;
        this.note("the runner leaves the family");
      }
      return;
    }
    const head = this.town.position(fam.head);
    const rp = this.town.puppet(id);
    if (!head || !rp) return;
    if (!held) {
      if (this.town.held(id)) return; // another layer has him (an event, a talk)
      const p = this.town.claim(id);
      if (!p) return;
      this.runnerHeld = { id, household: fam.household, talkT: 3, line: 0 };
      this.note(`the runner goes to the ${fam.surname} family`);
    }
    const r = this.runnerHeld!;
    // at the family's front, a step from the head of the family, turned to him
    const tx = head.x + 0.9;
    const tz = head.z - 1.1;
    if (dist(rp.x, rp.z, tx, tz) > 1.2) {
      if (!this.crowd.puppetBusy(rp)) this.crowd.puppetGo(rp, tx, tz, 1.1);
      return;
    }
    if (this.crowd.puppetBusy(rp)) return;
    r.talkT -= 0.5;
    if (r.talkT > 0) return;
    r.talkT = 9;
    this.crowd.puppetStand(rp, "talk", Math.atan2(head.x - rp.x, head.z - rp.z));
    if (dist(this.player.x, this.player.z, rp.x, rp.z) > 24) return;
    const LINES: Array<[boolean, string]> = [
      [true, "Railway tickets, from Philadelphia right to the west. Half what the office asks, my friend."],
      [false, "Half? Is true? You have a paper for it?"],
      [true, "A paper with a stamp, see here. The eagle of the railway company. Very good paper."],
      [false, "We think. The money is all we have."],
      [true, "Tomorrow the price goes up. Today only, for a family of honest people."],
      [false, "The keeper says we must go to the office. But the office is far."],
    ];
    const [runnerSpeaks, text] = LINES[r.line++ % LINES.length];
    const who = runnerSpeaks ? id : fam.head;
    const name = this.town.info(who)?.first ?? (runnerSpeaks ? "The man" : fam.surname);
    const c: Convo = { id: -900000 - Math.floor(this.t * 10), a: who, b: who, a_name: name, b_name: name, purpose: "chat", lines: [{ who, name, text }], source: "engine", outcome: "", at: Date.now(), event_id: null };
    this.bubbles.show(c);
  }

  // ------------------------------------------------------------------ boarding

  /** The lighter at the berth now, with time enough left alongside, or -1. */
  private lighterAtBerth(): number {
    const a = anchorage();
    if (!a) return -1;
    const tows = a.tows();
    for (let i = 0; i < tows.length; i++) {
      const t = tows[i];
      if (t.to === "quay" && t.phase === "dwell" && t.crab >= 0.99 && t.dwell > 25) return i;
    }
    return -1;
  }

  private startBoardings(v: View, hour: number): void {
    if (!v.ship || hour < v.ship.from || hour >= v.ship.to + 1) return;
    const tow = this.lighterAtBerth();
    if (tow < 0) return;
    // one family a lighter at a time, the first come first
    if ([...this.boarding.values()].some((b) => b.tow === tow && !b.reported)) return;
    const f = v.families
      .filter((x) => x.boarding_today && !x.waiting_for_jef && !this.boarding.has(x.household))
      .sort((a, b) => a.arrived_at - b.arrived_at)[0];
    if (!f) return;
    // everyone of the family must be free (not held by an event or a talk)
    if (f.members.some((id) => this.town.held(id))) return;
    const b: Boarding = { fam: f, tow, t: 0, walkers: new Map(), aboard: [], chestsLowered: false, reported: false };
    this.boarding.set(f.household, b);
    const lighter = anchorage()!.hulls()[tow * 2];
    const seen = dist(this.player.x, this.player.z, BERTH[0], BERTH[1]) < SEE_BERTH;
    this.note(`${f.surname}: to the lighter ${tow}${seen ? " (in sight)" : " (unseen)"}`);
    let i = 0;
    for (const id of f.members) {
      const p = seen ? this.town.puppet(id) : null;
      if (!p) {
        this.goAboard(b, id);
        continue;
      }
      // a place on the quay edge along the lighter, clear of lamps and bollards
      const x = Math.max(20, Math.min(36, lighter.position.x + (i++ - f.members.length / 2) * 1.1));
      const q = this.crowd.canStand(x, 1.2) ? { x, z: 1.2 } : this.crowd.openNear(x, 1.6) ?? { x, z: 2 };
      this.town.claim(id);
      this.crowd.puppetGo(p, q.x, q.z, 1.25);
      b.walkers.set(id, { p, to: [q.x, q.z] });
    }
  }

  private walkBoardings(dt: number): void {
    for (const b of this.boarding.values()) {
      if (b.reported) continue;
      b.t += dt;
      const t = anchorage()?.tows()[b.tow];
      const gone = !t || t.phase !== "dwell" || t.to !== "quay";
      for (const [id, w] of b.walkers) {
        if (gone || b.t > WALK_TIMEOUT || !this.crowd.alive(w.p) || dist(w.p.x, w.p.z, w.to[0], w.to[1]) < 1.3) {
          b.walkers.delete(id);
          this.goAboard(b, id);
        }
      }
      if (!b.chestsLowered && (b.aboard.length || gone)) this.lowerChests(b);
      if (!b.walkers.size && b.aboard.length === b.fam.members.length) {
        b.reported = true;
        call<{ ok: boolean }>("POST", "/api/emigrants/board", { household: b.fam.household })
          .then(() => {
            this.note(`${b.fam.surname}: aboard, told the server`);
            this.jobs.say(`The ${b.fam.surname} family went down into the lighter with their chests. She takes them out to the Kempenland.`);
          })
          .catch((e) => this.note(`${b.fam.surname}: the server said no (${(e as Error).message})`));
      }
    }
    // a boarding done and the family's camp cleared: forget it once the server has them gone
    for (const [hh, b] of this.boarding) if (b.reported && !this.view?.families.some((f) => f.household === hh)) this.boarding.delete(hh);
  }

  /** One of the family is on the lighter's deck now: out of the town, a figure on board. */
  private goAboard(b: Boarding, id: string): void {
    if (b.aboard.includes(id)) return;
    b.aboard.push(id);
    this.leaving.add(id);
    this.town.dropResident(id);
    const kind = this.kinds.get(id);
    const deck = this.deck(b.tow);
    if (!kind || !deck) return;
    // the baby rides in its mother's arms: no figure of its own
    if (b.fam.baby?.child === id) return;
    const h = makeHuman(kind as HumanKind);
    if (!h) return;
    const at = DECK_PEOPLE[deck.folk.length % DECK_PEOPLE.length];
    h.root.position.set(at[0], DECK_Y, at[1]);
    h.root.rotation.y = Math.PI / 2; // facing the quay
    h.play("idle", 0);
    deck.group.add(h.root);
    deck.folk.push({ human: h, at, wave: Math.random() * 6, arm: h.root.getObjectByName("armUpR") ?? null });
  }

  private lowerChests(b: Boarding): void {
    b.chestsLowered = true;
    const c = this.camps.get(b.fam.household);
    const deck = this.deck(b.tow);
    if (!c || !deck) {
      if (c) this.removeCamp(b.fam.household);
      return;
    }
    for (const o of c.chests) {
      if (!o.visible) continue; // Jef carried them (they lie at the berth on the quay)
      const from = new THREE.Vector3();
      o.getWorldPosition(from);
      o.removeFromParent();
      this.group.add(o);
      o.position.copy(from);
      deck.lowering.push({ obj: o, from, slot: DECK_CHESTS[(deck.chests.length + deck.lowering.length) % DECK_CHESTS.length], t: 0 });
    }
    this.removeCamp(b.fam.household);
  }

  private deck(tow: number): Deck | null {
    let d = this.decks.get(tow);
    if (d) return d;
    const hull = anchorage()?.hulls()[tow * 2];
    if (!hull) return null;
    const group = new THREE.Group();
    group.name = `emigrants_deck_${tow}`;
    this.group.add(group);
    d = { group, folk: [], chests: [], lowering: [], left: false };
    this.decks.set(tow, d);
    return d;
  }

  /** The people on the lighters ride with them, wave as she leaves, and climb up the liner's side at the other end. */
  private updateDecks(dt: number): void {
    const a = anchorage();
    if (!a) return;
    const tows = a.tows();
    const hulls = a.hulls();
    for (const [i, d] of this.decks) {
      const hull = hulls[i * 2];
      const t = tows[i];
      if (!hull || !t) continue;
      d.group.position.copy(hull.position);
      d.group.rotation.y = hull.rotation.y;
      d.group.updateMatrixWorld(true);
      // at the liner: they go up her side, the chests are swung up; the deck is empty again
      if (t.to === "liner" && t.phase === "dwell") {
        if (d.folk.length || d.chests.length) {
          for (const f of d.folk) f.human.dispose();
          for (const c of d.chests) c.removeFromParent();
          d.folk = [];
          d.chests = [];
          this.note(`lighter ${i}: her people went up into the Kempenland`);
        }
        continue;
      }
      for (const l of d.lowering) {
        l.t = Math.min(1, l.t + dt / 3.5);
        const to = new THREE.Vector3(l.slot[0], DECK_Y, l.slot[1]).applyMatrix4(d.group.matrixWorld);
        const k = l.t;
        l.obj.position.set(l.from.x + (to.x - l.from.x) * k, l.from.y + (to.y - l.from.y) * k + Math.sin(Math.PI * k) * 1.4, l.from.z + (to.z - l.from.z) * k);
        if (l.t >= 1) {
          l.obj.removeFromParent();
          d.group.add(l.obj);
          l.obj.position.set(l.slot[0], DECK_Y, l.slot[1]);
          l.obj.rotation.y = Math.PI / 2;
          d.chests.push(l.obj);
        }
      }
      d.lowering = d.lowering.filter((l) => l.t < 1);
      // leaving the quay: the ones at the rail wave to the town
      const leaving = t.to === "liner" || t.phase === "out";
      const near = dist(this.player.x, this.player.z, hull.position.x, hull.position.z) < 140;
      d.group.visible = near || leaving;
      for (const f of d.folk) {
        if (!near) continue;
        f.human.update(dt);
        if (leaving && f.arm) {
          f.wave += dt;
          const up = Math.min(1, f.wave / 0.6);
          // the upper arm raised out to the side and up, the hand going to and fro
          f.arm.rotateZ(-2.3 * up);
          f.arm.rotateX(Math.sin(f.wave * 7) * 0.35 * up);
        }
      }
    }
  }

  // ------------------------------------------------------------------ checks

  pathPoints(): Array<{ label: string; x: number; z: number; reach: number }> {
    const v = this.view;
    if (!v?.logement) return [];
    const out = [{ label: "the Logement door", x: v.logement.step[0], z: v.logement.step[1], reach: 1.8 }];
    for (const c of v.camps ?? []) out.push({ label: `the emigrants' place ${c.slot + 1}`, x: c.x, z: c.z, reach: 3 });
    out.push({ label: "the Red Star Line notice", x: this.boardAt[0], z: this.boardAt[1] - 1, reach: 2 });
    return out;
  }

  /** Dev: the families, the boardings, the decks. */
  info() {
    const v = this.view;
    return {
      families: v?.families.map((f) => ({ hh: f.household, name: f.surname, from: f.from, slot: f.slot, boarding_today: f.boarding_today, members: f.members.length, luggage: f.luggage })) ?? [],
      runner: v?.runner ?? null,
      boarding: [...this.boarding.values()].map((b) => ({ family: b.fam.surname, tow: b.tow, walking: b.walkers.size, aboard: b.aboard.length, reported: b.reported })),
      decks: [...this.decks.entries()].map(([i, d]) => ({ tow: i, folk: d.folk.length, chests: d.chests.length, lowering: d.lowering.length })),
      skipped: this.skipped,
      log: this.log.slice(-12),
    };
  }
}
