import * as THREE from "three";

// A thing's matrix made again only when it moved (2026-09-28, the slow frames). three.js r186 composes every
// object's local matrix from its position, rotation and scale every frame (updateMatrix), and then its world matrix
// and its children's, whether anything changed or not: ~8,000 things, twice a frame. This keeps the ten numbers
// the matrix was last made from; when they are the same the matrix is too, and nothing below it needs a new world
// matrix unless its parent's changed (three.js's own `force`). The picture is the same to the bit.
// (A matrix written by hand with matrixAutoUpdate on was undone every frame before and stays now; the game has none:
// game/lifeAboard.ts writes its group's matrix with matrixAutoUpdate off.)

/** Dev: off, every matrix is made every frame again (the pixel diff). */
export const matrixSkip = { on: true };
if (import.meta.env.DEV) Object.assign(window, { __matrixSkip: matrixSkip });

type Keyed = THREE.Object3D & { __trs?: Float64Array; pivot?: THREE.Vector3 | null };
const proto = THREE.Object3D.prototype as Keyed;
const compose = proto.updateMatrix;

proto.updateMatrix = function (this: Keyed): void {
  const p = this.position;
  const q = this.quaternion;
  const s = this.scale;
  let c = this.__trs;
  if (
    matrixSkip.on &&
    c &&
    c[0] === p.x &&
    c[1] === p.y &&
    c[2] === p.z &&
    c[3] === q.x &&
    c[4] === q.y &&
    c[5] === q.z &&
    c[6] === q.w &&
    c[7] === s.x &&
    c[8] === s.y &&
    c[9] === s.z &&
    !this.pivot
  )
    return;
  compose.call(this);
  if (!c) c = this.__trs = new Float64Array(10);
  c[0] = p.x;
  c[1] = p.y;
  c[2] = p.z;
  c[3] = q.x;
  c[4] = q.y;
  c[5] = q.z;
  c[6] = q.w;
  c[7] = s.x;
  c[8] = s.y;
  c[9] = s.z;
};
