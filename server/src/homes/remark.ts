import { z } from "zod";
import type { DB } from "../db.ts";
import { HOME_CALLS_PER_DAY } from "../config.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { clock, WEATHER_TEXT } from "../day.ts";
import { SYSTEM } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { LANGUAGE_RULE } from "../text.ts";
import { TRADES } from "../town/places.ts";
import { personaLine, resident, town } from "../town/store.ts";
import { activityAt } from "../town/schedule.ts";
import type { Resident } from "../town/population.ts";
import { callTimeout, canCallShare, getState, setState } from "../interiors/state.ts";
import { cleanLine } from "../interiors/tavern.ts";
import { CLASSES, comfortOf, comfortWords, FURNITURE, type HomeClass } from "../../../shared/homes.ts";
import { lease, placedIn } from "./homes.ts";
import { homeDef, type HomeDef } from "./town.ts";

// The landlady or a neighbour looks in at Jef's room (M6 homes). Who looks in is the
// ENGINE's pick (the widow in her own house, else a neighbour at home now); what they see
// is the engine's (the room's kind, its pieces, plain comfort words, never a number). The
// model writes ONE line in their voice (hook home_remark, its own share of the day's
// calls, 20 s, the engine's line behind it). The line changes nothing: no money, no needs,
// no trust. Once a game day per home.

export const HOME_HOOKS = ["home_remark"];
export function canCallHome(db: DB): boolean {
  return canCallShare(db, HOME_HOOKS, HOME_CALLS_PER_DAY);
}

export const RemarkSchema = z.object({ line: z.string().min(1).max(160) });

export interface Remark {
  who: { id: string; name: string; first: string; kind: string; sex: "m" | "f"; age: number };
  line: string;
  source: "claude" | "engine";
}

/** Who looks in: the widow in her own house; else the nearest neighbour who is at home and up. */
export function visitor(db: DB, h: HomeDef): Resident | null {
  const c = clock(db);
  const hr = c.hour + c.minute / 60;
  if (hr < 7 || hr >= 21.5) return null;
  const home = (r: Resident) => activityAt(r.sched, c.day, hr).act === "home";
  if (h.cls === "widow") {
    const w = resident(db, h.landlord);
    return w && home(w) ? w : null;
  }
  let best: Resident | null = null;
  let bd = 30;
  for (const r of town(db).town.residents) {
    if (r.age < 16 || r.home.house === h.house || !home(r)) continue;
    const d = Math.hypot(r.home.sx - h.step[0], r.home.sz - h.step[1]);
    if (d < bd) [best, bd] = [r, d];
  }
  return best;
}

/** What they see, in words: the room, its pieces, and how it feels. Never a number. */
export function roomFacts(db: DB, h: HomeDef): { pieces: string[]; words: string[] } {
  const placed = placedIn(db, h.id);
  const pieces = [...new Set(placed.map((p) => FURNITURE[p.kind].name))];
  return { pieces, words: comfortWords(comfortOf(h.cls as HomeClass, placed)) };
}

export function fallbackRemark(r: Resident, h: HomeDef, f: { pieces: string[]; words: string[] }): string {
  const bare = f.pieces.length === 0;
  const warm = r.stats.warmth >= 6;
  if (h.cls === "widow") return bare ? "Keep it tidy, and no visitors after nine. The walls are thin." : `${f.pieces.length > 2 ? "Well now, you have made it quite homely." : "A few things of your own. Good."} Mind my floor.`;
  if (bare) return warm ? "Bare as a church, this. You'll want a stool at least." : "Nothing in it but you. The last one left owing, too.";
  if (f.words[0] === "warm") return "Warm in here. Warmer than my place, I'll say that.";
  return warm ? `So you've got ${f.pieces[0]}. It suits the place.` : `${f.pieces[0][0].toUpperCase()}${f.pieces[0].slice(1)}. Where did you find the money for that?`;
}

const RULES = `
YOU NOW WRITE ONE LINE: a townsperson looks in at the door of the room Jef rents and says something about it.
- One or two short sentences, at most 25 words, in their own voice by their stats. Nosy, kind, sour or proud as fits them.
- Only what they SEE (listed below). Never invent furniture, visitors or deeds.
- Never name a sum, a price, a number or a coin. Never promise, give or ask anything; it is only a remark.
- No oaths.
- ${LANGUAGE_RULE.replace(/\s*\n\s*/g, " ")}`;

const doneKey = (db: DB, home: string) => `home:remark:${clock(db).day}:${home}`;

/**
 * The remark for Jef's room now, if anyone looks in. At most once a game day per home;
 * the model's line if it comes in time and passes the guard, else the engine's.
 */
export async function remarkOnRoom(db: DB, runner?: Runner): Promise<Remark | null> {
  const l = lease(db);
  if (!l) return null;
  const h = homeDef(db, l.home);
  if (!h) return null;
  const key = doneKey(db, h.id);
  if (getState(db, key, null)) return null;
  const r = visitor(db, h);
  if (!r) return null;
  // the day's one look is spent now, whatever the model does
  setState(db, key, { who: r.id });
  const facts = roomFacts(db, h);
  const fb = fallbackRemark(r, h, facts);
  let line = fb;
  let source: Remark["source"] = "engine";
  if (canCallHome(db)) {
    const c = clock(db);
    const s = r.stats;
    const persona = personaLine(db, r.id);
    const prompt = `PERSON: ${r.name}, ${r.age}, ${r.sex === "f" ? "woman" : "man"}, ${TRADES[r.trade]?.label ?? r.trade}${h.cls === "widow" ? ", the widow who lets Jef the room" : ", a neighbour"}. Stats 0-10: warmth ${s.warmth}, temper ${s.temper}, gossip ${s.gossip}, greed ${s.greed}, piety ${s.piety}.${persona ? ` ${persona}` : ""}

THE ROOM: ${CLASSES[h.cls].label}, ${h.label.replace(CLASSES[h.cls].label, "").trim()}.
It came with: ${CLASSES[h.cls].fixed.map((f) => f.kind.replace(/_/g, " ")).join(", ")}.
Jef's own things in it: ${facts.pieces.length ? facts.pieces.join(", ") : "nothing yet"}.
It feels: ${facts.words.join(", ")}.
NOW: ${c.weekday}, ${c.hour}:${String(c.minute).padStart(2, "0")}, ${WEATHER_TEXT[c.weather]}.`;
    const res = await callClaude(db, { hook: "home_remark", system: SYSTEM + "\n" + RULES, prompt, schema: RemarkSchema, timeoutMs: callTimeout() }, runner);
    const ok = res.ok && res.data ? cleanLine(res.data.line, 160) : null;
    if (ok && !/\b(give|take|pay|owe|lend|borrow|free|gift)\b/i.test(ok)) {
      line = ok;
      source = "claude";
    }
  }
  remember(db, r.id, `I looked in at Jef's room: ${facts.pieces.length ? facts.pieces.join(", ") : "bare"}, ${facts.words.join(", ")}.`, 2);
  return { who: { id: r.id, name: r.name, first: r.first, kind: r.kind, sex: r.sex, age: r.age }, line, source };
}
