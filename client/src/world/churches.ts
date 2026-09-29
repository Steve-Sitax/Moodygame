import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import CITY from "../../../shared/city.json";
import { bumpFromMap, psx } from "../retro/psx";
import type { Rect } from "./geom";
import { withPicture } from "./quayStone";
import { shellMarkers } from "./realOpenings";
import { publishShellGlass, roomGlassFrom, whenShellGlass } from "./shellGlass";
import type { SunWindow } from "./hallSun";
import type { ChurchOpening } from "../../../shared/churchesShell";

const CAROLUS_PICTURES: Record<string, string> = {
  carolus_sand: "/textures/carolus_sandstone.jpg",
  carolus_blue: "/textures/carolus_bluestone.jpg",
  // St Paul's brick and white stone, St James's Lede sandstone (M7 Paul and James)
  pj_brick: "/textures/pj_brick.jpg",
  pj_white: "/textures/pj_white.jpg",
  pj_brabant: "/textures/pj_brabant.jpg",
};
// --- the churches' walls (Steve, 2026-09-26: "churches do not forget bump mapping"; the foot of the walls): the stone
// and brick of the three churches get a height map from their own picture (retro/psx.ts bumpFromMap, made again when
// the Codex picture comes in), big soft patches so a repeated picture does not show its grid (psx mottle), and the
// mud and damp at the foot (psx foot). Not the park's things, the gilding, the roofs or the glass ---
const CHURCH_WALLS = /^(church_(stone|greystone|brick|atlas)|carolus_(sand|blue|pale|art)|pj_(brick|white|brabant))$/;
const wallLook = (name: string) => (CHURCH_WALLS.test(name) ? { foot: { amount: 0.5 }, mottle: name === "church_atlas" ? 0 : 0.45 } : {});
// ---
const CAROLUS_TINT: Record<string, THREE.Color> = {
  carolus_sand: new THREE.Color(1.38, 1.27, 1.06),
  carolus_blue: new THREE.Color(1.16, 1.13, 1.04),
  carolus_pale: new THREE.Color(1.3, 1.28, 1.22),
  carolus_art: new THREE.Color(1.25, 1.22, 1.15),
  pj_brick: new THREE.Color(1.12, 1.08, 1.04),
  pj_white: new THREE.Color(1.3, 1.28, 1.22),
  pj_brabant: new THREE.Color(1.62, 1.54, 1.4),
};

// The churches of the angled streets (Sint-Carolus Borromeus, Sint-Pauluskerk, Sint-Jacobskerk), the Stadspark's
// pond, bridge, benches, lanterns and railing, and the town pump that stands in every court of the back alleys
// (tools/blender/build_churches.py -> /models/churches.glb and /models/park.json; tools/city/streets.py, alleys.py).
// The walk map (plan.py) already has the churches, the pond and the park's furniture as walls; here the models,
// the pumps' posts as colliders, and the height of the footbridge's deck (rijnkaai.ts baseAt).

interface ParkData {
  bridge: { from: [number, number]; to: [number, number]; width: number; deck: Array<[number, number]> };
}

let park: ParkData | null = null;
const parkReady = fetch("/models/park.json")
  .then((r) => (r.ok ? r.json() : null))
  .then((d) => {
    park = d as ParkData | null;
  })
  .catch(() => {});
void parkReady;

/** The footbridge's deck height at (x, z), or null off it. */
export function parkBridgeHeight(x: number, z: number): number | null {
  if (!park) return null;
  const { from, to, width, deck } = park.bridge;
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  const L = Math.hypot(dx, dz) || 1;
  const ux = dx / L;
  const uz = dz / L;
  const s = (x - from[0]) * ux + (z - from[1]) * uz;
  const o = -(x - from[0]) * uz + (z - from[1]) * ux;
  if (s < 0 || s > L || Math.abs(o) > width / 2) return null;
  for (let i = 0; i < deck.length - 1; i++) {
    const [s0, y0] = deck[i];
    const [s1, y1] = deck[i + 1];
    if (s >= s0 && s <= s1) return y0 + ((y1 - y0) * (s - s0)) / (s1 - s0 || 1);
  }
  return deck[deck.length - 1][1];
}

/** The covered passages into the gangs (plan.py city.json poorts, 1.5 m past each mouth): street things keep out. */
export function poortKeepOut(): Rect[] {
  const P = ((CITY as unknown as { poorts?: number[][][] }).poorts ?? []) as number[][][];
  return P.map((r) => ({ minX: Math.min(...r.map((p) => p[0])), maxX: Math.max(...r.map((p) => p[0])), minZ: Math.min(...r.map((p) => p[1])), maxZ: Math.max(...r.map((p) => p[1])) }));
}

type Ring = number[][];
const ALLEYS = ((CITY as unknown as { alleys?: { lanes?: Ring[]; gangs?: Ring[] } }).alleys ?? {}) as { lanes?: Ring[]; gangs?: Ring[] };
function inRing(r: Ring, x: number, z: number): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, zi] = r[i];
    const [xj, zj] = r[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
/** The gangs' lanes with their small courts: the plan's lane rings (city.json alleys.lanes) a gang's middle line starts in. */
const GANGS = (ALLEYS.lanes ?? [])
  .filter((r) => (ALLEYS.gangs ?? []).some((g) => g.length > 0 && inRing(r, g[0][0], g[0][1])))
  .map((r) => ({ r, minX: Math.min(...r.map((p) => p[0])), maxX: Math.max(...r.map((p) => p[0])), minZ: Math.min(...r.map((p) => p[1])), maxZ: Math.max(...r.map((p) => p[1])) }));

/** Is (x, z) in a gang (its winding lane or one of its small courts)? */
export function inGang(x: number, z: number): boolean {
  return GANGS.some((g) => x >= g.minX && x <= g.maxX && z >= g.minZ && z <= g.maxZ && inRing(g.r, x, z));
}

const PUMPS = ((CITY as unknown as { alleys?: { pumps?: Array<[number, number]> } }).alleys?.pumps ?? []) as Array<[number, number]>;

/** The pumps' posts: solid (the crowd and the props keep off them). */
export function pumpColliders(): Rect[] {
  return PUMPS.map(([x, z]) => ({ minX: x - 0.45, maxX: x + 0.45, minZ: z - 0.45, maxZ: z + 0.45 }));
}

export interface ChurchesModel {
  group: THREE.Group;
  update(camera: THREE.Camera, far: number): void;
}

export function loadChurches(scene: THREE.Scene): ChurchesModel {
  const group = new THREE.Group();
  group.name = "churches";
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  const parts: THREE.Object3D[] = [];
  const matFor = (src: THREE.MeshStandardMaterial): THREE.Material => {
    const have = mats.get(src.name);
    if (have) return have;
    const map = src.map;
    if (map) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestMipmapLinearFilter;
      map.generateMipmaps = true;
      map.wrapS = map.wrapT = THREE.RepeatWrapping;
      map.needsUpdate = true;
    }
    // the Carolus front's stone: pictures made with Codex (assets/ATTRIBUTION.md), one repeat per 3.6 m and 3 m
    // (build_churches.py TILE); the painted texture in the glb until they load
    const picture = CAROLUS_PICTURES[src.name];
    if (map && picture) {
      map.minFilter = THREE.LinearMipmapLinearFilter;
      map.anisotropy = 4;
      withPicture(map, picture);
    }
    let m: THREE.Material;
    // issue #10: the real windows' old panes (the atlas's cells), never drawn: their glass is the hall's (a copy by
    // world/shellGlass.ts), and world/landmarkWindows.ts lights a copy of them at night
    if (src.name === "church_atlas_lit") {
      m = new THREE.MeshLambertMaterial({ map: map ?? null, vertexColors: true });
      m.visible = false;
      m.name = src.name;
      mats.set(src.name, m);
      return m;
    }
    if (src.name.endsWith("_glow")) m = psx(new THREE.MeshBasicMaterial({ map: map ?? null, color: map ? 0xffffff : 0xffd890 }), { affine: 0 });
    // gilding (the Carolus's cross, pots, rays, pineapples): a little light of its own, so it reads as gold in the grey
    else if (src.name === "church_gilt")
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: new THREE.Color(1.5, 1.45, 1.3), vertexColors: true, emissive: 0x2a1d08 }), {
        fogReach: 2.2,
        affine: 0,
      });
    // the Carolus's stone: kept up in 1873 (restored 1865), so the pale honey front is the lightest thing on the
    // square in the mist (a tint over 1 lifts it under the grey light; at night the light is gone and so is the lift)
    else if (CAROLUS_TINT[src.name])
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: CAROLUS_TINT[src.name], vertexColors: true, side: THREE.DoubleSide }), {
        fogReach: 2.2,
        affine: 0,
        ...wallLook(src.name),
      });
    else if (src.name === "park_water")
      m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : 0x3a4a4c, vertexColors: true, transparent: true, opacity: 0.88 }), { affine: 0, wet: true });
    // (the railing's pickets are single faces: both sides)
    else m = psx(new THREE.MeshLambertMaterial({ map: map ?? null, color: map ? 0xffffff : src.color, vertexColors: true, side: THREE.DoubleSide }), { fogReach: 2.2, affine: 0, ...wallLook(src.name) });
    // (the churches' walls: bumps from their own picture; not the atlas's painted windows)
    if (map && CHURCH_WALLS.test(src.name) && src.name !== "church_atlas") bumpFromMap(m, 1.0);
    m.name = src.name;
    mats.set(src.name, m);
    return m;
  };
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/churches.glb")
    .then((gltf) => {
      let pumpSrc: THREE.Object3D | null = null;
      const meshes: THREE.Mesh[] = [];
      // issue #10: the real openings' markers, for the interior check (dev/interiorcheck.ts)
      for (const e of shellMarkers(gltf.scene)) group.add(e);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        if (!m.geometry.getAttribute("color")) {
          const n = m.geometry.getAttribute("position").count;
          m.geometry.setAttribute("color", new THREE.Float32BufferAttribute(new Float32Array(n * 3).fill(1), 3));
        }
        const src = Array.isArray(m.material) ? m.material : [m.material];
        const out = src.map((s) => matFor(s as THREE.MeshStandardMaterial));
        m.material = Array.isArray(m.material) ? out : out[0];
        meshes.push(m);
      });
      for (const m of meshes) {
        let top: THREE.Object3D = m;
        while (top.parent && top.parent !== gltf.scene) top = top.parent;
        if (top.name === "pump") {
          pumpSrc = top;
          continue;
        }
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        m.geometry.computeBoundingSphere();
        group.add(m);
        parts.push(m);
        // issue #10: each church's lit glass to its hall (world/shellGlass.ts: the hall's stained glass is a copy); issue
        // #28: "_x", the glass of its towers, attics and annexes (world/churchSpaces.ts)
        const lit = /^church_(carolus|stpaul|stjacob)_lit_glass(_x)?$/.exec(m.name);
        if (lit) {
          // (glass, never drawn: the interior check looks through it)
          m.userData.glass = true;
          publishShellGlass(lit[1] + (lit[2] ?? ""), m);
        }
      }
      // a pump in every court of the alleys (its model faces +z: a quarter turn by its place)
      if (pumpSrc) {
        const src = pumpSrc as THREE.Object3D;
        src.updateWorldMatrix(true, true);
        for (const [x, z] of PUMPS) {
          const p = src.clone(true);
          p.position.set(x, 0, z);
          p.rotation.set(0, (Math.floor(Math.abs(x * 7.31 + z * 3.17)) % 4) * (Math.PI / 2), 0);
          group.add(p);
          parts.push(p);
        }
      }
      // the stand-ins the landmark model still carries for these three (landmarks.glb) are hidden
      scene.traverse((o) => {
        if (/^landmark_(carolus|stpaul|stjacob)/.test(o.name) || /^standin_(carolus|stpaul|stjacob)/.test(o.name)) o.visible = false;
      });
      draco.dispose();
    })
    .catch((e) => console.warn("churches.glb did not load", e));
  const tmp = new THREE.Vector3();
  const sph = new THREE.Sphere();
  return {
    group,
    update(camera, far) {
      const cp = camera.position;
      for (const p of parts) {
        const m = p as THREE.Mesh;
        if (m.isMesh) {
          if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
          sph.copy(m.geometry.boundingSphere!).applyMatrix4(m.matrixWorld);
        } else sph.set(tmp.copy(p.position), 3);
        p.visible = sph.center.distanceTo(cp) - sph.radius < far + 20;
      }
      // (the landmark stand-ins may load after this model: keep them hidden)
      for (const o of scene.children) if (o.name === "city") for (const c of o.children) if (/^(landmark|standin)_(carolus|stpaul|stjacob)/.test(c.name)) c.visible = false;
    },
  };
}

// ---- issue #10 (interiors are real): a church hall's stained glass is the shell's old panes (the atlas's cells, a mesh
// "church_<id>_lit_glass" published above), moved into the hall's scene. Copies of the same triangles: the street's
// side (front faces: by day the painted glass as the town always saw it; after dark the glass lit from within, in the
// candles' amber) and the hall's side (back faces: the same cells as daylight through them, the stone and the lead dark
// against it). See-through (0.8; the Carolus's plain panes 0.4) so the hall shows from the street and the street from
// inside; one material each of the kind the prison's chapel draws with (MeshBasic, a map): no new shader kind.

const daylightPics = new Map<THREE.Texture, THREE.Texture>();

/** The atlas as seen from inside by day: the glass lit (its own colours), the painted stone and lead dark. */
function daylightPicture(src: THREE.Texture): THREE.Texture {
  const have = daylightPics.get(src);
  if (have) return have;
  const img = src.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img || !img.width) return src;
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height);
  const px = d.data;
  for (let p = 0; p < px.length; p += 4) {
    const r = px[p] / 255;
    const gg = px[p + 1] / 255;
    const b = px[p + 2] / 255;
    const mx = Math.max(r, gg, b);
    const mn = Math.min(r, gg, b);
    const lum = 0.3 * r + 0.55 * gg + 0.15 * b;
    const sat = mx > 0 ? (mx - mn) / mx : 0;
    // the glass (dark or stained in the painting: the town's side of it) lit by the day behind it; the lead lines
    // in it stay darker; the painted tracery and frame are stone, against the light
    const glassy = lum < 0.3 || (sat > 0.45 && lum < 0.5);
    const k = glassy ? 3.4 : 0.32;
    const lift = glassy && lum > 0.06 ? 0.14 : 0;
    px[p] = Math.min(255, (r * k + lift) * 255);
    px[p + 1] = Math.min(255, (gg * k + lift) * 255);
    px[p + 2] = Math.min(255, (b * k + lift * 0.9) * 255);
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.flipY = src.flipY;
  t.colorSpace = src.colorSpace;
  t.wrapS = src.wrapS;
  t.wrapT = src.wrapT;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  t.name = "church_glass_daylight";
  daylightPics.set(src, t);
  return t;
}

/**
 * The sun's and the moon's way in (world/hallSun.ts): a church's real windows (in its hall's frame) at their glass.
 * `walls`: the hall's walls behind the shell (its linings' inner faces, hall frame) and the plan's yaw: a window whose
 * shaft (from its glass down along the light to the floor) would pass through one of them draws none (it would stand
 * out of the church over a roof); its light on the floor stays.
 */
export function sunWindowsOf(rows: readonly ChurchOpening[], floorY: number, walls?: { yaw: number; lines: Array<[[number, number], [number, number]]> }): SunWindow[] {
  // (hallSun.ts SUN_TOWARD: the light travels the other way; turned into the hall's frame as shellOpening.ts inFrame)
  const sun = new THREE.Vector3(-0.806, Math.tan(Math.PI / 6), 0.591).normalize();
  const c = Math.cos(walls?.yaw ?? 0);
  const s = Math.sin(walls?.yaw ?? 0);
  const dx = -sun.x * c + sun.z * s;
  const dz = -sun.x * s - sun.z * c;
  const cross = (a: [number, number], b: [number, number], p: [number, number], q: [number, number]) => {
    const d1 = (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const d2 = (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
    const d3 = (q[0] - p[0]) * (a[1] - p[1]) - (q[1] - p[1]) * (a[0] - p[0]);
    const d4 = (q[0] - p[0]) * (b[1] - p[1]) - (q[1] - p[1]) * (b[0] - p[0]);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  return rows
    .filter((o) => o.kind === "window")
    .map((o) => {
      const x = o.x - o.nx * o.depth;
      const z = o.z - o.nz * o.depth;
      const spring = (o.poly?.[2]?.[1] ?? o.yt) - floorY;
      const y = (o.yb - floorY + Math.min(o.yt - floorY, spring)) / 2;
      const run = y / sun.y;
      const end: [number, number] = [x + dx * run, z + dz * run];
      // (its own face's lining it starts in: the lines through the window's own face are not in its way)
      const own = (a: [number, number], b: [number, number]) => {
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
        return Math.abs(((x - a[0]) * (b[1] - a[1]) - (z - a[1]) * (b[0] - a[0])) / L) < 0.8 && (x - a[0]) * (b[0] - a[0]) + (z - a[1]) * (b[1] - a[1]) > -L;
      };
      const shaft = !walls || !walls.lines.some(([a, b]) => !own(a, b) && cross(a, b, [x, z], end));
      return {
        x,
        z,
        nx: -o.nx,
        nz: -o.nz,
        hw: o.hw,
        y0: o.yb - floorY,
        y1: o.yt - floorY,
        // (the outline's third point: the right side's top, where the head springs)
        spring,
        lights: o.lights,
        colour: o.colour,
        shaft,
      };
    });
}

/**
 * From inside a church, only its windows within this many metres bring the street in (world/inworld.ts insideReach):
 * the high and far ones show the hall's air behind their stained glass, which lets little through. The whole town drawn
 * through all of a church's windows cost about 6 ms a frame (issue #10, frameProf inside each church).
 */
export const CHURCH_INSIDE_REACH = 12;

export interface ChurchGlass {
  /** The hall's daylight (0..1), the sky (0.5..1) and the moon's share by night: the glass's brightness each side. */
  set(day: number, sky: number, moon: number): void;
}

/** A church hall's stained glass, from its shell's lit glass when that has loaded (added to the hall's scene). */
export function churchGlass(id: "carolus" | "stpaul" | "stjacob", scene: THREE.Scene): ChurchGlass {
  const m: { inner: THREE.Mesh | null; outer: THREE.Mesh | null; lit: THREE.Mesh | null } = { inner: null, outer: null, lit: null };
  let last: [number, number, number] = [1, 1, 0];
  // (the Gothic churches' windows are stained glass; the Carolus's, as its shell paints them, plain leaded panes: see
  // through them more, and from inside as they are painted, grey glass and its leads, not lit up)
  const plain = id === "carolus";
  const opacity = plain ? 0.4 : 0.8;
  const mat = (q: THREE.Mesh | null) => (q ? (q.material as THREE.MeshBasicMaterial) : null);
  const set = (day: number, sky: number, moon: number) => {
    last = [day, sky, moon];
    const g0 = 0.95 * day * sky;
    // (inside: the old halls' glass, lit by the day, the moon's blue by night)
    mat(m.inner)?.color.setRGB(0.07 + g0 + 0.05 * moon, 0.08 + g0 + 0.08 * moon, 0.1 + g0 + 0.17 * moon);
    // the street's side: by day the painted glass under the street's light; after dark the same glass lit from within
    // by the hall's candles, fading in over the dusk (the landmark windows' glow, world/landmarkWindows.ts, lies on the
    // street's side of the window, and the hall is drawn over it: the hall's own glass carries that light here)
    const night = 1 - THREE.MathUtils.smoothstep(day, 0.08, 0.4);
    const o = 0.06 + 0.9 * day * (0.6 + 0.4 * sky);
    const om = mat(m.outer);
    if (om && m.outer) {
      om.color.setRGB(o, o, o * 1.02);
      om.opacity = opacity * (1 - night);
      m.outer.visible = night < 0.99;
    }
    const lm = mat(m.lit);
    if (lm && m.lit) {
      lm.color.setRGB(1.0, 0.42, 0.1).multiplyScalar(plain ? 0.95 : 1.15);
      lm.opacity = 0.8 * night;
      m.lit.visible = night > 0.01;
    }
  };
  whenShellGlass(id, (src) => {
    const outer = roomGlassFrom(src, { name: `${id}_street`, opacity });
    const lit = roomGlassFrom(src, { name: `${id}_street_lit`, opacity: 0 });
    const inner = roomGlassFrom(src, { name: `${id}_hall`, opacity });
    mat(outer)!.side = THREE.FrontSide;
    mat(lit)!.side = THREE.FrontSide;
    mat(inner)!.side = THREE.BackSide;
    const src0 = mat(inner)!.map;
    const lightPic = src0 ? daylightPicture(src0) : null;
    if (lightPic && !plain) mat(inner)!.map = lightPic;
    if (lightPic) mat(lit)!.map = lightPic;
    // (the lit glass over the day's)
    lit.renderOrder = outer.renderOrder + 1;
    m.outer = outer;
    m.lit = lit;
    m.inner = inner;
    scene.add(outer, lit, inner);
    set(...last);
  });
  // issue #28: the glass of the towers, attics and annexes (world/churchSpaces.ts): the same picture, plain panes a
  // little clearer; no candles behind it at night (the landmark windows' own glow still says where a lamp would be)
  const extras: Array<(day: number, sky: number, moon: number) => void> = [];
  whenShellGlass(`${id}_x`, (src) => {
    const outer = roomGlassFrom(src, { name: `${id}_x_street`, opacity: plain ? 0.4 : 0.6 });
    const inner = roomGlassFrom(src, { name: `${id}_x_room`, opacity: plain ? 0.4 : 0.6 });
    // (the same materials' kind as the hall's own glass: no new shader)
    mat(outer)!.side = THREE.FrontSide;
    mat(inner)!.side = THREE.BackSide;
    const src0 = mat(inner)!.map;
    if (src0 && !plain) mat(inner)!.map = daylightPicture(src0);
    const setX = (day: number, sky: number, moon: number) => {
      const g0 = 0.95 * day * sky;
      mat(inner)!.color.setRGB(0.07 + g0 + 0.05 * moon, 0.08 + g0 + 0.08 * moon, 0.1 + g0 + 0.17 * moon);
      const o = 0.06 + 0.9 * day * (0.6 + 0.4 * sky);
      mat(outer)!.color.setRGB(o, o, o * 1.02);
    };
    extras.push(setX);
    setX(...last);
    scene.add(outer, inner);
  });
  return {
    set(day, sky, moon) {
      set(day, sky, moon);
      for (const f of extras) f(day, sky, moon);
    },
  };
}
