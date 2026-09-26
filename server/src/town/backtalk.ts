// What the people of the back streets say to each other (M7 back of town). Pure code, no imports:
// the client bundles this file and shows the lines as bubbles over their heads (game/backlife.ts,
// through the M4 bubbles). The ENGINE's own lines, picked by the kind of group, the hour and the
// weather; no model is asked (the day's calls stay for the talk, the board and the events).
//
// {a} {b} {c}: first names of the others in the group; {n}: a name of a neighbour; {hour}: the hour
// in words. Plain English (Dutch only in names), short.

export type TalkKind = "pump" | "men" | "corner" | "menace" | "menace_night" | "move_along" | "cards" | "gossip" | "step" | "drunk" | "watch" | "lovers" | "stroll" | "kroeg";

/** Two- and three-line exchanges: each line is [speaker slot 0/1/2, text]. */
export type Exchange = Array<[number, string]>;

const EX: Record<string, Exchange[]> = {
  pump: [
    [[0, "Three sheets of the notary's and not one of them clean."], [1, "Rub harder, {a}. He pays by the dozen, not by the stain."]],
    [[0, "Soap's gone up again at the grocer's."], [1, "Everything goes up but the wages."], [2, "Ash and lye, like my mother did. It costs nothing."]],
    [[0, "Mind the blue shirt, it runs."], [1, "Too late. Now the whole tub is blue."]],
    [[0, "Is that your {n}'s shirt? He wears it to the tavern, I know that stain."], [1, "Hold your tongue and pass me the board."]],
    [[0, "The water's cold as the grave this morning."], [1, "Keep pumping, you'll warm up."]],
    [[0, "Did the doctor come for the little one at number six?"], [1, "Twice. They say it's only the croup."], [2, "Pray God it is. I remember sixty-six."]],
    [[0, "If this fog doesn't lift, nothing will dry by Sunday."], [1, "Then it dries by the stove, like always."]],
    [[0, "My back is broken, {a}."], [1, "Mine broke years ago. You get used to it."]],
    [[0, "The lady on the Meir sent back two collars. Not white enough, she says."], [1, "Let her come and wash them herself, then."]],
  ],
  corner: [
    [[0, "Anything doing on the quays today?"], [1, "Not for us. The foremen know our faces."]],
    [[0, "Lend us five centimes, {a}."], [1, "Lend you? You still owe me ten."]],
    [[0, "There goes the watch's nephew. Look at him strut."], [1, "Let him strut. He'll come down this street alone one night."]],
    [[0, "I heard the Vliet men are paying for a lookout tonight."], [1, "Paying in trouble, more like."], [2, "Paying is paying."]],
    [[0, "Look at {n} in his Sunday coat."], [1, "Stole it off a line, I'd wager."]],
    [[0, "When's your brother out of the Steen?"], [1, "Saturday, if he keeps his mouth shut."]],
    [[0, "Cold enough to make a man honest."], [1, "Not that cold."]],
  ],
  men: [
    [[0, "Not taken on again. Third day this week."], [1, "The foreman looks straight through you if you're not his cousin."]],
    [[0, "They say there's a German ship due at the Kattendijk tomorrow."], [1, "Then we'll be at the gate at five."], [2, "With two hundred others."]],
    [[0, "My wife's taking in washing now. That's what we've come to."], [1, "Mine's done it for years. Be glad of it."]],
    [[0, "Lend me a pipe of tobacco, {a}."], [1, "Here. Pay me back when your ship comes in."]],
    [[0, "Grain from Odessa, all week. That's work for the Hessenatie, not for us."], [1, "Everything's for the Hessenatie."]],
    [[0, "Look at the fog. Nothing will move on the river today."], [1, "Then nothing moves in my purse either."]],
    [[0, "Did you hear who got hurt at the cranes?"], [1, "Ward's boy. A crate on his foot. He'll limp for life."]],
  ],
  cards: [
    [[0, "Your deal, {a}."], [1, "Hearts are trumps."], [2, "Hearts again. He's marked them, I swear."]],
    [[0, "That's my trick."], [1, "Your trick? You played a club on a spade."]],
    [[0, "Two centimes a point, no more. My wife counts the purse."], [1, "Your wife counts everything."]],
    [[0, "Look at his face. He's got nothing."], [1, "Play and find out."]],
    [[0, "In my day we played for jenever, not for centimes."], [1, "In your day you lost the jenever too."]],
    [[0, "Deal them fair this time, {a}."], [1, "I always deal fair. You always lose."]],
  ],
  gossip: [
    [[0, "Did you hear? {n} came home at two again, and singing."], [1, "The whole street heard. My little one woke up."]],
    [[0, "The landlord's put the rent up by half a franc."], [1, "For that hole? The rain comes through the ceiling."], [2, "Tell him to sleep in it one night."]],
    [[0, "The Van Gils girl is walking out with a sailor."], [1, "A sailor! Her mother will have a fit."]],
    [[0, "They say there's work at the new docks for anyone with a strong back."], [1, "My man went. They took the first twenty and sent the rest home."]],
    [[0, "Is it true the priest was at number four last night?"], [1, "The old man. He won't see the week out, poor soul."]],
    [[0, "Bread was six centimes at the baker's this morning."], [1, "And stale by noon."]],
    [[0, "Don't look now, but there's a stranger in the street."], [1, "A new face. Kempen, by the look of his boots."]],
  ],
  lovers: [
    [[0, "Your mistress lets you out late tonight."], [1, "She thinks I'm at vespers."]],
    [[0, "Look, the ducks have gone to sleep."], [1, "Then we'll have to talk to each other."]],
    [[0, "When I'm foreman, we'll have a house with two rooms."], [1, "Two! Now I know you're dreaming."]],
  ],
  stroll: [
    [[0, "You can see all the way to Berchem from up here."], [1, "When there's no fog. Which is never."]],
    [[0, "They say they'll pull the old walls down one day."], [1, "And put what, more houses? Let them leave us our walk."]],
    [[0, "Mind the children near the edge."], [1, "They're fine. Look at them run."]],
    [[0, "The ducks are fat this year."], [1, "Fatter than we are."]],
  ],
  kroeg: [
    [[0, "Another pot, and put it on the slate."], [1, "Your slate's longer than my arm."]],
    [[0, "The foreman took on his own cousins again."], [1, "It's always the cousins."]],
  ],
};

/** One-liners: a lone voice (the watch, a drunk, an old man by his door, the lads at Jef). */
const ONE: Record<string, string[]> = {
  menace: [
    "Lost your way, farm boy?",
    "Nice coat. Be a shame to see it in the gutter.",
    "Look, lads. Fresh off the Kempen cart.",
    "This is our corner. You're standing on it.",
    "Got a centime for the poor, friend?",
    "Keep walking. That's it.",
    "What are you looking at?",
  ],
  menace_night: [
    "Out late, aren't you, Kempen boy?",
    "Dark street for a stranger. Anything could happen.",
    "Heavy purse? Must be tiring to carry.",
    "The watch is three streets off. We counted.",
    "Walk faster, farm boy.",
  ],
  move_along: ["Move along.", "Something you want?", "Go on. Off with you.", "You deaf? Move along."],
  step: [
    "Mind the gutter, lad. It's deeper than it looks.",
    "In my day the street was cobbled right to the wall.",
    "Forty years on the quays, and this chair is what I have to show for it.",
    "Fog again. It gets into the bones.",
    "Good day to you.",
    "You're not from round here.",
  ],
  drunk: [
    "One more little glass... one more...",
    "Nobody... nobody tells me where to stand.",
    "Oh, the ship came in from Rio... la la la...",
    "Where's my house? It was here this morning.",
    "You! You're a good lad. Not like the others.",
    "The foreman... the foreman can go to the devil.",
  ],
  watch: [
    "{hour}, and all is well!",
    "{hour}, and a foggy night!",
    "{hour}! Mind your doors and your fires!",
    "{hour}, and all is quiet!",
  ],
};

const HOURS = ["Midnight", "One o'clock", "Two o'clock", "Three o'clock", "Four o'clock", "Five o'clock", "Six o'clock", "Seven o'clock", "Eight o'clock", "Nine o'clock", "Ten o'clock", "Eleven o'clock"];
/** The hour called by the watch: the last full hour. */
export function hourWords(hour: number): string {
  return HOURS[Math.floor(((hour % 24) + 24) % 24) % 12] ?? "Midnight";
}

/** A stable number in 0..1 for a string. */
function u01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

function fill(t: string, v: { names: string[]; neighbour: string; hour: number; weather: string }): string {
  let s = t
    .replace("{a}", v.names[1] ?? v.names[0] ?? "")
    .replace("{b}", v.names[0] ?? "")
    .replace("{c}", v.names[2] ?? v.names[0] ?? "")
    .replace("{n}", v.neighbour)
    .replace("{hour}", hourWords(v.hour));
  // the watch: "a foggy night" only when it is
  if (v.weather !== "fog" && v.weather !== "mist") s = s.replace("and a foggy night", v.weather === "rain" || v.weather === "storm" ? "and a wet night" : "and a clear night");
  return s.replace(/\s+,/g, ",").replace(/ {2,}/g, " ").trim();
}

/**
 * An exchange for a group of this kind: the lines with the slot of who says each (0 the first of
 * the group, 1 the second ...), fitted to how many are there. `seed` makes the pick (the same seed,
 * the same lines). Returns [] when nothing fits.
 */
export function exchange(kind: TalkKind, seed: string, v: { names: string[]; neighbour: string; hour: number; weather: string }): Array<{ slot: number; text: string }> {
  const n = v.names.length;
  const set = (EX[kind] ?? []).filter((e) => e.every(([slot]) => slot < n));
  if (!set.length) {
    const one = line(kind, seed, v);
    return one ? [{ slot: 0, text: one }] : [];
  }
  const e = set[Math.floor(u01(seed) * set.length)];
  return e.map(([slot, text]) => ({ slot, text: fill(text, v) }));
}

/** One line of a lone voice of this kind (the watch, a drunk, an old man, the lads at Jef). */
export function line(kind: TalkKind, seed: string, v: { names: string[]; neighbour: string; hour: number; weather: string }): string | null {
  const set = ONE[kind];
  if (!set?.length) return null;
  return fill(set[Math.floor(u01(seed) * set.length)], v);
}
