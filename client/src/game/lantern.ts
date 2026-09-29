import { holdArm } from "../player/body"; // M7 character: the hand that holds the lantern
import * as THREE from "three";
import { psx, psxUniforms } from "../retro/psx";
import type { FirstPerson } from "../player/firstPerson";
import { addLantern, removeLantern, type LanternSource } from "../world/lanternLights";
import { lampFog } from "../world/lampFog";
import { pick, type Target } from "./facing";
import { mergeParts } from "../world/staticMerge";

// A lantern to carry (M3h). A tin hand lantern with horn panes and a tallow
// candle: bought from a chandler, or taken from where people work (a dock gang's
// lantern by the door, a stall's lamp, the lock men's lantern; town/deeds.ts). In
// the pockets it is an item; held up (L) it shows in your right hand at the lower
// right of the view and throws a warm light round you: first in the pool of real
// lights for carried lanterns (world/lanternLights.ts), shadows and all, and the
// fog glow of one of the six psx lamp slots, borrowed from the gas lamp farthest
// away. People see you coming (the theft rules count it). The lanterns standing
// about light the world the same way once it is dark.

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
    horn: new THREE.MeshBasicMaterial({ color: 0xffc27a }),
    hornDark: new THREE.MeshBasicMaterial({ color: 0x6a5a44 }),
    halo: new THREE.SpriteMaterial({ map: tex, color: WARM, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.5 }),
    geo: {
      base: new THREE.CylinderGeometry(0.068, 0.072, 0.03, 8).translate(0, 0.015, 0),
      body: new THREE.CylinderGeometry(0.058, 0.062, 0.15, 8, 1, true).translate(0, 0.105, 0),
      cap: new THREE.ConeGeometry(0.074, 0.07, 8).translate(0, 0.215, 0),
      vent: new THREE.CylinderGeometry(0.018, 0.022, 0.04, 6).translate(0, 0.265, 0),
      ring: new THREE.TorusGeometry(0.035, 0.005, 4, 10).translate(0, 0.32, 0),
      bar: new THREE.BoxGeometry(0.008, 0.16, 0.008).translate(0, 0.105, 0),
    },
  };
  // M7 fog lamps: the lit horn fogs with the lantern (a little further; world/lampFog.ts)
  lampFog(parts.horn, 1.2);
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
  // the tin (base, cap, vent, ring, bars) one mesh (world/staticMerge.ts)
  mergeParts(group, (m) => m.material === P.tin);
  const halo = new THREE.Sprite(P.halo);
  halo.scale.set(0.42, 0.42, 1); // (2026-09-30: about the lantern's own size, not a big circle)
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
  src: LanternSource;
}

export class HandLantern {
  /** Jef has a lantern in his pockets. */
  owned = false;
  /** ...and holds it up (L). */
  held = false;
  /** Hands full (goods, climbing): it goes down for now. */
  busy = false;
  /** Its light on the world: the pool's first (world/lanternLights.ts). */
  readonly light: LanternSource;
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
    this.light = addLantern({ own: true, power: 0 });
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
    // M7 character: the player's own hand round the ring, the sleeve as dressed (player/body.ts)
    holdArm(this.view, "lantern");
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
        removeLantern(s.src);
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
      const src = addLantern({ power: 0.9 });
      src.pos.set(m.group.position.x, m.group.position.y + 0.11 * 1.15, m.group.position.z);
      src.ground = m.group.position.y - 0.001;
      this.standing.set(l.id, { id: l.id, group: m.group, glass: m.glass, halo: m.halo, x: l.x, z: l.z, src });
    }
  }

  /** The standing lantern within reach that Jef looks at (game/facing.ts). */
  nearestStanding(x: number, z: number, reach = 1.6): { id: string; d: number; at: Target } | null {
    const r = pick(this.standing.values(), (s) => {
      const d = Math.hypot(s.x - x, s.z - z);
      return d < reach ? { d, at: { x: s.x, y: s.group.position.y + 0.2, z: s.z } } : null;
    });
    return r ? { id: r.it.id, d: r.d, at: r.at } : null;
  }

  standingList(): Array<{ id: string; x: number; z: number; y: number }> {
    return [...this.standing.values()].map((s) => ({ id: s.id, x: s.x, z: s.z, y: s.group.position.y }));
  }

  removeStanding(id: string): void {
    const s = this.standing.get(id);
    if (!s) return;
    this.scene.remove(s.group);
    removeLantern(s.src);
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
      // (the pool scales it by the dark itself; a standing one is only lit after dark)
      s.src.on = this.dark > 0.3 ? 1 : 0;
    }
    const on = this.lit;
    this.view.visible = on;
    this.viewGlass.material = this.dark > 0.2 || on ? P.horn : P.hornDark;
    if (!on) {
      this.light.on = 0;
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
    this.light.pos.copy(this.slotPos);
    this.light.ground = p.y;
    this.light.on = 1;
    // (the pool flickers it; 1 = a townsman's lantern at night)
    this.light.power = (0.8 + 3.4 * this.dark) / 3.6;
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
    return { owned: this.owned, held: this.held, lit: this.lit, power: +(this.light.power * this.light.level).toFixed(2), standing: this.standing.size };
  }
}
