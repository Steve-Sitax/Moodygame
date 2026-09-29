import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import type { Kit, MatDef } from "./landmarkKit";
import { planarUV } from "./carolusHall";
import type { Opening } from "./inworld";
import { alongFace, onFace, outline, type ShellFace, type ShellOpening } from "../../../shared/shellOpening";

// Real openings (docs/building-with-interior.md; M7 prison real, 2026-09-26: Steve, "Never do instanced, always go
// real"). A building's shell (Blender) cuts its windows and doors through and lists them (shared/<name>Shell.ts,
// shared/shellOpening.ts). Here, the room's side of that:
//  - lining(): the room's wall behind one face of the shell, from the reveal's back to the room's inner face, cut
//    exactly where the shell's openings on that face are (so the reveal runs on without a gap, and never a painted
//    pane over a room);
//  - glassPanes(): the glass in every window, just behind the shell's bars (clear, or leaded for a chapel);
//  - windowOpenings(): each window as an opening of the in-world room (world/inworld.ts), so the room is drawn
//    through it from the street and the street through it from inside, only where it can be seen from.

/** A wall of the room behind a face of the shell. Heights in world metres; `u` along the face from its start. */
export interface Lining {
  face: ShellFace;
  /** The lining's outer face this far in from the shell's outer face (the reveal's depth), its inner face this far. */
  from: number;
  to: number;
  /** The part of the face it lines (default: all of it). */
  u0?: number;
  u1?: number;
  /** Bottom and top (world y). */
  y0: number;
  y1: number;
  /** A top that is not level (a gable, a slope): (u, world y) points from u0 to u1. */
  top?: Array<[number, number]>;
  /** Doorways of the room's own cut from the bottom (u0, u1 along the face; top world y; a round head; or a head of its own, (u, y) left to right). */
  doors?: Array<{ u0: number; u1: number; top: number; round?: boolean; head?: Array<[number, number]> }>;
  /** Holes of the room's own (u along the face, world y outlines). */
  holes?: Array<Array<[number, number]>>;
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * Build a lining into a kit (whose group sits at the building's frame, its floor at `floorY`). Every shell opening on
 * the face in its part is cut through it: windows as holes, doors from the bottom edge (2 cm wider than the shell's
 * reveal, so the two reveals never lie in one plane). Returns the openings it cut.
 */
export function lining(k: Kit, def: MatDef, L: Lining, openings: readonly ShellOpening[], floorY: number, tile = 2.0, tint?: number): ShellOpening[] {
  const f = L.face;
  const len = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const tx = (f.c[0] - f.a[0]) / len;
  const tz = (f.c[1] - f.a[1]) / len;
  const u0 = L.u0 ?? 0;
  const u1 = L.u1 ?? len;
  const topAt = (u: number): number => {
    if (!L.top?.length) return L.y1;
    const p = L.top;
    if (u <= p[0][0]) return p[0][1];
    for (let i = 1; i < p.length; i++) if (u <= p[i][0]) return p[i - 1][1] + ((p[i][1] - p[i - 1][1]) * (u - p[i - 1][0])) / Math.max(1e-6, p[i][0] - p[i - 1][0]);
    return p[p.length - 1][1];
  };
  const used: ShellOpening[] = [];
  const holes: Array<Array<[number, number]>> = [...(L.holes ?? [])];
  const doors = [...(L.doors ?? [])];
  for (const o of openings) {
    if (!onFace(o, f)) continue;
    const um = alongFace(o, f);
    const hw = o.shape === "round" ? (o.r ?? o.hw) : o.hw;
    if (um + hw < u0 + 1e-3 || um - hw > u1 - 1e-3) continue;
    if (o.yt < L.y0 - 1e-3 || o.yb > topAt(um) + 1e-3) continue;
    used.push(o);
    if (o.kind === "door" && o.yb <= L.y0 + 0.05) {
      // a head of its own (a basket arch): its outline over the bottom, left to right, 2 cm wider and higher
      let head: Array<[number, number]> | undefined;
      if (o.poly?.length) {
        const k = (hw + 0.02) / Math.max(1e-6, hw);
        head = o.poly.filter(([, y]) => y > o.yb + 1e-3).map(([u, y]) => [um + u * k, y + 0.02] as [number, number]).sort((p, q) => p[0] - q[0]);
      }
      doors.push({ u0: um - hw - 0.02, u1: um + hw + 0.02, top: o.arch ? o.yt + 0.02 : o.yt + 0.02, round: o.arch, head });
      continue;
    }
    holes.push(outline(o).map(([u, y]) => [um + u, y] as [number, number]));
    // issue #10: a reveal shallower than the lining's front: a sleeve of the room from the reveal's back to the
    // lining, so no gap shows between them (its sides only; the glass stays at the reveal's back)
    if (o.depth < L.from - 0.005) sleeve(k, def, f, um, outline(o, 10), o.depth, L.from, floorY, tint);
  }
  // the right hand: along x up x inward must be right-handed; if it is not, extrude from the inner face outward
  // (never mirror the shape: three.js then turns the hole's sides inside out)
  const det = tz * f.n[0] - tx * f.n[1];
  const inward = det >= 0;
  const shape = new THREE.Shape();
  const P = (u: number, y: number) => new THREE.Vector2(u, y - floorY);
  const pts: THREE.Vector2[] = [P(u0, L.y0)];
  for (const d of doors.sort((a, b) => a.u0 - b.u0)) {
    const a = Math.max(u0, d.u0);
    const b = Math.min(u1, d.u1);
    if (b <= a) continue;
    pts.push(P(a, L.y0));
    if (d.head?.length) {
      for (const [u, y] of d.head) pts.push(P(Math.min(b, Math.max(a, u)), y));
    } else if (d.round) {
      const r = (b - a) / 2;
      const sp = d.top - r;
      pts.push(P(a, sp));
      for (let i = 1; i < 8; i++) {
        const ang = Math.PI - (Math.PI * i) / 8;
        pts.push(P((a + b) / 2 + r * Math.cos(ang), sp + r * Math.sin(ang)));
      }
      pts.push(P(b, sp));
    } else {
      pts.push(P(a, d.top));
      pts.push(P(b, d.top));
    }
    pts.push(P(b, L.y0));
  }
  pts.push(P(u1, L.y0));
  if (L.top?.length) {
    pts.push(P(u1, topAt(u1)));
    for (let i = L.top.length - 1; i >= 0; i--) if (L.top[i][0] > u0 && L.top[i][0] < u1) pts.push(P(L.top[i][0], L.top[i][1]));
    pts.push(P(u0, topAt(u0)));
  } else {
    pts.push(P(u1, L.y1));
    pts.push(P(u0, L.y1));
  }
  shape.setFromPoints(pts);
  for (const h of holes) shape.holes.push(new THREE.Path(h.map(([u, y]) => P(u, y))));
  const g = new THREE.ExtrudeGeometry(shape, { depth: L.to - L.from, bevelEnabled: false, curveSegments: 1 });
  // shape x along the face, y up, extruded inward from the reveal's back (or outward from the inner face)
  const zs = inward ? -1 : 1;
  const d0 = inward ? L.from : L.to;
  const m = new THREE.Matrix4().makeBasis(V(tx, 0, tz), V(0, 1, 0), V(zs * f.n[0], 0, zs * f.n[1]));
  m.setPosition(f.a[0] - f.n[0] * d0, 0, f.a[1] - f.n[1] * d0);
  g.applyMatrix4(m);
  g.computeVertexNormals();
  planarUV(g, tile);
  k.add(g, def, 0, 0, 0, { tint, flat: true });
  return used;
}

/**
 * A shell's opening markers (the empties "opening_<id>" its Blender script writes), kept in their world place for the
 * interior check (dev/interiorcheck.ts): plain objects with the marker's custom properties, for a loader to add to
 * its group (at the world's origin, not turned).
 */
export function shellMarkers(root: THREE.Object3D): THREE.Object3D[] {
  root.updateMatrixWorld(true);
  const out: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (!/^opening_/.test(o.name)) return;
    const e = new THREE.Object3D();
    e.name = o.name;
    e.userData = { ...o.userData };
    e.position.setFromMatrixPosition(o.matrixWorld);
    out.push(e);
  });
  return out;
}

/**
 * The sides of an opening's hole from depth d0 to d1 into a face (issue #10): the outline (u from the face's start,
 * world y) swept straight in, each side facing into the opening.
 */
function sleeve(k: Kit, def: MatDef, f: ShellFace, um: number, ring: Array<[number, number]>, d0: number, d1: number, floorY: number, tint?: number): void {
  const len = Math.hypot(f.c[0] - f.a[0], f.c[1] - f.a[1]);
  const tx = (f.c[0] - f.a[0]) / len;
  const tz = (f.c[1] - f.a[1]) / len;
  const at = (u: number, y: number, d: number) => V(f.a[0] + tx * (um + u) - f.n[0] * d, y - floorY, f.a[1] + tz * (um + u) - f.n[1] * d);
  const cu = ring.reduce((s, p) => s + p[0], 0) / ring.length;
  const cy = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  const mid = at(cu, cy, (d0 + d1) / 2);
  const pos: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const [pu, py] = ring[i];
    const [qu, qy] = ring[(i + 1) % ring.length];
    if (Math.hypot(qu - pu, qy - py) < 1e-5) continue;
    const a = at(pu, py, d0);
    const b = at(qu, qy, d0);
    const c = at(qu, qy, d1);
    const d = at(pu, py, d1);
    // facing the opening's middle
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(d, a));
    const toMid = new THREE.Vector3().subVectors(mid, a);
    const q = n.dot(toMid) >= 0 ? [a, b, c, a, c, d] : [a, c, b, a, d, c];
    for (const v of q) pos.push(v.x, v.y, v.z);
  }
  if (!pos.length) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  planarUV(g, 1.6);
  k.add(g, def, 0, 0, 0, { tint: tint ?? 0.8, flat: true });
}

/** The glass of these openings (windows, slits left bare, roof lights), in the building's frame: a hair behind the shell's bars. */
export function glassPanes(openings: readonly ShellOpening[], floorY: number, into = 0.006): THREE.BufferGeometry | null {
  const geos: THREE.BufferGeometry[] = [];
  for (const o of openings) {
    if (o.kind === "door" || o.kind === "slit") continue;
    const pos: number[] = [];
    if (o.shape === "quad" && o.pts) {
      const n = V(o.nx, o.ny ?? 0, o.nz).normalize();
      const q = o.pts.map((p) => V(p[0], p[1] - floorY, p[2]).addScaledVector(n, -0.012));
      pos.push(...q[0].toArray(), ...q[1].toArray(), ...q[2].toArray(), ...q[0].toArray(), ...q[2].toArray(), ...q[3].toArray());
    } else {
      const d = o.depth + into;
      const ring = outline(o, 10).map(([u, y]) => V(o.x + o.tx * u - o.nx * d, y - floorY, o.z + o.tz * u - o.nz * d));
      const c = ring.reduce((a, p) => a.add(p), V(0, 0, 0)).multiplyScalar(1 / ring.length);
      for (let i = 0; i < ring.length; i++) pos.push(...c.toArray(), ...ring[i].toArray(), ...ring[(i + 1) % ring.length].toArray());
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    // uv: the pane in metres (the leaded glass's picture repeats every half metre)
    const uv: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uv.push((pos[i] * o.tx + pos[i + 2] * o.tz) * 2, pos[i + 1] * 1.2);
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geos.push(g);
  }
  if (!geos.length) return null;
  const out = mergeGeometries(geos, false);
  for (const g of geos) g.dispose();
  return out;
}

/**
 * Issue #10: the glass of a landmark's real windows as one mesh of its room (a picture of leaded glass, see-through
 * a little: the room shows from the street and the street from inside), `userData.glass` for the interior check.
 * `tile`: metres per repeat of the picture (the shell's own glass picture, as its panes had it). The material is one
 * the prison's chapel already draws with (MeshBasic, a map, see-through, both sides): no new shader kind.
 */
export function realGlass(openings: readonly ShellOpening[], floorY: number, pic: THREE.Texture, opts: { tile?: number; color?: number; opacity?: number; name: string }): { mesh: THREE.Mesh | null; mat: THREE.MeshBasicMaterial } {
  const mat = new THREE.MeshBasicMaterial({ map: pic, color: opts.color ?? 0x9a9e98, transparent: true, opacity: opts.opacity ?? 0.55, depthWrite: false, side: THREE.DoubleSide });
  mat.name = `${opts.name}_glass`;
  const g = glassPanes(openings, floorY);
  if (!g) return { mesh: null, mat };
  // glassPanes lays its uv at 0.5 m by 0.83 m: to the picture's tile
  const tile = opts.tile ?? 1.2;
  const uv = g.getAttribute("uv") as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / (2 * tile), uv.getY(i) / (1.2 * tile));
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = `${opts.name}_glass`;
  mesh.userData.glass = true;
  mesh.renderOrder = 5;
  return { mesh, mat };
}

let quarryPic: THREE.Texture | null = null;
/** Leaded quarries (diamond panes of old greenish glass, 0.64 m a repeat), painted once: for a shell whose glass picture is packed in its glb. */
export function quarries(): THREE.Texture {
  if (quarryPic) return quarryPic;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  g.fillStyle = "#9aa89c";
  g.fillRect(0, 0, 64, 64);
  // each pane a little different: old glass, uneven
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      const v = 150 + ((i * 37 + j * 71) % 40);
      g.fillStyle = `rgb(${v - 12}, ${v}, ${v - 8})`;
      g.beginPath();
      g.moveTo(i * 16 + 8, j * 16);
      g.lineTo(i * 16 + 16, j * 16 + 8);
      g.lineTo(i * 16 + 8, j * 16 + 16);
      g.lineTo(i * 16, j * 16 + 8);
      g.closePath();
      g.fill();
    }
  g.strokeStyle = "#2a2c2a";
  g.lineWidth = 1.5;
  for (let k = -64; k <= 64; k += 16) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.moveTo(k + 64, 0);
    g.lineTo(k, 64);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.name = "leaded_quarries";
  quarryPic = t;
  return t;
}

/** A picture of the shell's own (its glass), wrapped, for realGlass. */
export function shellPicture(url: string): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.name = url.replace(/^.*\//, "").replace(/\.\w+$/, "");
  return t;
}

/**
 * Each window (and slit and roof light) as an opening of an in-world room: its box from 0.3 m outside the shell's
 * face to past the reveal into the room, so the room is drawn through it from the street and the street through it
 * from inside. `seen(o)`, if given, answers for an eye inside whether that opening can be seen from there at all
 * (world/inworld.ts: only those count), the building's own portal knowledge (which part sees which).
 */
export function windowOpenings(openings: readonly ShellOpening[], toWorld: (x: number, z: number) => [number, number], seen?: (o: ShellOpening) => ((eye: THREE.Vector3) => boolean) | undefined): Opening[] {
  const out: Opening[] = [];
  for (const o of openings) {
    if (o.kind === "door") continue;
    const box = new THREE.Box3();
    const add = (x: number, y: number, z: number) => {
      const [wx, wz] = toWorld(x, z);
      box.expandByPoint(V(wx, y, wz));
    };
    let centre: THREE.Vector3;
    if (o.shape === "quad" && o.pts) {
      const n = V(o.nx, o.ny ?? 0, o.nz).normalize();
      for (const p of o.pts) for (const d of [0.4, -0.6]) add(p[0] + n.x * d, p[1] + n.y * d, p[2] + n.z * d);
      const c = o.pts.reduce((a, p) => a.add(V(p[0], p[1], p[2])), V(0, 0, 0)).multiplyScalar(0.25);
      const [wx, wz] = toWorld(c.x, c.z);
      centre = V(wx, c.y, wz);
    } else {
      const hw = o.shape === "round" ? (o.r ?? o.hw) : o.hw;
      const [yb, yt] = o.shape === "round" ? [(o.cy ?? 0) - hw, (o.cy ?? 0) + hw] : [o.yb, o.yt];
      for (const u of [-hw - 0.05, hw + 0.05])
        for (const d of [-0.3, o.depth + 0.5])
          for (const y of [yb - 0.05, yt + 0.05]) add(o.x + o.tx * u - o.nx * d, y, o.z + o.tz * u - o.nz * d);
      const [wx, wz] = toWorld(o.x, o.z);
      centre = V(wx, (yb + yt) / 2, wz);
    }
    const [ox, oz] = toWorld(o.x + o.nx, o.z + o.nz);
    const [cx, cz] = toWorld(o.x, o.z);
    const out_ = V(ox - cx, 0, oz - cz);
    if (out_.lengthSq() < 1e-6) out_.set(0, 1, 0);
    else out_.normalize();
    out.push({ kind: "window", label: o.label, box, inBox: box, centre, out: out_, open: () => true, seen: seen?.(o) });
  }
  return out;
}
