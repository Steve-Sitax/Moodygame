import type { DB } from "../db.ts";
import { clock, setWeather } from "../day.ts";
import { GameError, takeChecks } from "../game.ts";
import { town } from "../town/store.ts";
import { notify } from "./bus.ts";
import { writeEvent } from "./eventlog.ts";
import { setState, state, tempestPhase } from "./state.ts";
import type { EventRow, StoredStage } from "./scheduler.ts";
import { TEMPEST_TEMPLATE, type TempestPhase } from "../../../shared/tempest.ts";

// The great storm (Steve 2026-09-28; shared/tempest.ts has the who-runs-where). The ENGINE plays it; a model
// at most names it (the director may call it by kind "tempest", "storm", "gale").
//
// - tempest_coming (20 min): the sky goes black off the sea, the wind rises; the weather turns to storm now.
//   Every shop and every stall puts up its shutters or its tarpaulin (m4_closed, cleared with the event);
//   the taverns stay open (that is where the town goes). Other events of the day are called off.
// - tempest_peak (90 min): it breaks. Nobody gives out work (takeChecks below): no goods go out in this.
// - tempest_easing (30 min): it blows over; the shops stay shut until it is gone.
// - The end: the weather is rain for the rest of the day; the shops open again by their own hours.
// Nobody is hurt: this game has no deaths. The client (world/tempest.ts) makes it heavier than a storm day:
// the rain, the wind and its gusts, the sea, the sky, the lightning, and the sound of it all.

const PHASE_OF: Record<string, TempestPhase> = { tempest_coming: "coming", tempest_peak: "peak", tempest_easing: "easing" };

const LINES: Record<TempestPhase, string> = {
  coming: "The sky went black over the Schelde and a great storm came in off the sea. The shops put up their shutters; people ran for cover.",
  peak: "The storm broke over the town: rain in sheets, slates off the roofs, the river over the lowest steps.",
  easing: "The great storm began to blow itself out.",
};

export function runTempestAct(db: DB, ev: EventRow, s: StoredStage, _i: number): void {
  const phase = PHASE_OF[s.act ?? ""];
  if (!phase) return;
  if (phase === "coming") {
    const c = clock(db);
    setWeather(db, "storm", c.hour + c.minute / 60);
    // every shop and stall shut until the event ends (finishEvent takes this event's entries out again)
    const t = town(db).town;
    const closed = state<Record<string, number>>(db, "m4_closed", {});
    for (const sh of t.shops) closed[sh.id] = ev.id;
    for (const st of t.stalls) if (st.place && !st.place.startsWith("tavern:")) closed[st.place] = ev.id;
    setState(db, "m4_closed", closed);
  }
  setState(db, "tempest", { event: ev.id, phase });
  writeEvent(db, { kind: "event", verb: "weather", text: LINES[phase], ref_type: "town_event", ref_id: ev.id, weight: phase === "easing" ? 3 : 6 });
  notify("events", { jobs: true });
}

/** The event is over (or called off): the storm is gone, a wet afternoon is left. */
export function tempestEnd(db: DB, ev: EventRow, status: "done" | "cancelled"): void {
  const t = state<{ event?: number } | null>(db, "tempest", null);
  if (!t || t.event !== ev.id) return;
  setState(db, "tempest", null);
  const c = clock(db);
  setWeather(db, "rain", c.hour + c.minute / 60);
  if (status === "done") writeEvent(db, { kind: "event", verb: "weather", text: "The great storm had blown over; a steady rain was left, and the shops took down their shutters.", ref_type: "town_event", ref_id: ev.id, weight: 4 });
  notify("events", { jobs: true });
}

/** For the client (publicEvent): the part the storm is in. */
export function tempestForClient(db: DB, ev: EventRow): { phase: TempestPhase | null } | null {
  if (ev.template !== TEMPEST_TEMPLATE) return null;
  const t = state<{ event?: number } | null>(db, "tempest", null);
  return { phase: t?.event === ev.id ? tempestPhase(db) : null };
}

// No work while it blows: nobody sends goods out, nobody wants a hand on the quay.
takeChecks.push((db) => {
  if (tempestPhase(db)) throw new GameError("Nobody sends anything out in this storm. Get under a roof and wait it out.", 409);
});
