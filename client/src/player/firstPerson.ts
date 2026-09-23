import * as THREE from "three";
import type { World, Surface } from "../world/rijnkaai";

// First person walker: WASD, pointer-lock mouse look, head bob, footstep events.

const EYE = 1.62;
const EYE_CROUCH = 1.05;
const JUMP_V = 4.6; // m/s up: clears about 0.55 m, onto a crate with the step
const GRAVITY = 16;
const WALK = 1.55; // m/s, a tired man on wet stones
const HURRY = 2.9;
const RADIUS = 0.32;
const STEP_LEN = 0.72; // metres per footstep
const TURN_SENS = 0.0019;

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
    this.camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.08, 220);
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

  update(dt: number): void {
    const active = (this.locked || this.freeInput) && !this.frozen;
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

    const [nx, nz] = this.world.move(this.x, this.z, this.vel.x * dt, this.vel.y * dt, RADIUS, this.y);
    const moved = Math.hypot(nx - this.x, nz - this.z);
    this.x = nx;
    this.z = nz;
    const ground = this.world.groundAt(this.x, this.z, RADIUS, this.y);
    if (this.grounded && ground < this.y - 0.05) this.grounded = false; // walked off an edge
    if (!this.grounded) {
      this.vy -= GRAVITY * dt;
      this.y += this.vy * dt;
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

  /** Debug / automation: teleport and face a direction. */
  place(x: number, z: number, yaw: number, pitch = 0): void {
    this.x = x;
    this.z = z;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.yaw = this.lookYaw = yaw;
    this.pitch = this.lookPitch = pitch;
  }

  setKey(code: string, down: boolean): void {
    if (down) this.keys.add(code);
    else this.keys.delete(code);
  }
}
