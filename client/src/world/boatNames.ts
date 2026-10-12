import * as THREE from "three";
import type ATLAS_TYPE from "../../public/models/boat_names.json";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import FLEET from "../../../shared/fleet.json" with { type: "json" };
import { FleetNames, vessel, type Vessel } from "../../../shared/fleet";
import { psx, setNameCell } from "../retro/psx";
import { MOORINGS, isSmallKind } from "../../../shared/smallBoats";
import type { Boats } from "./boats";

type Zone = { zone: string; geometry: THREE.BufferGeometry };
type Cells = Record<string, number>;
const zones = new Map<string, Zone[]>();
const materials = new Map<string, THREE.Material>();
const allocator = new FleetNames();
const registered = new WeakMap<THREE.Object3D, { id: string; version: number }>();
let nameVersion = 0;
const rows: Array<{ mesh: THREE.InstancedMesh; frames: Array<() => THREE.Matrix4> }> = [];
const entries: Array<{ vessel: Vessel; cells: Cells; position: () => THREE.Vector3; shown: () => boolean }> = [];
type Atlas = typeof ATLAS_TYPE;
let ATLAS: Atlas;
const cellIndex = new Map<number, Atlas["cells"][number]>();
let loading: Promise<void> | undefined;
const zoneOf = (name: string) => /_name_(bow_[ps]|stern|box_[ps])$/.exec(name)?.[1];
const role = (zone: string) => zone.startsWith("bow") ? "bow" : zone.startsWith("box") ? "box" : "stern";

async function loadAtlas(): Promise<void> {
  const response = await fetch("/models/boat_names.json");
  if (!response.ok) throw new Error("boat names atlas index missing");
  ATLAS = await response.json() as Atlas;
  for (const cell of ATLAS.cells) cellIndex.set(cell.id, cell);
  await Promise.all(ATLAS.pages.map(async (page, p) => {
    const image = await new THREE.ImageLoader().loadAsync(`/models/${page.file}`);
    for (let band = 0; band < 4; band++) {
      // D3's square cell switch: four 4x4 sections of the original 4x16 page, without resampling.
      const canvas = document.createElement("canvas");
      canvas.width = page.size[0]; canvas.height = page.size[1] / 4;
      canvas.getContext("2d")!.drawImage(image, 0, band * canvas.height, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
      const map = new THREE.CanvasTexture(canvas);
      map.colorSpace = THREE.SRGBColorSpace;
      map.minFilter = THREE.LinearMipmapLinearFilter; map.magFilter = THREE.LinearFilter;
      const mat = psx(new THREE.MeshLambertMaterial({ map }), { nameCell: 4, noSnap: true, affine: 0 });
      mat.name = `boat_names_${p}_${band}`;
      mat.userData.flatLettering = true;
      materials.set(`${p}:${band}`, mat);
    }
  }));
}

/** Keep zones out of the hull's material merge, including the sack-free copies. */
export async function prepareBoatNames(scene: THREE.Object3D): Promise<(protos: Map<string, THREE.Object3D>) => void> {
  await (loading ??= loadAtlas());
  for (const root of scene.children) {
    root.updateMatrixWorld(true);
    const inv = root.matrixWorld.clone().invert();
    const own: Zone[] = [];
    const remove: THREE.Object3D[] = [];
    root.traverse((node) => {
      const zone = zoneOf(node.name);
      if (!zone || !(node instanceof THREE.Mesh)) return;
      const geometry = node.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, node.matrixWorld));
      // glTF stores v downward. The shared browser switch reads v upward, like an ordinary three.js map.
      const uv = geometry.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
      // Only the outward winding draws; no back face can show mirrored lettering.
      geometry.deleteAttribute("color");
      own.push({ zone, geometry }); remove.push(node);
    });
    for (const node of remove) node.removeFromParent();
    if (own.length) zones.set(root.name.replace(/_bare$/, ""), own);
  }
  return (protos) => {
    // The opening ferry is outside Boats.place; its one identity lives on its prototype.
    const ferry = protos.get("ferry");
    if (ferry) attach(ferry, "ferry", allocator.take("ferry", "ferry"));
  };
}

function cellsFor(v: Vessel): Cells {
  if (v.id.startsWith("spare:")) {
    const family = (FLEET.family as Record<string, string>)[v.kind] ?? v.kind;
    const spare = ((ATLAS.spare as unknown as Record<string, Array<{ name: string; bow: number; stern: number; box?: number }>>)[family] ?? ATLAS.spare.small).find((c) => c.name === v.name);
    const c = spare ? { bow: spare.bow, stern: spare.stern, ...(spare.box === undefined ? {} : { box: spare.box }) } : undefined;
    if (!c) throw new Error(`no atlas cells for ${v.name}`);
    return c;
  }
  return (ATLAS.vessels as Record<string, Cells>)[v.id] ?? {};
}

function plates(parent: THREE.Object3D, kind: string, vessels: Vessel[], frames: Array<() => THREE.Matrix4>): void {
  const byRole = new Map<string, THREE.BufferGeometry[]>();
  const ownZones = zones.get(kind) ?? [];
  // Paddle craft carry the side name on the box, so the bow board does not repeat it in the same view.
  const paddle = ownZones.some((z) => role(z.zone) === "box");
  for (const z of ownZones) {
    const k = role(z.zone);
    if (k === "bow" && paddle) continue;
    const list = byRole.get(k) ?? [];
    list.push(z.geometry);
    byRole.set(k, list);
  }
  for (const [zone, geos] of byRole) {
    const geometry = geos.length > 1 ? mergeGeometries(geos) ?? geos[0] : geos[0];
    const byBand = new Map<string, number[]>();
    vessels.forEach((v, i) => {
      const c = cellIndex.get(cellsFor(v)[zone]); if (!c) return;
      const key = `${c.page}:${Math.floor(c.cell / 16)}`, list = byBand.get(key) ?? [];
      list.push(i); byBand.set(key, list);
    });
    for (const [key, idx] of byBand) {
      const im = new THREE.InstancedMesh(geometry, materials.get(key)!, idx.length);
      im.name = `hull_names_${kind}_${zone}`;
      im.frustumCulled = false;
      const active = idx.map((i) => frames[i]);
      idx.forEach((i, j) => { setNameCell(im, j, cellIndex.get(cellsFor(vessels[i])[zone])!.cell % 16, 4); im.setMatrixAt(j, active[j]()); });
      parent.add(im); rows.push({ mesh: im, frames: active });
    }
  }
}
const identity = new THREE.Matrix4();

function attach(obj: THREE.Object3D, kind: string, v: Vessel): void {
  if (registered.get(obj)?.id === v.id) return;
  const old = obj.getObjectByName("vessel_lettering");
  if (old) {
    const meshes = new Set<THREE.Object3D>(); old.traverse((n) => meshes.add(n));
    for (let i = rows.length - 1; i >= 0; i--) if (meshes.has(rows[i].mesh)) rows.splice(i, 1);
    old.removeFromParent();
  }
  const holder = new THREE.Group(); holder.name = "vessel_lettering";
  obj.add(holder);
  plates(holder, kind, [v], [() => identity]);
  obj.userData.vesselId = v.id; obj.userData.vesselName = v.name; obj.userData.nameCells = cellsFor(v);
  const version = ++nameVersion; registered.set(obj, { id: v.id, version });
  entries.push({ vessel: v, cells: cellsFor(v), position: () => obj.getWorldPosition(new THREE.Vector3()), shown: () => registered.get(obj)?.version === version && shown(obj) });
}

/** Rowing swaps a moored instance for a pooled model. The vessel's identity follows that swap. */
export function bindBoatName(obj: THREE.Object3D, kind: string, id: string): void {
  if (!FLEET.vessels.some((v) => v.id === id)) return;
  const root = obj.children[0]?.name === kind ? obj.children[0] : obj;
  attach(root, kind, vessel(id)); obj.userData.vesselId = id;
}
function shown(obj: THREE.Object3D): boolean {
  for (let n: THREE.Object3D | null = obj; n; n = n.parent) if (!n.visible) return false;
  return !!obj.parent;
}

/** Wrap only public placement calls. W4 retains all floating and grounding code. */
export function namedBoats(boats: Boats): Boats {
  const place = boats.place, moor = boats.mooreAlong, fleet = boats.fleetOf, update = boats.update;
  boats.place = (kind, x, z, yaw, parent) => {
    const obj = place(kind, x, z, yaw, parent);
    if (!zones.has(kind)) return obj;
    if (x === 0 && z === 0 && isSmallKind(kind)) return obj; // rowing binds the boat's persistent id at once
    const how = parent?.name === "river_traffic" ? (x === 600 ? "river" : kind === "liner" ? "anchorage" : "anchorage_tow") : parent?.name.includes("lock") ? "lock" : parent?.name === "opening_bridges" ? "passage" : "place";
    const v = allocator.take(kind, how, x, z);
    attach(obj.children[0] ?? obj, kind, v);
    obj.userData.vesselId = v.id;
    return obj;
  };
  boats.mooreAlong = (...args) => {
    const result = moor(...args);
    const list = result.placed.map((b, slot) => ({ b, v: allocator.take(b.name, "row", b.x, b.z, args[7]?.seed ?? 1873, slot) }));
    result.group.userData.nameVessels = list.map(({ b, v }) => ({ id: v.id, kind: b.name, x: b.x, z: b.z }));
    for (const kind of new Set(list.map(({ b }) => b.name))) {
      const own = list.filter(({ b }) => b.name === kind);
      plates(result.group, kind, own.map(({ v }) => v), own.map(({ b }) => () => b.world!));
      for (const { b, v } of own) entries.push({ vessel: v, cells: cellsFor(v), position: () => new THREE.Vector3().setFromMatrixPosition(b.world!), shown: () => shown(result.group) });
    }
    return result;
  };
  boats.fleetOf = (scene, list) => {
    const result = fleet(scene, list);
    const own = list.map((b) => {
      const home = MOORINGS.find((m) => m.kind === b.name && Math.hypot(m.x - b.x, m.z - b.z) < 0.2);
      const loose = FLEET.vessels.find((v) => v.kind === b.name && v.where.how === "loose" && "at" in v.where && Math.hypot(v.where.at![0] - b.x, v.where.at![1] - b.z) < 0.2);
      return home ? allocator.byId(home.id) : loose ? allocator.byId(loose.id) : allocator.take(b.name, "mooring", b.x, b.z);
    });
    const body = [...scene.children].reverse().find((g) => g.name === "small_boats");
    if (body) body.userData.nameVessels = list.map((b, i) => ({ id: own[i].id, kind: b.name, x: b.x, z: b.z }));
    const holder = new THREE.Group(); holder.name = "small_boat_lettering"; scene.add(holder);
    for (const kind of new Set(list.map((b) => b.name))) {
      const idx = list.flatMap((b, i) => b.name === kind ? [i] : []);
      plates(holder, kind, idx.map((i) => own[i]), idx.map((i) => () => result.world(i)));
    }
    own.forEach((v, i) => entries.push({ vessel: v, cells: cellsFor(v), position: () => new THREE.Vector3().setFromMatrixPosition(result.world(i)), shown: () => !result.hidden(i) }));
    return result;
  };
  boats.update = (...args) => {
    update(...args);
    for (const row of rows) { row.frames.forEach((frame, i) => row.mesh.setMatrixAt(i, frame())); row.mesh.instanceMatrix.needsUpdate = true; }
  };
  (boats as Boats & { nameCheck(): unknown }).nameCheck = boatNameCheck;
  return boats;
}

/** The live audit includes only drawn copies; hidden pool entries cannot double a name. */
export function boatNameCheck(): unknown {
  const placed = entries.filter((e) => e.shown()).map((e) => ({ id: e.vessel.id, kind: e.vessel.kind, name: e.vessel.name, port: e.vessel.port, of: e.vessel.of, cells: e.cells, at: e.position().toArray() }));
  const problems: string[] = [];
  for (let i = 0; i < placed.length; i++) for (let j = i + 1; j < placed.length; j++) {
    const a = placed[i], b = placed[j];
    if (a.name && a.name === b.name && Math.hypot(a.at[0] - b.at[0], a.at[2] - b.at[2]) < 200) problems.push(`${a.id} and ${b.id}: ${a.name}`);
  }
  return { placed, problems };
}

/** Camera positions measured from the outward faces of the actual name zones. */
export function boatNameViews(boats: Boats): Array<{ name: string; x: number; y: number; z: number; yaw: number; pitch: number; hour: number; weather: string; storm: null }> {
  const views = [];
  for (const [id, zone] of [["anna_maria", "bow_p"], ["anna_maria", "stern"], ["schelde", "box_p"]]) {
    const p = boats.placements().find((p) => p.obj?.userData.vesselId === id)!;
    const inner = p.obj!.children[0]; inner.updateWorldMatrix(true, true);
    const board = zones.get(p.name)!.find((z) => z.zone === zone)!;
    board.geometry.computeBoundingBox();
    const at = board.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(inner.matrixWorld);
    const normal = new THREE.Vector3().fromBufferAttribute(board.geometry.getAttribute("normal"), 0).transformDirection(inner.matrixWorld);
    for (const distance of [10, 40]) {
      const from = at.clone().addScaledVector(normal, distance);
      views.push({ name: `${zone}${distance}`, x: from.x, y: from.y, z: from.z, yaw: Math.atan2(normal.x, normal.z) * 180 / Math.PI, pitch: -Math.asin(normal.y) * 180 / Math.PI, hour: 13, weather: "clear", storm: null });
    }
  }
  return views;
}
