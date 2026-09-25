import type { TownEvent } from "../net/api";
import { createHearse, type Hearse } from "../world/hearse";
import { loadProps, type Props } from "../world/props3d";
import type { World } from "../world/rijnkaai";
import type { Town } from "./town";
import { makeCoffin } from "./wardrobe";
import { GAME_MIN_PER_REAL_S } from "../../../shared/clock";

// The hearse of a funeral's departure (M7 funeral): the server's "depart" stage carries the road out
// of town (director/scheduler.ts departRoute: from the church door to the edge of the drawn town and
// 30 m on). The hearse waits a few metres down that road; the coffin is loaded when the bearers come
// up to its back (or, unseen, after a while by the clock); then it drives the road at a slow walk
// with the widow and the family behind it (game/actions.ts walks them after its back). When the
// event ends it drives on to the end of its road, or until Jef no longer sees it, and is gone.

/** Metres down the road where it waits for the coffin. */
const WAIT_AT_M = 9;
/** A slow walk (m/s). */
const PACE = 1.05;
/** The bearers within this of its back: the coffin is on. */
const LOAD_M = 3.2;
/** Unseen or slow: loaded anyway this far into the stage (0..1), and off 2 s after. */
const LOAD_BY = 0.4;
const OFF_AFTER_S = 2;
/** Drawn within this of Jef. */
const DRAW_M = 150;
/** Game minutes a real second (shared/clock.ts; M7: 3 -> 0.5). */
const GAME_MIN_PER_S = GAME_MIN_PER_REAL_S;
/** Its back: where the coffin goes on, and where the column's head walks. */
const BACK_M = 2.8;

interface Run {
  id: number;
  route: Array<[number, number]>;
  len: number;
  /** Metres along the road. */
  d: number;
  loaded: boolean;
  offIn: number;
  ended: boolean;
  bearers: string[];
  obj: Hearse | null;
  x: number;
  z: number;
  yaw: number;
}

function along(path: Array<[number, number]>, d: number): [number, number, number] {
  let left = Math.max(0, d);
  for (let i = 1; i < path.length; i++) {
    const [ax, az] = path[i - 1];
    const [bx, bz] = path[i];
    const L = Math.hypot(bx - ax, bz - az);
    if (left <= L || i === path.length - 1) {
      const t = L > 0 ? Math.min(1, left / L) : 0;
      return [ax + (bx - ax) * t, az + (bz - az) * t, Math.atan2(bx - ax, bz - az)];
    }
    left -= L;
  }
  const [x, z] = path[path.length - 1] ?? [0, 0];
  return [x, z, 0];
}

export class Hearses {
  private runs = new Map<number, Run>();
  private props: Props | null = null;

  constructor(
    private readonly world: World,
    private readonly town: Town,
  ) {
    loadProps()
      .then((p) => (this.props = p))
      .catch(() => {});
  }

  /** Where the column's head walks: the hearse's back (null: this event has no hearse on the road). */
  backOf(eventId: number | null): { x: number; z: number } | null {
    const r = eventId === null ? null : this.runs.get(eventId);
    if (!r) return null;
    return { x: r.x - Math.sin(r.yaw) * BACK_M, z: r.z - Math.cos(r.yaw) * BACK_M };
  }

  /** The coffin is on the hearse (the bearers carry it no more). */
  hasCoffin(eventId: number | null): boolean {
    return eventId !== null && !!this.runs.get(eventId)?.loaded;
  }

  update(dt: number, player: { x: number; z: number }, events: TownEvent[]): void {
    const seen = new Set<number>();
    for (const ev of events) {
      const st = ev.stages[ev.stage];
      if (ev.status !== "running" || !st || st.op !== "depart" || !st.hearse || !st.route || st.route.length < 2) continue;
      seen.add(ev.id);
      let r = this.runs.get(ev.id);
      if (!r) {
        const route = st.route;
        let len = 0;
        for (let i = 1; i < route.length; i++) len += Math.hypot(route[i][0] - route[i - 1][0], route[i][1] - route[i - 1][1]);
        r = { id: ev.id, route, len, d: Math.min(WAIT_AT_M, len * 0.2), loaded: false, offIn: OFF_AFTER_S, ended: false, bearers: ev.leads.filter((l) => l.role === "bearers").map((l) => l.id), obj: null, x: 0, z: 0, yaw: 0 };
        // come upon it late (Jef was elsewhere): where the clock says it is by now
        const secs = Math.max(0, (st.minutes - ev.stage_left) / GAME_MIN_PER_S);
        const loadS = (st.minutes * LOAD_BY) / GAME_MIN_PER_S;
        if (secs > loadS + OFF_AFTER_S) {
          r.loaded = true;
          r.offIn = 0;
          r.d = Math.min(len, r.d + (secs - loadS - OFF_AFTER_S) * PACE);
        }
        this.runs.set(ev.id, r);
      }
      if (!r.loaded) {
        const [x, z, yaw] = along(r.route, r.d);
        const bx = x - Math.sin(yaw) * BACK_M;
        const bz = z - Math.cos(yaw) * BACK_M;
        let near = 0;
        // the bearers in the street (drawn, whether or not Jef is looking) at its back
        for (const id of r.bearers) {
          const q = this.town.puppet(id);
          if (q && Math.hypot(q.x - bx, q.z - bz) < LOAD_M) near++;
        }
        const t = st.minutes > 0 ? 1 - ev.stage_left / st.minutes : 1;
        if (near >= 2 || t >= LOAD_BY) r.loaded = true;
      }
    }
    for (const r of this.runs.values()) {
      if (!seen.has(r.id)) r.ended = true;
      if (r.loaded) {
        if (r.offIn > 0) r.offIn -= dt;
        else r.d = Math.min(r.len, r.d + PACE * dt);
      }
      const [x, z, yaw] = along(r.route, r.d);
      const moving = r.loaded && r.offIn <= 0 && r.d < r.len;
      r.x = x;
      r.z = z;
      // turn gently on the corners
      const dy = Math.atan2(Math.sin(yaw - r.yaw), Math.cos(yaw - r.yaw));
      r.yaw = r.obj ? r.yaw + dy * Math.min(1, dt * 1.5) : yaw;
      const dj = Math.hypot(x - player.x, z - player.z);
      // over: at the end of its road, or out of Jef's sight once the event has ended
      if (r.ended && (r.d >= r.len - 0.1 || dj > 45 || !r.obj)) {
        r.obj?.dispose();
        this.runs.delete(r.id);
        continue;
      }
      if (!r.obj && dj < DRAW_M && this.props) r.obj = createHearse(this.world.scene, this.props, makeCoffin());
      if (r.obj && dj > DRAW_M + 20) {
        r.obj.dispose();
        r.obj = null;
      }
      if (r.obj) {
        r.obj.set(x, z, r.yaw, moving ? 1 : 0, this.world.groundAt(x, z, 0.3, 0));
        r.obj.coffin(r.loaded);
      }
    }
  }

  /** Dev: the hearses on the road. */
  info() {
    return [...this.runs.values()].map((r) => ({ event: r.id, at: [+r.x.toFixed(1), +r.z.toFixed(1)], d: +r.d.toFixed(1), len: +r.len.toFixed(1), loaded: r.loaded, moving: r.loaded && r.offIn <= 0 && r.d < r.len, ended: r.ended, drawn: !!r.obj }));
  }
}
