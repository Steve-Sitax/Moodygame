/** Small working rounds. Routes are checked once, not searched every render frame. */
export type WalkPoint = [number, number];
export type WalkFree = (x: number, z: number) => boolean;

export function clearWalk(from: WalkPoint, to: WalkPoint, free: WalkFree): boolean {
  const n = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / .15));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    if (!free(from[0] + (to[0] - from[0]) * k, from[1] + (to[1] - from[1]) * k)) return false;
  }
  return true;
}

/** A bounded aisle search, including checked diagonals; never crosses a blocked corner. */
export function localWalk(from: WalkPoint, to: WalkPoint, free: WalkFree, radius = 10): WalkPoint[] | null {
  if (!free(...from) || !free(...to)) return null;
  if (clearWalk(from, to, free)) return [to];
  const cell = .35, n = Math.ceil(radius / cell), key = (x: number, z: number) => `${x},${z}`;
  const pt = (x: number, z: number): WalkPoint => [from[0] + x * cell, from[1] + z * cell];
  const queue: Array<[number, number]> = [[0, 0]], prev = new Map<string, string | null>([[key(0, 0), null]]);
  let end: string | null = null;
  for (let i = 0; i < queue.length && i < 3600; i++) {
    const [x, z] = queue[i], p = pt(x, z);
    if (Math.hypot(p[0] - to[0], p[1] - to[1]) < .55 && clearWalk(p, to, free)) { end = key(x, z); break; }
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
      const nx = x + dx, nz = z + dz, k = key(nx, nz);
      if (Math.abs(nx) > n || Math.abs(nz) > n || prev.has(k)) continue;
      if (!clearWalk(p, pt(nx, nz), free)) continue;
      prev.set(k, key(x, z)); queue.push([nx, nz]);
    }
  }
  if (end === null) return null;
  const path: WalkPoint[] = [to];
  for (let k: string | null = end; k && prev.get(k) !== null; k = prev.get(k)!) {
    const [x, z] = k.split(",").map(Number); path.unshift(pt(x, z));
  }
  // Pull straight sections taut without cutting furniture or corners.
  const out: WalkPoint[] = []; let at = from;
  for (let i = 0; i < path.length;) {
    let j = path.length - 1;
    while (j > i && !clearWalk(at, path[j], free)) j--;
    at = path[j]; out.push(at); i = j + 1;
  }
  return out;
}

export class LocalRound {
  readonly home: WalkPoint;
  readonly routes: WalkPoint[][];
  readonly speed: number;
  readonly rest: number;
  x: number; z: number; yaw = 0;
  private path: WalkPoint[] = [];
  private outbound = false;
  private next = 0;
  private wait: number;
  private returnPath: WalkPoint[] = [];
  private moving = false;
  constructor(home: WalkPoint, routes: WalkPoint[][], seed = 0, speed = .75, rest = 22) {
    this.home = home; this.routes = routes; this.speed = speed; this.rest = rest;
    [this.x, this.z] = home; this.wait = 4 + (seed % 19);
  }
  get walking() { return this.moving; }
  get atHome() { return !this.path.length && !this.outbound; }
  update(dt: number, paused = false, free?: WalkFree): void {
    this.moving = false;
    if (paused || !this.routes.length) return;
    dt = Math.min(dt, .15);
    if (!this.path.length) {
      if ((this.wait -= dt) > 0) return;
      if (this.outbound) { this.path = this.returnPath.map(p => [...p]); this.outbound = false; }
      else {
        const route = this.routes[this.next++ % this.routes.length];
        if (free && !route.every((p, i) => clearWalk(i ? route[i - 1] : this.home, p, free))) { this.wait = 3; return; }
        this.returnPath = [...route.slice(0, -1)].reverse().concat([this.home]);
        this.path = route.map(p => [...p]); this.outbound = true;
      }
    }
    let step = this.speed * dt;
    while (step > 0 && this.path.length) {
      const [tx, tz] = this.path[0], dx = tx - this.x, dz = tz - this.z, d = Math.hypot(dx, dz);
      if (d < .001) { this.path.shift(); continue; }
      const k = Math.min(step / d, 1), nx = this.x + dx * k, nz = this.z + dz * k;
      if (free && !clearWalk([this.x, this.z], [nx, nz], free)) return;
      this.moving = true;
      this.x = nx; this.z = nz; this.yaw = Math.atan2(dx, dz); step -= d;
      if (k === 1) this.path.shift();
    }
    if (!this.path.length) this.wait = this.outbound ? 5 + this.next % 7 : this.rest + this.next % 13;
  }
}

/** Only reachable stops are kept. An empty result stays explicit for the dev audit. */
export function roundRoutes(home: WalkPoint, free: WalkFree, seed = 0, distance = 3): WalkPoint[][] {
  const routes: WalkPoint[][] = [];
  for (let i = 0; i < 12 && routes.length < 3; i++) {
    const a = (i / 12 + (seed % 17) / 17) * Math.PI * 2;
    const to: WalkPoint = [home[0] + Math.sin(a) * distance, home[1] + Math.cos(a) * distance];
    const route = localWalk(home, to, free, distance + 1);
    if (route) routes.push(route);
  }
  return routes;
}

/** A seated person's first step is out of their own seat, never sideways through it. */
export function seatExit(home: WalkPoint, yaw: number, x: number, z: number): boolean {
  const dx = x - home[0], dz = z - home[1];
  const along = dx * Math.sin(yaw) + dz * Math.cos(yaw);
  const across = dx * Math.cos(yaw) - dz * Math.sin(yaw);
  return along >= -.05 && along <= .9 && Math.abs(across) < .16;
}

export function groundRound(world: { standFree: (x: number, z: number, r: number, y: number) => boolean }, home: WalkPoint, y: number, yaw: number, seated: boolean, seed: number, distance = 3): { round: LocalRound; free: WalkFree } {
  // Some old standing marks touched a wall or a workbench. Start beside it, on real floor.
  if (!seated && !world.standFree(...home, .25, y)) {
    outer: for (const d of [.3, .6, .9]) for (let i = 0; i < 12; i++) {
      const a = yaw + Math.PI + i * Math.PI / 6;
      const q: WalkPoint = [home[0] + Math.sin(a) * d, home[1] + Math.cos(a) * d];
      if (world.standFree(...q, .25, y)) { home = q; break outer; }
    }
  }
  // Get up away from the table/river first. Sideways is a fallback for a bench against a wall.
  const exitYaw = seated ? [yaw + Math.PI, yaw + Math.PI / 2, yaw - Math.PI / 2, yaw, ...Array.from({ length: 12 }, (_, i) => yaw + Math.PI + i * Math.PI / 6)]
    .find(a => world.standFree(home[0] + Math.sin(a) * .85, home[1] + Math.cos(a) * .85, .25, y)) ?? yaw + Math.PI : yaw;
  const free: WalkFree = (x, z) => (seated && seatExit(home, exitYaw, x, z)) || world.standFree(x, z, .25, y);
  const exit: WalkPoint = seated ? [home[0] + Math.sin(exitYaw) * .85, home[1] + Math.cos(exitYaw) * .85] : home;
  const clear = (x: number, z: number) => world.standFree(x, z, .25, y);
  let routes = roundRoutes(exit, clear, seed, distance);
  if (!routes.length) routes = roundRoutes(exit, clear, seed, .7);
  return { free, round: new LocalRound(home, routes.map(r => seated ? [exit, ...r] : r), seed) };
}
