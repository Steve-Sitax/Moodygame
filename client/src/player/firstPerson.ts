import * as THREE from "three";
import type { World, Surface } from "../world/rijnkaai";
import type { Exit } from "../world/quaysteps";
import { WADE } from "../world/tide";
import { psxUniforms } from "../retro/psx";

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
/**
 * Menus (2026-09-26): the player's own look settings (game/settings.ts, set by menu/apply.ts): mouse
 * speed times TURN_SENS, the mouse's up and down turned round, and how much the head bobs (0: none).
 */
export const look = { sens: 1, invertY: false, bob: 1 };
/** A single mouse move this big (px) that comes out of a calm hand is a browser mistake (see the mousemove handler). */
const SPIKE = 250;
const SWIM = 1.0; // m/s, heavy clothes in cold water
const SWIM_FAST = 1.6; // Shift: a hard crawl, soon tiring; no faster than a brisk walk
const SWIM_FEET = 1.45; // feet this far under the surface while you swim
const SWIM_EYE = 0.17; // eye this far above it
const CLIMB = 1.1; // m/s up a ladder
const STROKE_LEN = 0.9; // metres per swim stroke

/** Walking in a carriage (its frame, origin under the rear axle): where you stand, where you may step, the floor. */
export interface RideWalk {
  x: number;
  z: number;
  walk(fx: number, fz: number, x: number, z: number): [number, number];
  floor(x: number, z: number): number;
  /** M6 landmark interiors: a tall hall's pace (m/s), eye height and footstep sound (default: a low saloon, 1 m/s, stooping, wood). */
  pace?: number;
  eye?: number;
  surface?: Surface;
}

/** A ladder you climb (M3g: a portal crane's): where you hang, face, step off at the top and at the foot. */
export interface ClimbLadder {
  hang: { x: number; z: number };
  foot: { x: number; z: number };
  head: { x: number; z: number };
  /** The player's yaw facing the rungs. */
  face: number;
  /** Feet heights: the ground, the deck at the top. */
  bottom: number;
  top: number;
  done?: (at: "top" | "foot") => void;
}

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

/** M3j: a rowing boat's size and where the rower sits (boat frame: bow along +z, y up from the waterline). */
export interface RowHull {
  /** Half the length of the hull on the water, and its half beam (m). */
  half: number;
  beam: number;
  /** The rower's seat: z along the boat, y over the waterline. */
  seatZ: number;
  seatY: number;
  /** A little slower for a flat punt. */
  speed: number;
}

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
  /** M7 night: slower when dead tired (game/day.ts sets it from the sleep need); apart from the load. */
  fatigue = 1;
  /** No walking while a paper is up in front of your face. */
  frozen = false;
  /** Carrying goods: no jumping. Set by the job code. */
  laden = false;
  /**
   * M6 handcart: while Jef pushes a cart, every step is checked for the whole cart: from (x, z)
   * the walk rules allow (nx, nz); this returns where he may go (game/handcart.ts), and turns the cart.
   */
  cartStep: ((x: number, z: number, nx: number, nz: number, dt: number) => [number, number]) | null = null;
  /** Feet height above the quay. */
  y = 0;
  crouching = false;
  /** M9 theft: running now (Shift and moving): no pocket is picked at a run, and one who half saw a theft is sure. */
  hurrying = false;
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
  /** The mouse (see the mousemove handler): when the lock came, the size of the recent moves. */
  private lockedAt = -Infinity;
  private recentMove = 0;
  private recentAt = 0;
  /** The last frame hung (main.ts): the mouse moves until the next frame are dropped. */
  stalled = false;
  /** A dialog is up: the mouse moves the ink cursor (game/cursor.ts), not the look. Set by main.ts. */
  mouseHeld: () => boolean = () => false;

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
    document.addEventListener("pointerlockchange", (e) => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) this.keys.clear();
      this.lockedAt = e.timeStamp;
    });
    // The look follows the hand, not the browser's mistakes (2026-09-26, "the mouse jerks to a direction"):
    //  - just after the lock the browser moves the hidden cursor itself: those first moves are not the hand's;
    //  - after a frame that hung (main.ts sets `stalled`), the moves piled up meanwhile come at once: dropped;
    //  - Chrome on Windows now and then reports one move far bigger than the ones round it: dropped. A real
    //    flick grows over several moves, so only a lone jump is left out (its size is still remembered).
    document.addEventListener("mousemove", (e) => {
      if (!this.locked || this.mouseHeld()) return;
      const m = Math.hypot(e.movementX, e.movementY);
      const before = this.recentMove * Math.exp(-Math.max(0, e.timeStamp - this.recentAt) / 150);
      this.recentMove = Math.max(m, before);
      this.recentAt = e.timeStamp;
      if (e.timeStamp - this.lockedAt < 100 || this.stalled) return;
      if (m > SPIKE && m > 5 * Math.max(before, 20)) return;
      this.yaw -= e.movementX * TURN_SENS * look.sens;
      this.pitch -= e.movementY * TURN_SENS * look.sens * (look.invertY ? -1 : 1);
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
    if (this.climbLadder) return this.updateClimbLadder(dt);
    if (this.bikeRiding || this.bikeFallT > 0) return this.updateBike(dt);
    if (this.rowing) return this.updateRow(dt);
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
    this.hurrying = hurry && len > 0;
    const speed = (hurry ? HURRY : WALK) * this.speedFactor * this.fatigue * (this.crouching ? 0.5 : 1);

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

    let [nx, nz] = this.world.move(this.x, this.z, this.vel.x * dt, this.vel.y * dt, RADIUS, this.y, this.laden);
    // M6 handcart: pushing a cart, the cart must fit where the step takes it (game/handcart.ts)
    if (this.cartStep) {
      [nx, nz] = this.cartStep(this.x, this.z, nx, nz, dt);
      if (nx === this.x && nz === this.z) this.vel.set(0, 0);
    }
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
    // M6 tides: down a flight of steps into deep water (or the tide came up round you): swim
    if (this.grounded && this.y < this.world.waterLevel(this.x, this.z) - WADE && this.world.swimmable(this.x, this.z)) {
      this.enterWater();
      return;
    }
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

    const bobY = -Math.abs(Math.sin(this.bobPhase)) * 0.045 * this.bobAmp * (hurry ? 1.4 : 1) * look.bob;
    const bobX = Math.cos(this.bobPhase) * 0.025 * this.bobAmp * look.bob;

    // slow turn: the view lags the mouse a little
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;

    this.camera.position.set(this.x + cos * bobX, this.y + this.eye + bobY, this.z - sin * bobX);
    this.camera.rotation.set(this.lookPitch, this.lookYaw, Math.cos(this.bobPhase) * 0.004 * this.bobAmp * look.bob);
  }

  // ------------------------------------------------------------ in the water

  private enterWater(): void {
    this.swimming = true;
    this.grounded = false;
    this.crouching = false;
    this.hurrying = false;
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

  /**
   * Fixes 2026-09-24 (Steve: stuck at the top of a ladder): the spot at the top can hold a crane's leg
   * or a wagon now. Step off beside it: a little further in, or to a side, wherever you can stand.
   */
  private climbSpot(e: Exit): [number, number] {
    for (const d of [0, 0.4, 0.8, 1.2])
      for (const s of [0, 0.6, -0.6, 1.2, -1.2]) {
        const x = e.tx - e.nx * d - e.nz * s;
        const z = e.tz - e.nz * d + e.nx * s;
        if (this.world.standFree(x, z, RADIUS, e.ty)) return [x, z];
      }
    return [e.tx, e.tz]; // nowhere free: world.move lets you walk out of what stands there
  }

  private startClimb(e: Exit): void {
    const floatY = this.world.waterLevel(this.x, this.z) - SWIM_FEET;
    const keys: Array<[number, number, number, number]> = [];
    const [tx, tz] = this.climbSpot(e);
    if (e.kind === "ladder") {
      const lx = e.gx - e.nx * 0.12;
      const lz = e.gz - e.nz * 0.12;
      keys.push([lx, floatY, lz, 0.4]);
      keys.push([lx, e.ty + 0.15, lz, (e.ty + 0.15 - floatY) / CLIMB]);
      keys.push([tx, e.ty, tz, 0.7]);
    } else {
      keys.push([e.gx, floatY, e.gz, 0.35]);
      keys.push([e.gx - e.nx * 0.45, e.ty + 0.1, e.gz - e.nz * 0.45, 1.1]);
      keys.push([tx, e.ty, tz, 0.5]);
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
      // M7 boats: a climb down a ladder into a boat ends in the boat (game/rowing.ts sits him down)
      const then = this.climbThen;
      this.climbThen = null;
      if (then) return then();
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

  // ------------------------------------------------------------ up and down a ladder (M3g: the portal cranes)

  /**
   * On a ladder (game/craneclimb.ts): W climbs, S goes down, you face the rungs (look about a
   * little). At the top you step off onto the deck; at the bottom onto the ground.
   */
  climbLadder: ClimbLadder | null = null;
  private climbLadderRung = 0;

  /** Onto the rungs: from the foot, or (fromTop) from the deck at the head. */
  climbLadderStart(l: ClimbLadder, fromTop = false): void {
    this.climbLadder = l;
    this.x = l.hang.x;
    this.z = l.hang.z;
    this.y = fromTop ? l.top - 1.2 : l.bottom + 0.05;
    this.vy = 0;
    this.vel.set(0, 0);
    this.crouching = false;
    this.hurrying = false;
    this.yaw = this.lookYaw = l.face;
    this.pitch = Math.max(-0.4, Math.min(0.6, this.pitch));
    this.climbLadderRung = this.y;
  }

  /** A key held now (the ladder: push into it to start climbing). */
  pressing(code: string): boolean {
    return (this.locked || this.freeInput || this.testInput) && !this.frozen && this.keys.has(code);
  }

  private updateClimbLadder(dt: number): void {
    const l = this.climbLadder!;
    const k = (c: string) => this.pressing(c);
    const v = (k("KeyW") || k("ArrowUp") ? 1 : 0) - (k("KeyS") || k("ArrowDown") ? 1 : 0);
    this.y += v * 0.9 * dt;
    this.x = l.hang.x;
    this.z = l.hang.z;
    if (Math.abs(this.y - this.climbLadderRung) > 0.35) {
      this.climbLadderRung = this.y;
      this.onStep("wood", false);
    }
    if (this.y >= l.top - 1.0) {
      // over the edge and onto the deck
      this.climbLadder = null;
      this.x = l.head.x;
      this.z = l.head.z;
      this.y = l.top;
      this.grounded = true;
      this.eye = EYE;
      this.onLand?.("wood");
      l.done?.("top");
    } else if (this.y <= l.bottom && v < 0) {
      this.climbLadder = null;
      this.x = l.foot.x;
      this.z = l.foot.z;
      this.y = l.bottom;
      this.grounded = true;
      this.eye = EYE;
      this.onLand?.(this.world.surfaceAt(this.x, this.z));
      l.done?.("foot");
    }
    // face the rungs: the view turns only so far either way
    let d = this.yaw - l.face;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.yaw = l.face + Math.max(-1.1, Math.min(1.1, d));
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;
    const pull = v ? Math.abs(Math.sin(this.y * 9)) * 0.03 : 0;
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
  /** Walking about inside the carriage (M3g: the omnibus), in its own frame; or sitting (a seat, body frame). */
  rideWalk: RideWalk | null = null;
  rideSeat: { x: number; y: number; z: number; eye: number } | null = null;
  private rideStepDist = 0;
  private rideT = 0;

  get riding(): boolean {
    return this.rideAnchor !== null;
  }

  /** Get carried. `faceYaw`: look this way to begin with (world yaw). */
  rideStart(anchor: () => RideAnchor, faceYaw?: number, walk?: RideWalk): void {
    const a = anchor();
    this.rideAnchor = anchor;
    this.rideWalk = walk ?? null;
    this.rideSeat = null;
    this.rideYaw = a.yaw;
    this.swimming = false;
    this.climb = null;
    this.crouching = false;
    this.hurrying = false;
    this.vel.set(0, 0);
    this.vy = 0;
    if (faceYaw !== undefined) this.yaw = this.lookYaw = faceYaw;
  }

  /** Set down on your feet at (x, z). */
  rideEnd(x: number, z: number): void {
    this.rideAnchor = null;
    this.rideWalk = null;
    this.rideSeat = null;
    this.x = x;
    this.z = z;
    this.y = this.world.groundAt(x, z, RADIUS, this.world.baseAt(x, z));
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
    this.rideT += dt;
    let eye = EYE;
    const w = this.rideWalk;
    if (w) {
      // walking about in the carriage (its own frame), or sitting on a seat
      let lx = w.x;
      let lz = w.z;
      let ly = w.floor(w.x, w.z);
      eye = w.eye ?? 1.52; // a low saloon: you stoop a little
      if (this.rideSeat) {
        lx = this.rideSeat.x;
        ly = this.rideSeat.y;
        lz = this.rideSeat.z;
        eye = this.rideSeat.eye;
      } else {
        const k = (c: string) => this.pressing(c);
        let fx = 0;
        let fz = 0;
        if (k("KeyW") || k("ArrowUp")) fz -= 1;
        if (k("KeyS") || k("ArrowDown")) fz += 1;
        if (k("KeyA") || k("ArrowLeft")) fx -= 1;
        if (k("KeyD") || k("ArrowRight")) fx += 1;
        const len = Math.hypot(fx, fz);
        if (len > 0) {
          const sy = Math.sin(this.yaw);
          const cy = Math.cos(this.yaw);
          const pace = (w.pace ?? 1.0) * (w.pace && (k("ShiftLeft") || k("ShiftRight")) ? 1.6 : 1);
          const wx = ((fx * cy + fz * sy) / len) * pace * dt;
          const wz = ((-fx * sy + fz * cy) / len) * pace * dt;
          // world to the carriage's frame
          const co = Math.cos(a.yaw);
          const si = Math.sin(a.yaw);
          const [nx, nz] = w.walk(w.x, w.z, w.x + wx * co - wz * si, w.z + wx * si + wz * co);
          this.rideStepDist += Math.hypot(nx - w.x, nz - w.z);
          w.x = lx = nx;
          w.z = lz = nz;
          ly = w.floor(nx, nz);
          if (this.rideStepDist > STEP_LEN) {
            this.rideStepDist = 0;
            this.onStep(w.surface ?? "wood", false);
          }
        }
      }
      const co = Math.cos(a.yaw);
      const si = Math.sin(a.yaw);
      this.x = a.x + lx * co + lz * si;
      this.z = a.z - lx * si + lz * co;
      this.y = a.y + ly;
    } else {
      this.x = a.x;
      this.z = a.z;
      this.y = a.y;
    }
    // the carriage rocks on its springs as the horses trot
    const go = Math.min(1, a.speed / 2);
    const bob = Math.sin(this.rideT * 9.5) * 0.018 * go + Math.sin(this.rideT * 2.3) * 0.01 * go;
    const s = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s;
    this.lookPitch += (this.pitch - this.lookPitch) * s;
    this.camera.position.set(this.x, this.y + eye + bob, this.z);
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
    this.y = this.world.groundAt(x, z, RADIUS, this.world.baseAt(x, z));
    this.yaw = this.lookYaw = heading;
    this.crouching = false;
    this.hurrying = false;
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

  // ------------------------------------------------------------ in a rowing boat (M3j)

  /**
   * In a rowing boat (game/rowing.ts keeps the boat, its oars and the rules of the water; this
   * is the rower). You sit on the aft thwart FACING THE BOW and push the oars: a real rower
   * faces aft and looks over his shoulder, but in a first-person game you must see the bridges,
   * the ships and the landings ahead of you, and the mouse still looks all round. W pulls
   * (both oars), S backs water, A/D pull one oar harder (with no W the other backs: the boat
   * turns on the spot), Shift a harder, faster stroke. The boat surges with each stroke, bobs on
   * the waves (waveAt), drifts with the current, and stops against walls and hulls.
   * x, z are the boat's middle; `rowHeading` is where its bow points (a boat yaw: bow = (sin, cos)).
   */
  rowing = false;
  rowHeading = 0;
  /** Speed along the heading, m/s. */
  rowSpeed = 0;
  /** Turn rate, rad/s (+ turns to the left). */
  rowTurn = 0;
  /** Stroke phase 0..1: the drive (blades in the water) is 0..0.45, then the recovery. */
  rowPhase = 0;
  /** How hard each oar works now, -1 (backing) .. 1 (pulling): port (left), starboard (right). */
  rowPort = 0;
  rowStarboard = 0;
  /** A hard stroke (Shift). */
  rowHard = false;
  /** The boat on the water now: height of its waterline, pitch (bow up +) and roll, rad. */
  rowY = 0;
  rowPitch = 0;
  rowRoll = 0;
  rowHull: RowHull = { half: 2.4, beam: 0.72, seatZ: -0.43, seatY: 0.38, speed: 1 };
  /** Is this water free for the hull (set by game/rowing.ts): walls, hulls, piles, the lock, low bridges. */
  rowFree: (x: number, z: number, r: number) => boolean = () => true;
  /** The current here (m/s, x and z). */
  rowCurrent: (x: number, z: number) => [number, number] = () => [0, 0];
  /** A stroke caught the water (for the sound; hard strokes count on the server). */
  onRowStroke?: (hard: boolean) => void;
  /** Ran into something at `speed` m/s (a wall, a moored hull, a pile). No harm done. */
  onRowBump?: (speed: number) => void;
  private rowT = 0;
  private rowCaught = false;

  /** Sit down in a boat whose middle is at (x, z), bow along `heading`; look ahead. */
  rowStart(x: number, z: number, heading: number, hull: RowHull): void {
    this.rowing = true;
    this.rowHull = hull;
    this.x = x;
    this.z = z;
    this.rowHeading = heading;
    this.rowSpeed = 0;
    this.rowTurn = 0;
    this.rowPort = this.rowStarboard = 0;
    this.rowPhase = 0;
    this.rowY = this.world.waterLevel(x, z);
    this.y = this.rowY + hull.seatY;
    this.yaw = this.lookYaw = heading + Math.PI;
    this.pitch = this.lookPitch = -0.12;
    this.swimming = false;
    this.climb = null;
    this.crouching = false;
    this.hurrying = false;
    this.vel.set(0, 0);
    this.vy = 0;
  }

  /** Where the seat is now (world x, z). */
  rowSeat(): [number, number] {
    const z = this.rowHull.seatZ;
    return [this.x + Math.sin(this.rowHeading) * z, this.z + Math.cos(this.rowHeading) * z];
  }

  /** M7 boats: what happens when the climb in hand ends (instead of standing on the ground there). */
  private climbThen: (() => void) | null = null;
  /**
   * M7 boats: climb from where he stands through the key points [x, y (feet), z, seconds] (down a quay
   * ladder, over a gunwale), then `then` (game/rowing.ts: sit down in the boat). Looks where he looks.
   */
  climbTo(keys: Array<[number, number, number, number]>, then: () => void): void {
    this.climb = { from: [this.x, this.y, this.z], keys, i: 0, t: 0 };
    this.climbThen = then;
    this.swimming = false;
    this.crouching = false;
    this.hurrying = false;
    this.vel.set(0, 0);
    this.vy = 0;
  }

  /** Stand up and step out onto a landing, the foot of a ladder, a pontoon (game/rowing.ts found it). */
  rowStepOut(e: Exit): void {
    const [sx, sz] = this.rowSeat();
    this.rowing = false;
    this.x = sx;
    this.z = sz;
    this.y = this.rowY + this.rowHull.seatY;
    const keys: Array<[number, number, number, number]> = [];
    if (e.kind === "ladder") {
      const lx = e.gx - e.nx * 0.12;
      const lz = e.gz - e.nz * 0.12;
      keys.push([lx, this.y - 0.4, lz, 0.6]);
      keys.push([lx, e.ty + 0.15, lz, Math.max(0.3, (e.ty + 0.15 - this.y + 0.4) / CLIMB)]);
      keys.push([e.tx, e.ty, e.tz, 0.7]);
    } else {
      keys.push([e.gx, Math.max(this.y - 0.3, e.ty - 0.4), e.gz, 0.5]);
      keys.push([e.tx, e.ty, e.tz, 0.6]);
    }
    this.climb = { from: [this.x, this.y - 0.5, this.z], keys, i: 0, t: 0 };
    this.vel.set(0, 0);
    this.vy = 0;
    this.rowSpeed = 0;
  }

  /** Over the side into the water, beside the boat. */
  rowOverboard(): void {
    const h = this.rowHeading;
    const [sx, sz] = this.rowSeat();
    this.rowing = false;
    this.x = sx;
    this.z = sz;
    const side = this.rowHull.beam + 0.55;
    for (const s of [1, -1]) {
      const px = sx + Math.cos(h) * side * s;
      const pz = sz - Math.sin(h) * side * s;
      if (this.world.swimFree(px, pz, RADIUS)) {
        this.x = px;
        this.z = pz;
        break;
      }
    }
    this.y = this.world.waterLevel(this.x, this.z) - 0.3;
    this.vy = -1.5;
    this.enterWater();
  }

  /** Turning against a wall: a small push away from it (sideways first) that lets the turn go on, or null. */
  private rowFendOff(h: number): [number, number] | null {
    const fx = Math.sin(this.rowHeading);
    const fz = Math.cos(this.rowHeading);
    for (const [dx, dz] of [[fz, -fx], [-fz, fx], [-fx, -fz], [fx, fz]]) {
      const x = this.x + dx * 0.03;
      const z = this.z + dz * 0.03;
      if (!this.rowBlocked(x, z, h)) return [x, z];
    }
    return null;
  }

  private rowBlocked(x: number, z: number, h: number): boolean {
    const hl = this.rowHull.half - this.rowHull.beam * 0.6;
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    for (const k of [-1, 0, 1]) if (!this.rowFree(x + fx * hl * k, z + fz * hl * k, this.rowHull.beam)) return true;
    return false;
  }

  private updateRow(dt: number): void {
    const ROW_DRIVE = 0.45;
    const active = (this.locked || this.freeInput || this.testInput) && !this.frozen;
    const k = (c: string) => active && this.keys.has(c);
    this.rowT += dt;
    const fwd = k("KeyW") || k("ArrowUp");
    const back = k("KeyS") || k("ArrowDown");
    const left = k("KeyA") || k("ArrowLeft");
    const right = k("KeyD") || k("ArrowRight");
    this.rowHard = (k("ShiftLeft") || k("ShiftRight")) && (fwd || back || left || right);
    // which oar does what: turning left = the starboard (right) oar harder, the port oar lighter or backing
    let port = 0;
    let stbd = 0;
    if (fwd) port = stbd = 1;
    else if (back) port = stbd = -1;
    if (left && !right) {
      stbd = fwd || !back ? 1 : -0.4;
      port = fwd ? 0.35 : back ? -1 : -0.7;
    } else if (right && !left) {
      port = fwd || !back ? 1 : -0.4;
      stbd = fwd ? 0.35 : back ? -1 : -0.7;
    }
    const ease = 1 - Math.exp(-dt * 5);
    this.rowPort += (port - this.rowPort) * ease;
    this.rowStarboard += (stbd - this.rowStarboard) * ease;
    const working = Math.abs(port) + Math.abs(stbd) > 0;

    // the stroke: faster and harder with Shift; let go, and it runs on to the end of the stroke
    const rate = this.rowHard ? 1 / 1.35 : 1 / 1.8;
    if (working || this.rowPhase > 0) {
      const was = this.rowPhase;
      this.rowPhase = (this.rowPhase + rate * dt) % 1;
      if (!working && this.rowPhase < was) this.rowPhase = 0; // the stroke is done: rest
      if (this.rowPhase < ROW_DRIVE && !this.rowCaught && working) {
        this.rowCaught = true;
        this.onRowStroke?.(this.rowHard);
      }
      if (this.rowPhase >= ROW_DRIVE) this.rowCaught = false;
    }
    // thrust: steady plus a surge in the drive (mean 1 over a stroke), in m/s^2
    const inDrive = this.rowPhase < ROW_DRIVE && working;
    const surge = inDrive ? Math.sin((Math.PI * this.rowPhase) / ROW_DRIVE) / 0.2865 : 0;
    const K = (this.rowHard ? 1.5 : 0.9) * this.rowHull.speed;
    const drive = working ? K * (0.6 + 0.4 * surge) : 0;
    const both = (this.rowPort + this.rowStarboard) / 2;
    const diff = (this.rowStarboard - this.rowPort) / 2;
    let v = this.rowSpeed;
    v += drive * (both >= 0 ? both : both * 0.65) * dt;
    v -= (0.08 * v + 0.35 * v * Math.abs(v)) * dt;
    let w = this.rowTurn;
    w += (working ? 0.55 + 0.45 * surge : 0) * 0.95 * diff * dt;
    w -= w * 1.8 * dt;
    w -= w * Math.min(1, Math.abs(v) * 0.15) * dt; // a boat under way turns a little less
    // the current on the river; in a gale the wind pushes the bow about
    const [cx, cz] = this.rowCurrent(this.x, this.z);
    const sea = psxUniforms.uSea.value;
    if (sea > 2.5) w += Math.sin(this.rowT * 0.37) * 0.04 * (sea - 2.5) * dt;

    const h1 = this.rowHeading + w * dt;
    let nx = this.x + (Math.sin(h1) * v + cx) * dt;
    let nz = this.z + (Math.cos(h1) * v + cz) * dt;
    let h = h1;
    if (this.rowBlocked(nx, nz, h)) {
      const hit = Math.abs(v);
      const bx = -Math.sin(this.rowHeading) * 0.04 * Math.sign(v || 1);
      const bz = -Math.cos(this.rowHeading) * 0.04 * Math.sign(v || 1);
      // turn on the spot; slide along a wall; turn while easing off it; else stop and come back a little
      // (the rub takes off the same speed a second at any frame rate: the factors are per 60th of a second)
      const fend = Math.abs(w) > 0.03 ? this.rowFendOff(h1) : null;
      if (!this.rowBlocked(this.x, this.z, h1)) {
        nx = this.x;
        nz = this.z;
        v *= Math.pow(0.5, dt * 60);
      } else if (fend) {
        // an oar against the wall: the boat is pushed off it as it turns
        [nx, nz] = fend;
        v *= Math.pow(0.5, dt * 60);
      } else if (!this.rowBlocked(nx, this.z, this.rowHeading)) {
        nz = this.z;
        h = this.rowHeading;
        v *= Math.pow(0.6, dt * 60);
      } else if (!this.rowBlocked(this.x, nz, this.rowHeading)) {
        nx = this.x;
        h = this.rowHeading;
        v *= Math.pow(0.6, dt * 60);
      } else if (!this.rowBlocked(this.x + bx, this.z + bz, h1)) {
        nx = this.x + bx;
        nz = this.z + bz;
        v = 0;
      } else {
        nx = this.x;
        nz = this.z;
        h = this.rowHeading;
        v = -0.2 * v;
        w *= 0.3;
      }
      if (hit > 0.45) this.onRowBump?.(hit);
    }
    const dh = h - this.rowHeading;
    this.x = nx;
    this.z = nz;
    this.rowHeading = h;
    this.rowSpeed = v;
    this.rowTurn = w;
    // the view turns with the boat
    this.yaw += dh;
    this.lookYaw += dh;

    // on the waves: heave from the water under the middle, pitch and roll from bow, stern and sides
    const fx = Math.sin(h);
    const fz = Math.cos(h);
    const L = this.rowHull.half * 0.8;
    const B = this.rowHull.beam;
    const mid = this.world.waterLevel(this.x, this.z);
    const bow = this.world.waterLevel(this.x + fx * L, this.z + fz * L);
    const stern = this.world.waterLevel(this.x - fx * L, this.z - fz * L);
    const portY = this.world.waterLevel(this.x + fz * B, this.z - fx * B);
    const stbdY = this.world.waterLevel(this.x - fz * B, this.z + fx * B);
    const e = 1 - Math.exp(-dt * 4);
    this.rowY += ((mid * 2 + bow + stern) / 4 - this.rowY) * e;
    // the bow lifts a little on each drive; the boat rolls on the swell
    this.rowPitch += (Math.atan2(bow - stern, 2 * L) * 0.8 + surge * 0.004 - this.rowPitch) * e;
    this.rowRoll += (Math.atan2(portY - stbdY, 2 * B) * 0.7 + Math.sin(this.rowT * 1.9) * 0.008 * Math.min(sea, 2.5) - this.rowRoll) * e;
    this.y = this.rowY + this.rowHull.seatY;

    // the eye: seated, 0.78 m over the thwart; carried by the boat's pitch and roll
    const EYE_SEATED = 0.78;
    const sz = this.rowHull.seatZ;
    const lean = inDrive ? Math.sin((Math.PI * this.rowPhase) / ROW_DRIVE) * 0.07 * Math.sign(both || 1) : 0; // lean into the push
    const ey = this.rowY + this.rowHull.seatY + EYE_SEATED + sz * Math.sin(this.rowPitch);
    const ez = sz + lean;
    const s2 = 1 - Math.exp(-dt * 22);
    this.lookYaw += (this.yaw - this.lookYaw) * s2;
    this.lookPitch += (this.pitch - this.lookPitch) * s2;
    const side = Math.sin(this.rowRoll) * EYE_SEATED;
    this.camera.position.set(this.x + fx * ez - fz * side, ey, this.z + fz * ez + fx * side);
    // the horizon tilts with the boat: its roll and pitch, as seen from where you look
    const rel = this.lookYaw - (h + Math.PI);
    this.camera.rotation.set(
      this.lookPitch + this.rowPitch * Math.cos(rel) - this.rowRoll * Math.sin(rel) * 0.5,
      this.lookYaw,
      -this.rowRoll * Math.cos(rel) + this.rowPitch * Math.sin(rel) * 0.5,
    );
  }

  /** Debug / automation: teleport and face a direction. */
  place(x: number, z: number, yaw: number, pitch = 0): void {
    this.rowing = false;
    this.x = x;
    this.z = z;
    // the ground floor there, not 0: on a raised floor (the Steen's courtyard and museum at 2.2 m) feet at 0
    // found no floor and Jef fell into the void, at the museum's closing too (walkthrough west, 2026-09-25)
    this.y = this.world.baseAt(x, z);
    this.vy = 0;
    this.grounded = true;
    this.swimming = false;
    this.climb = null;
    this.yaw = this.lookYaw = yaw;
    this.pitch = this.lookPitch = pitch;
  }

  /**
   * M7 save and pause: put Jef back as a save had him: the spot, the height he stood at (a deck, a
   * stair: kept when there is something under him there, else the ground), the facing, in the water.
   */
  restorePose(s: { x: number; z: number; y: number; yaw: number; pitch: number; swimming?: boolean; crouching?: boolean }): void {
    this.place(s.x, s.z, s.yaw, s.pitch);
    if (s.swimming) {
      this.swimming = true;
      this.grounded = false;
      this.y = s.y;
      this.strokeDist = 0;
    } else if (Math.abs(s.y - this.y) < 3.5) {
      const floor = this.world.baseAt(s.x, s.z);
      this.y = Math.max(floor, s.y);
    }
    this.crouching = !!s.crouching;
    this.camera.position.set(this.x, this.y + this.eye, this.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
}
