import * as THREE from "three";
import { clamp01, rand, type Weather } from "./common";

// M7 alive: the wind over the town, with gusts. The steady wind is world/ambient.ts's own (the
// same formula, so the leaves go the way the chimney smoke goes): a slow turn of its direction and
// a strength by the weather. On top of it come gusts: a front of wind that sweeps across the
// town along the wind, 2-6 s long, now and then (often on a storm day, hardly ever in fog). A
// place feels a gust when its front passes it, so the leaves in a street lift one after another.

/** Wind speed by weather, as world/ambient.ts WIND (m/s-ish): fog lies still, rain comes on a wind. */
const BASE: Record<Weather, number> = { fog: 0.35, mist: 0.6, clear: 0.9, rain: 1.5, storm: 3.2 };
/** Seconds between gusts, by weather. */
const GAP: Record<Weather, [number, number]> = { fog: [70, 160], mist: [30, 70], clear: [14, 40], rain: [8, 22], storm: [3, 9] };
/** How strong a gust is (times the base wind, added). */
const GUST: Record<Weather, [number, number]> = { fog: [0.6, 1.2], mist: [1, 2], clear: [1.5, 3], rain: [1.5, 2.8], storm: [0.8, 1.6] };

interface Gust {
  /** When the front passes the origin (s), how long it lasts, its strength, its speed (m/s). */
  t0: number;
  len: number;
  k: number;
  speed: number;
  /** Where along the wind the front was at t0 (Jef's place then): it passes him at t0. */
  a0: number;
}

export class Wind {
  /** The steady wind (x, z), m/s-ish. */
  readonly base = new THREE.Vector2(0.9, 0.35);
  /** Unit direction the wind blows to. */
  readonly dir = new THREE.Vector2(1, 0);
  private weather: Weather = "fog";
  private t = 0;
  private gusts: Gust[] = [];
  private next = 5;
  /** Dev: a gust now. */
  force = false;

  update(t: number, weather: Weather, eye: { x: number; z: number }): void {
    this.t = t;
    this.weather = weather;
    const wa = 0.35 + Math.sin(t * 0.013) * 0.25;
    const ws = (BASE[weather] ?? 0.5) * (1 + 0.2 * Math.sin(t * 0.07));
    this.base.set(Math.cos(wa) * ws, Math.sin(wa) * ws);
    this.dir.set(Math.cos(wa), Math.sin(wa));
    if (this.force || t >= this.next) {
      const g = GAP[weather] ?? [20, 50];
      const k = GUST[weather] ?? [1, 2];
      const a0 = eye.x * this.dir.x + eye.z * this.dir.y;
      this.gusts.push({ t0: t + 1.5, len: rand(2, 6), k: rand(k[0], k[1]), speed: 8 + BASE[weather] * 3, a0 });
      this.next = t + rand(g[0], g[1]);
      this.force = false;
    }
    this.gusts = this.gusts.filter((q) => t < q.t0 + q.len + 60);
  }

  /** The gust at a place now, 0.. (times the base wind). */
  gustAt(x: number, z: number): number {
    let g = 0;
    // the front moves along the wind: a place further downwind feels it later
    const along = x * this.dir.x + z * this.dir.y;
    for (const q of this.gusts) {
      const local = this.t - q.t0 - (along - q.a0) / q.speed;
      if (local < -0.5 || local > q.len + 1) continue;
      const env = clamp01((local + 0.5) / 0.8) * clamp01((q.len + 1 - local) / 1.5);
      g = Math.max(g, q.k * env * (0.75 + 0.25 * Math.sin(local * 7 + x * 0.3)));
    }
    return g;
  }

  /** The wind at a place: the base wind with the gust on it, into `out` (x, z). */
  at(x: number, z: number, out: THREE.Vector2): THREE.Vector2 {
    const g = this.gustAt(x, z);
    return out.copy(this.base).multiplyScalar(1 + g);
  }

  /** Base speed now. */
  get speed(): number {
    return this.base.length();
  }

  info(): Record<string, unknown> {
    return { base: +this.speed.toFixed(2), dir: +Math.atan2(this.dir.y, this.dir.x).toFixed(2), gusts: this.gusts.length, weather: this.weather };
  }
}
