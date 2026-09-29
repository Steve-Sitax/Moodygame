import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { psx } from "../retro/psx";
import { landmarkMaterials } from "./city";
import { shellMarkers } from "./realOpenings";
import { tex } from "./rooms";

// The Oostershuis with real windows and doors (issue #28, interiors are real): its own model
// (tools/blender/build_oostershuis.py -> /models/oostershuis.glb) in the landmarks' own materials (world/city.ts:
// the same stone, slate, lead, gilt, brickband and atlas, so it looks as the older one did, and no new shader), and
// oak for its shutters, leaves and hatches. It replaces the older Hanseatic House of landmarks.glb
// (build_landmarks.py hanzehuis), hidden here. The rooms behind its windows: world/landmarkHalls.ts buildOostershuis.
// Its panes (oostershuis_lit_glass, landmark_glass_lit) are never drawn: world/landmarkWindows.ts lights a copy of them
// at night.

let oak: THREE.Material | null = null;
function oakMaterial(): THREE.Material {
  if (oak) return oak;
  // (the glb's uv: box-projected, 3 m to one; the planks a repeat every 1.2 m)
  const map = tex().planks.clone();
  map.repeat.set(2.5, 2.5);
  map.needsUpdate = true;
  map.name = "oostershuis_oak";
  // (the planks' picture is a room's, dark; lifted for the street's daylight, a weathered brown)
  const m = new THREE.MeshLambertMaterial({ map, vertexColors: true, side: THREE.DoubleSide });
  m.color.setRGB(1.9, 1.45, 1.05);
  oak = psx(m, { fogReach: 2.2, affine: 0 });
  oak.name = "oostershuis_oak";
  return oak;
}

/** Load the Oostershuis into the scene and hide the older one of landmarks.glb (and its stand-in block). */
export function loadOostershuisShell(scene: THREE.Scene): void {
  const group = new THREE.Group();
  group.name = "oostershuis";
  scene.add(group);
  const draco = new DRACOLoader().setDecoderPath("/draco/");
  new GLTFLoader()
    .setDRACOLoader(draco)
    .loadAsync("/models/oostershuis.glb")
    .then(async (gltf) => {
      // the landmarks' materials, and their atlas once landmarks.glb is in (the clock, the arms, the balustrade)
      let lm = landmarkMaterials();
      for (let i = 0; i < 240 && !(lm && lm.cath_atlas); i++) {
        await new Promise((r) => setTimeout(r, 500));
        lm = landmarkMaterials();
      }
      if (!lm) return console.warn("oostershuis.glb: the landmarks' materials never came");
      let lit: THREE.Material | null = null;
      const pick = (name: string): THREE.Material => {
        if (name === "oh_oak") return oakMaterial();
        if (name === "landmark_glass_lit") {
          if (!lit) {
            // the old panes: never drawn; their picture is the glass's, for the night's light (world/landmarkWindows.ts)
            const src = lm!.glass as THREE.MeshLambertMaterial;
            lit = new THREE.MeshLambertMaterial({ map: src.map, vertexColors: true, side: THREE.DoubleSide });
            lit.name = "landmark_glass_lit";
            lit.visible = false;
          }
          return lit;
        }
        return lm![name] ?? lm!.stone;
      };
      const meshes: THREE.Mesh[] = [];
      // the real openings' markers, for the interior check (dev/interiorcheck.ts)
      for (const e of shellMarkers(gltf.scene)) group.add(e);
      gltf.scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.material = pick((m.material as THREE.Material).name);
        meshes.push(m);
      });
      for (const m of meshes) {
        m.updateWorldMatrix(true, false);
        m.applyMatrix4(m.parent!.matrixWorld);
        m.name = `oostershuis_shell_${(m.material as THREE.Material).name}`;
        m.geometry.computeBoundingSphere();
        group.add(m);
      }
      draco.dispose();
      // the older one (landmarks.glb) and the stand-in: hidden once they are there (they may load later). The clock's
      // live hands (world/clockHands.ts) hang on the nearest part of that file, the old dial: they come over to this one
      // (the dial is in the same place), so they keep showing the game's time
      let tries = 0;
      let since = -1;
      const hide = () => {
        const old: THREE.Object3D[] = [];
        scene.traverse((o) => {
          if (/^(landmark|standin)_hanzehuis/.test(o.name)) {
            o.visible = false;
            if (o.name.startsWith("landmark_")) old.push(o);
          }
        });
        for (const o of old) for (const c of [...o.children]) group.attach(c);
        if (old.length && since < 0) since = tries;
        // (on a while after the old one is found: the hands may be hung a little later)
        if (++tries < 150 && (since < 0 || tries - since < 20)) setTimeout(hide, 1000);
      };
      hide();
    })
    .catch((e) => console.warn("oostershuis.glb did not load", e));
}
