import { talkExtras } from "../town/talk.ts";
import { NIGHT_GIVER_IDS } from "../../../shared/night.ts";

// M7 night: how the givers of night work talk (the ordinary resident talk, town/talk.ts, with their own
// greeting, their own answer about themselves, and a line for the model's prompt). Engine words; the
// work they offer is the night board's (nightwork.ts), shown in the talk window as any employer's.

const IDS = new Set<string>(NIGHT_GIVER_IDS);

const GREET: Record<string, string[]> = {
  fence: ["Evening. Keep your voice down; sound carries on the water.", "You're out late. Looking to earn, or looking to buy?"],
  smuggler: ["Not so loud. The water police sleep light.", "Evening. You've a strong back, by the look of you."],
  nightcarter: ["Evening. Don't ask whose barrels. Ask what it pays.", "You walk about late for a farm boy."],
  cracksman: ["Evening. You've good eyes? Good. Keep them open.", "Walk on, unless you want work that pays better than the day's."],
};

const SELF: Record<string, string> = {
  fence: "I buy and I sell. What, is my business. Who from, is nobody's.",
  smuggler: "I bring things ashore that the customs never hear of. The river is wide and the night is long.",
  nightcarter: "I move barrels at night for men who pay in coin and give no names. Suits me.",
  cracksman: "I see to doors. Some want seeing to at night. A man needs somebody watching the street.",
};

talkExtras.greet.push((_db, r, _mood, met) => {
  if (!IDS.has(r.id)) return null;
  const lines = GREET[r.id] ?? GREET.fence;
  return lines[met % lines.length];
});

talkExtras.reply.push((_db, r, topic) => (IDS.has(r.id) && topic === "self" ? (SELF[r.id] ?? null) : null));

talkExtras.context.push((_db, r) =>
  IDS.has(r.id)
    ? "NIGHT WORK: you hire men after dark for work the watch must not see, from nine at night until five in the morning, and you pay better than the day's work. You never name a crime plainly and never speak of weapons. The work you have open is listed under YOUR OWN WORK; Jef takes it from you here. Before five it must be done, or it is nothing."
    : "",
);
