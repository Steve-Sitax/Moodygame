import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { psx } from "../retro/psx";
import { canvasTex, rand } from "./rooms";
import { glowTexture } from "./textures";

// The kit for the landmark halls (M6 landmark interiors): big rooms built in code in the PS1
// way, but cheap to draw. Every box, column and arch goes into a list per material and is
// merged into ONE mesh per material at the end (a hall of hundreds of pieces is a few dozen
// draw calls). Shading is baked into vertex colour: a tint per piece, darker toward the floor
// and in the corners, as the old engines did. Big faces are cut into pieces of a few metres,
// so the affine warp and the vertex snap stay tame.

export type Rect = { minX: number; maxX: number; minZ: number; maxZ: number };

export interface MatDef {
  key: string;
  make: () => THREE.Material;
}

const cache = new Map<string, THREE.Material>();
/** A psx Lambert with a map and vertex colour, made once. */
export function lmMat(key: string, o: THREE.MeshLambertMaterialParameters, affine = 0.15): MatDef {
  return { key, make: () => psx(new THREE.MeshLambertMaterial({ ...o, vertexColors: true }), { affine }) };
}
/** Unlit (glass, flames, painted light): basic with vertex colour. */
export function lmBasic(key: string, o: THREE.MeshBasicMaterialParameters): MatDef {
  return { key, make: () => new THREE.MeshBasicMaterial({ ...o, vertexColors: true }) };
}
/** The one material of a definition (made on first use). */
export function matOf(d: MatDef): THREE.Material {
  let m = cache.get(d.key);
  if (!m) cache.set(d.key, (m = d.make()));
  return m;
}

export interface PieceOpts {
  /** Metres per texture repeat. */
  tile?: number;
  /** Add to the walk blocks. */
  solid?: boolean;
  ry?: number;
  rx?: number;
  rz?: number;
  /** Colour multiplier (vertex colour), 0x rrggbb or a grey 0..1. */
  tint?: number;
  /** Skip the darkening toward the floor. */
  flat?: boolean;
}

function tintRGB(t: number | undefined): [number, number, number] {
  if (t === undefined) return [1, 1, 1];
  if (t <= 1.5) return [t, t, t];
  return [((t >> 16) & 255) / 255, ((t >> 8) & 255) / 255, (t & 255) / 255];
}

/**
 * A pointed arch's curve, from the left springing (-half, 0) over the apex (0, rise) to the
 * right springing (half, 0): two arcs of one radius, each centred on the springing line.
 */
export function pointedProfile(half: number, rise: number, n: number): Array<[number, number]> {
  const r = (half * half + rise * rise) / (2 * half);
  const cl = r - half; // the left arc's centre (x), right of the left jamb
  const aApex = Math.atan2(rise, -cl); // angle of the apex seen from the left centre
  const out: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const a = Math.PI + (aApex - Math.PI) * (i / n);
    out.push([-half + r + Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (let i = n - 1; i >= 0; i--) {
    const [x, y] = out[i];
    out.push([-x, y]);
  }
  return out;
}

export class Kit {
  readonly solids: Rect[] = [];
  private parts = new Map<string, { def: MatDef; geos: THREE.BufferGeometry[] }>();
  /** Height of the room, for the shading toward the floor. */
  shadeTop = 12;

  constructor(readonly group: THREE.Group) {}

  /** Put a geometry (its own frame) at a place, tinted, into the material's list. */
  add(g: THREE.BufferGeometry, def: MatDef, x: number, y: number, z: number, o: PieceOpts = {}): void {
    const geo = g.index ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(o.rx ?? 0, o.ry ?? 0, o.rz ?? 0, "YXZ")), new THREE.Vector3(1, 1, 1));
    geo.applyMatrix4(m);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((geo.getAttribute("position").count) * 2), 2));
    if (!geo.getAttribute("normal")) geo.computeVertexNormals();
    const pos = geo.getAttribute("position") as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const [r, gg, b] = tintRGB(o.tint);
    for (let i = 0; i < pos.count; i++) {
      const h = pos.getY(i);
      const k = o.flat ? 1 : 0.62 + 0.38 * Math.min(1, Math.max(0, h / this.shadeTop)) ** 0.7;
      col[i * 3] = r * k;
      col[i * 3 + 1] = gg * k;
      col[i * 3 + 2] = b * k;
    }
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    for (const name of Object.keys(geo.attributes)) if (!["position", "normal", "uv", "color"].includes(name)) geo.deleteAttribute(name);
    let p = this.parts.get(def.key);
    if (!p) this.parts.set(def.key, (p = { def, geos: [] }));
    p.geos.push(geo);
  }

  /** A box by its centre; big faces cut into pieces; the texture tiles by size. */
  box(w: number, h: number, d: number, x: number, y: number, z: number, def: MatDef, o: PieceOpts = {}): void {
    const seg = (v: number) => Math.max(1, Math.min(12, Math.ceil(v / 4)));
    const g = new THREE.BoxGeometry(w, h, d, seg(w), seg(h), seg(d));
    const tile = o.tile ?? 1;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    // planar UVs by the face's normal, in metres / tile (so the pieces of a cut face line up)
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(nrm.getX(i));
      const ny = Math.abs(nrm.getY(i));
      const px = pos.getX(i);
      const py = pos.getY(i);
      const pz = pos.getZ(i);
      if (ny > 0.5) uv.setXY(i, px / tile, pz / tile);
      else if (nx > 0.5) uv.setXY(i, pz / tile, py / tile);
      else uv.setXY(i, px / tile, py / tile);
    }
    this.add(g, def, x, y, z, o);
    if (o.solid) this.solid(w, d, x, z, o.ry);
  }

  solid(w: number, d: number, x: number, z: number, ry = 0): void {
    const rw = Math.abs(Math.cos(ry)) * w + Math.abs(Math.sin(ry)) * d;
    const rd = Math.abs(Math.sin(ry)) * w + Math.abs(Math.cos(ry)) * d;
    this.solids.push({ minX: x - rw / 2, maxX: x + rw / 2, minZ: z - rd / 2, maxZ: z + rd / 2 });
  }

  /** A column (or a round thing): radius top and bottom, height, standing on y. */
  cyl(rt: number, rb: number, h: number, x: number, y: number, z: number, def: MatDef, o: PieceOpts & { seg?: number; open?: boolean } = {}): void {
    const g = new THREE.CylinderGeometry(rt, rb, h, o.seg ?? 8, Math.max(1, Math.ceil(h / 4)), o.open ?? false);
    const tile = o.tile ?? 1;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const circ = Math.PI * 2 * Math.max(rt, rb);
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * circ) / tile, (uv.getY(i) * h) / tile);
    this.add(g, def, x, y + h / 2, z, o);
    if (o.solid) this.solids.push({ minX: x - rb, maxX: x + rb, minZ: z - rb, maxZ: z + rb });
  }

  /**
   * A wall with a pointed arch cut through it, in the x-y plane (thickness along z), centred on x.
   * `w` the wall's width, `h` its height; the opening `ow` wide, springing at `spring`, apex at `apex`.
   */
  archWall(w: number, h: number, t: number, ow: number, spring: number, apex: number, x: number, y: number, z: number, def: MatDef, o: PieceOpts = {}): void {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(-ow / 2, 0);
    for (const [px, py] of pointedProfile(ow / 2, apex - spring, 8)) s.lineTo(px, spring + py);
    s.lineTo(ow / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(w / 2, h);
    s.lineTo(-w / 2, h);
    s.lineTo(-w / 2, 0);
    const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 4 });
    g.translate(0, 0, -t / 2);
    const tile = o.tile ?? 1;
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    const pos = g.getAttribute("position") as THREE.BufferAttribute;
    const nrm = g.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const nz = Math.abs(nrm.getZ(i));
      uv.setXY(i, (nz > 0.5 ? pos.getX(i) : pos.getZ(i) + pos.getX(i)) / tile, pos.getY(i) / tile);
    }
    this.add(g, def, x, y, z, o);
  }

  /**
   * A pointed barrel vault along z: `w` across (x), springing at `spring`, rising `rise`, `len`
   * long, its near end at z0. Seen from below (the inside faces down).
   */
  vault(w: number, spring: number, rise: number, len: number, x: number, z0: number, def: MatDef, o: PieceOpts = {}): void {
    const prof = pointedProfile(w / 2, rise, 6);
    const segZ = Math.max(1, Math.ceil(len / 4));
    const pos: number[] = [];
    const uvs: number[] = [];
    const tile = o.tile ?? 2;
    let acc = 0;
    const along: number[] = [0];
    for (let i = 1; i < prof.length; i++) along.push((acc += Math.hypot(prof[i][0] - prof[i - 1][0], prof[i][1] - prof[i - 1][1])));
    for (let k = 0; k < segZ; k++) {
      const za = (len * k) / segZ;
      const zb = (len * (k + 1)) / segZ;
      for (let i = 0; i < prof.length - 1; i++) {
        const [xa, ya] = prof[i];
        const [xb, yb] = prof[i + 1];
        const quad = [
          [xa, ya, za, along[i], za],
          [xb, yb, zb, along[i + 1], zb],
          [xb, yb, za, along[i + 1], za],
          [xa, ya, za, along[i], za],
          [xa, ya, zb, along[i], zb],
          [xb, yb, zb, along[i + 1], zb],
        ];
        for (const [px, py, pz, u, v] of quad) {
          pos.push(px, spring + py, pz);
          uvs.push(u / tile, v / tile);
        }
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    g.computeVertexNormals();
    this.add(g, def, x, 0, z0, { ...o, flat: true });
  }

  /** A flat picture or pane facing +z (turn it with ry). */
  plane(w: number, h: number, x: number, y: number, z: number, def: MatDef, o: PieceOpts = {}): void {
    const g = new THREE.PlaneGeometry(w, h);
    this.add(g, def, x, y, z, { ...o, flat: o.flat ?? true });
  }

  /** A barrel (bulging staves) with its hoops, lying along x (lying) or standing. */
  barrel(x: number, y: number, z: number, wood: MatDef, hoop: MatDef, o: { lying?: boolean; ry?: number; r?: number; len?: number; tint?: number; solid?: boolean } = {}): void {
    const R = o.r ?? 0.34;
    const L = o.len ?? 0.95;
    const g = new THREE.CylinderGeometry(R, R, L, 10, 3);
    const p = g.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const k = 1 + 0.13 * (1 - (p.getY(i) / (L / 2)) ** 2);
      p.setXYZ(i, p.getX(i) * k, p.getY(i), p.getZ(i) * k);
    }
    const uv = g.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 3, uv.getY(i) * 1.2);
    const rot = { rz: o.lying ? Math.PI / 2 : 0, ry: o.ry ?? 0, tint: o.tint };
    this.add(g, wood, x, y, z, rot);
    for (const s of [-0.3, 0.3]) {
      const hg = new THREE.CylinderGeometry(R * 1.1, R * 1.1, 0.06, 10, 1, true);
      const off = s * L;
      if (o.lying) {
        const c = Math.cos(o.ry ?? 0);
        const sn = Math.sin(o.ry ?? 0);
        this.add(hg, hoop, x + off * c, y, z - off * sn, rot);
      } else this.add(hg, hoop, x, y + off, z, rot);
    }
    if (o.solid) this.solid(o.lying ? L : R * 2, R * 2, x, z, o.ry);
  }

  /** Merge each material's pieces into one mesh and put them in the group. */
  finish(): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const { def, geos } of this.parts.values()) {
      if (!geos.length) continue;
      const g = mergeGeometries(geos, false);
      for (const q of geos) q.dispose();
      if (!g) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, matOf(def));
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      this.group.add(mesh);
      out.push(mesh);
    }
    this.parts.clear();
    return out;
  }
}

// ---------------------------------------------------------------- walking

/** Walk in a union of floor rectangles, off the solid blocks (a walker of radius 0.3). */
export function rectWalker(floors: Rect[], solids: Rect[]): (fx: number, fz: number, x: number, z: number) => [number, number] {
  const R = 0.3;
  const inFloor = (x: number, z: number) => floors.some((f) => x > f.minX + R && x < f.maxX - R && z > f.minZ + R && z < f.maxZ - R) || floors.some((f) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && floors.some((g) => g !== f && x > g.minX - 0.01 && x < g.maxX + 0.01 && z > g.minZ - 0.01 && z < g.maxZ + 0.01));
  const free = (x: number, z: number) => inFloor(x, z) && !solids.some((b) => x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R);
  return (fx, fz, x, z) => {
    if (free(x, z)) return [x, z];
    if (free(x, fz)) return [x, fz];
    if (free(fx, z)) return [fx, z];
    return [fx, fz];
  };
}

// ---------------------------------------------------------------- light

/** Small flames (candles, the Lady altar's stand): one draw call for all of them. */
export class Flames {
  readonly points: THREE.Points;
  private readonly base: Float32Array;
  private n = 0;
  constructor(group: THREE.Group, max: number, size = 0.16) {
    const g = new THREE.BufferGeometry();
    this.base = new Float32Array(max * 3);
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setDrawRange(0, 0);
    this.points = new THREE.Points(
      g,
      new THREE.PointsMaterial({ map: glowTexture(), color: 0xffc070, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.points.frustumCulled = false;
    group.add(this.points);
  }
  addFlame(x: number, y: number, z: number): number {
    const i = this.n++;
    this.base.set([x, y, z], i * 3);
    const p = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    p.setXYZ(i, x, y, z);
    p.needsUpdate = true;
    this.points.geometry.setDrawRange(0, this.n);
    return i;
  }
  /** Show only the first `n` (candles blown out after mass). */
  showFirst(n: number): void {
    this.points.geometry.setDrawRange(0, Math.min(this.n, n));
  }
  get count(): number {
    return this.n;
  }
  update(t: number): void {
    const p = this.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < this.n; i++) p.setY(i, this.base[i * 3 + 1] + Math.sin(t * 9 + i * 1.7) * 0.006);
    p.needsUpdate = true;
    (this.points.material as THREE.PointsMaterial).opacity = 0.85 + Math.sin(t * 13.1) * 0.06 + Math.sin(t * 5.3) * 0.05;
  }
}

/** A shaft of daylight from a high window down to the floor: a soft additive quad, both sides. */
export function lightShaft(group: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, width: number, mat: THREE.MeshBasicMaterial): THREE.Mesh {
  const len = from.distanceTo(to);
  const g = new THREE.PlaneGeometry(width, len);
  const m = new THREE.Mesh(g, mat);
  m.position.copy(from).add(to).multiplyScalar(0.5);
  m.lookAt(to);
  m.rotateX(Math.PI / 2);
  group.add(m);
  return m;
}

export function shaftMaterial(): THREE.MeshBasicMaterial {
  const tex = canvasTex(
    16,
    64,
    (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 64);
      grad.addColorStop(0, "rgba(255,240,205,0.9)");
      grad.addColorStop(0.7, "rgba(255,235,200,0.35)");
      grad.addColorStop(1, "rgba(255,230,190,0)");
      g.fillStyle = grad;
      g.fillRect(0, 0, 16, 64);
      const side = g.createLinearGradient(0, 0, 16, 0);
      side.addColorStop(0, "rgba(0,0,0,1)");
      side.addColorStop(0.3, "rgba(0,0,0,0)");
      side.addColorStop(0.7, "rgba(0,0,0,0)");
      side.addColorStop(1, "rgba(0,0,0,1)");
      g.globalCompositeOperation = "destination-out";
      g.fillStyle = side;
      g.fillRect(0, 0, 16, 64);
    },
    false,
  );
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  return new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
}

// ---------------------------------------------------------------- paint (textures made in code)

const tcache = new Map<string, THREE.CanvasTexture>();
function once(key: string, make: () => THREE.CanvasTexture): THREE.CanvasTexture {
  let t = tcache.get(key);
  if (!t) tcache.set(key, (t = make()));
  return t;
}

/** Dressed sandstone in courses, a little soot. */
export const ashlar = (seed = 1, base: [number, number, number] = [178, 164, 138]) =>
  once(`ashlar${seed}${base}`, () => {
    const r = rand(seed * 77);
    return canvasTex(64, 64, (g) => {
      g.fillStyle = `rgb(${base.join(",")})`;
      g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 16)
        for (let x = (y / 16) % 2 ? -16 : 0; x < 64; x += 32) {
          const v = (r() - 0.5) * 22;
          g.fillStyle = `rgb(${base[0] + v},${base[1] + v},${base[2] + v * 0.8})`;
          g.fillRect(x + 1, y + 1, 30, 14);
        }
      g.fillStyle = "rgba(60,50,40,0.5)";
      for (let y = 0; y < 64; y += 16) g.fillRect(0, y, 64, 1);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(40,32,24,${r() * 0.15})`;
        g.fillRect(r() * 64, r() * 64, 2 + r() * 6, 1 + r() * 3);
      }
    });
  });

/** Blue-grey floor slabs, worn, a grave slab now and then with a line of cut letters. */
export const slabs = (seed = 2) =>
  once(`slabs${seed}`, () => {
    const r = rand(seed * 31);
    return canvasTex(64, 64, (g) => {
      g.fillStyle = "#4a4a4c";
      g.fillRect(0, 0, 64, 64);
      for (let y = 0; y < 64; y += 32)
        for (let x = 0; x < 64; x += 32) {
          const grave = r() < 0.35;
          const v = 70 + r() * 30;
          g.fillStyle = grave ? `rgb(${v - 22},${v - 20},${v - 16})` : `rgb(${v},${v},${v + 4})`;
          g.fillRect(x + 1, y + 1, 30, 30);
          if (grave) {
            g.fillStyle = "rgba(20,20,22,0.55)";
            for (let l = 0; l < 4; l++) g.fillRect(x + 6, y + 7 + l * 5, 14 + r() * 6, 1);
            g.strokeStyle = "rgba(20,20,22,0.4)";
            g.strokeRect(x + 4, y + 4, 24, 24);
          }
        }
      for (let i = 0; i < 60; i++) {
        g.fillStyle = `rgba(255,255,255,${r() * 0.05})`;
        g.fillRect(r() * 64, r() * 64, 3, 2);
      }
    });
  });

/** Whitewash with a faint grey, for vaults and plastered walls. */
export const whitewash = (seed = 3, base: [number, number, number] = [206, 198, 180]) =>
  once(`wash${seed}${base}`, () => {
    const r = rand(seed * 13);
    return canvasTex(64, 64, (g) => {
      g.fillStyle = `rgb(${base.join(",")})`;
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 70; i++) {
        const v = (r() - 0.5) * 18;
        g.fillStyle = `rgba(${base[0] + v},${base[1] + v},${base[2] + v},0.4)`;
        g.fillRect(r() * 64, r() * 64, 4 + r() * 10, 3 + r() * 8);
      }
    });
  });

/** Veined marble, white or black. */
export const marble = (dark: boolean) =>
  once(`marble${dark}`, () => {
    const r = rand(dark ? 5 : 6);
    return canvasTex(32, 32, (g) => {
      g.fillStyle = dark ? "#1c1a1c" : "#d8d4cc";
      g.fillRect(0, 0, 32, 32);
      g.strokeStyle = dark ? "rgba(200,200,200,0.25)" : "rgba(90,86,90,0.35)";
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        let x = r() * 32;
        let y = 0;
        g.moveTo(x, y);
        while (y < 32) {
          x += (r() - 0.5) * 8;
          y += 3 + r() * 4;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    });
  });

/** A row of book spines on a shelf (ledgers, registers). */
export const spines = () =>
  once("spines", () => {
    const r = rand(44);
    return canvasTex(64, 32, (g) => {
      g.fillStyle = "#2a1c12";
      g.fillRect(0, 0, 64, 32);
      let x = 0;
      while (x < 64) {
        const w = 3 + Math.floor(r() * 3);
        const c = [[92, 40, 30], [60, 50, 34], [40, 52, 40], [110, 90, 60], [70, 30, 26]][Math.floor(r() * 5)];
        g.fillStyle = `rgb(${c.join(",")})`;
        g.fillRect(x, 3 + r() * 4, w - 1, 29);
        g.fillStyle = "rgba(200,170,90,0.6)";
        g.fillRect(x, 10, w - 1, 1);
        g.fillRect(x, 22, w - 1, 1);
        x += w;
      }
    }, true);
  });

/** Stained glass in a lancet: lead lines, coloured panes, a figure's glow in the middle; or clear grisaille. */
export const glass = (kind: "colour" | "grisaille" | "rose", seed = 9) =>
  once(`glass${kind}${seed}`, () => {
    const r = rand(seed);
    return canvasTex(32, 64, (g) => {
      g.fillStyle = "#101010";
      g.fillRect(0, 0, 32, 64);
      const cols = kind === "colour" ? ["#7a1c1c", "#1c3a7a", "#c8a030", "#2a6a3a", "#5a2a6a", "#1c3a7a", "#a8c0d0"] : ["#b8c0b8", "#a8b4ac", "#c8ccc0", "#98a8a0", "#d0cca8"];
      for (let y = 1; y < 63; y += 6)
        for (let x = 1; x < 31; x += 5) {
          g.fillStyle = cols[Math.floor(r() * cols.length)];
          g.fillRect(x, y, 4, 5);
        }
      if (kind === "colour") {
        // a saint in a niche, a pale face, a halo
        g.fillStyle = "#c8a030";
        g.beginPath();
        g.arc(16, 22, 5, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = "#d8c0a0";
        g.fillRect(14, 20, 4, 5);
        g.fillStyle = "#7a1c1c";
        g.fillRect(11, 26, 10, 22);
        g.fillStyle = "#1c3a7a";
        g.fillRect(12, 30, 8, 18);
      }
      // the lancet's point: dark outside the arch
      g.fillStyle = "#101010";
      for (let y = 0; y < 12; y++) {
        const w = 16 * (1 - Math.sqrt(1 - ((12 - y) / 12) ** 2));
        g.fillRect(0, y, w, 1);
        g.fillRect(32 - w, y, w, 1);
      }
    }, false);
  });

/**
 * An old painting, dark and soft, painted in code: no copy of any real picture, only its
 * shape in the gloom (a diagonal of pale bodies, a cross, a white shroud, a figure going up).
 */
export const painting = (kind: "elevation" | "descent" | "assumption" | "saint" | "history" | "portrait" | "landscape", seed = 1) =>
  once(`painting${kind}${seed}`, () => {
    const r = rand(seed * 101 + kind.length);
    const t = canvasTex(64, 96, (g) => {
      const bg = g.createLinearGradient(0, 0, 0, 96);
      bg.addColorStop(0, kind === "assumption" ? "#5a4a30" : kind === "landscape" ? "#5a6470" : "#241a12");
      bg.addColorStop(1, "#140e0a");
      g.fillStyle = bg;
      g.fillRect(0, 0, 64, 96);
      g.filter = "blur(2px)";
      const blob = (x: number, y: number, w: number, h: number, c: string) => {
        g.fillStyle = c;
        g.beginPath();
        g.ellipse(x, y, w, h, r() * 0.6, 0, Math.PI * 2);
        g.fill();
      };
      if (kind === "elevation") {
        // the cross raised on a diagonal, men straining at its foot
        g.strokeStyle = "#4a3420";
        g.lineWidth = 6;
        g.beginPath();
        g.moveTo(12, 88);
        g.lineTo(50, 14);
        g.stroke();
        blob(40, 30, 5, 14, "#c8a888");
        for (let i = 0; i < 6; i++) blob(10 + r() * 30, 60 + r() * 30, 6, 9, ["#7a2a1a", "#8a6a4a", "#3a4a5a", "#b09070"][i % 4]);
      } else if (kind === "descent") {
        // a pale body down a white sheet, figures round, a red cloak
        blob(34, 50, 7, 26, "#e0dcc8");
        blob(30, 40, 4, 16, "#c8b098");
        blob(18, 62, 6, 14, "#9a1c14");
        for (let i = 0; i < 5; i++) blob(10 + r() * 44, 20 + r() * 60, 5, 8, ["#3a4a3a", "#8a6a4a", "#2a2a3a"][i % 3]);
        g.strokeStyle = "#3a2a1a";
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(32, 4);
        g.lineTo(32, 40);
        g.moveTo(16, 12);
        g.lineTo(48, 12);
        g.stroke();
      } else if (kind === "assumption") {
        // a figure rising in a golden light, a ring of small ones, a crowd below
        const glow = g.createRadialGradient(32, 34, 2, 32, 34, 30);
        glow.addColorStop(0, "#e8d8a0");
        glow.addColorStop(1, "rgba(90,70,40,0)");
        g.fillStyle = glow;
        g.fillRect(0, 0, 64, 70);
        blob(32, 36, 7, 16, "#3a5a8a");
        blob(32, 22, 4, 4, "#d8c0a0");
        for (let i = 0; i < 8; i++) blob(10 + r() * 44, 76 + r() * 16, 5, 7, ["#7a2a1a", "#8a6a4a", "#3a3a4a"][i % 3]);
      } else if (kind === "history") {
        // a crowd scene in a hall, banners
        for (let i = 0; i < 10; i++) blob(4 + r() * 56, 50 + r() * 40, 4, 10, ["#5a2a1a", "#2a2a3a", "#8a7050", "#4a1a1a"][i % 4]);
        blob(20, 20, 8, 12, "#7a1a14");
        blob(46, 18, 7, 12, "#c8a030");
      } else if (kind === "portrait") {
        blob(32, 34, 10, 12, "#c0a080");
        blob(32, 70, 20, 26, "#1a1a1a");
        blob(32, 50, 6, 3, "#e0e0d8");
      } else if (kind === "landscape") {
        g.fillStyle = "#3a4a3a";
        g.fillRect(0, 60, 64, 36);
        blob(40, 50, 14, 10, "#4a5a3a");
        blob(12, 64, 8, 4, "#8a8a70");
      } else {
        blob(32, 40, 9, 24, ["#5a2a1a", "#2a3a5a", "#5a4a2a"][seed % 3]);
        blob(32, 16, 5, 5, "#c8a888");
      }
      g.filter = "none";
      // varnish gone brown, and cracks
      g.fillStyle = "rgba(60,40,10,0.35)";
      g.fillRect(0, 0, 64, 96);
      for (let i = 0; i < 30; i++) {
        g.fillStyle = "rgba(0,0,0,0.25)";
        g.fillRect(r() * 64, r() * 96, 1, 3 + r() * 5);
      }
    }, false);
    return t;
  });

/** Gilded leather hung on the walls of a grand room (the town hall): dark gold with a pattern. */
export const goldLeather = () =>
  once("goldleather", () =>
    canvasTex(32, 32, (g) => {
      g.fillStyle = "#4a3418";
      g.fillRect(0, 0, 32, 32);
      g.strokeStyle = "#a8843a";
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(16, 16, 9, 0, Math.PI * 2);
      g.moveTo(0, 0);
      g.lineTo(8, 8);
      g.moveTo(32, 0);
      g.lineTo(24, 8);
      g.moveTo(0, 32);
      g.lineTo(8, 24);
      g.moveTo(32, 32);
      g.lineTo(24, 24);
      g.stroke();
      g.fillStyle = "#6a1c14";
      g.fillRect(14, 14, 4, 4);
    }),
  );

/** A printed bill on the board: a heading line and grey lines of print (the real words show in the panel). */
export const billTex = (seed: number) =>
  once(`bill${seed}`, () => {
    const r = rand(seed * 7 + 3);
    return canvasTex(32, 48, (g) => {
      g.fillStyle = ["#d8d0b8", "#e0d8c0", "#c8c0a0", "#d8c8a8"][seed % 4];
      g.fillRect(0, 0, 32, 48);
      g.fillStyle = "#1a1a1a";
      g.fillRect(4, 4, 24, 5);
      for (let y = 13; y < 44; y += 3) g.fillRect(3 + r() * 2, y, 22 + r() * 5, 1);
    }, false);
  });

// ---------------------------------------------------------------- storeys and stairs

export interface Level {
  y: number;
  floors: Rect[];
  solids: Rect[];
}
export interface Stair {
  rect: Rect;
  along: "x" | "z";
  /** The along-coordinate of the foot (y0, on level `lo`) and of the head (y1, on level `hi`). */
  foot: number;
  head: number;
  lo: number;
  hi: number;
  y0: number;
  y1: number;
  /** Step height (the floor goes up in steps). */
  rise: number;
}

/**
 * Walking a hall of more than one storey (the town hall, the Vleeshuis, the Steen's cellar): Jef
 * is on a level or on a stair. A level is floors minus blocks; a stair is entered only at its
 * foot from its lower level or at its head from its upper one, and left the same way. The floor
 * height follows: the level's, or the stair's step by step. Two storeys may lie over each other.
 */
export class Levels {
  state: { level: number } | { stair: number } = { level: 0 };
  constructor(
    readonly levels: Level[],
    readonly stairs: Stair[],
  ) {}

  private onLevel(L: number, x: number, z: number, R = 0.3): boolean {
    const lv = this.levels[L];
    const inFloor = lv.floors.some((f) => x > f.minX + R && x < f.maxX - R && z > f.minZ + R && z < f.maxZ - R) || lv.floors.some((f) => x >= f.minX && x <= f.maxX && z >= f.minZ && z <= f.maxZ && lv.floors.some((g) => g !== f && x > g.minX - 0.01 && x < g.maxX + 0.01 && z > g.minZ - 0.01 && z < g.maxZ + 0.01));
    return inFloor && !lv.solids.some((b) => x > b.minX - R && x < b.maxX + R && z > b.minZ - R && z < b.maxZ + R);
  }

  private t(s: Stair, x: number, z: number): number {
    const a = s.along === "x" ? x : z;
    return (a - s.foot) / (s.head - s.foot);
  }

  /** Inside the flight (sideways within its walls; lengthways a little past each end, where you step on and off). */
  private inStair(s: Stair, x: number, z: number, R = 0.28, M = 0.45): boolean {
    const r = s.rect;
    return s.along === "x" ? x >= r.minX - M && x <= r.maxX + M && z > r.minZ + R && z < r.maxZ - R : z >= r.minZ - M && z <= r.maxZ + M && x > r.minX + R && x < r.maxX - R;
  }

  private tryMove(x: number, z: number): boolean {
    const st = this.state;
    if ("level" in st) {
      // onto a stair at its foot (from below) or its head (from above)
      for (let i = 0; i < this.stairs.length; i++) {
        const s = this.stairs[i];
        if (!this.inStair(s, x, z)) continue;
        const t = this.t(s, x, z);
        if ((s.lo === st.level && t < 0.12 && t > -0.5) || (s.hi === st.level && t > 0.88 && t < 1.5)) {
          this.state = { stair: i };
          return true;
        }
      }
      return this.onLevel(st.level, x, z);
    }
    const s = this.stairs[st.stair];
    const t = this.t(s, x, z);
    const len = Math.abs(s.head - s.foot);
    if (this.inStair(s, x, z) && t >= -0.4 / len && t <= 1 + 0.4 / len) return true;
    if (t < 0.1 && this.onLevel(s.lo, x, z)) {
      this.state = { level: s.lo };
      return true;
    }
    if (t > 0.9 && this.onLevel(s.hi, x, z)) {
      this.state = { level: s.hi };
      return true;
    }
    return false;
  }

  walk = (fx: number, fz: number, x: number, z: number): [number, number] => {
    if (this.tryMove(x, z)) return [x, z];
    if (this.tryMove(x, fz)) return [x, fz];
    if (this.tryMove(fx, z)) return [fx, z];
    return [fx, fz];
  };

  /** Jef's floor now (his level, or the step he stands on). */
  floor = (x: number, z: number): number => {
    const st = this.state;
    if ("level" in st) return this.levels[st.level].y;
    const s = this.stairs[st.stair];
    const t = Math.max(0, Math.min(1, this.t(s, x, z)));
    const y = s.y0 + (s.y1 - s.y0) * t;
    return Math.round((y - s.y0) / s.rise) * s.rise + s.y0;
  };

  /** Back to the ground (a new visit). */
  reset(level = 0): void {
    this.state = { level };
  }

  /** Which level (or a stair) Jef is on, for keys and people. */
  get level(): number {
    const st = this.state;
    return "level" in st ? st.level : -1;
  }
}

/** A flight of steps as boxes (for the eye), from the foot to the head along an axis. */
export function stairSteps(k: Kit, s: Stair, def: MatDef, side?: MatDef): void {
  const n = Math.max(1, Math.round((s.y1 - s.y0) / s.rise));
  const len = Math.abs(s.head - s.foot);
  const run = len / n;
  const dir = Math.sign(s.head - s.foot);
  const r = s.rect;
  for (let i = 0; i < n; i++) {
    const a = s.foot + dir * (i + 0.5) * run;
    const top = s.y0 + (i + 1) * s.rise;
    if (s.along === "x") k.box(run, top - s.y0 + 0.05, r.maxZ - r.minZ, a, s.y0 + (top - s.y0) / 2 - 0.025, (r.minZ + r.maxZ) / 2, def, { tile: 0.8 });
    else k.box(r.maxX - r.minX, top - s.y0 + 0.05, run, (r.minX + r.maxX) / 2, s.y0 + (top - s.y0) / 2 - 0.025, a, def, { tile: 0.8 });
  }
  if (side) {
    // a balustrade either side, sloping with the flight
    const L = Math.hypot(len, s.y1 - s.y0);
    const ang = Math.atan2(s.y1 - s.y0, len);
    const mid = (s.foot + s.head) / 2;
    const ym = (s.y0 + s.y1) / 2 + 0.95;
    if (s.along === "x") {
      for (const zz of [r.minZ, r.maxZ]) k.box(L, 0.12, 0.14, mid, ym, zz, side, { rz: dir * ang });
    } else {
      for (const xx of [r.minX, r.maxX]) k.box(0.14, 0.12, L, xx, ym, mid, side, { rx: -dir * ang });
    }
  }
}
