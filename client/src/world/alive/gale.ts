import { gustRoar, rollingCask, shutterBang, signCreak, slateCrash } from "../../audio/aliveSounds";
import { rand, type Ctx, type Frame, type Part } from "./common";
import { tempest } from "../tempest";

// The great storm's own noises (Steve 2026-09-28: "make it have nice sounds"; world/tempest.ts). All made in code
// (audio/aliveSounds.ts), each at a real place round Jef with its own reach:
// - the gusts: a roar with a howl in it, from upwind, as each front of wind comes down the street to him;
// - shutters and loose doors slamming on the house fronts; a slate sliding off a roof and breaking on the stones;
//   a shop sign squealing on its bracket; now and then an empty cask rolling and knocking over the open ground.
// More and more often the harder it blows; nothing at all on any other day. Nothing drawn: the leaves and the
// paper flying (leaves.ts), the rain, the sea and the lightning show it.

/** A house front round Jef: out along a random way from him to the first wall, 6 to 55 m off (a square is wide). */
function wallNear(ctx: Ctx, f: Frame): { x: number; z: number } | null {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    for (let d = 2; d < 55; d += 0.8) {
      const fl = ctx.flags(f.eye.x + dx * d, f.eye.z + dz * d);
      if (fl === undefined || fl === 2 || fl === 4) break; // (water or outside the town: no house that way)
      if (fl === 1) {
        if (d < 6) break;
        // (a step back from the wall: the sound is on its face, not in it)
        return { x: f.eye.x + dx * (d - 0.4), z: f.eye.z + dz * (d - 0.4) };
      }
    }
  }
  return null;
}

/** Open ground 10 to 25 m off (a cask rolls there). */
function openNear(ctx: Ctx, f: Frame): { x: number; z: number } | null {
  for (let tries = 0; tries < 6; tries++) {
    const a = Math.random() * Math.PI * 2;
    const d = rand(10, 25);
    const x = f.eye.x + Math.cos(a) * d;
    const z = f.eye.z + Math.sin(a) * d;
    if (ctx.flags(x, z) === 0) return { x, z };
  }
  return null;
}

export function createGale(ctx: Ctx): Part {
  let on = true;
  const next = { bang: 3, slate: 12, sign: 6, cask: 40, gust: 0 };
  let lastGust = 0;
  const heard = { bang: 0, slate: 0, sign: 0, cask: 0, gust: 0 };
  let fury = 0;

  function update(f: Frame): void {
    fury = f.weather === "storm" ? tempest.level : 0;
    if (!on || fury < 0.12) return;
    const snd = ctx.sound();
    if (!snd) return;
    const dt = f.dt;
    // the gusts: a roar as each front comes to him (world/alive/wind.ts), from upwind
    const g = ctx.wind.gustAt(f.eye.x, f.eye.z);
    next.gust -= dt;
    if (g > 0.9 && lastGust <= 0.9 && next.gust <= 0) {
      next.gust = 2.5;
      const up = ctx.wind.dir;
      const at = { x: f.eye.x - up.x * 22, y: 7, z: f.eye.z - up.y * 22 };
      if (snd.placed(at, { ref: 30, reach: 400, max: 1e9, occl: 0, wet: 0.5, gain: 0.9 * fury }, gustRoar(Math.min(1, g / 2.4), rand(3, 5.5)))) heard.gust++;
    }
    lastGust = g;
    const tick = (k: keyof typeof next, gap: [number, number], play: () => boolean) => {
      next[k] -= dt;
      if (next[k] > 0) return;
      next[k] = rand(gap[0], gap[1]) / Math.max(0.25, fury);
      if (play()) heard[k as keyof typeof heard]++;
    };
    tick("bang", [1.2, 4.5], () => {
      const w = wallNear(ctx, f);
      return !!w && snd.placed({ x: w.x, y: rand(1.5, 5), z: w.z }, { ref: 4, reach: 60, max: 110, wet: 0.35 }, shutterBang(1 + Math.floor(Math.random() * 4)));
    });
    tick("slate", [7, 18], () => {
      const w = wallNear(ctx, f);
      return !!w && snd.placed({ x: w.x, y: 1, z: w.z }, { ref: 4, reach: 50, max: 90, wet: 0.3 }, slateCrash());
    });
    tick("sign", [4, 10], () => {
      const w = wallNear(ctx, f);
      return !!w && snd.placed({ x: w.x, y: 3.2, z: w.z }, { ref: 2.5, reach: 30, max: 45, wet: 0.25 }, signCreak());
    });
    tick("cask", [25, 60], () => {
      const o = openNear(ctx, f);
      return !!o && snd.placed({ x: o.x, y: 0.3, z: o.z }, { ref: 3, reach: 40, max: 60, wet: 0.2 }, rollingCask(rand(2.5, 5)));
    });
  }

  return {
    name: "gale",
    update,
    info: () => ({ fury: +fury.toFixed(2), heard: { ...heard } }),
    setOn: (v) => {
      on = v;
    },
  };
}
