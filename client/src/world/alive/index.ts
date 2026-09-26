import * as THREE from "three";
import { psxUniforms } from "../../retro/psx";
import type { World } from "../rijnkaai";
import { TIME, clamp01, hours, type AliveSound, type Ctx, type Frame, type Part, type Weather } from "./common";
import { Wind } from "./wind";
import { createLeaves } from "./leaves";
import { createLofts } from "./lofts";
import { createJackdaws } from "./jackdaws";
import { createSparrows } from "./sparrows";
import { createBats, createEyes, createMoths, createOwl } from "./night";
import { createBilge, createBuoys, createMist, createShipLights } from "./water";
import { createBreath, createDrips, createStorm } from "./air";

// M7 alive (Steve 2026-09-26: "more good ideas to make it all feel more alive"; docs/milestones/M7-alive.md):
// the town's small life that is not people: the wind's gusts and the leaves and paper they blow
// along, birds of the roofs and the gutters, the dark's animals and insects, water off the eaves,
// the river's mist, buoys and ships' pumps, breath in the cold, thunder. Each part is its own file
// here; this one makes them, hands them the frame, and gives the dev a switch and a readout
// (__scheldemist.alive). Nothing here owns a number of the game: it is all scenery.

export interface Alive {
  update(t: number, dt: number, cam: THREE.Camera, clock: { day: number; hour: number }, weather: Weather | null): void;
  info(): Record<string, unknown>;
  /** Dev: switch every part (or one, by name) on or off. */
  setOn(on: boolean, name?: string): string[];
  wind: Wind;
  parts: Part[];
}

/** Dark outside (world/ambient.ts NIGHT_BY_HOUR): 0 by day, 1 at night. */
function nightAt(h: number): number {
  if (h < 6.2 || h > 18.3) return 1;
  if (h < 8.2) return 1 - (h - 6.2) / 2;
  if (h > 16.2) return (h - 16.2) / 2.1;
  return 0;
}

export function createAlive(scene: THREE.Scene, world: World, sound: () => AliveSound | null): Alive {
  const wind = new Wind();
  const flags = (x: number, z: number) => world.city.flags(x, z);
  const ctx: Ctx = { scene, world, flags, wind, sound };
  const parts: Part[] = [];
  const add = (make: (c: Ctx) => Part) => {
    try {
      parts.push(make(ctx));
    } catch (e) {
      console.warn("[alive] a part failed to build", e);
    }
  };
  add(createLeaves);
  add(createLofts);
  add(createJackdaws);
  add(createSparrows);
  for (const make of [createEyes, createBats, createMoths, createOwl, createBuoys, createShipLights, createBilge, createMist, createDrips, createStorm, createBreath]) add(make);

  const errors = new Map<string, number>();
  const eye = new THREE.Vector3();
  const frame: Frame = { t: 0, dt: 0, cam: null as unknown as THREE.Camera, eye, hour: 12, day: 1, weather: "fog", night: 0, rain: 0, wet: 0, fogFar: 25, cold: 0 };

  return {
    wind,
    parts,
    update(t, dt, cam, clock, weather) {
      const w: Weather = weather ?? "fog";
      TIME.value = t;
      cam.getWorldPosition(eye);
      wind.update(t, w, eye);
      const h = ((clock.hour % 24) + 24) % 24;
      const dim = w === "fog" || w === "rain" || w === "storm" ? 0.4 : 0;
      frame.t = t;
      frame.dt = dt;
      frame.cam = cam;
      frame.hour = h;
      frame.day = clock.day;
      frame.weather = w;
      frame.night = Math.max(nightAt(h + dim), nightAt(h - dim));
      frame.rain = psxUniforms.uRain.value;
      frame.wet = psxUniforms.uWet.value;
      frame.fogFar = (scene.fog as THREE.Fog | null)?.far ?? 25;
      // cold: the night and the early morning (autumn), more under a clear sky and in the fog
      const early = Math.max(hours(h, 20, 9.5, 2), 0);
      frame.cold = clamp01(early * (w === "clear" ? 1 : w === "fog" || w === "mist" ? 0.9 : 0.6));
      for (const p of parts) {
        try {
          p.update(frame);
        } catch (e) {
          // (a part that throws says so a few times, not every frame)
          const n = (errors.get(p.name) ?? 0) + 1;
          errors.set(p.name, n);
          if (n <= 3) console.warn(`[alive] ${p.name}`, e);
        }
      }
    },
    info() {
      const out: Record<string, unknown> = { errors: Object.fromEntries(errors), wind: wind.info(), cold: +frame.cold.toFixed(2), night: +frame.night.toFixed(2) };
      for (const p of parts) out[p.name] = p.info();
      return out;
    },
    setOn(on, name) {
      const hit = parts.filter((p) => !name || p.name === name);
      for (const p of hit) p.setOn(on);
      return hit.map((p) => p.name);
    },
  };
}
