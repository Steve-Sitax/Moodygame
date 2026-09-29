import * as THREE from "three";
import { SHELL_SPACES, type ChurchOpening, type ChurchSpace } from "../../../shared/churchesShell";
import { onFace, outline, type ShellFace } from "../../../shared/shellOpening";
import { Kit, type MatDef } from "./landmarkKit";
import { lining } from "./realOpenings";
import { figure, panel, planarUV, type Hole } from "./carolusHall";
import { rand } from "./rooms";

// Issue #28 (interiors are real, docs/building-with-interior.md): the parts of the three churches behind real windows
// that are not their halls: the towers' rooms and belfries with their bells and timber, the lanterns, the stair towers
// with their newel stairs, the ridge turret, the roof spaces with their trusses, St Paul's convent, St James's
// baptistery and sacristy, the Carolus's Jesuit house, sacristy and the Lady Chapel range's rooms. Their numbers are
// the shell's (tools/blender/build_churches.py space(): shared/churchesShell.ts SHELL_SPACES, world frame); they stand
// in the hall's scene and frame (one pass for the church), a Kit per part so a part out of the view is not drawn.
// Only seen: none of them is walked (no stair or door of the halls leads there); the halls' plans do not change.
//
// Every edge of a space the shell names as its own wall is lined (world/realOpenings.ts lining: cut at the shell's
// openings on that face, from the reveals' back); the faces of the church a sacristy or a convent stands against are
// left as they are (their stone shows inside, as it would). No lights of their own: the hall's sky light lights them,
// their stone and timber tinted down (a belfry is dark, an attic darker); sound openings hold louvres, not glass.

type P2 = [number, number];
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** The materials a hall lends its spaces (all of them drawn in the hall already: no new shader kind). */
export interface SpaceMats {
  /** Whitewashed plaster (rooms, a sacristy). */
  wall: MatDef;
  /** Bare masonry (towers, belfries, attics' gables). */
  stone: MatDef;
  /** Rough oak (beams, rafters, boards, frames). */
  timber: MatDef;
  /** Carved or polished oak (furniture). */
  oak: MatDef;
  /** Stone slabs on a ground floor. */
  floor: MatDef;
  /** A plastered ceiling or a dome. */
  vault: MatDef;
  iron: MatDef;
  bronze: MatDef;
  dark: MatDef;
  marbleW: MatDef;
  marbleB: MatDef;
  gilt: MatDef;
  statue: MatDef;
  linen: MatDef;
  red: MatDef;
  blue: MatDef;
  /** A painting or two already hung in the hall. */
  pictures: MatDef[];
}

interface Edge {
  i: number;
  a: P2;
  c: P2;
  /** Unit along a -> c, and out of the space. */
  t: P2;
  n: P2;
  len: number;
  lined: boolean;
  rows: ChurchOpening[];
}

/** A space in the hall's frame. */
export interface LocalSpace {
  sp: ChurchSpace;
  poly: P2[];
  edges: Edge[];
  /** Openings on none of its edges (dormers). */
  inner: ChurchOpening[];
  rows: ChurchOpening[];
  c: P2;
}

/** The part (Kit) a space is built in: a tower and its lanterns, a house and its attic ... */
const KITS: Array<[RegExp, string]> = [
  [/^cb_(tower|belfry|lantern)/, "cb_tower"],
  [/^cb_stair_w/, "cb_stair_w"],
  [/^cb_stair_e/, "cb_stair_e"],
  [/^cb_house/, "cb_house"],
  [/^cb_chapel/, "cb_chapel"],
  [/^sp_(tower|belfry)/, "sp_tower"],
  [/^sp_attic/, "sp_attic"],
];
const kitOf = (id: string) => KITS.find(([re]) => re.test(id))?.[1] ?? id;

// ---------------------------------------------------------------- small geometry

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const dot = (a: P2, b: P2) => a[0] * b[0] + a[1] * b[1];
const add = (a: P2, b: P2, k = 1): P2 => [a[0] + b[0] * k, a[1] + b[1] * k];
const centroid = (p: P2[]): P2 => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length];

/** A convex outline moved in by d on every edge (edges in one line keep their shared corner moved in). */
function inset(poly: P2[], d: number): P2[] {
  const c = centroid(poly);
  const n = poly.length;
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % n];
    const t = sub(b, a);
    const L = Math.hypot(t[0], t[1]) || 1;
    const u: P2 = [t[0] / L, t[1] / L];
    let m: P2 = [-u[1], u[0]];
    if (dot(m, sub(c, a)) < 0) m = [-m[0], -m[1]];
    return { p: add(a, m, d), u, m };
  });
  return poly.map((_, i) => {
    const A = lines[(i + n - 1) % n];
    const B = lines[i];
    const det = A.u[0] * B.u[1] - A.u[1] * B.u[0];
    if (Math.abs(det) < 1e-6) return add(poly[i], B.m, d);
    const w = sub(B.p, A.p);
    const s = (w[0] * B.u[1] - w[1] * B.u[0]) / det;
    return add(A.p, A.u, s);
  });
}

/** A convex polygon (3D points in order) as one face toward `toward`. */
function convexGeo(pts: THREE.Vector3[], toward: THREE.Vector3, tile: number): THREE.BufferGeometry {
  const nrm = new THREE.Vector3().subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[2], pts[0]));
  for (let i = 3; nrm.lengthSq() < 1e-10 && i < pts.length; i++) nrm.subVectors(pts[1], pts[0]).cross(new THREE.Vector3().subVectors(pts[i], pts[0]));
  const flip = nrm.dot(toward) < 0;
  const pos: number[] = [];
  for (let i = 1; i + 1 < pts.length; i++) {
    const tri = flip ? [pts[0], pts[i + 1], pts[i]] : [pts[0], pts[i], pts[i + 1]];
    for (const p of tri) pos.push(p.x, p.y, p.z);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  planarUV(g, tile);
  return g;
}

/** A horizontal slab over a convex outline (local y): its top up, its underside down, its sides out. */
function slab(k: Kit, def: MatDef, poly: P2[], yTop: number, th: number, tint: number, tile = 2.4, top = true, bottom = true): void {
  const up = V(0, 1, 0);
  if (top) k.add(convexGeo(poly.map(([x, z]) => V(x, yTop, z)), up, tile), def, 0, 0, 0, { tint, flat: true });
  if (bottom) k.add(convexGeo(poly.map(([x, z]) => V(x, yTop - th, z)), V(0, -1, 0), tile), def, 0, 0, 0, { tint: tint * 0.8, flat: true });
  const c = centroid(poly);
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const mid: P2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const out = sub(mid, c);
    k.add(convexGeo([V(a[0], yTop - th, a[1]), V(b[0], yTop - th, b[1]), V(b[0], yTop, b[1]), V(a[0], yTop, a[1])], V(out[0], 0, out[1]), tile), def, 0, 0, 0, { tint: tint * 0.85, flat: true });
  }
}

/** A squared timber (or a rod) from a to b (local), w wide (horizontal) and h high across it. */
function beam(k: Kit, def: MatDef, a: THREE.Vector3, b: THREE.Vector3, w: number, h: number, tint = 1): void {
  const len = a.distanceTo(b);
  if (len < 1e-4) return;
  const dir = new THREE.Vector3().subVectors(b, a).normalize();
  const up = Math.abs(dir.y) > 0.98 ? V(1, 0, 0) : V(0, 1, 0);
  const xa = new THREE.Vector3().crossVectors(up, dir).normalize();
  const ya = new THREE.Vector3().crossVectors(dir, xa);
  const g = new THREE.BoxGeometry(w, h, len);
  const m = new THREE.Matrix4().makeBasis(xa, ya, dir).setPosition(a.clone().add(b).multiplyScalar(0.5));
  g.applyMatrix4(m);
  g.computeVertexNormals();
  planarUV(g, 1.2);
  k.add(g, def, 0, 0, 0, { tint, flat: true });
}

/** A bell (local): its crown at y, mouth radius r, hanging from a headstock. */
function bell(k: Kit, M: SpaceMats, x: number, y: number, z: number, r: number, ry = 0): void {
  const h = r * 1.35;
  // (from the mouth up to the crown: the lathe's faces then look out)
  const prof = [
    [0.93, 1.0],
    [1.0, 1.0],
    [0.9, 0.9],
    [0.7, 0.72],
    [0.56, 0.45],
    [0.5, 0.22],
    [0.42, 0.08],
    [0.3, 0.02],
    [0.001, 0],
  ].map(([rr, yy]) => new THREE.Vector2(rr * r, -yy * h));
  const g = new THREE.LatheGeometry(prof, 12);
  planarUV(g, 0.6);
  k.add(g, M.bronze, x, y, z, { tint: 0.62, flat: true, ry });
  // the clapper, the crown's loops, the headstock and its gudgeons
  k.cyl(0.035, 0.035, h * 0.8, x, y - h * 0.9, z, M.iron, { seg: 4 });
  k.cyl(r * 0.12, r * 0.12, r * 0.12, x, y - h * 0.97, z, M.iron, { seg: 6 });
  k.box(r * 0.35, 0.12, 0.08, x, y + 0.04, z, M.bronze, { tint: 0.55, ry });
  const c = Math.cos(ry);
  const s = Math.sin(ry);
  beam(k, M.timber, V(x - c * (r + 0.35), y + 0.22, z + s * (r + 0.35)), V(x + c * (r + 0.35), y + 0.22, z - s * (r + 0.35)), 0.3, 0.3, 0.55);
  // the wheel the rope turns, on the headstock's end
  k.cyl(r * 0.9, r * 0.9, 0.06, x + c * (r + 0.28), y + 0.22 - r * 0.2, z - s * (r + 0.28), M.timber, { seg: 10, rz: Math.PI / 2, ry, tint: 0.5 });
}

/** A geometry's faces turned the other way (a dome or a cone seen from inside). */
function inward(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const q = g.index ? g.toNonIndexed() : g;
  if (q !== g) g.dispose();
  const p = q.getAttribute("position") as THREE.BufferAttribute;
  for (let i = 0; i + 2 < p.count; i += 3) {
    const x = p.getX(i + 1);
    const y = p.getY(i + 1);
    const z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
  q.deleteAttribute("normal");
  q.computeVertexNormals();
  return q;
}

/** The u extent of an opening's outline at height y (u from its middle). */
function widthAt(o: ChurchOpening, y: number): [number, number] | null {
  const ring = outline(o, 10);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < ring.length; i++) {
    const [u0, y0] = ring[i];
    const [u1, y1] = ring[(i + 1) % ring.length];
    if ((y0 - y) * (y1 - y) > 0 || y0 === y1) continue;
    const u = u0 + ((u1 - u0) * (y - y0)) / (y1 - y0);
    lo = Math.min(lo, u);
    hi = Math.max(hi, u);
  }
  return hi > lo ? [lo, hi] : null;
}

// ---------------------------------------------------------------- the builder

export interface ChurchSpacesBuilt {
  /** One group per part (a tower, a house ...), in the hall's group. */
  parts: THREE.Group[];
  spaces: LocalSpace[];
}

/**
 * Build a church's spaces into its hall's group (the hall's frame; the group's y is the hall's floor, `floorY`).
 * `rows`: all the church's real openings in the hall's frame (churchRows / carolusRows).
 */
export function buildChurchSpaces(o: { church: ChurchSpace["church"]; group: THREE.Group; origin: { x: number; z: number }; yaw: number; floorY: number; rows: readonly ChurchOpening[]; mats: SpaceMats }): ChurchSpacesBuilt {
  const c = Math.cos(o.yaw);
  const s = Math.sin(o.yaw);
  const toLocal = ([x, z]: P2): P2 => {
    const dx = x - o.origin.x;
    const dz = z - o.origin.z;
    return [dx * c - dz * s, dx * s + dz * c];
  };
  const FY = o.floorY;
  const L = (y: number) => y - FY; // world y -> the group's y
  const rowsLeft = o.rows.filter((r) => r.zone !== "hall");
  const spaces: LocalSpace[] = SHELL_SPACES.filter((sp) => sp.church === o.church).map((sp) => {
    const poly = sp.poly.map(toLocal);
    const cc = centroid(poly);
    const edges: Edge[] = poly.map((a, i) => {
      const b = poly[(i + 1) % poly.length];
      const d = sub(b, a);
      const len = Math.hypot(d[0], d[1]);
      const t: P2 = [d[0] / len, d[1] / len];
      let n: P2 = [t[1], -t[0]];
      if (dot(n, sub([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], cc)) < 0) n = [-n[0], -n[1]];
      return { i, a, c: b, t, n, len, lined: (sp.lined[i] ?? 1) > 0, rows: [] };
    });
    return { sp, poly, edges, inner: [], rows: [], c: cc };
  });
  // each opening to the space behind it: on one of its edges within its heights, else inside its outline (a dormer)
  const inPoly = (p: P2, poly: P2[]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i];
      const [xj, zj] = poly[j];
      if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
    }
    return inside;
  };
  for (const r of rowsLeft) {
    const within = (ls: LocalSpace) => r.yb >= ls.sp.y0 - 0.05 && r.yt <= ls.sp.y1 + 0.3;
    let done = false;
    for (const ls of spaces) {
      if (!within(ls)) continue;
      const e = ls.edges.find((q) => onFace(r, { a: q.a, c: q.c, n: q.n }, 0.05));
      if (e) {
        e.rows.push(r);
        ls.rows.push(r);
        done = true;
        break;
      }
    }
    if (done) continue;
    const back: P2 = [r.x - r.nx * (r.depth + 0.3), r.z - r.nz * (r.depth + 0.3)];
    const ls = spaces.find((q) => within(q) && inPoly(back, q.poly));
    if (ls) {
      ls.inner.push(r);
      ls.rows.push(r);
    } else if (import.meta.env.DEV) console.warn(`[churchSpaces] ${r.label} (${r.id}): no space behind it`);
  }

  const kits = new Map<string, { k: Kit; g: THREE.Group }>();
  const kitFor = (id: string) => {
    const key = kitOf(id);
    let e = kits.get(key);
    if (!e) {
      const g = new THREE.Group();
      g.name = `space_${key}`;
      o.group.add(g);
      e = { k: new Kit(g), g };
      kits.set(key, e);
    }
    return e.k;
  };
  const r = rand(o.church === "carolus" ? 1615 : o.church === "stpaul" ? 1517 : 1491);
  for (const ls of spaces) {
    const k = kitFor(ls.sp.id);
    const above = spaces.some((q) => q !== ls && kitOf(q.sp.id) === kitOf(ls.sp.id) && Math.abs(q.sp.y0 - ls.sp.y1) < 0.2 && inPoly(ls.c, q.poly));
    const B = new SpaceBuild(k, ls, o.mats, FY, L, r, above, spaces);
    B.build();
  }
  const parts: THREE.Group[] = [];
  for (const { k, g } of kits.values()) {
    k.finish();
    parts.push(g);
  }
  return { parts, spaces };
}

/** One space's build (its linings, floors, ceilings, what it holds). */
class SpaceBuild {
  private readonly sp: ChurchSpace;
  private readonly n: Record<string, number>;
  /** A range's way in from its outer wall. */
  private outerM: P2 = [0, 1];
  constructor(
    private readonly k: Kit,
    private readonly ls: LocalSpace,
    private readonly M: SpaceMats,
    private readonly FY: number,
    private readonly L: (y: number) => number,
    private readonly r: () => number,
    /** Another space of its part stands on its top (its floor is this one's ceiling). */
    private readonly covered: boolean,
    private readonly all: LocalSpace[],
  ) {
    this.sp = ls.sp;
    this.n = ls.sp.n;
  }

  /** The reveal depth the linings start at on an edge (its openings' deepest), and their thickness. */
  private from(e: Edge): number {
    return Math.max(0.02, e.rows.length ? Math.max(...e.rows.map((q) => q.depth)) : (this.n.depth ?? 0.3));
  }

  private thick(): number {
    const kind = this.sp.kind;
    if (kind === "turret" || kind === "lantern") return 0.16;
    if (kind === "stair") return 0.18;
    if (kind === "belfry" || kind === "chamber" || kind === "clock") return 0.3;
    return 0.22;
  }

  /** The inner outline (the linings' inner faces). */
  private innerPoly(extra = 0): P2[] {
    const ds = this.ls.edges.map((e) => (e.lined ? this.from(e) + this.thick() : 0.02) + extra);
    // (one inset for all edges: the deepest; the rooms are regular)
    return inset(this.ls.poly, Math.max(...ds));
  }

  build(): void {
    const kind = this.sp.kind;
    this.linings();
    switch (kind) {
      case "belfry":
        this.belfry();
        break;
      case "chamber":
      case "clock":
        this.chamber();
        break;
      case "turret":
        this.turret();
        break;
      case "lantern":
        this.lantern();
        break;
      case "stair":
        this.stair();
        break;
      case "attic":
        this.attic();
        break;
      case "convent":
      case "house":
        this.range();
        break;
      case "sacristy":
      case "vestry":
        this.sacristy();
        break;
      case "porch":
        this.porch();
        break;
      case "baptistery":
        this.baptistery();
        break;
      default:
        this.plainRoom();
    }
    this.louvres();
    this.dormerFrames();
  }

  // ---------------------------------------------------------------- walls

  private wallDef(): MatDef {
    const kind = this.sp.kind;
    return kind === "convent" || kind === "house" || kind === "sacristy" || kind === "vestry" || kind === "porch" || kind === "baptistery" ? this.M.wall : this.M.stone;
  }

  private wallTint(): number {
    const kind = this.sp.kind;
    if (kind === "attic") return 0.58;
    if (kind === "belfry" || kind === "turret" || kind === "lantern") return 0.62;
    if (kind === "chamber" || kind === "clock" || kind === "stair") return 0.7;
    return 0.92;
  }

  /** Every lined edge: a lining from the reveals' back, cut at the shell's openings on it (gable ends to the roof). */
  private linings(): void {
    const { sp, ls } = this;
    const attic = sp.kind === "attic";
    const eave = this.n.eave ?? sp.y1;
    const ridge = this.n.ridge ?? sp.y1;
    const g0 = this.n.g0 ?? 0;
    for (const e of ls.edges) {
      if (!e.lined) continue;
      const from = this.from(e);
      const to = from + this.thick();
      // (under another space of its part: ending in that one's floor slab, never beside its lining)
      let y1 = this.covered ? sp.y1 - 0.05 : sp.y1 + 0.02;
      let top: Array<[number, number]> | undefined;
      if (attic) {
        const gable = e.i % 2 === g0 % 2;
        if (gable) {
          // a gable end: under the roof's underside (it passes through the eaves' wall tops and the ridge)
          const drop = 0.1;
          top = [
            [0, eave - drop],
            [e.len / 2, ridge - drop - 0.05],
            [e.len, eave - drop],
          ];
          y1 = ridge;
        } else {
          // an eave side: a knee wall to the wall plate, when there is one
          if (eave - sp.y0 < 0.3) continue;
          y1 = eave - 0.06;
        }
      }
      lining(this.k, this.wallDef(), { face: { a: e.a, c: e.c, n: e.n } as ShellFace, from, to, u0: 0, u1: e.len, y0: sp.y0 - 0.14, y1, top }, e.rows, this.FY, 2.4, this.wallTint());
    }
  }

  /** The louvres in the sound openings (open ones: no glass), sloping down to the street, as a belfry has them. */
  private louvres(): void {
    for (const e of this.ls.edges)
      for (const o of e.rows) {
        if (o.glaze !== "") continue;
        const from = this.from(e);
        const to = from + this.thick();
        const dc = (from + to) / 2;
        const top = Math.max(...outline(o).map(([, y]) => y));
        const ry = Math.atan2(-o.tz, o.tx);
        // local +z of the board after ry: (-tz, tx); the outer edge down
        const outSign = -o.tz * o.nx + o.tx * o.nz > 0 ? 1 : -1;
        const deep = Math.min(0.26, to - from - 0.02);
        for (let y = o.yb + 0.16; y < top - 0.12; y += 0.24) {
          const w = widthAt(o, y + 0.05);
          if (!w || w[1] - w[0] < 0.08) continue;
          const um = (w[0] + w[1]) / 2;
          const x = o.x + o.tx * um - o.nx * dc;
          const z = o.z + o.tz * um - o.nz * dc;
          this.k.box(w[1] - w[0] - 0.02, 0.025, deep, x, this.L(y), z, this.M.timber, { ry, rx: outSign * 0.62, tint: 0.45, flat: true });
        }
      }
  }

  /** A dormer's window has its own little lining round it (the attic's roof is its rafters, no lining under it). */
  private dormerFrames(): void {
    for (const o of this.ls.inner) {
      const f: ShellFace = { a: [o.x - o.tx * (o.hw + 0.26), o.z - o.tz * (o.hw + 0.26)], c: [o.x + o.tx * (o.hw + 0.26), o.z + o.tz * (o.hw + 0.26)], n: [o.nx, o.nz] };
      lining(this.k, this.M.timber, { face: f, from: o.depth, to: o.depth + 0.08, y0: o.yb - 0.3, y1: o.yt + 0.12 }, [o], this.FY, 1.2, 0.55);
    }
  }

  // ---------------------------------------------------------------- floors, ceilings

  private floorAndCeiling(floorDef: MatDef, ceilDef: MatDef | null, floorTint: number, ceilTint: number, hatch?: P2): void {
    const inner = inset(this.ls.poly, 0.03);
    const { sp } = this;
    // (the floor into the linings, its edges buried in them)
    slab(this.k, floorDef, inner, this.L(sp.y0), 0.14, floorTint, 1.6);
    if (ceilDef && !this.covered) slab(this.k, ceilDef, inner, this.L(sp.y1) + 0.14, 0.14, ceilTint, 1.6, false, true);
    if (hatch) {
      // a trap in the floor with its ladder down (the way up the tower)
      const [hx, hz] = hatch;
      this.k.box(0.9, 0.04, 0.7, hx, this.L(sp.y0) + 0.02, hz, this.M.dark, { flat: true });
    }
  }

  private beamsUnder(y: number, span: P2[], along: P2, step = 1.4, tint = 0.5): void {
    // joists across the shorter way, under a ceiling at local y
    const inner = span;
    const c = centroid(inner);
    const xs = inner.map((p) => dot(sub(p, c), along));
    const perp: P2 = [-along[1], along[0]];
    const ws = inner.map((p) => dot(sub(p, c), perp));
    const a0 = Math.min(...xs) + 0.3;
    const a1 = Math.max(...xs) - 0.3;
    const w0 = Math.min(...ws);
    const w1 = Math.max(...ws);
    for (let a = a0; a <= a1 + 1e-6; a += step) {
      const p = add(c, along, a);
      beam(this.k, this.M.timber, V(p[0] + perp[0] * w0, y - 0.12, p[1] + perp[1] * w0), V(p[0] + perp[0] * w1, y - 0.12, p[1] + perp[1] * w1), 0.16, 0.22, tint);
    }
  }

  /** The longest edge's direction (for joists and rows of things). */
  private mainAxis(): P2 {
    const e = [...this.ls.edges].sort((a, b) => b.len - a.len)[0];
    return e.t;
  }

  // ---------------------------------------------------------------- towers

  private ladder(x: number, z: number, y0: number, y1: number, ry: number): void {
    const c = Math.cos(ry);
    const s = Math.sin(ry);
    const lean = 0.35 * (y1 - y0);
    for (const side of [-0.3, 0.3]) beam(this.k, this.M.timber, V(x + c * side, y0, z - s * side), V(x + c * side + s * lean * 0.3, y1, z + c * lean * 0.3 - s * side), 0.07, 0.1, 0.55);
    for (let y = y0 + 0.3; y < y1 - 0.1; y += 0.3) {
      const f = (y - y0) / (y1 - y0);
      beam(this.k, this.M.timber, V(x - c * 0.3 + s * lean * 0.3 * f, y, z + s * 0.3 + c * lean * 0.3 * f), V(x + c * 0.3 + s * lean * 0.3 * f, y, z - s * 0.3 + c * lean * 0.3 * f), 0.05, 0.05, 0.55);
    }
  }

  private chamber(): void {
    const { sp } = this;
    const inner = this.innerPoly();
    const c = centroid(inner);
    const ax = this.mainAxis();
    const perp: P2 = [-ax[1], ax[0]];
    const half = Math.min(...this.ls.edges.map((e) => Math.abs(dot(sub(e.a, this.ls.c), e.n)) - this.from(e))) - this.thick() - 0.35;
    const hatch = add(add(c, ax, half - 0.7), perp, half - 0.6);
    this.floorAndCeiling(this.M.timber, this.M.timber, 0.55, 0.45, hatch);
    this.beamsUnder(this.L(sp.y1) + 0.0, inner, ax, 1.3, 0.45);
    // the ladder up to the trap in the ceiling
    const up = add(add(c, ax, half - 0.7), perp, -(half - 0.6));
    this.ladder(up[0], up[1], this.L(sp.y0), this.L(sp.y1), Math.atan2(-ax[1], ax[0]));
    // the bell ropes coming down from the belfry through the floor, a coil, a chest
    for (const d of [-0.9, 0, 0.9]) {
      const p = add(c, ax, d);
      this.k.cyl(0.018, 0.018, sp.y1 - sp.y0, p[0], this.L(sp.y0), p[1], this.M.timber, { seg: 3, tint: 0.7 });
    }
    const q = add(add(c, ax, -half + 0.6), perp, half - 0.5);
    this.k.box(1.1, 0.55, 0.6, q[0], this.L(sp.y0) + 0.275, q[1], this.M.oak, { ry: Math.atan2(-ax[1], ax[0]), tint: 0.6 });
    if (sp.kind === "clock") this.clockwork(c);
  }

  /** The tower clock: an iron frame of wheels in the middle, a rod to each dial's hub. */
  private clockwork(c: P2): void {
    const { sp } = this;
    const y = this.L(this.n.clock ?? sp.y0 + 1.9);
    const yb = this.L(sp.y0);
    this.k.box(1.2, 0.08, 0.7, c[0], yb + 0.9, c[1], this.M.timber, { tint: 0.5 });
    for (const [dx, dz] of [[-0.55, -0.3], [0.55, -0.3], [-0.55, 0.3], [0.55, 0.3]]) this.k.box(0.08, 0.9, 0.08, c[0] + dx, yb + 0.45, c[1] + dz, this.M.timber, { tint: 0.5 });
    this.k.box(0.9, 0.7, 0.5, c[0], yb + 1.3, c[1], this.M.iron, { tint: 0.8 });
    for (const [dx, r] of [[-0.25, 0.28], [0.05, 0.2], [0.3, 0.24]]) this.k.cyl(r, r, 0.04, c[0] + dx, yb + 1.3, c[1] + 0.27, this.M.bronze, { seg: 12, rx: Math.PI / 2, tint: 0.6 });
    // the pendulum, the weights' ropes
    this.k.cyl(0.012, 0.012, 1.1, c[0], yb + 0.2, c[1] - 0.1, this.M.iron, { seg: 3 });
    this.k.cyl(0.12, 0.12, 0.04, c[0], yb + 0.2, c[1] - 0.1, this.M.bronze, { seg: 10, rx: Math.PI / 2, tint: 0.6 });
    const dials = this.n.dials ?? 0;
    this.ls.edges.forEach((e, i) => {
      if (!(dials & (1 << i))) return;
      const m: P2 = [(e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2];
      const hub = add(m, e.n, -(this.from(e) + this.thick()));
      beam(this.k, this.M.iron, V(c[0], yb + 1.5, c[1]), V(c[0], y, c[1]), 0.05, 0.05, 0.8);
      beam(this.k, this.M.iron, V(c[0], y, c[1]), V(hub[0], y, hub[1]), 0.04, 0.04, 0.8);
      this.k.cyl(0.14, 0.14, 0.12, hub[0], y - 0.06, hub[1], this.M.iron, { seg: 8, tint: 0.8 });
    });
  }

  private belfry(): void {
    const { sp } = this;
    const inner = this.innerPoly();
    const c = centroid(inner);
    const ax = this.mainAxis();
    const perp: P2 = [-ax[1], ax[0]];
    const ry = Math.atan2(-ax[1], ax[0]);
    const halfA = Math.max(...inner.map((p) => dot(sub(p, c), ax)));
    const halfP = Math.max(...inner.map((p) => dot(sub(p, c), perp)));
    this.floorAndCeiling(this.M.timber, this.M.timber, 0.5, 0.4);
    const yb = this.L(sp.y0);
    const mid = this.n.mid ? this.L(this.n.mid) : null;
    const yTop = this.L(sp.y1);
    this.beamsUnder(yTop, inner, ax, 1.2, 0.4);
    // the bell frame: two sills, posts, braces, two head beams; the bells hanging between
    const hf = (mid ?? yTop - 1.4) - yb;
    const frameH = Math.min(3.2, hf - 0.6);
    const lenA = Math.min(halfA - 0.4, 3.6);
    const w = Math.min(halfP - 0.5, 1.0);
    for (const sw of [-w, w]) {
      const a0 = add(add(c, ax, -lenA), perp, sw);
      const a1 = add(add(c, ax, lenA), perp, sw);
      beam(this.k, this.M.timber, V(a0[0], yb + 0.15, a0[1]), V(a1[0], yb + 0.15, a1[1]), 0.3, 0.3, 0.5);
      beam(this.k, this.M.timber, V(a0[0], yb + frameH, a0[1]), V(a1[0], yb + frameH, a1[1]), 0.28, 0.3, 0.5);
      for (const f of [-1, -0.33, 0.33, 1]) {
        const p = add(add(c, ax, lenA * f), perp, sw);
        beam(this.k, this.M.timber, V(p[0], yb + 0.3, p[1]), V(p[0], yb + frameH, p[1]), 0.24, 0.24, 0.5);
      }
      for (const f of [-1, 1]) {
        const p = add(add(c, ax, lenA * f), perp, sw);
        const q = add(add(c, ax, lenA * f * 0.55), perp, sw);
        beam(this.k, this.M.timber, V(p[0], yb + 0.3, p[1]), V(q[0], yb + frameH - 0.2, q[1]), 0.16, 0.16, 0.5);
      }
    }
    const n = Math.max(1, Math.round(this.n.bells ?? 2));
    const sizes = [0.82, 0.68, 0.56, 0.46].slice(0, Math.min(n, 4));
    const fit = Math.min(1, (2 * lenA - 0.4) / sizes.reduce((s0, r) => s0 + 2 * r + 0.35, 0));
    let at = -sizes.reduce((s0, r) => s0 + (2 * r + 0.35) * fit, 0) / 2;
    for (const r0 of sizes) {
      const rr = Math.min(r0 * Math.min(fit, (hf - 0.8) / 2.2), w - 0.15);
      at += rr + 0.17;
      const p = add(c, ax, at);
      bell(this.k, this.M, p[0], yb + frameH - 0.3, p[1], rr, ry + Math.PI / 2);
      at += rr + 0.18;
    }
    // the floor between the two tiers (St Paul's octagon), and the carillon's small bells over it on their rack
    if (mid !== null) {
      slab(this.k, this.M.timber, inset(this.ls.poly, 0.03), mid + 0.02, 0.16, 0.45, 1.6);
      for (let i = 0; i < 3; i++) {
        const sw = (i - 1) * 0.8;
        const a0 = add(add(c, ax, -halfA * 0.7), perp, sw);
        const a1 = add(add(c, ax, halfA * 0.7), perp, sw);
        beam(this.k, this.M.iron, V(a0[0], mid + 2.3, a0[1]), V(a1[0], mid + 2.3, a1[1]), 0.08, 0.1, 0.8);
        for (let j = 0; j < 6; j++) {
          const f = -0.62 + (1.24 * j) / 5;
          const p = add(add(c, ax, halfA * f), perp, sw);
          bell(this.k, this.M, p[0], mid + 2.15, p[1], 0.14 + 0.05 * ((i + j) % 3), ry);
        }
      }
      for (const f of [-1, 1]) {
        const p = add(c, ax, halfA * 0.7 * f);
        beam(this.k, this.M.timber, V(p[0], mid, p[1]), V(p[0], mid + 2.4, p[1]), 0.2, 0.2, 0.5);
      }
    }
    this.ladder(c[0] + perp[0] * (halfP - 0.6), c[1] + perp[1] * (halfP - 0.6), yb, (mid ?? yTop) - 0.02, ry);
    if (this.n.clock && this.n.dials) this.clockwork(add(c, perp, -(halfP - 0.7)));
  }

  private turret(): void {
    const { sp } = this;
    const inner = this.innerPoly();
    const c = centroid(inner);
    const R = Math.min(...inner.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    slab(this.k, this.M.timber, inset(this.ls.poly, 0.03), this.L(sp.y0), 0.14, 0.5, 1.2);
    // the spire's inside over it, dark
    const cone = inward(new THREE.CylinderGeometry(0.02, R + 0.1, 1.6, 8, 1, true));
    planarUV(cone, 1.2);
    this.k.add(cone, this.M.timber, c[0], this.L(sp.y1) + 0.78, c[1], { tint: 0.35, flat: true });
    const ax = this.mainAxis();
    beam(this.k, this.M.timber, V(c[0] - ax[0] * R, this.L(sp.y1) - 0.35, c[1] - ax[1] * R), V(c[0] + ax[0] * R, this.L(sp.y1) - 0.35, c[1] + ax[1] * R), 0.14, 0.16, 0.5);
    bell(this.k, this.M, c[0], this.L(sp.y1) - 0.55, c[1], Math.min(0.32, R * 0.45), Math.atan2(-ax[1], ax[0]));
  }

  private lantern(): void {
    const { sp } = this;
    const inner = this.innerPoly();
    const c = centroid(inner);
    const R = Math.min(...inner.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    slab(this.k, this.M.timber, inset(this.ls.poly, 0.03), this.L(sp.y0), 0.14, 0.5, 1.2);
    // its dome inside (lead outside): a plastered half sphere from the top of the walls
    const dh = Math.min(this.n.dome ?? R, R * 1.1);
    const sphere = new THREE.SphereGeometry(R + 0.06, 12, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    sphere.scale(1, dh / (R + 0.06), 1);
    // (seen from inside: its faces turned in)
    const g = inward(sphere);
    planarUV(g, 1.6);
    this.k.add(g, this.M.vault, c[0], this.L(sp.y1) + 0.04, c[1], { flat: true, tint: 0.55 });
    if (R > 1.2) {
      // the lantern's bell (the Carolus rings the hours from its lantern), hung from a beam across
      const ax = this.mainAxis();
      const yb = this.L(sp.y1) - 0.3;
      beam(this.k, this.M.timber, V(c[0] - ax[0] * R, yb, c[1] - ax[1] * R), V(c[0] + ax[0] * R, yb, c[1] + ax[1] * R), 0.2, 0.22, 0.5);
      bell(this.k, this.M, c[0], yb - 0.25, c[1], Math.min(0.55, R * 0.25), Math.atan2(-ax[1], ax[0]));
    }
  }

  /** A newel stair: steps winding round a stone post from the floor to the top, a trap into the lantern. */
  private stair(): void {
    const { sp } = this;
    const inner = this.innerPoly();
    const c = centroid(inner);
    const ax = this.mainAxis();
    const perp: P2 = [-ax[1], ax[0]];
    const ha = Math.max(...inner.map((p) => dot(sub(p, c), ax)));
    const hp = Math.max(...inner.map((p) => dot(sub(p, c), perp)));
    const R = Math.min(ha, hp) - 0.04;
    const y0 = this.L(sp.y0);
    const y1 = this.L(sp.y1);
    slab(this.k, this.M.floor, inset(this.ls.poly, 0.03), y0, 0.14, 0.7, 1.2);
    slab(this.k, this.M.stone, inset(this.ls.poly, 0.03), y1 + 0.14, 0.14, 0.55, 1.6, false, true);
    this.k.cyl(0.16, 0.16, y1 - y0, c[0], y0, c[1], this.M.stone, { seg: 8, tint: 0.7 });
    const rise = 0.19;
    const turn = Math.PI / 8;
    const n = Math.floor((y1 - y0 - 0.3) / rise);
    const a0 = (this.n.sg ?? 1) > 0 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const a = a0 + i * turn * ((this.n.sg ?? 1) > 0 ? 1 : -1);
      const dir: P2 = [Math.cos(a) * ax[0] + Math.sin(a) * perp[0], Math.cos(a) * ax[1] + Math.sin(a) * perp[1]];
      const len = Math.min(R / Math.max(Math.abs(Math.cos(a)), 1e-3), R / Math.max(Math.abs(Math.sin(a)), 1e-3), R * 1.35) - 0.16;
      const m = add(c, dir, 0.16 + len / 2);
      const ry = Math.atan2(-dir[1], dir[0]);
      this.k.box(len, 0.18, 0.44, m[0], y0 + (i + 1) * rise - 0.09, m[1], this.M.stone, { ry, tint: 0.62 + 0.08 * ((i % 3) / 2), flat: true });
    }
    // a rope for a handrail up the wall, a trap at the top
    this.k.box(0.8, 0.04, 0.6, c[0] + ax[0] * (ha - 0.5), y1 + 0.001, c[1] + ax[1] * (ha - 0.5), this.M.dark, { flat: true, ry: Math.atan2(-ax[1], ax[0]) });
  }

  // ---------------------------------------------------------------- roof spaces

  private attic(): void {
    const { sp, ls } = this;
    const eave = this.n.eave ?? sp.y0;
    const ridge = this.n.ridge ?? sp.y1;
    const g0 = (this.n.g0 ?? 0) % 2;
    // the eaves: the two edges that are not gables; the ridge between them, along them
    const e1 = ls.edges[(g0 + 1) % 4];
    const e3 = ls.edges[(g0 + 3) % 4];
    const along = e1.t;
    const across: P2 = [-along[1], along[0]];
    const c = ls.c;
    const off = (p: P2) => dot(sub(p, c), across);
    const halfW = (Math.abs(off(e1.a)) + Math.abs(off(e3.a))) / 2;
    const alongs = ls.poly.map((p) => dot(sub(p, c), along));
    const a0 = Math.min(...alongs);
    const a1 = Math.max(...alongs);
    const roofAt = (w: number) => eave + (ridge - eave) * (1 - Math.min(1, Math.abs(w) / halfW));
    const vaulted = /^sp_attic/.test(sp.id);
    const others = this.all.filter((q) => q !== ls && q.sp.church === sp.church && q.sp.kind === "attic" && kitOf(q.sp.id) === kitOf(sp.id));
    const inOther = (p: P2) => others.some((q) => {
      let inside = false;
      const poly = q.poly;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        const [xi, zi] = poly[i];
        const [xj, zj] = poly[j];
        if (zi > p[1] !== zj > p[1] && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
      }
      return inside;
    });
    const P = (a: number, w: number, y: number) => {
      const p = add(add(c, along, a), across, w);
      return V(p[0], this.L(y), p[1]);
    };
    const tieY = vaulted ? sp.y0 + 0.35 : sp.y0 + 0.45;
    const reach = (y: number) => halfW * (1 - Math.min(1, (y + 0.15 - eave) / (ridge - eave)));
    // the floor: boards over the ceilings below, or over a vault a plank walk on the ties and boards over the wall tops
    if (!vaulted) slab(this.k, this.M.timber, inset(ls.poly, 0.03), this.L(sp.y0) + 0.1, 0.1, 0.42, 1.4);
    // rafters every 0.9 m, a truss every fourth, the ridge beam, purlins; none in the other attic's square (the crossing)
    let i = 0;
    for (let a = a0 + 0.35; a <= a1 - 0.3; a += 0.9, i++) {
      if (inOther(add(c, along, a))) continue;
      for (const sw of [-1, 1]) {
        const foot = sw * (halfW - 0.1);
        beam(this.k, this.M.timber, P(a, foot, roofAt(foot) - 0.14), P(a, sw * 0.06, ridge - 0.16), 0.1, 0.16, 0.42);
      }
      if (i % 4 === 0) {
        const tw = Math.max(0.5, reach(tieY) - 0.1);
        beam(this.k, this.M.timber, P(a, -tw, tieY), P(a, tw, tieY), 0.2, 0.24, 0.45);
        const cy = eave + (ridge - eave) * 0.62;
        const cw = reach(cy) - 0.1;
        beam(this.k, this.M.timber, P(a, -cw, cy), P(a, cw, cy), 0.14, 0.18, 0.45);
        beam(this.k, this.M.timber, P(a, 0, tieY + 0.12), P(a, 0, ridge - 0.2), 0.18, 0.18, 0.45);
        for (const sw of [-1, 1]) beam(this.k, this.M.timber, P(a, 0, tieY + 0.8), P(a, sw * tw * 0.6, tieY + 0.12 + (ridge - tieY) * 0.35), 0.12, 0.12, 0.45);
      }
    }
    // the ridge beam and the purlins, in pieces between the crossings
    const runs: Array<[number, number]> = [];
    let run: number | null = null;
    for (let a = a0 + 0.2; a <= a1 - 0.2 + 1e-6; a += 0.3) {
      const out = inOther(add(c, along, a));
      if (!out && run === null) run = a;
      if ((out || a > a1 - 0.35) && run !== null) {
        runs.push([run, out ? a - 0.3 : a]);
        run = null;
      }
    }
    for (const [ra, rb] of runs) {
      beam(this.k, this.M.timber, P(ra, 0, ridge - 0.3), P(rb, 0, ridge - 0.3), 0.18, 0.22, 0.4);
      for (const sw of [-1, 1]) {
        const w = sw * halfW * 0.5;
        beam(this.k, this.M.timber, P(ra, w, roofAt(w) - 0.3), P(rb, w, roofAt(w) - 0.3), 0.16, 0.18, 0.4);
        // the wall plates on the eaves' wall tops, and boards over them to the vault's haunch
        beam(this.k, this.M.timber, P(ra, sw * (halfW - 0.25), eave - 0.08), P(rb, sw * (halfW - 0.25), eave - 0.08), 0.3, 0.16, 0.45);
      }
      if (vaulted) {
        // the plank walk along the ridge line, on the ties
        beam(this.k, this.M.timber, P(ra, 0, tieY + 0.16), P(rb, 0, tieY + 0.16), 0.75, 0.05, 0.5);
        for (const sw of [-1, 1]) {
          const w0 = sw * (halfW - 0.05);
          const w1 = sw * (halfW - 1.3);
          const y = sp.y0 + 0.36;
          const qa = P(ra, w0, y);
          const qb = P(rb, w0, y);
          const qc = P(rb, w1, y);
          const qd = P(ra, w1, y);
          this.k.add(convexGeo([qa, qb, qc, qd], V(0, 1, 0), 1.4), this.M.timber, 0, 0, 0, { tint: 0.4, flat: true });
        }
      }
    }
    // the chimney breasts of a house's attic (their stacks stand on its roof)
    for (const key of ["chim0", "chim1"]) {
      const v = this.n[key];
      if (v === undefined) continue;
      // (along the outline's first edge from its first corner, on the ridge line)
      const q = add(ls.poly[0], ls.edges[0].t, v);
      const p = add(c, along, dot(sub(q, c), along));
      this.k.box(1.0, ridge - 1.0 - sp.y0, 1.2, p[0], this.L(sp.y0) + (ridge - 1.0 - sp.y0) / 2, p[1], this.M.stone, { ry: Math.atan2(-along[1], along[0]), tint: 0.5, flat: true });
    }
    // old things kept up there: chests, a broken chair, a pile of slates
    if (!vaulted) {
      const r = this.r;
      for (let j = 0; j < 5; j++) {
        const a = a0 + 1.5 + r() * (a1 - a0 - 3);
        const w = (r() - 0.5) * halfW * 0.8;
        const p = add(add(c, along, a), across, w);
        this.k.box(0.9 + r() * 0.4, 0.5, 0.55, p[0], this.L(sp.y0) + 0.35, p[1], this.M.oak, { ry: Math.atan2(-along[1], along[0]) + (r() - 0.5) * 0.3, tint: 0.45 });
      }
    }
  }

  // ---------------------------------------------------------------- rooms

  /**
   * A range of rooms (St Paul's convent, the Jesuit house): its outer long side (the edge with the most windows) has the
   * rooms along it, a corridor wall behind them (`rooms` deep, or none), partitions between every two windows, the end
   * rooms through to the back where the ends have windows there; storeys at floor1 (and floor2).
   */
  private range(): void {
    const { sp, ls, M } = this;
    const outer = [...ls.edges].sort((a, b) => b.rows.length - a.rows.length || b.len - a.len)[0];
    const t = outer.t;
    const m: P2 = [-outer.n[0], -outer.n[1]];
    this.outerM = m;
    const o0 = outer.a;
    const U = (p: P2) => dot(sub(p, o0), t);
    const D = (p: P2) => dot(sub(p, o0), m);
    const Uw = Math.max(...ls.poly.map(U));
    const Dfull = Math.max(...ls.poly.map(D));
    const fromO = this.from(outer) + this.thick();
    const house = sp.kind === "house";
    const corridor = house ? (this.n.corridor ?? 1.7) : 0;
    const roomsD = house ? Dfull - corridor - 0.3 : Math.min(this.n.rooms ?? Dfull, Dfull);
    const storeys: Array<[number, number]> = [];
    const fl = [sp.y0, this.n.floor1, this.n.floor2].filter((v): v is number => v !== undefined);
    fl.forEach((y, i) => storeys.push([y, i + 1 < fl.length ? fl[i + 1] - 0.16 : sp.y1]));
    const at = (u: number, d: number): P2 => add(add(o0, t, u), m, d);
    const inner = inset(ls.poly, 0.03);
    // the windows along the outer side (their u), and where the ends have windows deep in (then the end room goes through)
    const us = [...new Set(outer.rows.map((q) => Math.round(U([q.x, q.z]) * 100) / 100))].sort((a, b) => a - b);
    const ends = ls.edges.filter((e) => e !== outer && e.rows.length > 0);
    const deepEnd = (atStart: boolean) =>
      ends.some((e) => e.rows.some((q) => D([q.x, q.z]) > roomsD - 0.3 && (U([q.x, q.z]) < Uw / 2) === atStart));
    // partitions: between every two windows (a cell per window on an upper floor of the convent)
    const parts = (per: number) => {
      const out: number[] = [];
      for (let i = per; i < us.length; i += per) out.push((us[i - 1] + us[i]) / 2);
      return out;
    };
    const wallT = 0.16;
    storeys.forEach(([y0, y1], si) => {
      const yb = this.L(y0);
      const yt = this.L(y1);
      // the floor: slabs on the ground, boards on joists over it
      if (si === 0) slab(this.k, M.floor, inner, yb, 0.14, 0.8, 1.6);
      else {
        slab(this.k, M.timber, inner, yb, 0.16, 0.62, 1.4);
        this.beamsUnder(yb - 0.16, inner, t, 1.1, 0.5);
      }
      if (si === storeys.length - 1) slab(this.k, M.vault, inner, yt + 0.14, 0.14, 0.9, 2.4, false, true);
      const per = !house && si > 0 ? 1 : 2;
      const cuts = parts(per);
      const edgesU = [0, ...cuts, Uw];
      const startDeep = deepEnd(true);
      const endDeep = deepEnd(false);
      const cA = startDeep ? cuts[0] ?? Uw : 0;
      const cB = endDeep ? cuts[cuts.length - 1] ?? 0 : Uw;
      // the corridor wall with a door into each room
      if (roomsD < Dfull - 0.4 && cB > cA) {
        const doors: Hole[] = [];
        for (let i = 0; i + 1 < edgesU.length; i++) {
          const mu = (edgesU[i] + edgesU[i + 1]) / 2;
          if (mu < cA || mu > cB) continue;
          doors.push({ u0: mu - cA - 0.45, u1: mu - cA + 0.45, y0: yb, spring: yb + 2.2 });
        }
        const a = at(cA, roomsD + wallT / 2);
        const b = at(cB, roomsD + wallT / 2);
        panel(this.k, M.wall, [a[0], a[1]], [b[0], b[1]], yb - 0.02, yt + 0.02, wallT, doors.filter((d) => d.u1 < cB - cA - 0.1), [], 2.4, 0.86);
      }
      // the partitions, from the outer lining to the corridor wall (the end rooms through to the back)
      for (const u of cuts) {
        const deep = (u <= cA + 1e-3 && startDeep) || (u >= cB - 1e-3 && endDeep) || roomsD >= Dfull - 0.4;
        const d1 = deep ? Dfull - 0.02 : roomsD;
        const a = at(u, fromO - 0.02);
        const b = at(u, d1);
        panel(this.k, M.wall, [a[0], a[1]], [b[0], b[1]], yb - 0.02, yt + 0.02, wallT, [], [], 2.4, 0.84);
      }
      // what is in each room
      for (let i = 0; i + 1 < edgesU.length; i++) {
        const u0 = edgesU[i] + (i > 0 ? wallT / 2 : fromO * 0);
        const u1 = edgesU[i + 1] - (i + 2 < edgesU.length ? wallT / 2 : 0);
        this.furnish(sp.kind, si, i, at, u0 + 0.35, u1 - 0.35, fromO + 0.05, Math.min(roomsD, Dfull - 0.4) - 0.1, yb, yt, t);
      }
    });
  }

  /** Furniture for a room of a range (u along the outer wall, d in from it; the room's floor and top, local). */
  private furnish(kind: string, storey: number, idx: number, at: (u: number, d: number) => P2, u0: number, u1: number, d0: number, d1: number, yb: number, yt: number, t: P2): void {
    const { M, k } = this;
    const ry = Math.atan2(-t[1], t[0]);
    const w = u1 - u0;
    const dd = d1 - d0;
    if (w < 1.2 || dd < 1.2) return;
    const P = (u: number, d: number) => at(u, d);
    const house = kind === "house";
    const role = house ? (storey === 0 ? (idx % 3 === 1 ? "refectory" : "parlour") : storey === 2 && idx % 2 === 0 ? "library" : "cell") : storey === 0 ? (idx % 2 === 0 ? "refectory" : "chapter") : "cell";
    const tb = (uu: number, d: number, sw: number, sh: number, sd: number, y: number, def: MatDef, tint = 0.8) => {
      const p = P(uu, d);
      k.box(sw, sh, sd, p[0], yb + y, p[1], def, { ry, tint });
    };
    // a crucifix on the back wall of every room, a painting in the larger ones
    {
      const p = P((u0 + u1) / 2, d1 + 0.02);
      const q = P((u0 + u1) / 2, d1 - 0.02);
      const face = Math.atan2(q[0] - p[0], q[1] - p[1]);
      k.box(0.05, 0.7, 0.04, p[0], yb + 1.9, p[1], M.dark, { ry: face });
      k.box(0.4, 0.05, 0.04, p[0], yb + 2.05, p[1], M.dark, { ry: face });
    }
    if (role === "refectory") {
      // a long table with benches along the room, a reader's pulpit
      const len = Math.min(w - 0.6, 6);
      const um = (u0 + u1) / 2;
      const dm = (d0 + d1) / 2;
      tb(um, dm, len, 0.06, 0.8, 0.76, M.oak);
      for (const f of [-0.42, 0.42]) tb(um + f * (len - 0.3), dm, 0.1, 0.72, 0.6, 0.36, M.oak, 0.6);
      for (const sd of [-0.65, 0.65]) tb(um, dm + sd, len, 0.05, 0.3, 0.45, M.oak, 0.7);
      for (let j = 0; j < Math.floor(len / 0.7); j++) {
        const uu = um - len / 2 + 0.35 + j * 0.7;
        for (const sd of [-0.18, 0.18]) tb(uu, dm + sd, 0.22, 0.03, 0.2, 0.8, M.linen, 0.85);
      }
      tb(u1 - 0.3, d1 - 0.3, 0.5, 1.2, 0.5, 0.6, M.oak, 0.7);
    } else if (role === "chapter" || role === "parlour") {
      // benches round the walls, a table in the middle with chairs
      tb((u0 + u1) / 2, d1 - 0.22, w - 0.4, 0.45, 0.4, 0.225, M.oak, 0.7);
      tb((u0 + u1) / 2, (d0 + d1) / 2, Math.min(1.8, w - 1), 0.75, 0.9, 0.375, M.oak, 0.75);
      for (const f of [-0.5, 0.5]) tb((u0 + u1) / 2 + f * Math.min(1.8, w - 1), (d0 + d1) / 2, 0.42, 0.9, 0.42, 0.45, M.oak, 0.6);
      const p = P((u0 + u1) / 2, d1 + 0.03);
      const pic = M.pictures[idx % Math.max(1, M.pictures.length)];
      // (facing back toward the outer wall, the way into the room)
      if (pic) k.plane(1.1, 0.8, p[0], yb + 2.2, p[1], pic, { ry: Math.atan2(-this.outerM[0], -this.outerM[1]) });
    } else if (role === "library") {
      // bookcases along the walls, a reading desk
      for (const [uu, len] of [[u0 + 0.25, dd], [u1 - 0.25, dd]] as Array<[number, number]>) {
        const p = P(uu, (d0 + d1) / 2);
        k.box(0.36, Math.min(2.6, yt - yb - 0.3), len - 0.2, p[0], yb + Math.min(2.6, yt - yb - 0.3) / 2, p[1], M.oak, { ry, tint: 0.55 });
        for (let y = 0.4; y < 2.4; y += 0.45)
          for (let j = 0; j < 4; j++) {
            const q = P(uu, d0 + 0.2 + (j + 0.5) * ((dd - 0.4) / 4));
            k.box(0.26, 0.3, (dd - 0.5) / 4, q[0], yb + y + 0.15, q[1], [M.red, M.blue, M.oak, M.dark][(j + Math.round(y * 10)) % 4], { ry, tint: 0.55 });
          }
      }
      tb((u0 + u1) / 2, (d0 + d1) / 2, 1.4, 0.8, 0.7, 0.4, M.oak, 0.7);
    } else {
      // a cell: a bed with its blanket, a table and a stool, a prie-dieu, a chest
      const ub = u0 + 0.5;
      tb(ub, (d0 + d1) / 2 + 0.2, 0.9, 0.4, 1.9, 0.2, M.oak, 0.6);
      tb(ub, (d0 + d1) / 2 + 0.2, 0.84, 0.12, 1.84, 0.46, M.linen, 0.85);
      tb(ub, (d0 + d1) / 2 + 0.55, 0.86, 0.06, 1.2, 0.53, kind === "house" ? M.red : M.blue, 0.6);
      tb(u1 - 0.45, d0 + 0.45, 0.8, 0.76, 0.55, 0.38, M.oak, 0.7);
      tb(u1 - 0.45, d0 + 1.0, 0.36, 0.45, 0.36, 0.225, M.oak, 0.6);
      tb(u1 - 0.4, d1 - 0.4, 0.5, 0.8, 0.4, 0.4, M.oak, 0.6);
      if (dd > 2.6) tb((u0 + u1) / 2, d1 - 0.3, 0.9, 0.5, 0.45, 0.25, M.oak, 0.55);
    }
  }

  private plainRoom(): void {
    this.floorAndCeiling(this.M.floor, this.M.vault, 0.8, 0.9);
  }

  private sacristy(): void {
    const { sp, M, k, ls } = this;
    this.floorAndCeiling(M.floor, M.vault, 0.8, 0.9);
    const inner = this.innerPoly(0.02);
    const c = centroid(inner);
    const yb = this.L(sp.y0);
    // the vestment press along the longest wall of its own with no window near (clear of the church's windows), a tall
    // cupboard, the lavabo, a crucifix and a prie-dieu
    const walls = ls.edges.filter((e) => e.lined).sort((a, b) => a.rows.length - b.rows.length || b.len - a.len);
    const e = walls[0];
    if (e) {
      const d = this.from(e) + this.thick() + 0.45;
      const m: P2 = [(e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2];
      const p = add(m, e.n, -d);
      const ry = Math.atan2(-e.t[1], e.t[0]);
      const len = Math.min(e.len - 2.4, 5.5);
      k.box(len, 0.95, 0.85, p[0], yb + 0.475, p[1], M.oak, { ry, tint: 0.7 });
      k.box(len + 0.05, 0.05, 0.9, p[0], yb + 0.975, p[1], M.oak, { ry, tint: 0.85 });
      const q = add(m, e.n, -(this.from(e) + this.thick() + 0.04));
      k.box(0.05, 0.9, 0.05, q[0], yb + 2.1, q[1], M.dark, { ry });
      k.box(0.5, 0.06, 0.05, q[0], yb + 2.35, q[1], M.dark, { ry });
      figure(k, M.statue, q[0] - e.n[0] * 0.02, yb + 1.75, q[1] - e.n[1] * 0.02, 0.55, ry, false);
      const u2 = add(add(m, e.t, len / 2 + 0.8), e.n, -(this.from(e) + this.thick() + 0.35));
      k.box(1.2, 2.3, 0.6, u2[0], yb + 1.15, u2[1], M.oak, { ry, tint: 0.62 });
    }
    k.box(0.6, 0.8, 0.5, c[0], yb + 0.4, c[1], M.oak, { tint: 0.6 });
    k.box(0.6, 0.12, 0.3, c[0], yb + 0.2, c[1] + 0.3, M.oak, { tint: 0.6 });
    const pic = M.pictures[0];
    const w2 = walls[1];
    if (pic && w2) {
      const m: P2 = [(w2.a[0] + w2.c[0]) / 2, (w2.a[1] + w2.c[1]) / 2];
      const p = add(m, w2.n, -(this.from(w2) + this.thick() + 0.03));
      k.plane(1.0, 1.3, p[0], yb + 2.4, p[1], pic, { ry: Math.atan2(-w2.n[0], -w2.n[1]) });
    }
  }

  private porch(): void {
    const { sp, M, k, ls } = this;
    this.floorAndCeiling(M.floor, M.vault, 0.8, 0.9);
    const yb = this.L(sp.y0);
    // benches along the long walls, the votive stand, a painting of the Virgin on the wall toward the chapel
    for (const e of ls.edges.filter((q) => q.lined && q.len > 5)) {
      const d = this.from(e) + this.thick() + 0.22;
      const m: P2 = [(e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2];
      const p = add(m, e.n, -d);
      const ry = Math.atan2(-e.t[1], e.t[0]);
      k.box(e.len - 2.4, 0.08, 0.4, p[0], yb + 0.45, p[1], M.oak, { ry, tint: 0.7 });
      k.box(e.len - 2.4, 0.4, 0.3, p[0], yb + 0.2, p[1], M.oak, { ry, tint: 0.55 });
    }
    const c = ls.c;
    k.box(0.5, 0.9, 0.5, c[0], yb + 0.45, c[1], M.iron, { tint: 0.8 });
    const e = [...ls.edges].sort((a, b) => a.rows.length - b.rows.length || a.len - b.len)[0];
    const pic = M.pictures[1] ?? M.pictures[0];
    if (pic && e) {
      const m: P2 = [(e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2];
      const p = add(m, e.n, -(this.from(e) + this.thick() + 0.03));
      k.plane(1.3, 1.7, p[0], yb + 2.6, p[1], pic, { ry: Math.atan2(-e.n[0], -e.n[1]) });
    }
  }

  private baptistery(): void {
    const { sp, M, k } = this;
    const inner = this.innerPoly();
    const c = centroid(inner);
    const R = Math.min(...inner.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    slab(k, M.marbleW, inset(this.ls.poly, 0.03), this.L(sp.y0), 0.14, 0.9, 1.2);
    const yb = this.L(sp.y0);
    // its dome, plastered, from the walls' top
    const dh = this.n.dome ?? 2.5;
    const sphere = new THREE.SphereGeometry(R + 0.08, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2);
    sphere.scale(1, dh / (R + 0.08), 1);
    const g = inward(sphere);
    planarUV(g, 1.6);
    k.add(g, M.vault, c[0], this.L(sp.y1) + 0.02, c[1], { flat: true, tint: 0.95 });
    const ring = inward(new THREE.CylinderGeometry(R + 0.1, R + 0.1, 0.25, 16, 1, true));
    planarUV(ring, 1.2);
    k.add(ring, M.marbleW, c[0], this.L(sp.y1) - 0.075, c[1], { tint: 0.9, flat: true });
    // the font: a marble basin on a baluster, its copper cover with a figure of St John on it; a step round it
    k.cyl(0.95, 0.95, 0.12, c[0], yb, c[1], M.marbleB, { seg: 12 });
    k.cyl(0.22, 0.32, 0.75, c[0], yb + 0.12, c[1], M.marbleB, { seg: 10 });
    k.cyl(0.62, 0.3, 0.32, c[0], yb + 0.87, c[1], M.marbleW, { seg: 12 });
    k.cyl(0.2, 0.62, 0.55, c[0], yb + 1.19, c[1], M.bronze, { seg: 12, tint: 0.7 });
    figure(k, M.gilt, c[0], yb + 1.74, c[1], 0.55, 0, false);
    // a painting of the baptism of Christ on the wall away from the windows
    const pic = this.M.pictures[0];
    const e = this.ls.edges.find((q) => q.rows.length === 0 && q.lined);
    if (pic && e) {
      const m: P2 = [(e.a[0] + e.c[0]) / 2, (e.a[1] + e.c[1]) / 2];
      const p = add(m, e.n, -(this.from(e) + this.thick() + 0.03));
      k.plane(1.1, 1.5, p[0], yb + 2.9, p[1], pic, { ry: Math.atan2(-e.n[0], -e.n[1]) });
    }
  }
}

/** The parts of a church that are only seen from the street: shown or hidden as a group (dev and the checks). */
export function spaceParts(built: ChurchSpacesBuilt): THREE.Group[] {
  return built.parts;
}
