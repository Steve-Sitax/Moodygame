import * as THREE from "three";

// Hands on the thing they hold (docs/testing.md rule 5, Steve 2026-09-25: "not ropes in hands"). The
// people.glb skeletons have a plain arm: armUp (the shoulder), armLow (the elbow), hand (the wrist),
// each bone pointing down its own +y. reachArm turns the upper and the lower arm, after the clip has
// posed them this frame, so that the wrist comes to a point in the world: a two-bone reach with the
// elbow bent toward a hint (the pole). The clip keeps the rest of the body (breathing, the head).

const S = new THREE.Vector3();
const E = new THREE.Vector3();
const H = new THREE.Vector3();
const T = new THREE.Vector3();
const TIP = new THREE.Vector3();
const D = new THREE.Vector3();
const N = new THREE.Vector3();
const W = new THREE.Vector3();
const U0 = new THREE.Vector3();
const U1 = new THREE.Vector3();
const Q = new THREE.Quaternion();
const PQ = new THREE.Quaternion();
const WQ = new THREE.Quaternion();
const BQ = new THREE.Quaternion();

/** Turn `bone` in world space so that the way from its origin to `from` comes to point at `to`. */
function aim(bone: THREE.Object3D, from: THREE.Vector3, to: THREE.Vector3): void {
  bone.getWorldPosition(W);
  U0.subVectors(from, W).normalize();
  U1.subVectors(to, W).normalize();
  if (U0.lengthSq() < 1e-8 || U1.lengthSq() < 1e-8) return;
  Q.setFromUnitVectors(U0, U1);
  bone.getWorldQuaternion(WQ);
  bone.parent!.getWorldQuaternion(PQ);
  bone.quaternion.copy(PQ.invert().multiply(Q.multiply(WQ)));
  bone.updateWorldMatrix(false, true);
}

/**
 * Bring the `side` wrist of `body` (a Human's root) to `target` (world), the elbow bent toward `pole`
 * (a direction in the body's own frame: +x its left, +y up, +z the way it faces). A target out of reach
 * is reached for as far as the arm goes. Returns how far short the wrist stays (0 when it is there).
 */
export function reachArm(body: THREE.Object3D, side: "L" | "R", target: THREE.Vector3, pole: THREE.Vector3): number {
  const up = body.getObjectByName(`armUp${side}`);
  const low = body.getObjectByName(`armLow${side}`);
  const hand = body.getObjectByName(`hand${side}`);
  if (!up || !low || !hand) return Infinity;
  up.updateWorldMatrix(true, true);
  up.getWorldPosition(S);
  low.getWorldPosition(E);
  hand.getWorldPosition(H);
  const a = S.distanceTo(E);
  const b = E.distanceTo(H);
  D.subVectors(target, S);
  const want = D.length();
  const d = Math.min(a + b - 1e-4, Math.max(Math.abs(a - b) + 1e-4, want));
  D.normalize();
  // the elbow: out of the line shoulder-to-wrist, toward the pole (law of cosines)
  body.getWorldQuaternion(BQ);
  N.copy(pole).applyQuaternion(BQ);
  N.addScaledVector(D, -N.dot(D));
  if (N.lengthSq() < 1e-8) N.set(0, -1, 0).addScaledVector(D, D.y);
  N.normalize();
  const cos = Math.min(1, Math.max(-1, (a * a + d * d - b * b) / (2 * a * d)));
  const sin = Math.sqrt(1 - cos * cos);
  const elbow = T.copy(S).addScaledVector(D, a * cos).addScaledVector(N, a * sin);
  aim(up, E, elbow);
  // then the forearm to the (reachable) target
  low.getWorldPosition(E);
  hand.getWorldPosition(H);
  const tip = TIP.copy(S).addScaledVector(D, d);
  aim(low, H, tip);
  return Math.max(0, want - d);
}
