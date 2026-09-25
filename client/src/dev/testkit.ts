import type { World } from "../world/rijnkaai";
import { SPOTS } from "../world/rijnkaai";
import type { FirstPerson } from "../player/firstPerson";
import type { Town } from "../game/town";
import type { Jobs } from "../game/jobs";
import type { Events } from "../game/events";
import { Figure, type FigureKind } from "../game/figures";
import { GAME_MIN_PER_REAL_S, REAL_S_PER_GAME_MIN } from "../../../shared/clock";
import type { QuestBoxes } from "../game/questboxes";
import type { Nightlife } from "../game/nightlife";

// The test kit (Steve, 2026-09-24: "write good testing routines: where to go, what time and how;
// searching or spawning figures for quick tests instead of waiting"). Dev builds only, in the tab
// as `__scheldemist.t`. The routine that goes with it is docs/testing.md. Everything that writes
// to the save refuses to run on Steve's own game (vite port 5173) unless `t.allowLive = true`.

/** The Dev menu's jumps (main.ts uses the same list). */
export const JUMPS: Array<{ name: string; x: number; z: number }> = [
  { name: "Rijnkaai", x: 20, z: 20 },
  { name: "Werf", x: -270, z: 9 },
  { name: "Steenplein", x: -180, z: 20 },
  { name: "Het Steen (ramp)", x: -202.2, z: 0.5 },
  { name: "Vismarkt", x: -118, z: 30 },
  { name: "Vleeshuis", x: -122, z: 84 },
  { name: "Grote Markt", x: -254, z: 90 },
  { name: "Cathedral", x: -262, z: 138 },
  { name: "Canal", x: -64, z: 100 },
  { name: "Lock", x: 96, z: 26 },
  { name: "Petit Bassin", x: 120, z: 117 },
];

type Pt = { x: number; z: number };
type Target = string | Pt | [number, number] | Figure;

export interface TestKitDeps {
  player: FirstPerson;
  world: World;
  town: Town;
  jobs: Jobs;
  events: Events;
  /** M7 night: the quest boxes and the gangs. */
  boxes: QuestBoxes;
  night: Nightlife;
  /** Run the game n seconds now (main.ts step: works with the tab hidden). */
  step(seconds: number): void;
  shotFrom(name: string, from: [number, number, number], to: [number, number, number], fogFar?: number): Promise<string>;
  /** The sound, to close it at the end. */
  audio(): { ctx: BaseAudioContext } | null;
}

async function post<T>(url: string, body: unknown, timeoutMs = 60_000): Promise<T> {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });
  const d = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new Error(d.error ?? `HTTP ${r.status}`);
  return d;
}

export function makeTestKit(d: TestKitDeps) {
  const spawned: Figure[] = [];
  const summoned = new Set<string>();
  /** Spawned figures move with the game: every frame while the tab shows, and in run() and until(). */
  const tickFigures = (dt: number) => {
    for (const f of spawned) if (!f.gone) f.update(dt);
  };
  let last = performance.now();
  const frame = (now: number) => {
    tickFigures(Math.min(0.1, (now - last) / 1000));
    last = now;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  const low = (s: string) => s.toLowerCase();
  const round = (v: number) => Math.round(v * 10) / 10;

  const kit = {
    /** Allow writes to the save on Steve's own game (port 5173). Leave false. */
    allowLive: false,

    help(): string[] {
      return [
        "light(hour=13, weather='clear')  midday, clear, needs full: a good view (test save only)",
        "time(h, m=0) / weather(w)        set the clock or the sky (test save only)",
        "places('quay')                   named places: jumps, town places, job spots, shops",
        "go('vismarkt' | [x,z] | {x,z})   stand there on free ground, facing its middle",
        "find('Ward' | 'thief' | 'fishwife' | 'auctioneer')  townspeople and event leads, nearest first",
        "meet('Ward Cuypers')             stand 2.2 m in front of them, facing them (drawn if they were not)",
        "summon('fishwife')               bring that townsperson to 3 m in front of Jef, waiting there (not one busy in an event)",
        "spawn('thief', {walkTo:[x,z]})   a job figure 5 m ahead on land (thief, stranger, foreman, recipient)",
        "job({type:'watch', twist:'thief'}) a job of that kind on the board, taken, Jef at its start (test save only)",
        "event('fish_auction' | 'invent') start an event now and go there (test save only)",
        "run(s) / until(() => cond, maxS) run the game now (the tab may be hidden), at most 30 s a call (15 game minutes)",
        "skip(min)                        the clock on by min game minutes (through midnight: the date turns), then one tick (test save only)",
        "gang(answer?)                    M7 night: a gang now where Jef stands; answer 'run' | 'fight' | 'shout' | 'pay' at once, or leave it to the keys (test save only)",
        "nightWork(fallback?)             M7 night: the night's work now (the model's, or the hand-written jobs); givers() where the givers stand",
        "boxes()                          M7 night: the quest boxes, and whose man is away now",
        "shot('name', target?)            a picture of the target from 4 m, lit, fog pushed back",
        "state()                          clock, place, people near, events, the job",
        "clear()                          remove spawned figures, let summoned people go",
        "done()                           clear(), close the audio, park the tab",
      ];
    },

    guard(what: string): void {
      if (location.port === "5173" && !kit.allowLive) throw new Error(`${what} writes to the save: not on Steve's game (5173). Use the test stack (docs/testing.md).`);
    },

    async light(hour = 13, weather: "fog" | "mist" | "clear" | "rain" | "storm" = "clear"): Promise<string> {
      kit.guard("light()");
      await post("/api/dev/set", { hour, minute: 0, weather, food: 10, warmth: 10, sleep: 10, health: 10 });
      d.step(1);
      return `${hour}:00, ${weather}, needs full`;
    },

    /** The clock's rate (shared/clock.ts): a game minute is this many real seconds. */
    rate: { realSPerGameMin: REAL_S_PER_GAME_MIN, gameMinPerRealS: GAME_MIN_PER_REAL_S },

    /**
     * M7 clock: jump the server's clock on by this many game minutes, then one tick, so the events'
     * stages, the actions and the director move on (a jump within the day plays the stages it passes).
     * M7 night: through midnight too; the date turns on the way as in play (a new board, the rent).
     * A game hour is two real minutes: skip() instead of waiting.
     */
    async skip(minutes: number): Promise<string> {
      kit.guard("skip()");
      await post("/api/dev/advance", { minutes: Math.max(0, Math.round(minutes)) });
      await d.jobs.day.tick();
      d.step(1);
      const c = d.jobs.day;
      return `now day ${c.dayNum}, ${Math.floor(c.hourF)}:${String(Math.floor((c.hourF % 1) * 60)).padStart(2, "0")}`;
    },

    async time(hour: number, minute = 0): Promise<string> {
      kit.guard("time()");
      await post("/api/dev/set", { hour, minute });
      d.step(1);
      return `${hour}:${String(minute).padStart(2, "0")}`;
    },

    async weather(w: "fog" | "mist" | "clear" | "rain" | "storm"): Promise<string> {
      kit.guard("weather()");
      await post("/api/dev/set", { weather: w });
      return w;
    },

    places(filter = ""): Array<{ key: string; label: string; x: number; z: number; kind: string }> {
      const out: Array<{ key: string; label: string; x: number; z: number; kind: string }> = [];
      for (const j of JUMPS) out.push({ key: low(j.name), label: j.name, x: j.x, z: j.z, kind: "jump" });
      const data = d.town.data;
      if (data) {
        for (const [k, p] of Object.entries(data.places)) out.push({ key: k, label: p.label, x: p.x, z: p.z, kind: "place" });
        for (const s of data.shops) out.push({ key: s.id, label: s.label, x: s.out[0], z: s.out[1], kind: "shop" });
      }
      for (const [k, s] of Object.entries(SPOTS)) out.push({ key: k, label: (s as { label?: string }).label ?? k, x: s.x, z: s.z, kind: "job spot" });
      const f = low(filter);
      return f ? out.filter((p) => low(p.key).includes(f) || low(p.label).includes(f)) : out;
    },

    /** A point from a place name, a person, a figure or coordinates. */
    at(t: Target): Pt | null {
      if (t instanceof Figure) return { x: t.pos.x, z: t.pos.z };
      if (Array.isArray(t)) return { x: t[0], z: t[1] };
      if (typeof t === "object") return t;
      const who = kit.find(t)[0];
      if (who && who.x !== null && who.z !== null) return { x: who.x, z: who.z };
      const f = low(t);
      const p = kit.places().find((q) => q.key === f || low(q.label) === f) ?? kit.places(t)[0];
      return p ? { x: p.x, z: p.z } : null;
    },

    /** The nearest free ground to a point, on land (a spiral out to 12 m). */
    free(x: number, z: number): Pt | null {
      const w = d.world;
      if (w.isFree(x, z, 0.4) && !w.isWater(x, z)) return { x, z };
      for (let r = 0.75; r <= 12; r += 0.75)
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 8) {
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          if (w.isFree(px, pz, 0.4) && !w.isWater(px, pz)) return { x: px, z: pz };
        }
      return null;
    },

    /** Face a point from where Jef stands. */
    face(t: Target): void {
      const p = kit.at(t);
      if (!p) return;
      d.player.place(d.player.x, d.player.z, Math.atan2(-(p.x - d.player.x), -(p.z - d.player.z)), 0);
    },

    go(t: Target, opts: { back?: number } = {}): string {
      const p = kit.at(t);
      if (!p) return `no place or person "${String(t)}"`;
      // stand a little back from the middle (a square's edge, not inside the stall), facing it
      const back = opts.back ?? (typeof t === "string" && !kit.find(t).length ? 6 : 0);
      const spot = kit.free(p.x, p.z + back) ?? kit.free(p.x, p.z);
      if (!spot) return `no free ground near ${String(t)}`;
      d.player.place(spot.x, spot.z, 0, 0);
      if (back) kit.face(p);
      d.step(0.2);
      return `at ${round(spot.x)}, ${round(spot.z)}`;
    },

    /** Townspeople by name, first name, trade, id, or an event lead's role; nearest first. */
    find(q: string): Array<{ id: string; name: string; trade: string; role: string; x: number | null; z: number | null; shown: boolean; d: number | null }> {
      const data = d.town.data;
      if (!data) return [];
      const f = low(q);
      const leads = new Map<string, string>();
      for (const ev of d.events.list) for (const l of ev.leads) leads.set(l.id, l.role);
      const hits = data.residents.filter(
        (r) => r.id === q || low(r.name).includes(f) || low(r.first) === f || low(r.trade) === f || low(r.label).includes(f) || leads.get(r.id) === f,
      );
      return hits
        .map((r) => {
          const p = d.town.position(r.id);
          return { id: r.id, name: r.name, trade: r.trade, role: leads.get(r.id) ?? "", x: p ? round(p.x) : null, z: p ? round(p.z) : null, shown: !!p?.shown, d: p ? round(Math.hypot(p.x - d.player.x, p.z - d.player.z)) : null };
        })
        .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
    },

    meet(q: string): string {
      const who = kit.find(q)[0];
      if (!who) return `nobody called "${q}"`;
      if (who.x === null || who.z === null) return `${who.name} is not in the street now`;
      const spot = kit.free(who.x, who.z + 2.2) ?? kit.free(who.x + 2.2, who.z);
      if (!spot) return `no free ground by ${who.name}`;
      d.player.place(spot.x, spot.z, 0, 0);
      kit.face({ x: who.x, z: who.z });
      // only 50 townspeople are drawn at once: wait a moment, then draw them here ourselves
      const drawn = kit.until(() => !!d.town.position(who.id)?.shown, 3) >= 0 || kit.draw(who.id, { x: who.x, z: who.z });
      const p = d.town.position(who.id);
      if (p) kit.face(p);
      return `by ${who.name} (${who.trade}${who.role ? `, ${who.role}` : ""})${drawn ? "" : ", could not be drawn"}`;
    },

    /** Draw a townsperson at a point now (they go on with their day from there). */
    draw(id: string, at: Pt): boolean {
      const spot = kit.free(at.x, at.z);
      if (!spot || !d.town.claim(id, spot)) return false;
      d.town.release(id);
      d.step(0.2);
      return !!d.town.position(id)?.shown;
    },

    /** Bring a townsperson (by name, trade, id or lead role) to 3 m in front of Jef, drawn, facing him. */
    summon(q: string): string {
      const who = kit.find(q)[0];
      if (!who) return `nobody called "${q}"`;
      const ahead = { x: d.player.x - Math.sin(d.player.yaw) * 3, z: d.player.z - Math.cos(d.player.yaw) * 3 };
      // a held person (an event's lead, a talk) is not taken from their part
      if (d.town.held(who.id)) return `${who.name} is busy in an event or a talk: meet('${q}') instead`;
      const ok = kit.draw(who.id, ahead);
      if (!ok) return `could not bring ${who.name} here`;
      // they wait for Jef, facing him, till clear() lets them go on with their day
      d.town.hold(who.id, true);
      summoned.add(who.id);
      return `${who.name} (${who.trade}) waits in front of you: E to talk; clear() lets them go`;
    },

    spawn(kind: FigureKind = "thief", opts: { at?: Target; walkTo?: Target; speed?: number } = {}): Figure {
      const ahead = { x: d.player.x - Math.sin(d.player.yaw) * 5, z: d.player.z - Math.cos(d.player.yaw) * 5 };
      const want = opts.at ? kit.at(opts.at) : ahead;
      const p = kit.free(want?.x ?? ahead.x, want?.z ?? ahead.z) ?? ahead;
      const f = new Figure(kind, p.x, p.z, d.world.scene);
      spawned.push(f);
      const to = opts.walkTo ? kit.at(opts.walkTo) : null;
      if (to) f.walkTo(to.x, to.z, opts.speed ?? 1.2);
      else f.face(d.player.x, d.player.z);
      f.update(0);
      return f;
    },

    /** Remove spawned figures and let summoned people go on with their day. */
    clear(): number {
      const n = spawned.length + summoned.size;
      for (const f of spawned.splice(0)) f.remove();
      for (const id of summoned) d.town.hold(id, false);
      summoned.clear();
      return n;
    },

    async job(spec: { type: "carry" | "watch" | "deliver"; twist?: string; goods?: string; from?: string; to?: string; employer?: string; urgent?: boolean }): Promise<string> {
      kit.guard("job()");
      const r = await post<{ id: number; title: string; task: { kind: string; from?: string; to?: string; post?: string } | null }>("/api/dev/job", spec);
      const took = await d.jobs.devTake(r.id);
      const start = r.task?.kind === "watch" ? r.task.post : r.task?.from;
      if (start) kit.go(start, { back: 0 });
      return `${took}; ${JSON.stringify(r.task)}`;
    },

    async event(template: string): Promise<string> {
      kit.guard("event()");
      const r = await post<{ ok?: boolean; id?: number; title?: string; where?: string; why?: string }>("/api/dev/director", template === "invent" ? { invent: true } : { template });
      if (!r.ok || !r.id) return `not started: ${r.why ?? JSON.stringify(r)}`;
      // wait for the client to hear of it, then go to its place
      for (let i = 0; i < 20; i++) {
        await fetch("/api/actions").catch(() => null);
        d.step(0.5);
        const ev = d.events.list.find((e) => e.id === r.id);
        if (ev) {
          kit.go({ x: ev.x, z: ev.z + Math.max(6, ev.r + 2) });
          kit.face({ x: ev.x, z: ev.z });
          return `"${r.title}" (${r.id}) at ${r.where}; ${ev.status}, starts in ${ev.starts_in} game min`;
        }
        await new Promise((res) => setTimeout(res, 500));
      }
      return `"${r.title}" (${r.id}) planned at ${r.where}; not in the client's list yet, try go('${r.where}')`;
    },

    run(seconds: number): string {
      const s = Math.min(30, Math.max(0, seconds));
      for (let t = 0; t < s; t += 0.5) {
        d.step(0.5);
        for (let k = 0; k < 30; k++) tickFigures(1 / 60);
      }
      return `ran ${s} s${seconds > 30 ? " (30 s a call at most: call again)" : ""}`;
    },

    until(cond: () => boolean, maxS = 30): number {
      for (let t = 0; t <= Math.min(30, maxS); t += 0.5) {
        if (cond()) return t;
        d.step(0.5);
        for (let k = 0; k < 30; k++) tickFigures(1 / 60);
      }
      return -1;
    },

    async shot(name: string, target?: Target, opts: { dist?: number; height?: number; fog?: number; lookY?: number } = {}): Promise<string> {
      const p = target ? kit.at(target) : { x: d.player.x - Math.sin(d.player.yaw) * 5, z: d.player.z - Math.cos(d.player.yaw) * 5 };
      if (!p) return `no target "${String(target)}"`;
      // from Jef's side of the target, a few metres off, at eye height
      let dx = d.player.x - p.x;
      let dz = d.player.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      dx /= len;
      dz /= len;
      const dist = opts.dist ?? 4;
      const from: [number, number, number] = [p.x + dx * dist, opts.height ?? 1.7, p.z + dz * dist];
      return d.shotFrom(name, from, [p.x, opts.lookY ?? 1.1, p.z], opts.fog ?? 120);
    },

    /** M7 night: a gang now, where Jef stands (the engine's roll skipped); `answer` answers at once. */
    async gang(answer?: "run" | "fight" | "shout" | "pay" | "stand"): Promise<string> {
      kit.guard("gang()");
      const r = await post<{ gang: { id: number; demand_c: number } | null }>("/api/dev/gang", d.night.facts());
      if (!r.gang) return "no gang";
      d.night.show(r.gang as Parameters<Nightlife["show"]>[0]);
      d.step(3);
      if (!answer) return `gang ${r.gang.id} asks ${r.gang.demand_c} c: R run, F fight, H shout, P pay (or t.gang again)`;
      return d.night.answer(answer);
    },

    /** M7 night: the night's work now; `fallback` puts up the hand-written jobs (no model call). */
    async nightWork(fallback = false): Promise<string> {
      kit.guard("nightWork()");
      const r = await post<Record<string, unknown>>("/api/dev/night-work", { fallback }, 40_000);
      await d.jobs.refresh(await (await fetch("/api/jobs")).json());
      return JSON.stringify(r);
    },

    /** M7 night: the givers of night work, where they stand and whether they are out. */
    givers(): Array<{ id: string; name: string; x: number | null; z: number | null; shown: boolean }> {
      return ["fence", "smuggler", "nightcarter", "cracksman"].map((id) => {
        const n = d.jobs.people.get(id);
        return { id, name: n?.def.name ?? id, x: n ? round(n.pos.x) : null, z: n ? round(n.pos.z) : null, shown: !!n?.present };
      });
    },

    boxes() {
      return d.boxes.info();
    },

    state() {
      const day = d.jobs.day;
      return {
        clock: `day ${day.dayNum}, ${Math.floor(day.hourF)}:${String(Math.floor((day.hourF % 1) * 60)).padStart(2, "0")}`,
        at: [round(d.player.x), round(d.player.z)],
        near: d.town.near(6),
        events: d.events.info().map((e) => `${e.id} ${e.title}: ${e.status}, stage ${e.stage}, at ${e.at.join(",")}`),
        job: d.jobs.devActive?.title ?? null,
        spawned: spawned.filter((f) => !f.gone).map((f) => `${f.kind} at ${round(f.pos.x)},${round(f.pos.z)}`),
      };
    },

    async done(): Promise<string> {
      kit.clear();
      try {
        await (d.audio()?.ctx as AudioContext | undefined)?.close();
      } catch {
        /* already closed */
      }
      location.replace("about:blank");
      return "cleared, audio closed, tab parked";
    },
  };
  return kit;
}

export type TestKit = ReturnType<typeof makeTestKit>;
