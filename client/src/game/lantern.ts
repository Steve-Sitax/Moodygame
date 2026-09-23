import * as THREE from "three";
import { psx, psxUniforms } from "../retro/psx";
import type { FirstPerson } from "../player/firstPerson";

// A lantern to carry (M3h). A tin hand lantern with horn panes and a tallow
// candle: bought from a chandler, or taken from where people work (a dock gang's
// lantern by the door, a stall's lamp, the lock men's lantern; town/deeds.ts). In
// the pockets it is an item; held up (L) it shows in your right hand at the lower
// right of the view and throws a warm light round you: a real point light (always
// in the scene, so the light count never changes and no shader is rebuilt), and
// the fog glow of one of the six psx lamp slots, borrowed from the gas lamp
// farthest away. People see you coming (the theft rules count it).

const WARM = 0xffb468;

/** The lantern's parts, shared by the one in your hand and the ones standing about. */
let parts: {
  tin: THREE.Material;
  horn: THREE.MeshBasicMaterial;
  hornDark: THREE.MeshBasicMaterial;
  halo: THREE.SpriteMaterial;
  geo: { base: THREE.BufferGeometry; body: THREE.BufferGeometry; cap: THREE.BufferGeometry; vent: THREE.BufferGeometry; ring: THREE.BufferGeometry; bar: THREE.BufferGeometry };
} | null = null;

function lanternParts() {
  if (parts) return parts;
  const c = document.createElement("canvas");
  c.width = c.height = 32;
  const g = c.getContext("2d")!;
  const grd = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.3, "rgba(255,255,255,0.4)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  parts = {
    tin: psx(new THREE.MeshLambertMaterial({ color: 0x3a3632 })),
    horn: new THREE.MeshBasicMaterial({ color: 0xffc27a, fog: false }),
    hornDark: new THREE.MeshBasicMaterial({ color: 0x6a5a44 }),
    halo: new THREE.SpriteMaterial({ map: tex, color: WARM, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5, fog: false }),
    geo: {
      base: new THREE.CylinderGeometry(0.068, 0.072, 0.03, 8).translate(0, 0.015, 0),
      body: new THREE.CylinderGeometry(0.058, 0.062, 0.15, 8, 1, true).translate(0, 0.105, 0),
      cap: new THREE.ConeGeometry(0.074, 0.07, 8).translate(0, 0.215, 0),
      vent: new THREE.CylinderGeometry(0.018, 0.022, 0.04, 6).translate(0, 0.265, 0),
      ring: new THREE.TorusGeometry(0.035, 0.005, 4, 10).translate(0, 0.32, 0),
      bar: new THREE.BoxGeometry(0.008, 0.16, 0.008).translate(0, 0.105, 0),
    },
  };
  return parts;
}

/** A tin lantern, origin at its foot. `glass` is the lit horn (its material is swapped day/night). */
export function makeLantern(): { group: THREE.Group; glass: THREE.Mesh; halo: THREE.Sprite } {
  const P = lanternParts();
  const group = new THREE.Group();
  const glass = new THREE.Mesh(P.geo.body, P.horn);
  group.add(new THREE.Mesh(P.geo.base, P.tin), glass, new THREE.Mesh(P.geo.cap, P.tin), new THREE.Mesh(P.geo.vent, P.tin), new THREE.Mesh(P.geo.ring, P.tin));
  for (let i = 0; i < 4; i++) {
    const bar = new THREE.Mesh(P.geo.bar, P.tin);
    const a = (i / 4) * Math.PI * 2 + Math.PI / 8;
    bar.position.set(Math.cos(a) * 0.062, 0, Math.sin(a) * 0.062);
    group.add(bar);
  }
  const halo = new THREE.Sprite(P.halo);
  halo.scale.set(0.8, 0.8, 1);
  halo.position.y = 0.11;
  group.add(halo);
  return { group, glass, halo };
}

interface Standing {
  id: string;
  group: THREE.Group;
  glass: THREE.Mesh;
  halo: THREE.Sprite;
  x: number;
  z: number;
}

export class HandLantern {
  /** Jef has a lantern in his pockets. */
  owned = false;
  /** ...and holds it up (L). */
  held = false;
  /** Hands full (goods, climbing): it goes down for now. */
  busy = false;
  readonly light: THREE.PointLight;
  private readonly view: THREE.Group;
  private readonly viewGlass: THREE.Mesh;
  private readonly standing = new Map<string, Standing>();
  private t = 0;
  private sway = 0;
  private last = new THREE.Vector2();
  /** 0 by day, 1 at night (set by main from the clock): how much the flame shows. */
  dark = 0;
  private readonly slotPos = new THREE.Vector3();

  constructor(
    private readonly scene: THREE.Scene,
    private readonly player: FirstPerson,
  ) {
    this.light = new THREE.PointLight(WARM, 0, 10, 1.6);
    scene.add(this.light);
    const l = makeLantern();
    l.halo.visible = false; // your own lantern does not glare in your eyes
    this.view = l.group;
    this.viewGlass = l.glass;
    // small and close (the same size on screen as a real one at arm's length), so it
    // stays inside the body's radius and never pokes into a wall you stand against
    this.view.scale.setScalar(0.4);
    this.view.traverse((o) => {
      o.frustumCulled = false;
    });
    this.view.visible = false;
    player.camera.add(this.view);
  }

  get lit(): boolean {
    return this.owned && this.held && !this.busy;
  }

  /** L: hold it up, or put it away. */
  toggle(): string {
    if (!this.owned) return "You have no lantern. A chandler sells them; people who work at night leave theirs about.";
    this.held = !this.held;
    return this.held ? "You hold up the lantern." : "You put the lantern away.";
  }

  setOwned(on: boolean): void {
    if (on && !this.owned) this.held = true; // a new lantern: straight up in the hand
    this.owned = on;
    if (!on) this.held = false;
  }

  // ---- lanterns standing where people work

  syncStanding(list: Array<{ id: string; x: number; z: number; y: number }>, groundAt: (x: number, z: number) => number): void {
    const keep = new Set(list.map((l) => l.id));
    for (const [id, s] of this.standing) {
      if (!keep.has(id)) {
        this.scene.remove(s.group);
        this.standing.delete(id);
      }
    }
    for (const l of list) {
      if (this.standing.has(l.id)) continue;
      const m = makeLantern();
      m.group.position.set(l.x, (l.y || groundAt(l.x, l.z)) + 0.001, l.z);
      m.group.rotation.y = (l.x * 7.1 + l.z * 3.3) % Math.PI;
      m.group.scale.setScalar(1.15);
      this.scene.add(m.group);
      this.standing.set(l.id, { id: l.id, group: m.group, glass: m.glass, halo: m.halo, x: l.x, z: l.z });
    }
  }

  nearestStanding(x: number, z: number, reach = 1.6): { id: string; d: number } | null {
    let best: { id: string; d: number } | null = null;
    for (const s of this.standing.values()) {
      const d = Math.hypot(s.x - x, s.z - z);
      if (d < reach && (!best || d < best.d)) best = { id: s.id, d };
    }
    return best;
  }

  standingList(): Array<{ id: string; x: number; z: number; y: number }> {
    return [...this.standing.values()].map((s) => ({ id: s.id, x: s.x, z: s.z, y: s.group.position.y }));
  }

  removeStanding(id: string): void {
    const s = this.standing.get(id);
    if (!s) return;
    this.scene.remove(s.group);
    this.standing.delete(id);
  }

  // ---- per frame, after the world has filled the lamp slots

  update(dt: number): void {
    this.t += dt;
    const P = lanternParts();
    const flick = 0.9 + Math.sin(this.t * 7.3) * 0.05 + Math.sin(this.t * 17.9) * 0.04 + (Math.sin(this.t * 1.3) > 0.97 ? -0.2 : 0);
    // the standing ones: lit after dark, horn dull by day
    for (const s of this.standing.values()) {
      s.glass.material = this.dark > 0.3 ? P.horn : P.hornDark;
      s.halo.visible = this.dark > 0.3;
      s.halo.material.opacity = 0.5 * flick;
    }
    const on = this.lit;
    this.view.visible = on;
    this.viewGlass.material = this.dark > 0.2 || on ? P.horn : P.hornDark;
    if (!on) {
      this.light.intensity = 0;
      return;
    }
    // it swings as you walk
    const p = this.player;
    const moved = Math.hypot(p.x - this.last.x, p.z - this.last.y) / Math.max(dt, 1e-3);
    this.last.set(p.x, p.z);
    this.sway += dt * (moved > 0.3 ? 6.5 : 1.5);
    const amp = moved > 0.3 ? 0.014 : 0.004;
    this.view.position.set(0.15 + Math.cos(this.sway) * amp * 0.5, -0.19 + Math.abs(Math.sin(this.sway)) * amp * 0.5, -0.28);
    this.view.rotation.set(0.05, -0.25, Math.sin(this.sway) * 0.08);
    // the light: a little ahead and to the right of you, warm and flickering
    const cam = p.camera;
    this.slotPos.set(0.3, -0.25, -0.5);
    cam.localToWorld(this.slotPos);
    this.light.position.copy(this.slotPos);
    this.light.intensity = (0.8 + 3.4 * this.dark) * flick;
    // borrow the psx lamp slot farthest from here for the glow in the fog
    const slots = psxUniforms.uLamps.value;
    let far = -1;
    let fd = 40 * 40; // only a gas lamp more than 40 m off gives up its slot
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (s.w <= 0.01) {
        far = i;
        break;
      }
      const d = (s.x - this.slotPos.x) ** 2 + (s.z - this.slotPos.z) ** 2;
      if (d > fd) {
        fd = d;
        far = i;
      }
    }
    if (far >= 0) slots[far].set(this.slotPos.x, this.slotPos.y, this.slotPos.z, 0.05 + 0.13 * this.dark); // a soft halo round you, not a lit-up fog bank
  }

  /** Dev: the state. */
  info() {
    return { owned: this.owned, held: this.held, lit: this.lit, intensity: +this.light.intensity.toFixed(2), standing: this.standing.size };
  }
}
