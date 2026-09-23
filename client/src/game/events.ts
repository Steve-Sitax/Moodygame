import * as THREE from "three";
import type { ActionsPayload, TownEvent } from "../net/api";
import type { World } from "../world/rijnkaai";
import { psx } from "../retro/psx";
import { makeGoods } from "./props";
import type { Stalls } from "./stalls";
import type { Town } from "./town";

// Town events on the client (M4). The server plans and runs them
// (director/scheduler.ts): stages by game time, people reserved with attend
// actions (game/actions.ts walks them into a ring or a column). This side plays
// what can be seen and heard near Jef: the stage's sound (bells, music, a
// murmur, a handbell) through the soundscape, props round the place (crates,
// barrels, sacks, flowers, black cloth), and shuts the stalls of a place an
// event closed. Everything is taken away when the event ends.

const HEAR_M = 90;

export type EventSoundKind = "bells" | "music" | "murmur" | "handbell";
export interface EventSoundHandle {
  move(x: number, z: number): void;
  stop(): void;
}

interface Live {
  ev: TownEvent;
  soundKey: string;
  sound: EventSoundHandle | null;
  props: THREE.Object3D[];
  propsKey: string;
}

export class Events {
  list: TownEvent[] = [];
  closed: string[] = [];
  private live = new Map<number, Live>();
  private closedKeepers = new Set<string>();
  /** Set by main: a sound at a place for some seconds, from the soundscape. */
  eventSound: (kind: EventSoundKind, at: { x: number; z: number }, seconds: number) => EventSoundHandle | null = () => null;
  private clothMat: THREE.Material | null = null;
  private flowerMats: THREE.Material[] | null = null;

  constructor(
    private readonly world: World,
    private readonly town: Town,
    private readonly stalls: Stalls,
  ) {}

  /** The server's list (with the actions' payload, every poll). */
  set(p: ActionsPayload): void {
    this.list = p.events;
    const seen = new Set<number>();
    for (const ev of p.events) {
      seen.add(ev.id);
      const l = this.live.get(ev.id);
      if (l) l.ev = ev;
      else this.live.set(ev.id, { ev, soundKey: "", sound: null, props: [], propsKey: "" });
    }
    for (const [id, l] of this.live) {
      if (seen.has(id)) continue;
      this.clear(l);
      this.live.delete(id);
    }
    this.applyClosed(p.closed);
  }

  private clear(l: Live): void {
    l.sound?.stop();
    l.sound = null;
    l.soundKey = "";
    for (const o of l.props) o.removeFromParent();
    l.props = [];
    l.propsKey = "";
  }

  /** Stalls and shop tables of a closed place go under the tarpaulin; reopened when the keeper is at work. */
  private applyClosed(closed: string[]): void {
    const d = this.town.data;
    if (!d) return;
    const keepers = new Set<string>();
    for (const id of closed) {
      for (const s of d.stalls) if (s.place === id && s.keeper) keepers.add(s.keeper);
      for (const s of d.shops) if (s.id === id) keepers.add(s.keeper);
    }
    for (const k of keepers) if (!this.closedKeepers.has(k)) this.stalls.setOpen(k, false);
    for (const k of this.closedKeepers) if (!keepers.has(k)) this.stalls.setOpen(k, this.town.isAtWork(k));
    this.closedKeepers = keepers;
    this.closed = closed;
  }

  /** Where an event is now (its stage's place). */
  centreOf(id: number | null): { x: number; z: number } | null {
    if (id === null) return null;
    const ev = this.live.get(id)?.ev;
    if (!ev) return null;
    const s = ev.stages[ev.stage];
    return s ? { x: s.x, z: s.z } : { x: ev.x, z: ev.z };
  }

  moodOf(id: number | null): string {
    if (id === null) return "calm";
    const ev = this.live.get(id)?.ev;
    return ev?.stages[ev.stage]?.mood ?? "calm";
  }

  /** The n-th person of an event (a procession's column order). */
  participant(id: number | null, n: number): string | null {
    if (id === null) return null;
    return this.live.get(id)?.ev.people[n] ?? null;
  }

  update(_dt: number, player: { x: number; z: number }): void {
    for (const l of this.live.values()) {
      const ev = l.ev;
      if (ev.status !== "running") continue;
      const st = ev.stages[ev.stage];
      if (!st) continue;
      const near = Math.hypot(st.x - player.x, st.z - player.z) < HEAR_M;
      // sound: one per stage, started when Jef is near enough to hear it
      const key = `${ev.id}:${ev.stage}:${st.sound}`;
      if (l.soundKey !== key) {
        l.sound?.stop();
        l.sound = null;
        l.soundKey = key;
        if (st.sound !== "none" && near) {
          // a game minute is a third of a real second
          const secs = Math.max(8, Math.min(120, st.minutes / 3));
          l.sound = this.eventSound(st.sound, { x: st.x, z: st.z }, secs);
        }
      } else if (l.sound) l.sound.move(st.x, st.z);
      // props: once per event, at the first stage that names them
      if (st.props !== "none" && l.propsKey !== `${ev.id}:${st.props}` && near) {
        for (const o of l.props) o.removeFromParent();
        l.props = this.placeProps(st.props, st.x, st.z, ev.r);
        l.propsKey = `${ev.id}:${st.props}`;
      }
    }
  }

  private placeProps(kind: TownEvent["stages"][number]["props"], x: number, z: number, r: number): THREE.Object3D[] {
    const out: THREE.Object3D[] = [];
    const n = kind === "black_cloth" ? 2 : kind === "flowers" ? 5 : 4;
    const ring = Math.max(2.5, Math.min(r, 6)) * 0.9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + 0.7;
      const px = x + Math.cos(a) * ring;
      const pz = z + Math.sin(a) * ring;
      if (!this.world.isFree(px, pz, 0.5)) continue;
      const o = this.prop(kind);
      o.position.set(px, this.world.groundAt(px, pz, 0.3, 0), pz);
      o.rotation.y = Math.random() * Math.PI * 2;
      this.world.scene.add(o);
      out.push(o);
    }
    return out;
  }

  private prop(kind: TownEvent["stages"][number]["props"]): THREE.Object3D {
    const m = this.world.mats;
    if (kind === "crates" || kind === "barrels" || kind === "sacks") {
      const g = new THREE.Group();
      g.add(makeGoods(kind, m));
      if (kind !== "barrels") {
        const top = makeGoods(kind, m);
        top.position.y = kind === "crates" ? 0.7 : 0.4;
        top.rotation.y = 0.3;
        g.add(top);
      }
      return g;
    }
    if (kind === "black_cloth") {
      this.clothMat ??= psx(new THREE.MeshLambertMaterial({ color: 0x141214 }));
      const g = new THREE.Group();
      // a length of black cloth over a trestle by the door
      const cloth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.06, 0.7), this.clothMat);
      cloth.position.y = 0.75;
      g.add(cloth);
      const hang = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.7, 0.04), this.clothMat);
      hang.position.set(0, 0.4, 0.34);
      g.add(hang);
      return g;
    }
    // flowers: a small basket with a few colour tufts (late autumn: asters, dahlias)
    this.flowerMats ??= [0xb04a6a, 0xd8c060, 0xe8e0d0, 0x7a4a9a].map((c) => psx(new THREE.MeshLambertMaterial({ color: c })));
    const g = new THREE.Group();
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.16, 0.22, 6), m.rope);
    basket.position.y = 0.11;
    g.add(basket);
    for (let i = 0; i < 6; i++) {
      const t = new THREE.Mesh(new THREE.IcosahedronGeometry(0.07, 0), this.flowerMats[i % this.flowerMats.length]);
      const a = (i / 6) * Math.PI * 2;
      t.position.set(Math.cos(a) * 0.12, 0.3 + (i % 2) * 0.06, Math.sin(a) * 0.12);
      g.add(t);
    }
    return g;
  }

  /** Dev: what runs and what plays. */
  info() {
    return [...this.live.values()].map((l) => ({
      id: l.ev.id,
      title: l.ev.title,
      status: l.ev.status,
      stage: l.ev.stage,
      op: l.ev.stages[l.ev.stage]?.op ?? null,
      sound: l.sound ? l.soundKey : null,
      props: l.props.length,
      people: l.ev.people.length,
      at: [+l.ev.x.toFixed(0), +l.ev.z.toFixed(0)],
      starts_in: l.ev.starts_in,
      ends_in: l.ev.ends_in,
    }));
  }
}
