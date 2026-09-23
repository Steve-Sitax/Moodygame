import * as THREE from "three";
import type { World, Surface } from "../world/rijnkaai";
import type { Exit } from "../world/quaysteps";

// First person walker: WASD, pointer-lock mouse look, head bob, footstep events.
// Off an open quay edge you fall into the Schelde and swim (slow, eye just above the
// water, no running); you get out only up an iron ladder or onto the landing of a
// flight of steps: swim up to it and push into it, or press E.

const EYE = 1.62;
const EYE_CROUCH = 1.05;
const JUMP_V = 4.6; // m/s up: clears about 0.55 m, onto a crate with the step
const GRAVITY = 16;
const WALK = 1.55; // m/s, a tired man on wet stones
const HURRY = 3.4;
const RADIUS = 0.32;
const STEP_LEN = 0.72; // metres per footstep
const TURN_SENS = 0.0019;
const SWIM = 1.0; // m/s, heavy clothes in cold water
const SWIM_FEET = 1.45; // feet this far under the surface while you swim
const SWIM_EYE = 0.17; // eye this far above it
const CLIMB = 1.1; // m/s up a ladder
const STROKE_LEN = 0.9; // metres per swim stroke

export class FirstPerson {
  readonly camera: THREE.PerspectiveCamera;
  x = 10;
  z = 12;
  yaw = Math.PI / 2 + 0.35; // look along the quay, water to the left
  pitch = -0.04;
  locked = false;
  /** Allow movement without pointer lock (debug/automation). */
  freeInput = false;
  /** Slower when carrying. Set by the job code. */
  speedFactor = 1;
  /** No walking while a paper is up in front of your face. */
  frozen = false;
  /** Carrying goods: no jumping. Set by the job code. */
  laden = false;
  /** Feet height above the quay. */
  y = 0;
  crouching = false;
  private vy = 0;
  private grounded = true;
  private eye = EYE;
  onStep: (surface: Surface, hurry: boolean) => void = () => {};
  onLand?: (surface: Surface) => void;
  /** In the Schelde. */
  swimming = false;
  /** Climbing out up a ladder or onto a landing (no control meanwhile). */
  get climbing(): boolean {
    return this.climb !== null;
  }
  /** You hit the water (once per fall). */
  onSplash?: (x: number, z: number) => void;
  /** A swim stroke (about every metre). */
  onStroke?: () => void;
  /** Out of the water, on your feet again. */
  onClimbOut?: () => void;
  private climb: { from: [number, number, number]; keys: Array<[number, number, number, number]>; i: number; t: number } | null = null;
  private swimT = 0;
  private strokeDist = 0;
  /** Dev checks only: take keys from setKey() without pointer lock and without running the game clock. */
  testInput = false;

  private keys = new Set<string>();
  private vel = new THREE.Vector2();
  private bobPhase = 0;
  private bobAmp = 0;
  private lastStepSide = 0;
  private lookYaw = this.yaw;
  private lookPitch = this.pitch;

  constructor(
    private readonly world: World,
    private readonly dom: HTMLElement,
  ) {
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 480);
    this.camera.rotation.order = "YXZ";

    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    window.addEventListener("blur", () => this.keys.clear());
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw -= e.movementX * TURN_SENS;
      this.pitch -= e.movementY * TURN_SENS;
      this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch));
    });
  }

  lock(): void {
    const p = this.dom.requestPointerLock() as unknown;
    if (p instanceof Promise) p.catch(() => {});
  }

  /** Dev fly mode: free camera, no walls, no ground (F9 in dev). */
  fly = false;
  flyY = 0;

  private updateFly(dt: number): void {
    const on = this.locked || this.freeInput;
    const k = (c: string) => on && this.keys.has(c);
    const fast = k("ShiftLeft") || k("ShiftRight") ? 45 : 12;
    let fx = 0;
    let fz = 0;
    if (k("KeyW")) fz -= 1;
    if (k("KeyS")) fz += 1;
    if (k("KeyA")) fx -= 1;
    if (k("KeyD")) fx += 1;
    // fly where you look, pitch included
    const cp = Math.cos(this.pitch);
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const fwd = new THREE.Vector3(-sy * cp, Math.sin(this.pitch), -cy * cp);
    const right = new THREE.Vector3(cy, 0, -sy);
    const move = fwd.multiplyScalar(-fz).add(right.multiplyScalar(fx));
    if (k("Space")) move.y += 1;
    if (k("KeyC") || k("ControlLeft")) move.y -= 1;
    if (move.lengthSq() > 0) move.normalize().multiplyScalar(fast * dt);
    this.x += move.x;
    this.z += move.z;
    this.flyY += move.y;
    this.camera.position.set(this.x, this.flyY, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  update(dt: number): void {
    if (this.fly) return this.updateFly(dt);
    if (this.climb) return this.updateClimb(dt);
    if (this.swimming) return this.updateSwim(dt);
    const active = (this.locked || this.freeInput || this.testInput) && !this.frozen;
    const k = (c: string) => active && this.keys.has(c);
    let fx = 0;
    let fz = 0;
    if (k("KeyW") || k("ArrowUp")) fz -= 1;
    if (k("KeyS") || k("ArrowDown")) fz += 1;
    if (k("KeyA") || k("ArrowLeft")) fx -= 1;
    if (k("KeyD") || k("ArrowRight")) fx += 1;
    this.crouching = k("KeyC") || k("ControlLeft");
    const hurry = (k("ShiftLeft") || k("ShiftRight")) && !this.crouching;
    const len = Math.hypot(fx, fz);
    const speed = (hurry ? HURRY : WALK) * this.speedFactor * (this.crouching ? 0.5 : 1);

    // jump and fall
    if (k("Space") && this.grounded && !this.laden && !this.crouching) {
      this.vy = JUMP_V;
      this.grounded = false;
    }

    // wish velocity in world space
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = 0;
    let wz = 0;
    if (len > 0) {
      fx /= len;
      fz /= len;
      wx = (fx * cos + fz * sin) * speed;
      wz = (-fx * sin + fz * cos) * speed;
    }
    // heavy start and stop
    const a = 1 - Math.exp(-dt * (len > 0 ? 6 : 9));
    this.vel.x += (wx - this.vel.x) * a;
    this.vel.y += (wz - this.vel.y) * a;

    const [nx, nz] = this.world.move(this.x, this.z, this.vel.x * dt, this.vel.y * dt, RADIUS, this.y, this.laden);
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx;
    this.z = nz;
    const ground = this.world.groundAt(this.x, this.z, RADIUS, this.y);
    // walked off an edge (down steps and slopes you stay on your feet)
    if (this.grounded && ground < this.y - 0.12) this.grounded = false;
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
      if (this.y <= this.world.waterLevel(this.x, this.z) && this.world.swimmable(this.x, this.z)) {
        this.enterWater();
        return;
      }
      if (this.y <= ground) {
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        this.onLand?.(this.world.surfaceAt(this.x, this.z));
      }
    } else this.y = ground; // step up onto low things
    this.eye += ((this.crouching ? EYE_CROUCH : EYE) - this.eye) * (1 - Math.exp(-dt * 10));

    // head bob follows distance walked: one full cycle = two steps
    const moving = moved / Math.max(dt, 1e-4) > 0.25 && this.grounded;
    this.bobAmp += ((moving ? 1 : 0) - this.bobAmp) * (1 - Math.exp(-dt * 5));
    this.bobPhase += (moved / STEP_LEN) * Math.PI;
    const side = Math.floor(this.bobPhase / Math.PI);
    if (moving && side !== this.lastStepSide) {
      this.onStep(this.world.surfaceAt(this.x, this.z), hurry);
    }
    this.lastStepSide = side;

    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmp * (hurry ? 1.4 : 1);
    const bobX = Math.cos(this.bobPhase) * 0.025 * this.bobAmp;

    // slow turn: the view lags the mouse a little
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;

    this.camera.position.set(this.x + cos * bobX, this.y + this.eye + bobY, this.z - sin * bobX);
    this.camera.rotation.set(this.lookPitch, this.lookYaw, Math.cos(this.bobPhase) * 0.004 * this.bobAmp);
  }

  // ------------------------------------------------------------ in the water

  private enterWater(): void {
    this.swimming = true;
    this.grounded = false;
    this.crouching = false;
    this.vy = Math.max(this.vy, -7); // the plunge, then you come up
    this.vel.multiplyScalar(0.3);
    // clear of the wall you fell from
    const spot = this.world.nearestSwim(this.x, this.z, RADIUS);
    if (spot) [this.x, this.z] = spot;
    this.strokeDist = 0;
    this.onSplash?.(this.x, this.z);
  }

  private updateSwim(dt: number): void {
    const active = (this.locked || this.freeInput || this.testInput) && !this.frozen;
    const k = (c: string) => active && this.keys.has(c);
    let fx = 0;
    let fz = 0;
    if (k("KeyW") || k("ArrowUp")) fz -= 1;
    if (k("KeyS") || k("ArrowDown")) fz += 1;
    if (k("KeyA") || k("ArrowLeft")) fx -= 1;
    if (k("KeyD") || k("ArrowRight")) fx += 1;
    const len = Math.hypot(fx, fz);
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    let wx = 0;
    let wz = 0;
    if (len > 0) {
      wx = ((fx * cos + fz * sin) / len) * SWIM;
      wz = ((-fx * sin + fz * cos) / len) * SWIM;
    }
    // water is thick: slow to get going, slow to stop
    const a = 1 - Math.exp(-dt * (len > 0 ? 2.2 : 1.6));
    this.vel.x += (wx - this.vel.x) * a;
    this.vel.y += (wz - this.vel.y) * a;
    if (!this.world.swimFree(this.x, this.z, RADIUS)) {
      const spot = this.world.nearestSwim(this.x, this.z, RADIUS);
      if (spot) [this.x, this.z] = spot;
    }
    const [nx, nz] = this.world.swimMove(this.x, this.z, this.vel.x * dt, this.vel.y * dt, RADIUS);
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx;
    this.z = nz;

    // up out of the plunge, then float: feet under, eye just above the waves
    const level = this.world.waterLevel(this.x, this.z);
    const floatY = level - SWIM_FEET;
    this.vy += (floatY - this.y) * 14 * dt;
    this.vy *= Math.exp(-dt * 4.5);
    this.y += this.vy * dt;

    // strokes, and a slow bob
    this.swimT += dt;
    this.strokeDist += moved;
    if (this.strokeDist > STROKE_LEN) {
      this.strokeDist = 0;
      this.onStroke?.();
    }
    const speed = moved / Math.max(dt, 1e-4);
    const bob = Math.sin(this.swimT * 1.7) * 0.035 + Math.sin(this.swimT * 5.2) * 0.012 * Math.min(1, speed);

    // out: push into a ladder or a landing, or press E by one
    const exit = this.world.exitNear(this.x, this.z, 1.2);
    if (exit) {
      const push = len > 0 && (wx * -exit.nx + wz * -exit.nz) / SWIM > 0.5;
      if (push || k("KeyE")) return this.startClimb(exit);
    }

    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;
    const eyeY = Math.max(this.y + SWIM_FEET + SWIM_EYE + bob, level + 0.07);
    this.camera.position.set(this.x, eyeY, this.z);
    this.camera.rotation.set(this.lookPitch, this.lookYaw, Math.sin(this.swimT * 1.1) * 0.02);
  }

  private startClimb(e: Exit): void {
    const floatY = this.world.waterLevel(this.x, this.z) - SWIM_FEET;
    const keys: Array<[number, number, number, number]> = [];
    if (e.kind === "ladder") {
      const lx = e.gx - e.nx * 0.12;
      const lz = e.gz - e.nz * 0.12;
      keys.push([lx, floatY, lz, 0.4]);
      keys.push([lx, e.ty + 0.15, lz, (e.ty + 0.15 - floatY) / CLIMB]);
      keys.push([e.tx, e.ty, e.tz, 0.7]);
    } else {
      keys.push([e.gx, floatY, e.gz, 0.35]);
      keys.push([e.gx - e.nx * 0.45, e.ty + 0.1, e.gz - e.nz * 0.45, 1.1]);
      keys.push([e.tx, e.ty, e.tz, 0.5]);
    }
    this.climb = { from: [this.x, this.y, this.z], keys, i: 0, t: 0 };
    this.swimming = false;
    this.vel.set(0, 0);
    this.vy = 0;
  }

  private updateClimb(dt: number): void {
    const c = this.climb!;
    c.t += dt;
    let [x0, y0, z0] = c.from;
    while (c.i < c.keys.length && c.t >= c.keys[c.i][3]) {
      c.t -= c.keys[c.i][3];
      c.from = [c.keys[c.i][0], c.keys[c.i][1], c.keys[c.i][2]];
      [x0, y0, z0] = c.from;
      c.i++;
    }
    if (c.i >= c.keys.length) {
      [this.x, this.y, this.z] = c.from;
      this.climb = null;
      this.grounded = true;
      this.eye = EYE;
      this.onLand?.(this.world.surfaceAt(this.x, this.z));
      this.onClimbOut?.();
    } else {
      const [x1, y1, z1, dur] = c.keys[c.i];
      const k = THREE.MathUtils.smoothstep(c.t / dur, 0, 1);
      this.x = x0 + (x1 - x0) * k;
      this.y = y0 + (y1 - y0) * k;
      this.z = z0 + (z1 - z0) * k;
    }
    // hand over hand: a small pull on every rung
    const pull = c.i === 1 ? Math.abs(Math.sin(c.t * 5.5)) * 0.04 : 0;
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;
    this.camera.position.set(this.x, this.y + EYE - pull, this.z);
    this.camera.rotation.set(this.lookPitch, this.lookYaw, 0);
  }

  /** Debug / automation: teleport and face a direction. */
  place(x: number, z: number, yaw: number, pitch = 0): void {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    this.climb = null;
    this.yaw = this.lookYaw = yaw;
    this.pitch = this.lookPitch = pitch;
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
}
