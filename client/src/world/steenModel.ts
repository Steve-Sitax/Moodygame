import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx, bumpFromMap, footDirt } from "../retro/psx";
import { shellMarkers } from "./realOpenings";

// Het Steen in detail (Steve, 2026-09-26: "do the steen again in higher quality", "do not forget bump mapping"):
// tools/blender/build_steen.py -> /models/steen.glb. It replaces the Steen of landmarks.glb (build_landmarks.py
// steen5, the object landmark_steen), which is hidden here once both have loaded. Same footprint, gate, doors,
// courtyard and ramp, so the hall (landmarkHalls.ts buildSteen), the walk map and steenramp.ts fit as before.
//
// The stone, the slate and the brick are pictures (Codex, assets/ATTRIBUTION.md) laid in world
// metres by the model's uv. Each has a height map made from that same picture (tools/textures/steen_maps.py) that
// bumps the light; steen_maps.json names each with the SHA-256 of the picture it was made from, and a height map
// whose picture has changed since is not used (the wall stays flat rather than showing another picture's bumps).
// The glass and the painted atlas (doors, the dark of the slits, the museum's name and board) are packed in the
// glb; their bump comes from their own colour (retro/psx.ts bumpFromMap).

const PICTURES = ["tournai", "sand", "blue", "slate", "brick", "carve"] as const;
type Pic = (typeof PICTURES)[number];
/** How the pictures sit in the game's grey light: a lift over 1 for the pale stone (the churches do the same). */
const TINT: Record<Pic, THREE.Color> = {
  tournai: new THREE.Color(1.12, 1.12, 1.12),
  sand: new THREE.Color(1.2, 1.17, 1.12),
  blue: new THREE.Color(1.1, 1.1, 1.1),
  slate: new THREE.Color(1.0, 1.0, 1.0),
  brick: new THREE.Color(1.0, 1.0, 1.0),
  carve: new THREE.Color(1.15, 1.12, 1.08),
};

async function sha256(url: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const buf = await (await fetch(url)).arrayBuffer();
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
}

function picture(url: string, carve: boolean, colour: boolean): THREE.Texture {
  const t = new THREE.TextureLoader().load(url);
  if (colour) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = colour ? THREE.NearestFilter : THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.anisotropy = 4;
  // (the carvings sheet is laid by cell, top left first, as the glb's own textures are)
  if (carve) t.flipY = false;
  return t;
}

export interface SteenModel {
  group: THREE.Group;
  /** Keep the old Steen of landmarks.glb hidden (it may load after this). */
  update(): void;
  info(): { loaded: boolean; oldHidden: number; bumps: Record<string, number> };
  /** Dev: show the old Steen instead of this one (before and after pictures, perf), or back. */
  showOld(on: boolean): void;
  /**
   * Dev (Steve, 2026-09-26: a door built half into another building): is every door, gate, window, stair and roof
   * part of the Steen clear of everything else in the world (other buildings, quay walls, the ground, street
   * things), and has every door and gate free ground to stand on before it? Lists what is not; it must list nothing.
   */
  check(world: CheckWorld): Promise<{ features: Record<string, number>; triangles: number; problems: string[] }>;
}

/** What check() asks of the world (world/rijnkaai.ts). */
export interface CheckWorld {
  scene: THREE.Scene;
  groundAt(x: number, z: number, radius: number, feet: number): number;
  standFree(x: number, z: number, radius: number, feet: number): boolean;
}

interface Feature {
  k: "door" | "gate" | "window" | "stair" | "roof";
  n: string;
  box: number[];
  tris?: number[];
  out?: number[];
  sill?: number;
  front?: number[];
  base?: number;
}

// things that move or are no building (people, boats, carts, the water, the sky): left out of check()
const MOVING = /^(crowd|boats?|ships?|traffic|handcarts?|carts?|omnibuses|hearses?|ferry|animals|horses|birds?|alive_|sky|river|water|rain|smoke|tide_mud|people|townLife|lively)/i;

/** Does segment p-q cross triangle abc? (Moller-Trumbore, the segment's ends left out.) */
function segTri(p: THREE.Vector3, q: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): boolean {
  const e1 = b.clone().sub(a);
  const e2 = c.clone().sub(a);
  const d = q.clone().sub(p);
  const h = d.clone().cross(e2);
  const det = e1.dot(h);
  if (Math.abs(det) < 1e-9) return false;
  const f = 1 / det;
  const sv = p.clone().sub(a);
  const u = f * sv.dot(h);
  if (u < 0 || u > 1) return false;
  const qv = sv.cross(e1);
  const v = f * d.dot(qv);
  if (v < 0 || u + v > 1) return false;
  const t = f * e2.dot(qv);
  return t > 1e-4 && t < 1 - 1e-4;
}

function triTri(A: THREE.Triangle, B: THREE.Triangle): boolean {
  const ea: Array<[THREE.Vector3, THREE.Vector3]> = [[A.a, A.b], [A.b, A.c], [A.c, A.a]];
  const eb: Array<[THREE.Vector3, THREE.Vector3]> = [[B.a, B.b], [B.b, B.c], [B.c, B.a]];
  return ea.some(([p, q]) => segTri(p, q, B.a, B.b, B.c)) || eb.some(([p, q]) => segTri(p, q, A.a, A.b, A.c));
}

export function loadSteenModel(scene: THREE.Scene): SteenModel {
  const group = new THREE.Group();
  group.name = "steen";
  scene.add(group);
  const mats = new Map<string, THREE.MeshLambertMaterial>();
  const bumps: Record<string, number> = {};
  let loaded = false;
  const pic = (name: Pic): THREE.MeshLambertMaterial => {
    const m = psx(
      new THREE.MeshLambertMaterial({ map: picture(`/textures/steen_${name}.jpg`, name === "carve", true), color: TINT[name], vertexColors: true, side: THREE.DoubleSide }),
      { fogReach: 2.2, affine: 0 },
    );
    m.name = `steen_${name}`;
    // the dirt band at the foot of the walls (retro/psx.ts footDirt): the stone and brick, not the slate or carvings
    if (name !== "slate" && name !== "carve") footDirt(m, 0.6);
    return m;
  };
  for (const p of PICTURES) mats.set(`steen_${p}`, pic(p));
  const metal = psx(new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 });
  metal.name = "steen_metal";
  mats.set("steen_metal", metal);
  // the height maps, each only with the picture it was made from
  fetch("/textures/steen_maps.json")
    .then((r) => r.json() as Promise<Record<string, { sha256: string; bump: number }>>)
    .then(async (made) => {
      await Promise.all(
        PICTURES.map(async (p) => {
          const rec = made[p];
          const m = mats.get(`steen_${p}`);
          if (!rec || !m) return;
          const sha = await sha256(`/textures/steen_${p}.jpg`).catch(() => null);
          if (sha && sha !== rec.sha256) {
            console.warn(`steen_${p}_h.png was made from another picture: it stays flat (run tools/textures/steen_maps.py)`);
            return;
          }
          m.bumpMap = picture(`/textures/steen_${p}_h.png`, p === "carve", false);
          m.bumpScale = rec.bump;
          m.needsUpdate = true;
          bumps[p] = rec.bump;
        }),
      );
    })
    .catch((e) => console.warn("steen height maps did not load: the Steen stays flat", e));

  const matFor = (src: THREE.MeshStandardMaterial): THREE.Material => {
    const have = mats.get(src.name);
    if (have) return have;
    // steen_glass, steen_atlas: painted in the script and packed in the glb, pixel sharp
    const map = src.map;
    if (map) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapLinearFilter;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    // steen_glass_lit, the old panes of the five courtyard windows by the museum door (issue #10 left them undrawn: their
    // glass was to be the room's): no room stands behind them, only the hall's faint beams of light, and the fog showed
    // through (issue #56, Steve 2026-10-04: dark leaded glass, the cheap outside fix). Drawn as the Steen's own glass;
    // world/landmarkWindows.ts still lights a copy of them at night, 3 cm in front.
    const m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0 });
    if (map) bumpFromMap(m, src.name === "steen_glass" ? 0.4 : 0.5);
    m.name = src.name;
    mats.set(src.name, m);
    return m;
  };
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/steen.glb")
    .then((gltf) => {
      const meshes: THREE.Mesh[] = [];
      // issue #10: the real openings' markers, for the interior check (dev/interiorcheck.ts)
      for (const e of shellMarkers(gltf.scene)) group.add(e);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = matFor(m.material as THREE.MeshStandardMaterial);
        meshes.push(m);
      });
      for (const m of meshes) {
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        m.geometry.computeBoundingSphere();
        m.name = `steen_${(m.material as THREE.Material).name.replace(/^steen_/, "")}`;
        group.add(m);
      }
      loaded = true;
      hideOld(0);
      draco.dispose();
    })
    .catch((e) => console.warn("steen.glb did not load: the old Steen stays", e));

  // the old Steen (landmarks.glb, city.ts puts its meshes straight in the "city" group): hidden once ours is in,
  // whichever of the two loads first (looked for every half second for a minute, and kept hidden in update())
  let old: THREE.Object3D[] = [];
  let look = 0;
  let devOld = false;
  const findOld = () => {
    const found: THREE.Object3D[] = [];
    for (const o of scene.children) if (o.name === "city") for (const c of o.children) if (/^landmark_steen(_\d+)?$/.test(c.name)) found.push(c);
    return found;
  };
  function hideOld(tries: number): void {
    if (old.length === 0) old = findOld();
    if (old.length === 0) {
      if (tries < 120) setTimeout(() => hideOld(tries + 1), 500);
      return;
    }
    for (const o of old) o.visible = devOld;
  }
  return {
    group,
    update() {
      if (!loaded) return;
      if (old.length === 0 && look-- <= 0) {
        old = findOld();
        look = 60;
      }
      for (const o of old) o.visible = devOld;
      group.visible = !devOld;
    },
    info: () => ({ loaded, oldHidden: old.filter((o) => !o.visible).length, bumps: { ...bumps } }),
    showOld(on: boolean) {
      devOld = on;
      old = findOld();
      for (const o of old) o.visible = on;
      group.visible = !on;
    },
    async check(world: CheckWorld) {
      const F = (await (await fetch("/models/steen_features.json")).json()) as Feature[];
      const problems: string[] = [];
      const count: Record<string, number> = {};
      for (const f of F) count[f.k] = (count[f.k] ?? 0) + 1;
      const boxOf = (f: Feature, pad: number) =>
        new THREE.Box3(new THREE.Vector3(f.box[0] + pad, f.box[1] + pad, f.box[2] + pad), new THREE.Vector3(f.box[3] - pad, f.box[4] - pad, f.box[5] - pad));
      const all = new THREE.Box3();
      for (const f of F) all.union(boxOf(f, -0.5));
      // every other static thing drawn near the Steen, its triangles in world metres
      const tris: Array<{ t: THREE.Triangle; box: THREE.Box3; what: string }> = [];
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      const c = new THREE.Vector3();
      const mw = new THREE.Matrix4();
      const im = new THREE.Matrix4();
      world.scene.updateMatrixWorld(true);
      for (const root of world.scene.children) {
        if (root === group || MOVING.test(root.name) || (root as THREE.Camera).isCamera) continue;
        // people (a skinned body and what they hold) move: their groups are left out, the rest of the root stays
        const people = new Set<THREE.Object3D>();
        root.traverse((o) => {
          if ((o as THREE.SkinnedMesh).isSkinnedMesh) for (let p = o.parent; p && p !== root; p = p.parent) people.add(p);
        });
        root.traverse((o) => {
          const m = o as THREE.Mesh;
          if (!m.isMesh || MOVING.test(m.name) || (m as unknown as THREE.SkinnedMesh).isSkinnedMesh) return;
          for (let p: THREE.Object3D | null = m; p; p = p.parent) if (!p.visible || people.has(p)) return;
          const g = m.geometry as THREE.BufferGeometry;
          const P = g.getAttribute("position") as THREE.BufferAttribute | undefined;
          if (!P) return;
          const inst = (m as THREE.InstancedMesh).isInstancedMesh ? (m as THREE.InstancedMesh) : null;
          if (!g.boundingBox) g.computeBoundingBox();
          const idx = g.index;
          const n = idx ? idx.count : P.count;
          const what = [root.name, m.name].filter(Boolean).join("/") || m.type;
          for (let k = 0; k < (inst ? inst.count : 1); k++) {
            mw.copy(m.matrixWorld);
            if (inst) {
              inst.getMatrixAt(k, im);
              mw.multiply(im);
            }
            if (!g.boundingBox!.clone().applyMatrix4(mw).intersectsBox(all)) continue;
            for (let i = 0; i + 2 < n; i += 3) {
              a.fromBufferAttribute(P, idx ? idx.getX(i) : i).applyMatrix4(mw);
              b.fromBufferAttribute(P, idx ? idx.getX(i + 1) : i + 1).applyMatrix4(mw);
              c.fromBufferAttribute(P, idx ? idx.getX(i + 2) : i + 2).applyMatrix4(mw);
              const tb = new THREE.Box3().setFromPoints([a, b, c]);
              if (!tb.intersectsBox(all)) continue;
              tris.push({ t: new THREE.Triangle(a.clone(), b.clone(), c.clone()), box: tb, what });
            }
          }
        });
      }
      const hits = (box: THREE.Box3, own?: THREE.Triangle[]) => {
        const seen = new Set<string>();
        for (const o of tris) {
          if (!o.box.intersectsBox(box)) continue;
          if (own ? own.some((t) => triTri(t, o.t)) : box.intersectsTriangle(o.t)) seen.add(o.what);
        }
        return [...seen];
      };
      const ground = (x: number, z: number, y: number) => world.groundAt(x, z, 0, y + 0.3);
      for (const f of F) {
        const box = boxOf(f, 0.02);
        let own: THREE.Triangle[] | undefined;
        if (f.k === "roof" && f.tris) {
          own = [];
          const T = f.tris;
          for (let i = 0; i + 8 < T.length; i += 9)
            own.push(new THREE.Triangle(new THREE.Vector3(T[i], T[i + 1], T[i + 2]), new THREE.Vector3(T[i + 3], T[i + 4], T[i + 5]), new THREE.Vector3(T[i + 6], T[i + 7], T[i + 8])));
        }
        const other = hits(box, own);
        if (other.length) problems.push(`${f.k} "${f.n}" runs into ${other.join(", ")}`);
        // the ground: windows and roofs stand over it; stairs stand on it
        const cx = (f.box[0] + f.box[3]) / 2;
        const cz = (f.box[2] + f.box[5]) / 2;
        const gy = ground(cx, cz, f.box[1]);
        if ((f.k === "window" || f.k === "roof") && f.box[1] < gy + 0.1) problems.push(`${f.k} "${f.n}" is in the ground (its foot ${f.box[1].toFixed(2)}, the ground ${gy.toFixed(2)})`);
        if (f.k === "stair" && Math.abs(gy - (f.base ?? 0)) > 0.2) problems.push(`stair "${f.n}" does not stand on the ground (its foot ${(f.base ?? 0).toFixed(2)}, the ground ${gy.toFixed(2)})`);
        // doors and gates: free ground to stand on before them, at the height of their sill (or of their steps' foot)
        if ((f.k === "door" || f.k === "gate") && f.front) {
          const [fx, , fz] = f.front;
          const at = f.base ?? f.sill ?? 0;
          const gy2 = ground(fx, fz, at);
          if (Math.abs(gy2 - at) > 0.3) problems.push(`${f.k} "${f.n}": the ground before it is at ${gy2.toFixed(2)}, its ${f.base !== f.sill ? "steps' foot" : "sill"} at ${at.toFixed(2)}`);
          else if (!world.standFree(fx, fz, 0.3, gy2)) problems.push(`${f.k} "${f.n}": nowhere to stand before it (${fx.toFixed(1)}, ${fz.toFixed(1)})`);
        }
      }
      return { features: count, triangles: tris.length, problems };
    },
  };
}
