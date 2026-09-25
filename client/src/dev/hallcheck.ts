import * as THREE from "three";
import type { HallInWorld } from "../world/hallInWorld";
import type { World } from "../world/rijnkaai";
import type { InWorld } from "../world/inworld";
import type { FirstPerson } from "../player/firstPerson";

// The hall checks (dev, __scheldemist.halls; M7 halls, docs/milestones/M7-halls-inworld.md):
//  - shot(name, id, from, to, level): a picture from a hall point (local x, z) looking at another (local
//    x, z, height), on a storey; saved as data/shots/<name>.jpg;
//  - walk(id, {from, to, turn}): the eye walked along a line through a door, 10 frames a metre, the grain
//    held still; the change per frame (mean per pixel and channel, 0..255) and the spikes (over 1.8 times
//    their two neighbours): a wall popping away or a room loading in shows as a spike;
//  - gaps(id, level, points): from each point, eight views; any pixel of the cleared background (made
//    magenta for the check) where no door is in view is a hole in the hall (a seam, a missing wall).

export interface HallCheckDeps {
  halls: () => HallInWorld[];
  player: FirstPerson;
  world: World;
  inWorld: InWorld;
  renderer: THREE.WebGLRenderer;
  render: (cam: THREE.PerspectiveCamera, t: number) => void;
  update: (dt: number) => void;
  shot: (name: string) => Promise<string>;
}

export function makeHallCheck(d: HallCheckDeps) {
  const hall = (id: string) => {
    const h = d.halls().find((q) => q.id === id);
    if (!h) throw new Error(`no hall ${id}`);
    return h;
  };
  const read = (W: number, H: number) => {
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    const g = c.getContext("2d", { willReadFrequently: true })!;
    return () => {
      g.drawImage(d.renderer.domElement, 0, 0, W, H);
      return g.getImageData(0, 0, W, H).data;
    };
  };
  const stand = (h: HallInWorld, x: number, z: number, level: number) => {
    const [wx, wz] = h.world(x, z);
    const feet = h.plan.floorY + h.plan.levels[level].y;
    d.player.place(wx, wz, 0, 0);
    d.player.y = feet;
    return { wx, wz, feet };
  };
  return {
    /** A picture from a hall point looking at another (local), on a storey. */
    async shot(name: string, id: string, from: [number, number], to: [number, number, number?], level = 0): Promise<string> {
      const h = hall(id);
      const { wx, wz, feet } = stand(h, from[0], from[1], level);
      const [tx, tz] = h.world(to[0], to[1]);
      const yaw = Math.atan2(-(tx - wx), -(tz - wz));
      const pitch = Math.atan2((to[2] ?? 1.6) - 1.6, Math.hypot(tx - wx, tz - wz));
      d.player.place(wx, wz, yaw, pitch);
      d.player.y = feet;
      d.update(0.1);
      d.update(0.1);
      return d.shot(name);
    },
    /** The eye walked through a door: the change between frames, its spikes, where the drawing turns inside. */
    walk(id: string, o: { from: [number, number]; to: [number, number]; step?: number; turn?: number; level?: number; full?: boolean }) {
      const h = hall(id);
      const step = o.step ?? 0.1;
      const cam = d.player.camera;
      const px = read(320, 180);
      const L = Math.hypot(o.to[0] - o.from[0], o.to[1] - o.from[1]);
      const n = Math.round(L / step);
      const dx = (o.to[0] - o.from[0]) / L;
      const dz = (o.to[1] - o.from[1]) / L;
      let prev: Uint8ClampedArray | null = null;
      let feet: number | null = null;
      const out: Array<[number, number, number, number]> = [];
      for (let i = 0; i <= n; i++) {
        const lx = o.from[0] + dx * step * i;
        const lz = o.from[1] + dz * step * i;
        const [wx, wz] = h.world(lx, lz);
        const [ax, az] = h.world(lx + dx, lz + dz);
        feet = d.world.groundAt(wx, wz, 0.3, feet ?? h.plan.floorY + h.plan.levels[o.level ?? 0].y);
        d.player.place(wx, wz, 0, 0);
        d.player.y = feet;
        cam.position.set(wx, feet + 1.6, wz);
        cam.rotation.set(0, Math.atan2(-(ax - wx), -(az - wz)) + (o.turn ?? 0), 0, "YXZ");
        cam.updateMatrixWorld();
        d.render(cam, 1000);
        const p = px();
        if (prev) {
          let sum = 0;
          for (let k = 0; k < p.length; k += 4) sum += Math.abs(p[k] - prev[k]) + Math.abs(p[k + 1] - prev[k + 1]) + Math.abs(p[k + 2] - prev[k + 2]);
          out.push([+lz.toFixed(2), +(sum / ((p.length / 4) * 3)).toFixed(2), d.inWorld.visibility().inside ? 1 : 0, +feet.toFixed(2)]);
        }
        prev = new Uint8ClampedArray(p);
      }
      const spikes: Array<[number, number, number]> = [];
      for (let i = 1; i < out.length - 1; i++) {
        const nb = (out[i - 1][1] + out[i + 1][1]) / 2;
        if (out[i][1] > 1.8 * nb && out[i][1] > 3) spikes.push([out[i][0], out[i][1], +(out[i][1] / nb).toFixed(2)]);
      }
      const near = out.filter((q) => Math.abs(q[0] - (o.from[1] + o.to[1]) / 2) < 6);
      const worst = near.reduce((a, b) => (b[1] > a[1] ? b : a), [0, 0, 0, 0]);
      const worstSpike = spikes.reduce((a, b) => (b[2] > a[2] ? b : a), [0, 0, 0] as [number, number, number]);
      return { frames: out.length, worst: [worst[0], worst[1]], spikes, worstSpike, inside: out.filter((q, i) => i && q[2] !== out[i - 1][2]).map((q) => q[0]), ...(o.full ? { out } : {}) };
    },
    /** Points on a storey's floors, `spacing` apart, for gaps(). */
    points(id: string, level: number, spacing = 2.5): Array<[number, number]> {
      const P = hall(id).plan;
      const pts: Array<[number, number]> = [];
      for (const f of P.levels[level].floors) for (let x = f.minX + 0.5; x < f.maxX - 0.4; x += spacing) for (let z = f.minZ + 0.5; z < f.maxZ - 0.4; z += spacing) pts.push([x, z]);
      // not the porch or the doorway: the street shows there by design
      return pts.filter(([x, z]) => level > 0 || h0(P, x, z));
    },
    /** Holes in the hall: the cleared background seen from these points where no door is in view. */
    gaps(id: string, level: number, pts: Array<[number, number]>) {
      const h = hall(id);
      const cam = d.player.camera;
      const px = read(120, 68);
      const bg = d.world.scene.background as THREE.Color;
      const keep = bg.clone();
      bg.set(0xff00ff);
      const bad: Array<[number, number, number, number, number]> = [];
      let views = 0;
      try {
        for (const [x, z] of pts) {
          const { wx, wz, feet } = stand(h, x, z, level);
          for (let a = 0; a < 4; a++)
            for (const pitch of [0.05, 0.75]) {
              cam.position.set(wx, feet + 1.6, wz);
              cam.rotation.set(pitch, (a * Math.PI) / 2 + 0.4, 0, "YXZ");
              cam.updateMatrixWorld();
              d.render(cam, 1000);
              if (d.inWorld.visibility().outdoors) continue;
              views++;
              const p = px();
              let n = 0;
              for (let k = 0; k < p.length; k += 4) if (p[k] > 180 && p[k + 1] < 90 && p[k + 2] > 180) n++;
              if (n > 4) bad.push([+x.toFixed(1), +z.toFixed(1), a, pitch, n]);
            }
        }
      } finally {
        bg.copy(keep);
      }
      return { views, bad };
    },
  };
}

/** Inside the hall (past every door's inner face). */
function h0(P: HallInWorld["plan"], x: number, z: number): boolean {
  return P.doors.every((q) => Math.abs(x - q.x) > q.hw + 0.5 || (z - q.inner) * q.dir > 0.8);
}
