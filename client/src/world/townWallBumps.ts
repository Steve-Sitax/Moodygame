import * as THREE from "three";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";

// Bumps on the town wall (the bump audit, 2026-09-26; Steve: "textures from the wall are not bump-mapped and still
// flat"). The wall's pictures are painted by tools/blender/build_wall.py and packed in wall.glb; their height maps are
// worked out from those same pictures by tools/textures/townwall_maps.py (the brick's lime mortar is lighter than the
// brick, so the picture's light is not its height: the script finds the joints by the colour). townwall_maps.json
// records each picture's SHA-256 as packed in the glb: a height map is used only with the picture it was made from,
// so a wall.glb rebuilt with other pictures has a flat wall until the script runs again, never the old bricks.
//
// three.js's own bump map, on the picture's own uv. The shader is fixed from the start: every material named here
// gets its bump map when it is made (flat grey, strength 0), and only the picture and the strength (a uniform) change
// once the height map is in. No shader is built again.

/** The wall.glb materials that townwall_maps.py makes a height map for (its KINDS). */
const BUMPED = ["wall_brick", "wall_quoin", "wall_plinth", "wall_stone", "wall_slate", "wall_wood", "wall_iron", "wall_window", "wall_arms", "wall_canvas", "wall_coping", "wall_props"];

interface Rec {
  sha256: string;
  kind: string;
  bump: number;
  map: string;
}

const heights = new Map<string, { tex: THREE.Texture; mats: THREE.MeshLambertMaterial[] }>();

function flatHeight(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 4;
  const g = c.getContext("2d")!;
  g.fillStyle = "#808080";
  g.fillRect(0, 0, 4, 4);
  const t = new THREE.CanvasTexture(c);
  // (the glb's uv are glTF's: the top of a picture at v 0, as the colour map)
  t.flipY = false;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

/** Give a wall material its (for now flat) bump map, if townwall_maps.py makes one for it. */
export function townWallBump(m: THREE.Material, name: string): void {
  if (!BUMPED.includes(name)) return;
  const lm = m as THREE.MeshLambertMaterial;
  let e = heights.get(name);
  if (!e) heights.set(name, (e = { tex: flatHeight(), mats: [] }));
  e.mats.push(lm);
  lm.bumpMap = e.tex;
  lm.bumpScale = 0;
  lm.userData.bumpKind = "town wall height";
  lm.userData.bumpBefore = 0;
  lm.needsUpdate = true;
}

async function sha256(buf: ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", buf)), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Once wall.glb is in: check each picture against townwall_maps.json and put its height map in. */
export async function loadTownWallBumps(gltf: GLTF): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const made = (await (await fetch("/textures/townwall_maps.json")).json()) as Record<string, Rec>;
    const js = gltf.parser.json as {
      materials: Array<{ name: string; pbrMetallicRoughness?: { baseColorTexture?: { index: number } } }>;
      textures: Array<{ source: number }>;
      images: Array<{ bufferView?: number }>;
    };
    await Promise.all(
      js.materials.map(async (mj) => {
        const e = heights.get(mj.name);
        const rec = made[mj.name];
        if (!e || !rec) return;
        const ti = mj.pbrMetallicRoughness?.baseColorTexture?.index;
        const bv = ti === undefined ? undefined : js.images[js.textures[ti].source]?.bufferView;
        if (bv === undefined) return;
        const sha = await sha256((await gltf.parser.getDependency("bufferView", bv)) as ArrayBuffer);
        if (sha && sha !== rec.sha256) {
          console.warn(`${rec.map} was made from another picture: that part of the town wall stays flat (run tools/textures/townwall_maps.py)`);
          out[mj.name] = "stale";
          return;
        }
        const img = await new THREE.ImageLoader().loadAsync(`/textures/${rec.map}`);
        e.tex.image = img;
        e.tex.needsUpdate = true;
        for (const m of e.mats) m.bumpScale = rec.bump;
        out[mj.name] = `bump ${rec.bump}`;
      }),
    );
  } catch (err) {
    console.warn("town wall height maps did not load: the wall stays flat", err);
  }
  return out;
}
