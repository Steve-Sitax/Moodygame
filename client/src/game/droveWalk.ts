import * as THREE from "three";
import type { Crowd, Puppet } from "./crowd";
import { makeAnimal, type Animal } from "./animals";
import { DROVE_GAP, DROVE_IN_MIN, DROVE_PACE, droveAt, droveLine, type Drove } from "../../../shared/drove";
import { wayPoint } from "../../../shared/trade";

// T3 chain 3 in the open (shared/drove.ts): the farmer who drives his pigs in from the Kipdorp gate to the butcher's
// door at dawn, drawn only near the player (the server's clock places them; every PC the same). The pigs walk in a
// loose line before him, each a little to the side of the way (never on one thread), and go in at the door one after
// another; he walks back out empty-handed. The pigs are the animals' models (build_animals.py pig_pink, pig_spotted);
// the farmer a crowd figure held by this layer (as the lively layer holds its people): the crowd does not push him.

/** Drawn within this many metres of the player (the fog hides them further off). */
const NEAR_M = 70;

interface Host {
  scene: THREE.Scene;
  crowd: Crowd;
  /** The height of the ground an animal at (x, z) stands on. */
  heightAt(x: number, z: number): number;
}

export class DroveWalk {
  private id = "";
  private man: Puppet | null = null;
  private pigs: Array<Animal | null> = [];
  private t = 0;
  private lamp: boolean | null = null;

  constructor(private readonly host: Host) {}

  /** `d`: today's drove (GET /api/trade), `min`: the game minute now (from day 1, 0:00). */
  update(dt: number, d: Drove | null, min: number, px: number, pz: number): void {
    this.t += dt;
    const at = d ? droveAt(d, min) : null;
    if (!d || !at || at.phase === "before" || at.phase === "over") return this.clear();
    const line = at.phase === "back" ? null : droveLine(d, at.f);
    const manS = at.phase === "back" ? at.f * d.len : line!.man;
    const [mx, mz] = this.pointAt(d, manS);
    // near the player: the line is short, the farmer's place tells
    if (Math.hypot(mx - px, mz - pz) > NEAR_M) return this.clear();
    if (d.id !== this.id) {
      this.clear();
      this.id = d.id;
    }
    // the farmer: behind his pigs, on the way (back out alone)
    const back = at.phase === "back";
    const yawM = this.yawAt(d, manS, back);
    if (!this.man) {
      this.man = this.host.crowd.addPuppet("old_man", mx, mz, yawM, DROVE_PACE);
      if (this.man) this.host.crowd.puppetStand(this.man, "walk", null);
      this.lamp = null;
    }
    // (a lantern in his hand while it is dark: he leaves the gate before dawn)
    const dark = min % 1440 < 6.5 * 60;
    if (this.man && this.lamp !== dark) {
      this.host.crowd.puppetLantern(this.man, dark);
      this.lamp = dark;
    }
    if (this.man) {
      const p = this.man;
      p.x = mx;
      p.z = mz;
      p.yaw = yawM;
      if (at.phase === "in") this.host.crowd.puppetStand(p, "idle", null);
      else {
        this.host.crowd.puppetStand(p, "walk", null);
        p.human.setPace((back ? 1.2 : DROVE_PACE) / p.size);
      }
    }
    // the pigs: before him, each a little off the middle of the way, nosing about; at the door in one by one
    for (let i = 0; i < d.pigs.length; i++) {
      const inBy = ((i + 1) / (d.pigs.length + 1)) * DROVE_IN_MIN;
      const gone = back || (at.phase === "in" && at.minIn > inBy);
      if (gone) {
        this.dropPig(i);
        continue;
      }
      let a = this.pigs[i];
      if (!a) {
        a = makeAnimal(d.pigs[i]);
        if (!a) continue; // (the models not in yet)
        this.pigs[i] = a;
        this.host.scene.add(a.group);
      }
      // at the door they close up to it, the first first
      const s = at.phase === "in" ? Math.min(d.len, line!.pigs[i] + (DROVE_GAP * i * at.minIn) / inBy) : line!.pigs[i];
      const side = 0.35 * Math.sin(i * 2.1 + this.t * 0.35) + (i % 2 ? 0.25 : -0.25);
      const [x, z] = this.pointAt(d, s, side);
      a.group.position.set(x, this.host.heightAt(x, z), z);
      a.group.rotation.y = this.yawAt(d, s, false) + 0.25 * Math.sin(this.t * 0.8 + i);
      a.play(at.phase === "in" ? (i % 2 ? "sniff" : "idle") : "walk");
      a.update(dt);
    }
  }

  /** A point `s` metres along the way from the gate, `side` metres to the right of it. */
  private pointAt(d: Drove, s: number, side = 0): [number, number] {
    const f = Math.max(0, Math.min(1, s / Math.max(1, d.len)));
    const [x, z] = wayPoint(d.way, f);
    if (!side) return [x, z];
    const [x2, z2] = wayPoint(d.way, Math.min(1, f + 0.5 / Math.max(1, d.len)));
    const L = Math.hypot(x2 - x, z2 - z) || 1;
    return [x - ((z2 - z) / L) * side, z + ((x2 - x) / L) * side];
  }

  private yawAt(d: Drove, s: number, back: boolean): number {
    const [x, z] = this.pointAt(d, Math.max(0, s - 0.5));
    const [x2, z2] = this.pointAt(d, Math.min(d.len, s + 0.5));
    return back ? Math.atan2(x - x2, z - z2) : Math.atan2(x2 - x, z2 - z);
  }

  private dropPig(i: number): void {
    const a = this.pigs[i];
    if (!a) return;
    a.dispose();
    this.pigs[i] = null;
  }

  /** Nothing drawn (out of range, not out now, a new day). */
  clear(): void {
    if (this.man) this.host.crowd.removePuppet(this.man);
    this.man = null;
    for (let i = 0; i < this.pigs.length; i++) this.dropPig(i);
    this.pigs = [];
    this.id = "";
  }

  /** Dev (the browser check): what is drawn now. */
  info(): { id: string; man: [number, number] | null; pigs: Array<[number, number] | null> } {
    return {
      id: this.id,
      man: this.man ? [Math.round(this.man.x * 10) / 10, Math.round(this.man.z * 10) / 10] : null,
      pigs: this.pigs.map((a) => (a ? [Math.round(a.group.position.x * 10) / 10, Math.round(a.group.position.z * 10) / 10] : null)),
    };
  }
}
