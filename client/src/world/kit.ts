import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { worldUV } from "./geom";

// A small builder for code-made models (M3g: goods wagons, loads, the omnibus): boxes,
// cylinders and lathes with a colour per part, merged into one geometry with position,
// normal, uv (per metre) and color, for one textured, vertex-coloured material.

export type RGB = [number, number, number];

export class Kit {
  private geos: THREE.BufferGeometry[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();

  private add(g: THREE.BufferGeometry, x: number, y: number, z: number, col: RGB, rx: number, ry: number, rz: number, tile: number, uv: boolean): void {
    this.e.set(rx, ry, rz, "YXZ");
    this.q.setFromEuler(this.e);
    this.m.compose(new THREE.Vector3(x, y, z), this.q, new THREE.Vector3(1, 1, 1));
    let geo = g.index ? g.toNonIndexed() : g;
    geo.applyMatrix4(this.m);
    if (uv) worldUV(geo, tile);
    for (const a of Object.keys(geo.attributes)) if (!["position", "normal", "uv"].includes(a)) geo.deleteAttribute(a);
    if (!geo.getAttribute("uv")) geo.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(geo.getAttribute("position").count * 2), 2));
    const n = geo.getAttribute("position").count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set(col, i * 3);
    geo.setAttribute("color", new THREE.Float32BufferAttribute(c, 3));
    geo = geo.index ? geo.toNonIndexed() : geo;
    this.geos.push(geo);
  }

  /** A box w (x) by h (y) by d (z), centred at (x, y, z), turned by ry about y (then rx, rz). */
  box(w: number, h: number, d: number, x: number, y: number, z: number, col: RGB, ry = 0, rx = 0, rz = 0, tile = 1): this {
    this.add(new THREE.BoxGeometry(w, h, d), x, y, z, col, rx, ry, rz, tile, true);
    return this;
  }

  /** A cylinder along y (turn it with rx / rz), centred at (x, y, z). */
  cyl(rTop: number, rBot: number, h: number, sides: number, x: number, y: number, z: number, col: RGB, rx = 0, ry = 0, rz = 0): this {
    this.add(new THREE.CylinderGeometry(rTop, rBot, h, sides, 1), x, y, z, col, rx, ry, rz, 1, false);
    return this;
  }

  /** A lathe about y from (radius, height) points, centred at (x, y, z). */
  lathe(pts: Array<[number, number]>, sides: number, x: number, y: number, z: number, col: RGB, rx = 0, ry = 0, rz = 0): this {
    this.add(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), sides), x, y, z, col, rx, ry, rz, 1, false);
    return this;
  }

  /** A thin bar between two points (square section s). */
  bar(a: THREE.Vector3, b: THREE.Vector3, s: number, col: RGB): this {
    const d = b.clone().sub(a);
    const len = d.length();
    const g = new THREE.BoxGeometry(s, len, s).toNonIndexed();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()));
    const mid = a.clone().add(b).multiplyScalar(0.5);
    this.add(g, mid.x, mid.y, mid.z, col, 0, 0, 0, 1, false);
    return this;
  }

  build(): THREE.BufferGeometry {
    const g = mergeGeometries(this.geos, false) ?? new THREE.BufferGeometry();
    for (const x of this.geos) x.dispose();
    this.geos = [];
    g.computeBoundingSphere();
    return g;
  }
}
