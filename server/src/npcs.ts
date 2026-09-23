import { z } from "zod";
import { LANGUAGE_RULE, plainEnglish } from "./text.ts";
import type { DB } from "./db.ts";
import { FACTIONS } from "./db.ts";
import { callClaude, type Runner } from "./ai/claude.ts";
import { SYSTEM } from "./hooks/jobBoard.ts";

// NPCs as three records (docs/03): persona, relationship with Jef, memories.
// Only one NPC's slice ever goes into a prompt.

/** NPCs standing on the Rijnkaai in M3, with the seed Claude writes a persona from. */
export const PLACED: Record<string, string> = {
  sooi:
    "Foreman of the Hessenatie on the Rijnkaai, in his fifties. Gruff and fair. Hires day men at dawn at the board by the Hessenatie door. Hates slackers, thieves and men who talk to the police.",
  peeters:
    "Widow who has run a ship chandlery on the Rijnkaai since her husband drowned. Careful with money, sharp with figures, remembers every favour and every slight.",
  tuur:
    "Ferryman on the Scheldt and a night lighter. Rows people to Sint-Anna by day and moves goods nobody asks about by night. Pays for silence. Friendly until he is not.",
  fientje:
    "Fishwife from the Vismarkt who sells from a cart on the Rijnkaai in the mornings. Knows everyone's business and tells it, often wrong in the details. Loud, warm, never quiet for long.",
};

const trait = z.number().int().min(0).max(10);
export const PersonaSchema = z.object({
  traits: z.object({ warmth: trait, greed: trait, honesty: trait, temper: trait, loyalty: trait, courage: trait, piety: trait }),
  loves: z.enum([...FACTIONS, "none"]),
  hates: z.enum([...FACTIONS, "none"]),
  wants: z.array(z.string().max(90)).length(2),
  fears: z.array(z.string().max(90)).length(2),
  secret: z.string().max(180),
  speech: z.object({
    tics: z.array(z.string().max(70)).length(3),
    length: z.enum(["short", "mid"]),
  }),
  look: z.string().max(160),
});
export type Persona = z.infer<typeof PersonaSchema>;

/** Hand-written personas, used when Claude is late or wrong. */
export const FALLBACK_PERSONA: Record<string, Persona> = {
  sooi: {
    traits: { warmth: 4, greed: 3, honesty: 7, temper: 7, loyalty: 8, courage: 6, piety: 4 },
    loves: "naties",
    hates: "politie",
    wants: ["a crew that works without being watched", "the Hessenatie to beat the Katoennatie to the new ships"],
    fears: ["his knees giving out before his sons are grown", "a cargo lost on his watch"],
    secret: "He once let a smuggler's barrels through the Hessenatie shed for a month's wages.",
    speech: { tics: ["Right.", "Out with it.", "I don't pay for talk."], length: "short" },
    look: "Broad, grey stubble, a docker's cap and a coat gone shiny at the elbows.",
  },
  peeters: {
    traits: { warmth: 5, greed: 7, honesty: 6, temper: 4, loyalty: 6, courage: 5, piety: 7 },
    loves: "burgerij",
    hates: "smokkelaars",
    wants: ["to keep the chandlery out of debt", "a son who comes home sober"],
    fears: ["the bank", "dying alone above the shop"],
    secret: "Her husband did not drown by accident; she knows who pushed him.",
    speech: { tics: ["Count it twice.", "We shall see.", "Hm."], length: "mid" },
    look: "Small, in black, a ledger under her arm and spectacles on a ribbon.",
  },
  tuur: {
    traits: { warmth: 6, greed: 6, honesty: 3, temper: 5, loyalty: 5, courage: 7, piety: 2 },
    loves: "smokkelaars",
    hates: "politie",
    wants: ["a bigger boat", "Agent Verhulst looking the other way"],
    fears: ["the river at night when the fog is thick", "prison in the Steen"],
    secret: "He owes money to men from Rotterdam who are losing patience.",
    speech: { tics: ["Ask nothing.", "The river keeps quiet, so do I.", "Ha."], length: "short" },
    look: "Lean, tar on his hands, a sailor's jersey and a pipe that is never lit.",
  },
  fientje: {
    traits: { warmth: 8, greed: 5, honesty: 5, temper: 5, loyalty: 4, courage: 6, piety: 5 },
    loves: "none",
    hates: "none",
    wants: ["to know everything first", "a proper stall at the Vismarkt"],
    fears: ["being the one people talk about", "cholera coming back"],
    secret: "She cannot read, and hides it by making people tell her everything.",
    speech: { tics: ["You didn't hear it from me!", "Listen, listen.", "Mark my words."], length: "mid" },
    look: "Big red hands, a shawl, a basket of herring on her hip, a voice that carries.",
  },
};

export function npcRow(db: DB, id: string) {
  return db.prepare("SELECT id, name, role, district, faction, persona_json FROM npc WHERE id = ?").get(id) as
    | { id: string; name: string; role: string; district: string; faction: string | null; persona_json: string }
    | undefined;
}

export function persona(db: DB, id: string): Persona {
  const row = npcRow(db, id);
  const parsed = PersonaSchema.safeParse(JSON.parse(row?.persona_json || "{}"));
  const p = parsed.success ? parsed.data : FALLBACK_PERSONA[id];
  // personas written before the plain-English rule may carry Dutch words
  return { ...p, speech: { ...p.speech, tics: p.speech.tics.map(plainEnglish) } };
}

/** Write personas for placed NPCs that have none yet, one Claude call each. */
export async function ensurePersonas(db: DB, runner?: Runner): Promise<string[]> {
  const done: string[] = [];
  for (const [id, seed] of Object.entries(PLACED)) {
    const row = npcRow(db, id);
    if (!row || PersonaSchema.safeParse(JSON.parse(row.persona_json || "{}")).success) continue;
    const res = await callClaude(
      db,
      {
        hook: "persona",
        system: SYSTEM,
        prompt: `Write the persona of one person of the Rijnkaai, 1873.

NAME: ${row.name}
ROLE: ${row.role}
SEED: ${seed}

- traits: 0-10 each. Make them uneven; nobody is average at everything.
- loves / hates: one faction each (${FACTIONS.join(", ")}) or "none".
- wants, fears: two each, concrete and period-true.
- secret: one thing they would not want known on the kaai.
- speech: three verbal tics (short English phrases they repeat) and whether they talk short or mid-length.
${LANGUAGE_RULE}
- look: one line, what Jef sees.`,
        schema: PersonaSchema,
      },
      runner,
    );
    const p = res.ok && res.data ? res.data : FALLBACK_PERSONA[id];
    db.prepare("UPDATE npc SET persona_json = ? WHERE id = ?").run(JSON.stringify(p), id);
    done.push(`${id}:${res.ok ? "claude" : "fallback"}`);
  }
  return done;
}

// ------------------------------------------------------------------ relationship

export interface Relationship {
  trust: number;
  affection: number;
  respect: number;
  fear: number;
  times_met: number;
  last_seen_day: number | null;
  last_place: string | null;
  view_of_player: string;
}

export function relationship(db: DB, id: string): Relationship {
  return db
    .prepare("SELECT trust, affection, respect, fear, times_met, last_seen_day, last_place, view_of_player FROM npc_relationship WHERE npc_id = ?")
    .get(id) as Relationship;
}

/** Trust moves by at most 2 per conversation (docs/03 clamp). */
export function applyTrust(db: DB, id: string, delta: number, soFar: number): number {
  const clamped = Math.max(-2 - soFar, Math.min(2 - soFar, Math.round(delta)));
  const d = Math.max(-2, Math.min(2, clamped));
  if (d) db.prepare("UPDATE npc_relationship SET trust = MAX(0, MIN(10, trust + ?)) WHERE npc_id = ?").run(d, id);
  return d;
}

// ------------------------------------------------------------------ memory

export interface Memory {
  id: number;
  text: string;
  source: "seen" | "heard";
  heard_from: string | null;
  weight: number;
  day: number;
}

export function topMemories(db: DB, id: string, n = 8): Memory[] {
  return db
    .prepare("SELECT id, text, source, heard_from, weight, day FROM npc_memory WHERE npc_id = ? ORDER BY weight DESC, id DESC LIMIT ?")
    .all(id, n) as Memory[];
}

export function remember(db: DB, id: string, text: string, weight: number, source: "seen" | "heard" = "seen", from: string | null = null): void {
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  db.prepare("INSERT INTO npc_memory (npc_id, text, source, heard_from, weight, day) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    text.trim().slice(0, 200),
    source,
    from,
    Math.max(1, Math.min(10, Math.round(weight))),
    day,
  );
  spreadGossip(db);
}

/**
 * Gossip rule (docs/03): a "seen" memory of weight 6+ reaches Fientje as
 * "heard", two points lighter. She receives everything. Runs after every new
 * memory; each memory spreads once. (At sleep, M5 spreads to others too.)
 */
export function spreadGossip(db: DB): number {
  const rows = db
    .prepare("SELECT m.id, m.npc_id, m.text, m.weight, n.name FROM npc_memory m JOIN npc n ON n.id = m.npc_id WHERE m.source = 'seen' AND m.weight >= 6 AND m.spread = 0 AND m.npc_id <> 'fientje'")
    .all() as Array<{ id: number; npc_id: string; text: string; weight: number; name: string }>;
  const day = (db.prepare("SELECT day FROM player WHERE id = 1").get() as { day: number }).day;
  for (const r of rows) {
    db.prepare("INSERT INTO npc_memory (npc_id, text, source, heard_from, weight, day, spread) VALUES ('fientje', ?, 'heard', ?, ?, ?, 1)").run(
      `${r.name} was saying: ${r.text}`,
      r.npc_id,
      Math.max(1, r.weight - 2),
      day,
    );
    db.prepare("UPDATE npc_memory SET spread = 1 WHERE id = ?").run(r.id);
  }
  return rows.length;
}
