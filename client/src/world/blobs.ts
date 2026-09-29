import * as THREE from "three";

// Soft shadows on the ground (2026-09-29, Steve: "Lighting during day is flat, is it realistic to have more shadow
// play?"): under every walker, cart and dray near the eye a dark soft patch, as the sky's light is kept off the stones
// under anything that stands on them, in any weather. One instanced flat shape, one draw, only within REACH of the eye.

const MAX = 192;
const REACH = 45;

export interface BlobSpot {
  x: number;
  z: number;
  /** The ground under it (m); a walker's feet. */
  y: number;
  /** Its half width (m). */
  r: number;
}

export function createBlobs(scene: THREE.Scene): { update(spots: Iterable<BlobSpot>, eye: THREE.Vector3, day: number): void; count(): number } {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(0,0,0,1)");
  grad.addColorStop(0.45, "rgba(0,0,0,0.75)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: 0xffffff, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  mat.name = "ground_blob";
  const geo = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
  const mesh = new THREE.InstancedMesh(geo, mat, MAX);
  mesh.name = "ground_blobs";
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.renderOrder = 1;
  scene.add(mesh);
  const m = new THREE.Matrix4();
  return {
    update(spots, eye, day) {
      let n = 0;
      for (const s of spots) {
        if (n >= MAX) break;
        if (Math.abs(s.x - eye.x) > REACH || Math.abs(s.z - eye.z) > REACH) continue;
        m.makeScale(s.r, 1, s.r).setPosition(s.x, s.y + 0.03, s.z);
        mesh.setMatrixAt(n++, m);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = n > 0;
      // a little stronger by day, when the sky's light is what they keep off
      mat.opacity = 0.28 + 0.2 * day;
    },
    count: () => mesh.count,
  };
}
