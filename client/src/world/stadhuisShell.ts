import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { footDirt, psx } from "../retro/psx";
import { shellMarkers } from "./realOpenings";

// The town hall of 1873 in detail (the high-quality pass, 2026-09-26): its own model (tools/blender/build_stadhuis.py
// -> /models/stadhuis.glb) with a picture and a height map per material that follows it
// (tools/textures/stadhuis_maps.py; the stone, slate, glass and oak pictures made with Codex, the arms painted;
// assets/ATTRIBUTION.md). It replaces the older town hall of landmarks.glb (build_landmarks.py stadhuis), hidden here.
// The footprint, the three doors of the frontispiece (the main one open: world/hallInWorld.ts hangs its leaves) and
// the 22 bays stay where they were, so the hall inside (shared/townhallPlan.ts, world/landmarkHalls.ts) and the walk
// map fit it unchanged. Issue #10 (interiors are real): its windows are cut through (shared/stadhuisShell.ts, the
// empties opening_<id>): their glass and the rooms behind them are the hall's; their old panes (sh_glass_lit) are
// never drawn, only lit at night by world/landmarkWindows.ts.
//
// Bumps: three.js's own bump map on the picture's own uv, so every joint, slate edge and lead came of the height map
// lies under the one drawn; the lowest parts (the joints) are drawn a little darker, as they get less light.

interface Pic {
  map?: string;
  height?: string;
  /**
   * three.js bumpScale (per screen pixel, as three.js r186 counts it). About half the first values since retro/psx.ts
   * psxBumpGain draws bumps up to 2.5 times as strong up close (Steve, 2026-09-27: too much bump; the stone read as grit).
   */
  bump: number;
  /** How much darker the lowest parts of the height map are drawn: 0 none. */
  joint: number;
  /** The picture's colour lifted (over 1): the game's grey daylight seldom reaches a wall straight on. */
  lift: number;
  color?: number;
  /** A warm or cool cast over the picture (times the lift). */
  tint?: [number, number, number];
  repeat?: boolean;
}

const T = "/textures/stadhuis_";
const PICS: Record<string, Pic> = {
  sh_white: { map: `${T}limestone.jpg`, height: `${T}limestone_h.png`, bump: 0.7, joint: 0.3, lift: 1.0, tint: [1.0, 0.95, 0.86] },
  sh_carved: { map: `${T}carved.jpg`, height: `${T}carved_h.png`, bump: 0.6, joint: 0.12, lift: 0.98, tint: [1.0, 0.95, 0.86] },
  sh_blue: { map: `${T}bluestone.jpg`, height: `${T}bluestone_h.png`, bump: 0.45, joint: 0.15, lift: 1.3 },
  sh_slate: { map: `${T}slate.jpg`, height: `${T}slate_h.png`, bump: 0.8, joint: 0.3, lift: 1.25 },
  sh_glass: { map: `${T}glass.jpg`, height: `${T}glass_h.png`, bump: 0.6, joint: 0.15, lift: 1.15 },
  // issue #10: the old panes of the real windows, never drawn: world/landmarkWindows.ts lights a copy of them at night
  sh_glass_lit: { map: `${T}glass.jpg`, bump: 0, joint: 0, lift: 1.15 },
  sh_oak: { map: `${T}oak.jpg`, height: `${T}oak_h.png`, bump: 0.8, joint: 0.25, lift: 1.3 },
  sh_arms: { map: `${T}arms.png`, height: `${T}arms_h.png`, bump: 0.9, joint: 0.15, lift: 1.2, repeat: false },
  sh_lead: { bump: 0, joint: 0, lift: 1, color: 0x4c5054 },
  sh_gilt: { bump: 0, joint: 0, lift: 1, color: 0xd0a444 },
  sh_cloth: { bump: 0, joint: 0, lift: 1, color: 0xffffff },
};

/** A picture, handed to `ready` once it has loaded (until then the material keeps its plain colour). */
function load(url: string, colour: boolean, repeat: boolean, ready: (t: THREE.Texture) => void): void {
  new THREE.TextureLoader().load(
    url,
    (t) => {
      // (the glb's uv are glTF's: the top of a picture at v 0)
      t.flipY = false;
      t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
      t.magFilter = THREE.LinearFilter;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.anisotropy = 4;
      if (colour) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      ready(t);
    },
    undefined,
    () => console.warn("town hall picture did not load", url),
  );
}

function material(name: string, src: THREE.MeshStandardMaterial): THREE.Material {
  const p = PICS[name];
  const repeat = p?.repeat ?? true;
  const m = new THREE.MeshLambertMaterial({ color: p?.color ?? src.color, vertexColors: true, side: THREE.DoubleSide });
  // the gilding: a little light of its own, so it reads as gold in the grey (as the Carolus's)
  if (name === "sh_gilt") m.emissive = new THREE.Color(0x2a1d08);
  if (p?.map)
    load(p.map, true, repeat, (t) => {
      m.map = t;
      m.color.setRGB(p.lift * (p.tint?.[0] ?? 1), p.lift * (p.tint?.[1] ?? 1), p.lift * (p.tint?.[2] ?? 1));
      m.needsUpdate = true;
    });
  if (p?.height && p.bump > 0)
    load(p.height, false, repeat, (t) => {
      m.bumpMap = t;
      m.bumpScale = p.bump;
      m.needsUpdate = true;
    });
  m.name = name;
  if (name === "sh_glass_lit") {
    m.visible = false;
    return m;
  }
  psx(m, { fogReach: 2.2, affine: 0 });
  // the dirt band at the foot of the walls (retro/psx.ts footDirt; weaker by itself on the Grote Markt, a fine square)
  footDirt(m, 0.5);
  if (p?.height && p.joint > 0) {
    // the joints in shade: the lowest parts of the height map a little darker (before the light is added)
    const prev = m.onBeforeCompile;
    const key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uShJoint = { value: p.joint };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float uShJoint;\nvoid main() {")
        .replace(
          "#include <emissivemap_fragment>",
          "#ifdef USE_BUMPMAP\ndiffuseColor.rgb *= 1.0 - uShJoint * (1.0 - smoothstep(0.08, 0.55, texture2D(bumpMap, vBumpMapUv).r));\n#endif\n#include <emissivemap_fragment>",
        );
    };
    m.customProgramCacheKey = () => `${key()}-shjoint`;
  }
  return m;
}

/** Load the town hall into the scene and hide the older one of landmarks.glb (and its stand-in block). */
export function loadStadhuisShell(scene: THREE.Scene): void {
  const group = new THREE.Group();
  group.name = "stadhuis";
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/stadhuis.glb")
    .then((gltf) => {
      const meshes: THREE.Mesh[] = [];
      // issue #10: the real openings' markers, for the interior check (dev/interiorcheck.ts)
      for (const e of shellMarkers(gltf.scene)) group.add(e);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        const src = m.material as THREE.MeshStandardMaterial;
        let mat = mats.get(src.name);
        if (!mat) mats.set(src.name, (mat = material(src.name, src)));
        m.material = mat;
        meshes.push(m);
      });
      for (const m of meshes) {
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        // (stadhuis_body: the walls, orders and roof; stadhuis_detail: balusters, capitals, consoles, triglyphs)
        let top: THREE.Object3D = m;
        while (top.parent && top.parent !== gltf.scene) top = top.parent;
        m.name = `stadhuis_shell_${top.name.replace(/^stadhuis_/, "")}_${(m.material as THREE.Material).name}`;
        m.geometry.computeBoundingSphere();
        group.add(m);
      }
      draco.dispose();
      // the older town hall (landmarks.glb) and the stand-in: hidden once they are there (they may load later)
      let tries = 0;
      const hide = () => {
        let found = false;
        scene.traverse((o) => {
          if (/^(landmark|standin)_stadhuis/.test(o.name)) {
            o.visible = false;
            if (o.name.startsWith("landmark_")) found = true;
          }
        });
        if (!found && ++tries < 120) setTimeout(hide, 1000);
      };
      hide();
    })
    .catch((e) => console.warn("stadhuis.glb did not load", e));
}
