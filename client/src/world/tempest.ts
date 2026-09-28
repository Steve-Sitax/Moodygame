import { TEMPEST_LEVEL, TEMPEST_TEMPLATE, type TempestPhase } from "../../../shared/tempest";
import type { TownEvent } from "../net/api";

// The great storm on this PC (server director/tempest.ts; shared/tempest.ts). The server says which part it is
// in (the event's `tempest.phase`); this eases one number, `level` 0..1, that everything heavier than an
// ordinary storm day reads: the rain (world/ambient.ts), the fog and the sea (world/rijnkaai.ts), the sky
// (world/sky.ts), the wind and its gusts (world/alive/wind.ts), the lightning (world/alive/air.ts), the leaves
// (world/alive/leaves.ts), the storm's own noises (world/alive/gale.ts) and the soundscape's wind and rain
// (audio/soundscape.ts setTempest). The townspeople run for shelter while `phase` is set (game/town.ts).

export interface TempestState {
  /** The part it is in now, or null: no great storm. */
  phase: TempestPhase | null;
  /** The storm's number (its event id): shared/tempest.ts shelterFor gives each person his way for this storm. */
  event: number;
  /** How hard it blows, eased: 0 (an ordinary storm day, or none) .. 1 (the height of it). */
  level: number;
  /** Dev: hold the level here (null: the event's). */
  hold: number | null;
  /** When the part changes (the toasts: main.ts). */
  onPhase: (p: TempestPhase | null, was: TempestPhase | null) => void;
}

export const tempest: TempestState = { phase: null, event: 0, level: 0, hold: null, onPhase: () => {} };

let target = 0;
/** The storm's event as the server last sent it (its stage and the minutes left in it: events.ts counts them down). */
let evNow: TownEvent | null = null;

/** From the server's list of events (game/events.ts set, every poll). */
export function tempestFromEvents(list: readonly TownEvent[]): void {
  const ev = list.find((e) => e.template === TEMPEST_TEMPLATE && e.status === "running" && e.tempest?.phase);
  const phase = (ev?.tempest?.phase ?? null) as TempestPhase | null;
  const was = tempest.phase;
  tempest.event = ev?.id ?? tempest.event;
  if (phase !== was) {
    tempest.phase = phase;
    tempest.onPhase(phase, was);
  }
  evNow = ev ?? null;
}

/** Once a frame: the level eases to where the storm is now (up fast as it breaks, down slowly as it goes). */
export function tempestUpdate(dt: number): void {
  const ev = evNow;
  const ph = tempest.phase;
  if (!ev || !ph) target = 0;
  else {
    const st = ev.stages[ev.stage];
    const k = st && st.minutes > 0 ? Math.max(0, Math.min(1, 1 - ev.stage_left / st.minutes)) : 1;
    // it comes on through its first part, blows at full through the height, and dies down through the last
    target = ph === "coming" ? 0.12 + (TEMPEST_LEVEL.coming - 0.12) * k : ph === "peak" ? TEMPEST_LEVEL.peak : TEMPEST_LEVEL.peak + (TEMPEST_LEVEL.easing - TEMPEST_LEVEL.peak) * k;
  }
  if (tempest.hold !== null) target = tempest.hold;
  const rate = target > tempest.level ? 0.18 : 0.05;
  tempest.level += (target - tempest.level) * Math.min(1, dt * rate);
  if (tempest.level < 0.002 && target === 0) tempest.level = 0;
}
