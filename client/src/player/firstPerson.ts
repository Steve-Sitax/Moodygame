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
const SWIM_FAST = 1.6; // Shift: a hard crawl, soon tiring; no faster than a brisk walk
const SWIM_FEET = 1.45; // feet this far under the surface while you swim
const SWIM_EYE = 0.17; // eye this far above it
const CLIMB = 1.1; // m/s up a ladder
const STROKE_LEN = 0.9; // metres per swim stroke

/** Where a carried player stands (feet), the way the carriage points, and how fast it goes (m/s). */
export interface RideAnchor {
  x: number;
  y: number;
  z: number;
  yaw: number;
  speed: number;
}

/** M3h: what is under a velocipede's wheels (game/velocipedes.ts works it out). */
export interface BikeGround {
  kind: "cobble" | "flags" | "earth" | "wood";
  /** On a rail head: the rail's direction (unit x, z), else null. */
  rail: [number, number] | null;
  /** In the wheel ruts of a cart road. */
  rut: boolean;
}
export type BikeEvent = "wobble" | "fall" | "steps" | "bump" | "edge";

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
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 600);
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
    if (this.rideAnchor) return this.updateRide(dt);
    if (this.bikeRiding || this.bikeFallT > 0) return this.updateBike(dt);
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
    const stroke = k("ShiftLeft") || k("ShiftRight") ? SWIM_FAST : SWIM;
    if (len > 0) {
      wx = ((fx * cos + fz * sin) / len) * stroke;
      wz = ((-fx * sin + fz * cos) / len) * stroke;
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

  // ------------------------------------------------------------ carried (M3g: the omnibus)

  /**
   * Carried by something that moves (game/ride.ts: the omnibus's back platform): the feet
   * follow the anchor, walking is off, looking works, and the view turns with the carriage.
   */
  rideAnchor: (() => RideAnchor) | null = null;
  private rideYaw = 0;
  private rideT = 0;

  get riding(): boolean {
    return this.rideAnchor !== null;
  }

  /** Get carried. `faceYaw`: look this way to begin with (world yaw). */
  rideStart(anchor: () => RideAnchor, faceYaw?: number): void {
    const a = anchor();
    this.rideAnchor = anchor;
    this.rideYaw = a.yaw;
    this.swimming = false;
    this.climb = null;
    this.crouching = false;
    this.vel.set(0, 0);
    this.vy = 0;
    if (faceYaw !== undefined) this.yaw = this.lookYaw = faceYaw;
  }

  /** Set down on your feet at (x, z). */
  rideEnd(x: number, z: number): void {
    this.rideAnchor = null;
    this.x = x;
    this.z = z;
    this.y = this.world.groundAt(x, z, RADIUS, 0);
    this.vy = 0;
    this.grounded = true;
    this.eye = EYE;
    this.onLand?.(this.world.surfaceAt(x, z));
  }

  private updateRide(dt: number): void {
    const a = this.rideAnchor!();
    let d = a.yaw - this.rideYaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.rideYaw = a.yaw;
    this.yaw += d;
    this.lookYaw += d;
    this.x = a.x;
    this.z = a.z;
    this.y = a.y;
    this.rideT += dt;
    // the carriage rocks on its springs as the horses trot
    const go = Math.min(1, a.speed / 2);
    const bob = Math.sin(this.rideT * 9.5) * 0.018 * go + Math.sin(this.rideT * 2.3) * 0.01 * go;
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;
    this.camera.position.set(this.x, this.y + EYE + bob, this.z);
    this.camera.rotation.set(this.lookPitch, this.lookYaw, Math.sin(this.rideT * 1.7) * 0.006 * go);
  }

  // ------------------------------------------------------------ on a velocipede (M3h)

  /**
   * On a velocipede (game/velocipedes.ts keeps the machine; this is the rider).
   * W pedals, S brakes (and pushes back when stopped), A/D steer and the view turns
   * with the machine; without A/D it steers toward where you look. Iron tyres: the
   * view rattles on the cobbles. It slows on earth, wobbles on the rails and in the
   * ruts, and may throw you. It will not go down steps or off a quay edge.
   */
  bikeRiding = false;
  /** Speed along the heading, m/s (a little below 0: pushing it back). */
  bikeSpeed = 0;
  /** Where the machine points (a yaw, like `yaw`). */
  bikeHeading = 0;
  /** The front wheel is turned this far (rad, + to the left). */
  bikeSteer = 0;
  /** Metres rolled: the wheels and the pedals turn by it. */
  bikeDist = 0;
  /** Roll of the machine now (lean into a turn, the wobble), rad. */
  bikeLean = 0;
  /** What is under the wheels (set by velocipedes.ts). */
  bikeGround: (x: number, z: number) => BikeGround = () => ({ kind: "cobble", rail: null, rut: false });
  onBikeEvent?: (e: BikeEvent) => void;
  /** Seconds left of getting up after a fall. */
  bikeFallT = 0;
  private bikeWob = 0;
  private bikeT = 0;
  private bikeEventAt = -9;
  private bikeByKeys = false;

  /** Get on: at (x, z), facing the way the machine points. */
  bikeMount(x: number, z: number, heading: number): void {
    this.bikeRiding = true;
    this.bikeSpeed = 0;
    this.bikeHeading = heading;
    this.bikeSteer = 0;
    this.bikeWob = 0;
    this.bikeFallT = 0;
    this.x = x;
    this.z = z;
    this.y = this.world.groundAt(x, z, RADIUS, 0);
    this.yaw = this.lookYaw = heading;
    this.crouching = false;
    this.swimming = false;
    this.climb = null;
    this.vel.set(0, 0);
    this.vy = 0;
    this.grounded = true;
  }

  /** Get off and step beside it. Returns where the machine stands. */
  bikeDismount(): { x: number; z: number; yaw: number } {
    const at = { x: this.x, z: this.z, yaw: this.bikeHeading };
    this.bikeRiding = false;
    this.bikeSpeed = 0;
    this.bikeWob = 0;
    this.bikeStepAside(0.75);
    this.eye = EYE;
    return at;
  }

  private bikeStepAside(d: number): void {
    const h = this.bikeHeading;
    // left of the heading, else the right, else behind it
    for (const [sx, sz] of [
      [-Math.cos(h), Math.sin(h)],
      [Math.cos(h), -Math.sin(h)],
      [Math.sin(h), Math.cos(h)],
    ]) {
      const px = this.x + sx * d;
      const pz = this.z + sz * d;
      if (this.world.isFree(px, pz, RADIUS, this.y) && Math.abs(this.world.groundAt(px, pz, RADIUS, this.y) - this.y) < 0.2) {
        this.x = px;
        this.z = pz;
        return;
      }
    }
  }

  private bikeEvent(e: BikeEvent): void {
    if (e !== "fall" && this.bikeT - this.bikeEventAt < 1.2) return;
    this.bikeEventAt = this.bikeT;
    this.onBikeEvent?.(e);
  }

  /** Thrown off: the machine goes down, you land beside it and get up. */
  private bikeFall(): void {
    this.bikeRiding = false;
    this.bikeSpeed = 0;
    this.bikeWob = 0;
    this.bikeFallT = 1.6;
    this.bikeEvent("fall");
    this.bikeStepAside(0.9);
  }

  private updateBike(dt: number): void {
    const BIKE_EYE = 1.86; // high on the saddle of a boneshaker
    const WHEELBASE = 1.18;
    const BIKE_R = 0.38;
    this.bikeT += dt;
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;
    if (this.bikeFallT > 0) {
      // on the cobbles for a moment, then up again
      this.bikeFallT = Math.max(0, this.bikeFallT - dt);
      const low = Math.min(1, this.bikeFallT / 0.9);
      this.camera.position.set(this.x, this.y + EYE - (EYE - 0.5) * low, this.z);
      this.camera.rotation.set(this.lookPitch, this.lookYaw, 0.45 * low);
      if (this.bikeFallT === 0) this.eye = EYE;
      return;
    }
    const active = (this.locked || this.freeInput || this.testInput) && !this.frozen;
    const k = (c: string) => active && this.keys.has(c);
    const g = this.bikeGround(this.x, this.z);
    const hard = k("ShiftLeft") || k("ShiftRight");
    const top = { cobble: 4.6, flags: 5.0, wood: 4.2, earth: 2.8 }[g.kind] * (hard ? 1.15 : 1);
    const pedal = k("KeyW") || k("ArrowUp");
    const brake = k("KeyS") || k("ArrowDown") || this.frozen;
    let v = this.bikeSpeed;
    if (pedal) v = v < top ? Math.min(top, v + (hard ? 1.9 : 1.4) * dt) : Math.max(top, v - 1.5 * dt);
    else if (brake) v = v > 0 ? Math.max(0, v - 3.6 * dt) : this.frozen ? 0 : Math.max(-0.6, v - 0.8 * dt);
    else v = v > 0 ? Math.max(0, v - (0.22 + (g.kind === "earth" ? 0.9 : 0) + (g.rut ? 0.3 : 0)) * dt) : Math.min(0, v + 1.5 * dt);

    // steering: the keys turn the bar (and the view with the machine); else toward where you look
    let want = 0;
    if (k("KeyA") || k("ArrowLeft")) want += 0.5;
    if (k("KeyD") || k("ArrowRight")) want -= 0.5;
    this.bikeByKeys = want !== 0;
    const off = Math.atan2(Math.sin(this.yaw - this.bikeHeading), Math.cos(this.yaw - this.bikeHeading));
    if (!want && Math.abs(off) < 1.4 && Math.abs(v) > 0.15) want = THREE.MathUtils.clamp(off * 1.4, -0.45, 0.45);
    want /= 1 + Math.abs(v) * 0.15;
    this.bikeSteer += (want - this.bikeSteer) * (1 - Math.exp(-dt * 6));
    this.bikeWob = Math.max(0, this.bikeWob - dt * 0.8);
    const wobble = this.bikeWob * Math.sin(this.bikeT * 13) * 0.2;
    const dh = ((v * Math.tan(this.bikeSteer + wobble)) / WHEELBASE) * dt;
    this.bikeHeading += dh;
    if (this.bikeByKeys) {
      this.yaw += dh;
      this.lookYaw += dh;
    }

    // roll on: never off an edge, never down (or up) a flight of steps
    const fx = -Math.sin(this.bikeHeading);
    const fz = -Math.cos(this.bikeHeading);
    const dx = fx * v * dt;
    const dz = fz * v * dt;
    if (dx || dz) {
      const [nx, nz] = this.world.move(this.x, this.z, dx, dz, BIKE_R, this.y, false);
      const ng = this.world.groundAt(nx, nz, BIKE_R * 0.5, this.y);
      const dir = Math.sign(v);
      if (Math.abs(ng - this.y) > 0.16 || this.world.isWater(nx + fx * 0.7 * dir, nz + fz * 0.7 * dir)) {
        this.bikeEvent(this.world.isWater(nx + fx * 0.9 * dir, nz + fz * 0.9 * dir) || ng < this.y - 1 ? "edge" : "steps");
        v = 0;
      } else {
        const moved = Math.hypot(nx - this.x, nz - this.z);
        const wish = Math.hypot(dx, dz);
        if (moved < wish * 0.4 && Math.abs(v) > 1.2) {
          this.bikeEvent("bump");
          v *= 0.15;
        } else if (moved < wish * 0.9) v *= 1 - Math.min(1, dt * 3); // scraping along a wall
        this.x = nx;
        this.z = nz;
        this.y = ng;
        this.bikeDist += moved * dir;
      }
    }

    // the rails, the ruts and loose earth: a wobble, and at speed maybe a fall
    const sp = Math.abs(v);
    if (sp > 1.2) {
      const q = sp / 4.6;
      let risk = 0;
      let throwOff = 0;
      if (g.rail) {
        const along = Math.abs(fx * g.rail[0] + fz * g.rail[1]);
        if (along > 0.85) {
          risk = 3 * q; // the front wheel runs in the groove beside the rail head
          throwOff = sp > 3.4 ? 0.3 : 0;
        } else risk = along > 0.5 ? 1.5 * q : 0.3 * q;
      }
      if (g.rut) risk = Math.max(risk, 0.35 * q);
      if (g.kind === "earth") risk = Math.max(risk, 0.2 * q);
      if (risk && Math.random() < risk * dt) {
        if ((this.bikeWob > 0.5 && sp > 3) || Math.random() < throwOff) {
          this.bikeSpeed = 0;
          return this.bikeFall();
        }
        this.bikeWob = 1;
        v *= 0.8;
        this.bikeEvent("wobble");
      }
    }
    this.bikeSpeed = v;

    // the view: high on the saddle, the lean into a turn, the wobble, iron tyres on stone
    const lean = -this.bikeSteer * Math.min(1, sp / 3) * 0.22 + this.bikeWob * Math.sin(this.bikeT * 13) * 0.07;
    this.bikeLean = lean;
    const rattle = (g.kind === "cobble" ? 1 : g.kind === "flags" ? 0.6 : g.kind === "earth" ? 0.4 : 0.3) * Math.min(1, sp / 3.5);
    const jy = (Math.random() - 0.5) * 0.014 * rattle;
    const bob = Math.abs(Math.sin(this.bikeDist / 0.46)) * 0.022 * Math.min(1, sp);
    this.camera.position.set(this.x + Math.sin(this.bikeHeading) * 0.08, this.y + BIKE_EYE + jy + bob, this.z + Math.cos(this.bikeHeading) * 0.08);
    this.camera.rotation.set(this.lookPitch + jy * 0.6, this.lookYaw, lean * 0.45);
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
