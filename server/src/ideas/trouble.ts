import { z } from "zod";
import type { DB } from "../db.ts";
import { callClaude, type Runner } from "../ai/claude.ts";
import { weather } from "../day.ts";
import { writeEvent } from "../director/eventlog.ts";
import { GameError, job, log, player, settleExtras, type Settlement } from "../game.ts";
import { ALL_EMPLOYERS, SPOTS, type JobRow } from "../hooks/jobBoard.ts";
import { remember } from "../npcs.ts";
import { LANGUAGE_RULE, plainEnglish } from "../text.ts";
import { rngFrom } from "../town/population.ts";
import { town } from "../town/store.ts";
import { noteOnRecord, policePost } from "../town/police.ts";
import { canCallIdeas, clamp, d2, digitsOf, GIFTS, namesOk, now, numbersOk, OUT_OF_WORLD, round5 } from "./common.ts";

// Jobs that go wrong (M6 AI ideas). Sometimes, on a running job, there is trouble:
// a stowaway in a crate, a crate that breaks, a suspicious customs officer, a rival
// who wants the load, the weather. The ENGINE picks the trouble from this fixed list,
// casts the people, and sets every number: the pay change (within a cap of a quarter
// of the pay, at most 40 centimes), money now (at most 30 in, 20 out), an extra step
// to walk, a roll and its odds. Jef picks one of 2 or 3 engine options; the engine
// resolves it now (money, a memory, the police record) and at the end of the job (the
// pay change, trust). The model only words the scene, the people's lines, the options
// and what follows each; words with a number, a name or a promise the engine did not
// give fall back to the engine's words.

export type TroubleKind = "stowaway" | "broken_crate" | "customs" | "rival" | "weather";
export const TROUBLE_KINDS: TroubleKind[] = ["stowaway", "broken_crate", "customs", "rival", "weather"];

/** Chance of trouble when a job is taken, and at most this many a day. */
export const TROUBLE_CHANCE = 0.3;
export const TROUBLES_A_DAY = 2;
/** Caps (engine): money in now, money out now. The pay change is capped by capFor(). */
export const NOW_IN_MAX = 30;
export const NOW_OUT_MAX = 20;
const REACH_M = 4;

export interface Step {
  x: number;
  z: number;
  label: string;
  /** Pay change at the end when the step is done, and when it is not. */
  done_c: number;
  missed_c: number;
}

export interface Roll {
  /** Chance the bad thing happens (engine). */
  p: number;
  pay_c: number;
  trust: number;
  police?: boolean;
  what: string;
}

export interface TroubleOption {
  /** Engine's own label and follow-up line (the fallback words). */
  label: string;
  after: string;
  after_bad?: string;
  /** Money into Jef's hand now (from other hands), or out of it now (a bribe). */
  now_in_c?: number;
  now_out_c?: number;
  /** Pay change at the end, whatever happens, and trust with the employer's faction. */
  pay_c?: number;
  trust?: number;
  step?: Step;
  roll?: Roll;
  /** Engine facts for the log and the outcome writer. */
  fact: string;
}

export interface CastMember {
  id: string | null;
  name: string;
  role: string;
}

export interface TroubleWords {
  scene: string;
  lines: Array<{ who: number; text: string }>;
  options: Array<{ label: string; after: string; after_bad: string }>;
}

export interface TroubleRow {
  id: number;
  job_id: number;
  day: number;
  kind: TroubleKind;
  after_s: number;
  cast_json: string;
  options_json: string;
  words_json: string;
  source: string;
  status: "ready" | "chosen" | "settled";
  choice: number | null;
  step_done: number;
  result_json: string;
}

/** The most the pay may move either way: a quarter of it, at most 40 centimes, at least 5. */
export function capFor(pay: number): number {
  return clamp(round5(pay * 0.25), 5, 40);
}

/** Which troubles fit this job. */
export function fitting(j: JobRow, w: string): TroubleKind[] {
  const t = j.task;
  if (!t) return [];
  const out: TroubleKind[] = [];
  if (t.kind === "carry") {
    if (t.goods === "crates" || t.goods === "barrels" || t.goods === "chests") out.push("stowaway", "broken_crate");
    out.push("rival");
  }
  if (t.kind === "carry" || t.kind === "deliver") out.push("customs");
  if (t.kind === "watch") out.push("rival");
  if (t.kind === "carry" || t.kind === "deliver" || t.kind === "watch" || t.kind === "letters") if (w !== "clear" || t.kind !== "letters") out.push("weather");
  return out;
}

const spotOf = (id: string) => (SPOTS as Record<string, { x: number; z: number; label: string }>)[id];

/** The engine's trouble for a job: kind, cast and options with all their numbers. */
export function planTrouble(db: DB, j: JobRow, rng: () => number, force?: TroubleKind): { kind: TroubleKind; cast: CastMember[]; options: TroubleOption[]; after_s: number } | null {
  const w = weather(db);
  const kinds = fitting(j, w);
  const kind = force && kinds.includes(force) ? force : force ? null : kinds[Math.floor(rng() * kinds.length)];
  if (!kind) return null;
  const pay = j.pay_c;
  const cap = capFor(pay);
  const half = round5(cap / 2) || 5;
  const who = j.employer_name;
  const emp = ALL_EMPLOYERS[j.employer_npc];
  const door = emp ? spotOf(emp.door) : null;
  const chandler = spotOf("peeters_dock");
  const pp = policePost();
  const cast: CastMember[] = [];
  let options: TroubleOption[] = [];
  const count = j.task?.kind === "carry" ? j.task.count : 1;
  switch (kind) {
    case "stowaway": {
      cast.push({ id: null, name: "a thin boy of about twelve", role: "a stowaway, hidden in a crate from the ship" });
      options = [
        {
          label: "Take him to the police post",
          after: "You walk him up to the police post by the town hall.",
          step: { x: pp.x, z: pp.z, label: pp.label, done_c: half, missed_c: 0 },
          fact: "Jef found a stowaway boy in a crate and took him to the police post.",
        },
        {
          label: "Let him slip away",
          after: "He is gone between the sheds before anyone looks up.",
          after_bad: `${who} heard of it and is not pleased.`,
          roll: { p: 0.4, pay_c: 0, trust: -1, what: `${who} found out Jef let a stowaway go.` },
          fact: "Jef found a stowaway boy in a crate and let him go.",
        },
        {
          label: `Tell ${who}'s man`,
          after: "The man takes the boy by the ear. The work goes on.",
          pay_c: 5,
          fact: `Jef found a stowaway boy in a crate and handed him to ${who}'s man.`,
        },
      ];
      break;
    }
    case "broken_crate": {
      cast.push({ id: null, name: `${who}'s tally man`, role: "counts the goods" });
      options = [
        { label: "Own up to it", after: "The tally man writes it down. It will come off your pay, but he nods at you.", pay_c: -half, trust: 1, fact: "A crate broke in Jef's hands and he owned up to it." },
        {
          label: "Fetch nails at the chandler's and mend it",
          after: "Nails, a borrowed hammer, and the lid is shut again.",
          step: chandler ? { x: chandler.x, z: chandler.z, label: "the chandlery on the Rijnkaai", done_c: 0, missed_c: -cap } : undefined,
          fact: "A crate broke in Jef's hands; he went for nails to mend it.",
        },
        {
          label: "Hide it among the others",
          after: "You turn the split side to the wall. Nobody seems to see.",
          after_bad: "The tally man found the broken crate you hid.",
          roll: { p: 0.5, pay_c: -cap, trust: -1, what: "The broken crate Jef hid was found." },
          fact: "A crate broke in Jef's hands and he hid it among the others.",
        },
      ];
      if (!options[1].step) options.splice(1, 1);
      break;
    }
    case "customs": {
      const officers = town(db).town.residents.filter((r) => r.trade === "customs");
      const o = officers.length ? officers[Math.floor(rng() * officers.length)] : null;
      cast.push({ id: o?.id ?? null, name: o?.name ?? "a customs officer", role: "customs officer, suspicious of the load" });
      const bribe = 10;
      options = [
        { label: "Wait while he checks the load", after: "He takes his time over every mark. You lose half an hour.", pay_c: -5, fact: "A customs officer stopped Jef's load and checked it slowly." },
        {
          label: `Fetch the papers from ${who}`,
          after: `${who} sends the papers with a curse for the customs. All in order.`,
          trust: 1,
          step: door ? { x: door.x, z: door.z, label: `${who}'s door`, done_c: 0, missed_c: -cap } : undefined,
          fact: `A customs officer stopped Jef's load; Jef went to ${who} for the papers.`,
        },
        {
          label: `Slip him ${bribe} centimes`,
          after: "The coins vanish into his glove. He waves you on.",
          after_bad: "He took the coins, and then he told his sergeant.",
          now_out_c: bribe,
          roll: { p: 0.3, pay_c: 0, trust: -1, police: true, what: `Jef offered a customs officer ${bribe} centimes to look away, and the officer reported it.` },
          fact: `Jef paid a customs officer ${bribe} centimes to look away.`,
        },
      ];
      if (!options[1].step) options.splice(1, 1);
      if (player(db).money_c < bribe) options = options.filter((x) => !x.now_out_c);
      break;
    }
    case "rival": {
      const rivals = town(db).town.residents.filter((r) => (r.trade === "docker" || r.trade === "natie") && r.age >= 18);
      const r = rivals.length ? rivals[Math.floor(rng() * rivals.length)] : null;
      cast.push({ id: r?.id ?? null, name: r?.name ?? "a docker of another natie", role: "a rival docker who wants the load and the pay" });
      const share = 20;
      const oneLoad = round5(pay / Math.max(1, count));
      options = [
        {
          label: "Send him off",
          after: "He spits, looks you over, and goes.",
          after_bad: `He went straight to ${who} with a story about you.`,
          roll: { p: r ? clamp(0.1 + r.stats.temper / 25, 0.1, 0.45) : 0.3, pay_c: -half, trust: 0, what: `A rival docker complained about Jef to ${who}.` },
          fact: "A rival docker wanted Jef's load; Jef sent him off.",
        },
        {
          label: `Let him carry one load for ${share} centimes`,
          after: "He counts the coins into your hand and shoulders one load.",
          after_bad: `${who}'s man saw another man carrying your load.`,
          now_in_c: share,
          pay_c: -Math.min(cap, oneLoad),
          roll: { p: 0.35, pay_c: -cap + Math.min(cap, oneLoad), trust: -1, what: `${who} found out Jef sold a load of his work to another man.` },
          fact: `Jef let a rival docker carry one load for ${share} centimes.`,
        },
        {
          label: `Call ${who}`,
          after: `${who} comes out and the rival slinks away. "Good man."`,
          step: door ? { x: door.x, z: door.z, label: `${who}'s door`, done_c: half, missed_c: 0 } : undefined,
          fact: `A rival docker wanted Jef's load; Jef went for ${who}.`,
        },
      ];
      if (!options[2].step) options.splice(2, 1);
      break;
    }
    case "weather": {
      const wet = w === "rain" || w === "storm";
      cast.push({ id: null, name: `${who}'s man`, role: "an old hand" });
      options = [
        {
          label: "Push on",
          after: "You bend your head and keep going.",
          after_bad: wet ? "One load got soaked through; it will come off your pay." : "In the murk you set one load down at the wrong door.",
          roll: { p: 0.4, pay_c: -half, trust: 0, what: wet ? "One of Jef's loads got soaked in the squall." : "In the fog Jef set a load down in the wrong place." },
          fact: wet ? "A squall came over the river; Jef pushed on." : "The fog came down thick; Jef pushed on.",
        },
        { label: "Wait it out under the shed", after: "You wait under the eaves till the worst is over. The foreman grumbles at the time.", pay_c: -5, fact: "Jef waited out the weather under a shed." },
        {
          label: "Fetch a tarpaulin from the chandler's",
          after: "A tarred sheet over the goods. The old hand nods: that is how it is done.",
          step: chandler ? { x: chandler.x, z: chandler.z, label: "the chandlery on the Rijnkaai", done_c: half, missed_c: 0 } : undefined,
          fact: "Jef fetched a tarpaulin from the chandler's to keep the goods dry.",
        },
      ];
      if (!options[2].step) options.splice(2, 1);
      break;
    }
  }
  // the engine's clamps, whatever the table above says
  for (const o of options) {
    if (o.pay_c) o.pay_c = clamp(o.pay_c, -cap, cap);
    if (o.now_in_c) o.now_in_c = clamp(o.now_in_c, 0, NOW_IN_MAX);
    if (o.now_out_c) o.now_out_c = clamp(o.now_out_c, 0, NOW_OUT_MAX);
    if (o.trust) o.trust = clamp(o.trust, -1, 1);
    if (o.step) {
      o.step.done_c = clamp(o.step.done_c, -cap, cap);
      o.step.missed_c = clamp(o.step.missed_c, -cap, cap);
    }
    if (o.roll) {
      o.roll.p = clamp(o.roll.p, 0, 1);
      o.roll.pay_c = clamp(o.roll.pay_c, -cap, cap);
      o.roll.trust = clamp(o.roll.trust, -1, 1);
    }
  }
  if (options.length < 2) return null;
  const after_s = 18 + Math.floor(rng() * 20);
  return { kind, cast, options, after_s };
}

// ------------------------------------------------------------------ words

export const TroubleWordsSchema = z.object({
  scene: z.string().min(20).max(420),
  lines: z.array(z.object({ who: z.number().int(), text: z.string().min(2).max(180) })).min(1).max(4),
  options: z.array(z.object({ n: z.number().int(), label: z.string().min(3).max(80), after: z.string().min(5).max(220), after_bad: z.string().max(220) })).min(2).max(3),
});
export type TroubleWordsOut = z.infer<typeof TroubleWordsSchema>;

export const TROUBLE_SYSTEM = `You write short scenes for Scheldemist, a game set on the quays of Antwerp, October 1873.
Jef, a farm boy from the Kempen, new in the city, is doing a day labourer's job when something goes wrong.
The engine has decided what went wrong, who is there, and what Jef can do (the OPTIONS, with their outcomes).
You only write the words: the scene, what the people say, the options as Jef would think them, and what follows each.

${LANGUAGE_RULE}
No modern words. No exclamation storms. Nobody is hurt; no weapons.
Never add a sum, a number, a name, a reward or a punishment that is not in the facts. Keep to the JSON schema.`;

export function troublePrompt(j: JobRow, plan: { kind: TroubleKind; cast: CastMember[]; options: TroubleOption[] }): string {
  const t = j.task;
  const what = t?.kind === "carry" ? `carrying ${t.count} ${t.goods} for ${j.employer_name}` : t?.kind === "deliver" ? `delivering a ${t.goods} for ${j.employer_name}` : t?.kind === "watch" ? `watching ${t.goods} for ${j.employer_name}` : `a job for ${j.employer_name}`;
  const kinds: Record<TroubleKind, string> = {
    stowaway: "A crate from the ship has a stowaway in it: a thin boy of about twelve, frightened, who begs Jef not to give him up.",
    broken_crate: "A crate splits in Jef's hands; the goods show through the boards.",
    customs: "A customs officer stops the load and wants to see the papers; he suspects something.",
    rival: "A docker from another natie wants the load, and the pay, for himself.",
    weather: "The weather turns bad over the river while the goods are out.",
  };
  return `THE JOB: Jef is ${what}.
WHAT WENT WRONG (engine): ${kinds[plan.kind]}

PEOPLE (by number)
${plan.cast.map((c, i) => `${i}. ${c.name}: ${c.role}`).join("\n")}

OPTIONS (engine; number, what Jef does, what follows; "if unlucky" only where there is a risk)
${plan.options.map((o, i) => `${i + 1}. ${o.label}. Then: ${o.after}${o.after_bad ? ` If unlucky: ${o.after_bad}` : ""}`).join("\n")}

WRITE
- scene: 2 or 3 short sentences, what Jef sees.
- lines: 1 to 3 lines spoken by the people above ("who" = their number), in character.
- options: for each option by number ("n"): label (a few words, as Jef would think it, keeping any sum), after (one sentence), after_bad (one sentence, or "" where there is no risk).`;
}

export function engineWords(plan: { kind: TroubleKind; cast: CastMember[]; options: TroubleOption[] }): TroubleWords {
  const scenes: Record<TroubleKind, string> = {
    stowaway: "The crate is too heavy on one side. You lift the lid an inch: two eyes look back at you. A thin boy, filthy, shaking.",
    broken_crate: "The boards give under your hands with a crack. The side splits, and the goods show through.",
    customs: "A man in the green coat of the customs steps in front of you and holds up a hand. He looks at the marks on the load for a long time.",
    rival: "A big docker from another natie plants himself in your way. He has been watching you work.",
    weather: "The sky over the river goes dark in a minute. The wind picks up and the first of it comes over the quay.",
  };
  const lines: Record<TroubleKind, string> = {
    stowaway: "Please, mister. Don't give me up. I only want to get to America.",
    broken_crate: "That will be counted, you know.",
    customs: "Papers for this. Now, if you please.",
    rival: "That is natie work, farm boy. Give it here, or share the pay.",
    weather: "You will not want those goods out in this.",
  };
  return {
    scene: scenes[plan.kind],
    lines: [{ who: 0, text: lines[plan.kind] }],
    options: plan.options.map((o) => ({ label: o.label, after: o.after, after_bad: o.after_bad ?? "" })),
  };
}

/** Check the model's words: each field on its own, the engine's where it fails. */
export function cleanWords(db: DB, j: JobRow, plan: { cast: CastMember[]; options: TroubleOption[] }, out: TroubleWordsOut, fallback: TroubleWords): TroubleWords {
  const names = [j.employer_name, ...plan.cast.map((c) => c.name)];
  const ok = (s: string, nums: string[]) => numbersOk(s, nums) && namesOk(db, s, names, true) && !OUT_OF_WORLD.test(s) && !GIFTS.test(s) && !/\b(knife|pistol|gun|blood|stab|kill|wound)\w*/i.test(s);
  const scene = plainEnglish(out.scene);
  const lines = out.lines
    .filter((l) => l.who >= 0 && l.who < plan.cast.length)
    .map((l) => ({ who: l.who, text: plainEnglish(l.text) }))
    .filter((l) => ok(l.text, []))
    .slice(0, 3);
  return {
    scene: ok(scene, []) ? scene : fallback.scene,
    lines: lines.length ? lines : fallback.lines,
    options: plan.options.map((o, i) => {
      const m = out.options.find((x) => x.n === i + 1);
      const nums = digitsOf(o.label);
      const fb = fallback.options[i];
      if (!m) return fb;
      const label = plainEnglish(m.label);
      const after = plainEnglish(m.after);
      const bad = plainEnglish(m.after_bad);
      // a sum in the engine's label must stay in the model's label
      const keepsSum = nums.every((d) => label.includes(d));
      return {
        label: ok(label, nums) && keepsSum ? label : fb.label,
        after: ok(after, []) ? after : fb.after,
        after_bad: o.after_bad ? (bad && ok(bad, []) ? bad : fb.after_bad) : "",
      };
    }),
  };
}

// ------------------------------------------------------------------ the running job

export function troubleOf(db: DB, jobId: number): TroubleRow | null {
  return (db.prepare("SELECT * FROM job_trouble WHERE job_id = ?").get(jobId) as TroubleRow | undefined) ?? null;
}

/**
 * When a job is taken: maybe trouble (the engine rolls, at most two a day). The words come
 * later (the model), the engine's are there at once. Returns the row, or null.
 */
export async function maybeTrouble(db: DB, jobId: number, opts: { runner?: Runner; timeoutMs?: number; rng?: () => number; force?: TroubleKind } = {}): Promise<TroubleRow | null> {
  const j = job(db, jobId);
  if (j.status !== "taken" || troubleOf(db, jobId)) return null;
  const { day } = now(db);
  const rng = opts.rng ?? rngFrom(((town(db).town.seed || 1873) * 41 + jobId * 7717) >>> 0);
  if (!opts.force) {
    const today = (db.prepare("SELECT COUNT(*) AS n FROM job_trouble WHERE day = ?").get(day) as { n: number }).n;
    if (today >= TROUBLES_A_DAY || rng() > TROUBLE_CHANCE) return null;
  }
  const plan = planTrouble(db, j, rng, opts.force);
  if (!plan) return null;
  const fb = engineWords(plan);
  const id = Number(
    db
      .prepare("INSERT INTO job_trouble (job_id, day, kind, after_s, cast_json, options_json, words_json, source, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'engine', 'ready')")
      .run(jobId, day, plan.kind, plan.after_s, JSON.stringify(plan.cast), JSON.stringify(plan.options), JSON.stringify(fb)).lastInsertRowid,
  );
  if (canCallIdeas(db)) {
    const res = await callClaude(db, { hook: "trouble", system: TROUBLE_SYSTEM, prompt: troublePrompt(j, plan), schema: TroubleWordsSchema, timeoutMs: opts.timeoutMs }, opts.runner);
    if (res.ok && res.data) {
      const words = cleanWords(db, j, plan, res.data, fb);
      db.prepare("UPDATE job_trouble SET words_json = ?, source = 'claude' WHERE id = ? AND status = 'ready'").run(JSON.stringify(words), id);
    }
  }
  return troubleOf(db, jobId);
}

/** What the client shows (no odds: the rolls stay the engine's). */
export function troubleView(db: DB, jobId: number) {
  const t = troubleOf(db, jobId);
  if (!t) return null;
  const words = JSON.parse(t.words_json) as TroubleWords;
  const cast = JSON.parse(t.cast_json) as CastMember[];
  const options = JSON.parse(t.options_json) as TroubleOption[];
  const result = JSON.parse(t.result_json) as { text?: string; step?: Step | null };
  return {
    id: t.id,
    job_id: t.job_id,
    kind: t.kind,
    after_s: t.after_s,
    status: t.status,
    source: t.source,
    scene: words.scene,
    lines: words.lines.map((l) => ({ name: cast[l.who]?.name ?? "", who: cast[l.who]?.id ?? null, text: l.text })),
    options: words.options.map((o, i) => ({ n: i + 1, label: o.label, step: options[i]?.step ? { x: options[i].step!.x, z: options[i].step!.z, label: options[i].step!.label } : null })),
    choice: t.choice,
    result: result.text ?? null,
    step: t.status === "chosen" && result.step && !t.step_done ? { x: result.step.x, z: result.step.z, label: result.step.label } : null,
    step_done: !!t.step_done,
  };
}

/** Jef picks an option: the engine rolls and applies what happens now. */
export function chooseTrouble(db: DB, id: number, n: number, rng: () => number = Math.random): { text: string; money_c: number } {
  const t = db.prepare("SELECT * FROM job_trouble WHERE id = ?").get(id) as TroubleRow | undefined;
  if (!t) throw new GameError("no such trouble", 404);
  if (t.status !== "ready") throw new GameError("that is settled already", 409);
  const j = job(db, t.job_id);
  if (j.status !== "taken") throw new GameError("the job is over", 409);
  const options = JSON.parse(t.options_json) as TroubleOption[];
  const words = JSON.parse(t.words_json) as TroubleWords;
  const o = options[n - 1];
  if (!Number.isInteger(n) || !o) throw new GameError("no such choice", 400);
  const bad = o.roll ? rng() < o.roll.p : false;
  const p = player(db);
  const out = o.now_out_c ? Math.min(o.now_out_c, p.money_c) : 0;
  const cast = JSON.parse(t.cast_json) as CastMember[];
  const text = (bad ? words.options[n - 1]?.after_bad || o.after_bad : words.options[n - 1]?.after || o.after) ?? o.after;
  db.transaction(() => {
    db.prepare("UPDATE job_trouble SET status = 'chosen', choice = ?, result_json = ? WHERE id = ?").run(n, JSON.stringify({ bad, text, step: o.step ?? null }), id);
    const delta = (o.now_in_c ?? 0) - out;
    if (delta) db.prepare("UPDATE player SET money_c = MAX(0, money_c + ?) WHERE id = 1").run(delta);
    log(db, "job_trouble", String(t.job_id), `${o.fact}${bad && o.roll ? ` ${o.roll.what}` : ""}`);
  })();
  if (bad && o.roll?.police) noteOnRecord(db, o.roll.what);
  const other = cast[0]?.id;
  if (other) remember(db, other, `On the quay, ${o.fact.replace(/^Jef/, "Jef, the new day labourer,")}`, 4);
  remember(db, j.employer_npc, bad && o.roll ? o.roll.what : o.fact, bad ? 5 : 3);
  writeEvent(db, { kind: "job", verb: "job_trouble", text: `${o.fact}${bad && o.roll ? ` ${o.roll.what}` : ""}`, actor: j.employer_npc, target: other ?? null, weight: bad ? 5 : 4, data: { kind: t.kind, choice: n, bad } });
  return { text: o.step ? `${text} (Go to ${o.step.label}.)` : text, money_c: player(db).money_c };
}

/** The extra step: Jef is at the place. */
export function troubleStep(db: DB, id: number, at: { x: number; z: number }): { text: string } {
  const t = db.prepare("SELECT * FROM job_trouble WHERE id = ?").get(id) as TroubleRow | undefined;
  if (!t || t.status !== "chosen") throw new GameError("nothing to do there", 409);
  const r = JSON.parse(t.result_json) as { step?: Step | null };
  if (!r.step || t.step_done) throw new GameError("nothing to do there", 409);
  if (!Number.isFinite(at.x) || !Number.isFinite(at.z) || d2(at, r.step) > REACH_M) throw new GameError("you are not there yet", 409);
  db.prepare("UPDATE job_trouble SET step_done = 1 WHERE id = ?").run(id);
  log(db, "job_trouble_step", String(t.job_id), `Jef went to ${r.step.label} about the trouble on his job.`);
  return { text: `Done at ${r.step.label}. Back to the work.` };
}

/** At the end of the job: the engine's pay change and trust, within the caps. */
export function settleTrouble(db: DB, j: JobRow, s: Settlement): void {
  const t = troubleOf(db, j.id);
  if (!t || t.status === "settled") return;
  if (t.status === "ready") {
    db.prepare("UPDATE job_trouble SET status = 'settled' WHERE id = ?").run(t.id);
    return;
  }
  const o = (JSON.parse(t.options_json) as TroubleOption[])[(t.choice ?? 1) - 1];
  const r = JSON.parse(t.result_json) as { bad?: boolean };
  if (!o) return;
  const cap = capFor(j.pay_c);
  let pay = o.pay_c ?? 0;
  let trust = o.trust ?? 0;
  if (o.step) pay += t.step_done ? o.step.done_c : o.step.missed_c;
  if (r.bad && o.roll) {
    pay += o.roll.pay_c;
    trust += o.roll.trust;
  }
  pay = clamp(pay, -cap, cap);
  trust = clamp(trust, -1, 1);
  // never pay for trouble on a job that paid nothing (caught, failed)
  if (s.pay_c > 0) s.pay_c = Math.max(0, s.pay_c + pay);
  s.trust_delta = clamp(s.trust_delta + trust, -2, 2);
  s.facts.push(o.fact + (o.step && !t.step_done ? ` He never went to ${o.step.label}.` : "") + (r.bad && o.roll ? ` ${o.roll.what}` : ""));
  db.prepare("UPDATE job_trouble SET status = 'settled', result_json = ? WHERE id = ?").run(JSON.stringify({ ...JSON.parse(t.result_json), pay_c: pay, trust }), t.id);
}

settleExtras.push(settleTrouble);
