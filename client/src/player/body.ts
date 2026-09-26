import * as THREE from "three";
import type { FirstPerson } from "./firstPerson";
import { forearm, loadKit, PlayerFigure, type Kit } from "./look";
import { me, onProfile } from "./profile";
import { addCaster, removeCaster } from "../world/lanternLights";
import { isMirrorCamera } from "../world/mirror";
import { psx } from "../retro/psx";
import type { Profile } from "../../../shared/character";

// M7 character: the player's own body in the world, dressed as the profile says (player/look.ts).
// The eye never sees it (the camera is in its head): it draws only for the mirrors (the river, the
// puddles, a mirror in a room) and throws its shadow from a lantern; the first person sees the
// forearms instead (fpArm: the gift in hands.ts, the lantern in lantern.ts), cut from the same body,
// so a woman's blouse sleeve or a man's coat sleeve and cuff show as they are dressed. Other players
// later are PlayerFigures made from the look code the server sends (shared fromAppearanceCode).

type ArmPose = "give" | "lantern";

let body: PlayerBody | null = null;
/** Hands that hold something for as long as they are there (the lantern): dressed again with the body. */
const holders: Array<{ parent: THREE.Object3D; pose: ArmPose; arm: THREE.Object3D | null }> = [];

/** The player's body now, if it is built. */
export const playerBody = (): PlayerBody | null => body;

export class PlayerBody {
  figure: PlayerFigure | null = null;
  private kit: Kit | null = null;
  private last = new THREE.Vector3(NaN, 0, 0);
  private speed = 0;
  /** Dev: draw it for every camera (the dev's shots from outside). */
  showAll = false;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly player: FirstPerson,
  ) {
    body = this;
    void loadKit().then((k) => {
      this.kit = k;
      if (k) this.dress(me());
    });
    onProfile((p) => this.dress(p));
  }

  /** Build the figure for this profile (again). */
  dress(p: Profile): void {
    if (!this.kit) return;
    if (this.figure) {
      removeCaster(this.figure.root);
      this.figure.dispose();
    }
    const f = new PlayerFigure(this.kit, p);
    this.figure = f;
    f.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      m.raycast = () => {}; // never in the way of what the eye picks
      // colour and depth for the mirrors' cameras only: the eye is inside the head
      m.onBeforeRender = (_r, _s, cam) => {
        const show = this.showAll || isMirrorCamera(cam);
        f.material.colorWrite = show;
        f.material.depthWrite = show;
      };
    });
    this.scene.add(f.root);
    addCaster(f.root);
    for (const h of holders) fillHolder(h);
  }

  update(dt: number): void {
    const f = this.figure;
    if (!f) return;
    const p = this.player;
    const away = p.fly || p.swimming || p.climbing || p.riding || p.bikeRiding || p.rowing || !!p.climbLadder;
    f.root.visible = !away;
    if (away) return;
    if (Number.isNaN(this.last.x)) this.last.set(p.x, p.y, p.z);
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.z) / Math.max(dt, 1e-3);
    this.last.set(p.x, p.y, p.z);
    // a moment's smoothing: a step round a post is not a stop
    this.speed += (Math.min(moved, 8) - this.speed) * Math.min(1, dt * 8);
    const crouch = p.crouching;
    f.play(crouch ? "crouch" : this.speed > 0.35 ? "walk" : "idle");
    f.setPace(this.speed);
    f.root.position.set(p.x, p.y - (crouch ? 0.4 : 0), p.z);
    f.root.rotation.y = p.yaw + Math.PI;
    f.update(dt);
  }
}

// ------------------------------------------------------------------ the forearms before the eye

/**
 * The right forearm as the eye sees it for a pose, in an outer group placed like the old stand-ins:
 * "give" the hand palm up, the forearm coming from below and behind toward the thing held out (hands.ts);
 * "lantern" the hand round the lantern's ring, in the lantern's own (small) frame (lantern.ts).
 * Null while the body is not built (the callers keep their own stand-ins).
 */
export function fpArm(pose: ArmPose): THREE.Group | null {
  const f = body?.figure;
  if (!f) return null;
  const arm = forearm(f, "R");
  const outer = new THREE.Group();
  outer.name = `fp_arm_${pose}`;
  outer.add(arm);
  // its own material (the body's is kept from the eye), the same picture, lit like the town
  const mat = psx(new THREE.MeshLambertMaterial({ map: f.texture, side: THREE.DoubleSide }));
  arm.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.material = mat;
      m.raycast = () => {};
      m.renderOrder = 2;
    }
  });
  const up = new THREE.Vector3(0, 1, 0);
  if (pose === "give") {
    // from the grip the forearm runs back toward the eye and a little down; the palm turned up
    const along = new THREE.Vector3(0.08, -0.3, 1).normalize();
    arm.quaternion.setFromUnitVectors(up, along);
    arm.rotateY(-Math.PI / 2);
    arm.position.set(0, -0.04, 0.02);
  } else {
    // the hand closed over the ring, the forearm down and back to the lower right of the view
    const along = new THREE.Vector3(0.42, -0.5, 0.76).normalize();
    arm.quaternion.setFromUnitVectors(up, along);
    arm.rotateY(Math.PI * 0.9);
    arm.position.set(0.0, 0.33, 0.0);
  }
  return outer;
}

function fillHolder(h: { parent: THREE.Object3D; pose: ArmPose; arm: THREE.Object3D | null }): void {
  h.arm?.removeFromParent();
  h.arm = fpArm(h.pose);
  if (h.arm) {
    h.arm.traverse((o) => (o.frustumCulled = false));
    h.parent.add(h.arm);
  }
}

/** A hand that stays on `parent` (the held lantern), dressed again whenever the body is. */
export function holdArm(parent: THREE.Object3D, pose: ArmPose): void {
  const h = { parent, pose, arm: null as THREE.Object3D | null };
  holders.push(h);
  fillHolder(h);
}
