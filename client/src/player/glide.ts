// A smooth move through key points (2026-10-11, Steve: "not a smooth transition"; "it seems scripted"): one curve
// through all of them (a cubic Hermite spline in time), so the body never stops at a key and never jumps. It starts
// with the speed he had (a run into a vault, a climb up the rungs) and ends with the speed given (none: he comes to
// rest). The corners are rounded a little short of a Catmull-Rom spline's, so a lift over a rail stays a lift. The
// Godot game has the same (godot/src/Player/Glide.cs).

export type V3 = [number, number, number];

export class Glide {
  private readonly p: V3[] = [];
  private readonly m: V3[] = [];
  private readonly t: number[] = [];

  /**
   * from: where he is now; keys: [x, y, z, seconds from the last]; v0, v1: his speed now and at the end (m/s);
   * round: how round the corners are; maxSpeed: no part faster than this (a key too far for its seconds gets more).
   */
  constructor(from: V3, keys: Array<[number, number, number, number]>, v0: V3 = [0, 0, 0], v1: V3 = [0, 0, 0], round = 0.8, maxSpeed = Infinity) {
    this.p.push([...from]);
    this.t.push(0);
    for (const k of keys) {
      const q: V3 = [k[0], k[1], k[2]];
      const last = this.p[this.p.length - 1];
      // a smooth step's top speed is about 1.5 times its mean
      const need = (1.5 * Math.hypot(q[0] - last[0], q[1] - last[1], q[2] - last[2])) / maxSpeed;
      this.t.push(this.t[this.t.length - 1] + Math.max(0.02, k[3], need));
      this.p.push(q);
    }
    const n = this.p.length;
    for (let i = 0; i < n; i++) this.m.push([0, 0, 0]);
    this.m[0] = [...v0];
    this.m[n - 1] = [...v1];
    for (let i = 1; i < n - 1; i++) {
      const a = this.p[i].map((v, j) => (v - this.p[i - 1][j]) / (this.t[i] - this.t[i - 1]));
      const b = this.p[i + 1].map((v, j) => (v - this.p[i][j]) / (this.t[i + 1] - this.t[i]));
      const mid = a.map((v, j) => (v + b[j]) * 0.5 * round) as V3;
      // no overshoot where the way turns back on itself in height (up onto a rail, then down)
      if (a[1] * b[1] <= 0) mid[1] = 0;
      this.m[i] = mid;
    }
  }

  get duration(): number {
    return this.t[this.t.length - 1];
  }

  private seg(s: number): [number, number, number] {
    s = Math.max(0, Math.min(this.duration, s));
    let i = 0;
    while (i < this.t.length - 2 && s > this.t[i + 1]) i++;
    const h = this.t[i + 1] - this.t[i];
    return [i, h > 0 ? (s - this.t[i]) / h : 1, h];
  }

  at(s: number): V3 {
    const [i, u, h] = this.seg(s);
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    return [0, 1, 2].map((j) => this.p[i][j] * h00 + this.m[i][j] * h10 * h + this.p[i + 1][j] * h01 + this.m[i + 1][j] * h11 * h) as V3;
  }

  velocity(s: number): V3 {
    const [i, u, h] = this.seg(s);
    const u2 = u * u;
    const d00 = 6 * u2 - 6 * u;
    const d10 = 3 * u2 - 4 * u + 1;
    const d01 = -6 * u2 + 6 * u;
    const d11 = 3 * u2 - 2 * u;
    return [0, 1, 2].map((j) => (this.p[i][j] * d00 + this.p[i + 1][j] * d01) / h + this.m[i][j] * d10 + this.m[i + 1][j] * d11) as V3;
  }

  /** Which key he is heading for at time s (0: the first). */
  keyAt(s: number): number {
    return this.seg(s)[0];
  }
}
