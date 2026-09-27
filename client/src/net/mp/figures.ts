// M8a multiplayer: the other players' bodies (docs/multiplayer-plan.md 4.3). Each is a PlayerFigure dressed
// from the look code the server sends (shared/character.ts fromAppearanceCode; player/look.ts), with his
// name over his head (a paper tag like the speech bubbles, "away" when his menu is up). The animation comes
// from his mode and his speed: walk, crouch, swim (treading), row, ride; in the air (a jump) he stands in the
// arc. On the ground his feet are put on this PC's own ground at his place (no floating, no sinking on
// stairs); in the air or in the water his own height counts.

import * as THREE from "three";
import { fromAppearanceCode } from "../../../../shared/character";
import { FLAG, MODES, type RosterEntry } from "../../../../shared/mpProtocol";
import { loadKit, PlayerFigure, type Kit } from "../../player/look";
import type { Pose } from "./remotes";

const TAG_M = 40;
const HEAD_M = 1.95;

export interface FigureWorld {
  scene: THREE.Scene;
  groundAt(x: number, z: number, r: number, feet: number): number;
}

export class RemoteFigure {
  figure: PlayerFigure | null = null;
  code = "";
  name = "";
  away = false;
  readonly tag: HTMLDivElement;
  /** Where he is drawn now (world). */
  readonly at = new THREE.Vector3();
  yaw = 0;
  shown = false;
  private stepDist = 0;
  private lastX = NaN;
  private lastZ = NaN;
  /** A footstep this frame (the caller plays it where he is). */
  stepped = false;
  /** M8f: goods in his arms (game/goods.ts puts them on his shoulder and sets this): the carry walk. */
  carrying = false;
  /** The figure's root, for what he carries (game/goods.ts). */
  get root(): THREE.Object3D | null {
    return this.figure?.root ?? null;
  }
  hurry = false;

  constructor(
    readonly id: number,
    private readonly w: FigureWorld,
  ) {
    this.tag = document.createElement("div");
    this.tag.className = "mp-tag";
    this.tag.style.display = "none";
    document.body.appendChild(this.tag);
  }

  dress(kit: Kit, r: RosterEntry): void {
    const label = r.name + (r.away ? " · away" : "");
    if (this.tag.textContent !== label) this.tag.textContent = label;
    this.name = r.name;
    this.away = r.away;
    if (r.code === this.code && this.figure) return;
    const p = fromAppearanceCode(r.code, { first: r.name, last: "" });
    if (!p) return;
    this.figure?.dispose();
    const f = new PlayerFigure(kit, p);
    f.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).raycast = () => {};
    });
    f.root.visible = false;
    this.w.scene.add(f.root);
    this.figure = f;
    this.code = r.code;
  }

  place(p: Pose, dt: number): void {
    const f = this.figure;
    this.stepped = false;
    if (!f) return;
    const mode = MODES[p.mode] ?? "walk";
    const grounded = (p.flags & FLAG.grounded) !== 0;
    let y = p.y;
    if ((mode === "walk" || mode === "crouch") && grounded) {
      const g = this.w.groundAt(p.x, p.z, 0.2, p.y);
      if (Math.abs(g - p.y) < 0.45) y = g;
    }
    this.at.set(p.x, y, p.z);
    this.yaw = p.yaw;
    f.root.visible = mode !== "fly";
    this.shown = f.root.visible;
    const crouch = mode === "crouch";
    f.root.position.set(p.x, y - (crouch ? 0.4 : 0), p.z);
    f.root.rotation.y = p.yaw + Math.PI;
    const speed = p.stale ? 0 : p.speed;
    const inAir = !grounded && (mode === "walk" || mode === "crouch");
    const motion =
      mode === "row" ? "row" : mode === "bike" || mode === "sit" ? "ride" : crouch ? "crouch" : mode === "swim" ? "walk" : inAir ? "idle" : speed > 0.35 && mode !== "ladder" && mode !== "climb" && mode !== "ride" ? "walk" : "idle";
    // (M8f: goods on his shoulder: the dockers' carry clip, walking or standing)
    f.play(this.carrying && (motion === "walk" || motion === "idle") && mode === "walk" ? "carry" : motion);
    f.setPace(mode === "swim" ? Math.max(0.4, speed * 0.6) : speed);
    f.update(dt);
    // footsteps by the distance walked on the ground (as the own body's)
    if (!Number.isNaN(this.lastX) && grounded && (mode === "walk" || mode === "crouch")) {
      this.stepDist += Math.hypot(p.x - this.lastX, p.z - this.lastZ);
      if (this.stepDist > 0.72) {
        this.stepDist = 0;
        this.stepped = true;
      }
    }
    this.hurry = (p.flags & FLAG.hurry) !== 0;
    this.lastX = p.x;
    this.lastZ = p.z;
  }

  hide(): void {
    if (this.figure) this.figure.root.visible = false;
    this.shown = false;
    this.tag.style.display = "none";
  }

  /** The name over his head: on screen, near enough, not behind the camera. */
  drawTag(camera: THREE.Camera, v: THREE.Vector3): void {
    if (!this.shown) {
      this.tag.style.display = "none";
      return;
    }
    const d = camera.position.distanceTo(this.at);
    v.set(this.at.x, this.at.y + HEAD_M + 0.25, this.at.z).project(camera);
    if (d > TAG_M || v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) {
      this.tag.style.display = "none";
      return;
    }
    this.tag.style.display = "";
    const x = (v.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-v.y * 0.5 + 0.5) * window.innerHeight;
    this.tag.style.transform = `translate(-50%, -100%) translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
    this.tag.style.opacity = String(Math.max(0.35, 1 - d / TAG_M));
  }

  dispose(): void {
    this.figure?.dispose();
    this.tag.remove();
  }
}

let kitP: Promise<Kit | null> | null = null;
export const figureKit = (): Promise<Kit | null> => (kitP ??= loadKit());

// the tags' look: a small paper label, as the speech bubbles
{
  const st = document.createElement("style");
  st.textContent = `.mp-tag{position:fixed;left:0;top:0;z-index:40;pointer-events:none;padding:1px 7px 2px;white-space:nowrap;
    font:13px var(--f-print,Georgia,serif);color:#221b15;background:rgba(233,225,203,0.86);border:1px solid rgba(34,27,21,0.45);
    box-shadow:0 1px 3px rgba(0,0,0,0.35)}`;
  document.head.appendChild(st);
}
