import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { footDirt, psx } from "../retro/psx";
import { shellMarkers } from "./realOpenings";

// The Vleeshuis of 1873 in detail (the high-quality pass, 2026-09-26): its own model
// (tools/blender/build_vleeshuis.py -> /models/vleeshuis.glb) with a picture and a matching height map per
// material (tools/textures/vleeshuis_maps.py; the pictures made with Codex, assets/ATTRIBUTION.md). It replaces the
// older Vleeshuis of landmarks.glb (build_landmarks.py vleeshuis2), which is hidden here. The outline, the doors of
// the long sides and the windows the theatre lights stay where they were: the hall inside (shared/vleeshuisPlan.ts,
// world/landmarkHalls.ts) and the walk map fit it unchanged.
//
// Bumps: three.js's own bump map (the normal tilted by the height map's slope, in any light), the same uv as the
// picture, so every joint and band of the height map lies under the one drawn; and the joints a little darker (they
// get less light). Lead and iron (no picture): no relief.

interface Pic {
  map?: string;
  height?: string;
  /** three.js bumpScale: how steep the height map's slopes light (per screen pixel, as three.js r186 counts it). */
  bump: number;
  /** How much darker the lowest parts (the joints) are drawn: 0 none. */
  joint: number;
  /** The picture's colour lifted (over 1): the game's grey daylight seldom reaches a wall straight on. */
  lift: number;
  color?: number;
}

const PICS: Record<string, Pic> = {
  vh_bands: { map: "/textures/vleeshuis_bands.jpg", height: "/textures/vleeshuis_bands_h.png", bump: 1.4, joint: 0.3, lift: 1.5 },
  vh_sand: { map: "/textures/vleeshuis_sand.jpg", height: "/textures/vleeshuis_sand_h.png", bump: 1.2, joint: 0.25, lift: 1.35 },
  vh_blue: { map: "/textures/vleeshuis_blue.jpg", height: "/textures/vleeshuis_blue_h.png", bump: 1.0, joint: 0.25, lift: 1.35 },
  vh_slate: { map: "/textures/vleeshuis_slate.jpg", height: "/textures/vleeshuis_slate_h.png", bump: 1.2, joint: 0.25, lift: 1.2 },
  vh_glass: { map: "/textures/vleeshuis_glass.jpg", height: "/textures/vleeshuis_glass_h.png", bump: 0.6, joint: 0.1, lift: 1.1 },
  // issue #10: the old panes of the real windows, never drawn: world/landmarkWindows.ts lights a copy of them at night
  vh_glass_lit: { map: "/textures/vleeshuis_glass.jpg", bump: 0, joint: 0, lift: 1.1 },
  vh_oak: { map: "/textures/vleeshuis_oak.jpg", height: "/textures/vleeshuis_oak_h.png", bump: 1.2, joint: 0.25, lift: 1.3 },
  vh_madonna: { map: "/textures/vleeshuis_madonna.jpg", height: "/textures/vleeshuis_madonna_h.png", bump: 1.5, joint: 0.2, lift: 1.3 },
  vh_lead: { bump: 0, joint: 0, lift: 1, color: 0x4a4c4e },
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
    () => console.warn("vleeshuis picture did not load", url),
  );
}

function material(name: string, src: THREE.MeshStandardMaterial): THREE.Material {
  const p = PICS[name];
  const repeat = name !== "vh_madonna";
  const m = new THREE.MeshLambertMaterial({ color: p?.color ?? src.color, vertexColors: true, side: THREE.DoubleSide });
  if (p?.map)
    load(p.map, true, repeat, (t) => {
      m.map = t;
      m.color.setScalar(p.lift);
      m.needsUpdate = true;
    });
  if (p?.height && p.bump > 0)
    load(p.height, false, repeat, (t) => {
      m.bumpMap = t;
      m.bumpScale = p.bump;
      m.needsUpdate = true;
    });
  m.name = name;
  if (name === "vh_glass_lit") {
    m.visible = false;
    return m;
  }
  psx(m, { fogReach: 2.2, affine: 0 });
  // the dirt band at the foot of the walls (retro/psx.ts footDirt)
  footDirt(m, 0.5);
  if (p?.height && p.joint > 0) {
    // the joints in shade: the lowest parts of the height map a little darker (before the light is added)
    const prev = m.onBeforeCompile;
    const key = m.customProgramCacheKey.bind(m);
    m.onBeforeCompile = (shader, renderer) => {
      prev.call(m, shader, renderer);
      shader.uniforms.uVhJoint = { value: p.joint };
      shader.fragmentShader = shader.fragmentShader
        .replace("void main() {", "uniform float uVhJoint;\nvoid main() {")
        .replace(
          "#include <emissivemap_fragment>",
          "#ifdef USE_BUMPMAP\ndiffuseColor.rgb *= 1.0 - uVhJoint * (1.0 - smoothstep(0.08, 0.55, texture2D(bumpMap, vBumpMapUv).r));\n#endif\n#include <emissivemap_fragment>",
        );
    };
    m.customProgramCacheKey = () => `${key()}-vhjoint`;
  }
  return m;
}

/** Load the Vleeshuis into the scene and hide the older one of landmarks.glb (and its stand-in block). */
export function loadVleeshuisShell(scene: THREE.Scene): void {
  const group = new THREE.Group();
  group.name = "vleeshuis";
  scene.add(group);
  const mats = new Map<string, THREE.Material>();
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/vleeshuis.glb")
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
        m.name = `vleeshuis_shell_${(m.material as THREE.Material).name}`;
        m.geometry.computeBoundingSphere();
        group.add(m);
      }
      draco.dispose();
      // the older Vleeshuis (landmarks.glb) and the stand-in: hidden once they are there (they may load later)
      let tries = 0;
      const hide = () => {
        let found = false;
        scene.traverse((o) => {
          if (/^(landmark|standin)_vleeshuis/.test(o.name)) {
            o.visible = false;
            if (o.name.startsWith("landmark_")) found = true;
          }
        });
        if (!found && ++tries < 120) setTimeout(hide, 1000);
      };
      hide();
    })
    .catch((e) => console.warn("vleeshuis.glb did not load", e));
}
