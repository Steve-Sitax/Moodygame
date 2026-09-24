import type { DB } from "../db.ts";
import { VIOLENCE_RE } from "../director/vocab.ts";
import { plainEnglish } from "../text.ts";
import { town } from "../town/store.ts";

// The engine's check on what the model writes for the ballad singer and the Sunday sermon
// (M6 ballads and sermon). A line must be plain, tame English with no sums or numbers
// (cleanLine), no weapon, killing or blood (VIOLENCE_RE), no call to harm anyone, and no
// name the game does not own: no real people. One bad line and the whole text is the engine's.

/** A call to do harm (the sermon must never send the flock after anyone). */
export const HARM_RE =
  /\b(drive (them|him|her|these|those|such) (out|away|off)|run (them|him|her) out|chase (them|him|her) (out|off)|burn (them|him|her|their|his|the house)|ston(e|es|ing) (them|him|her)|stone (the|such)|punish (them|him|her|the)|beat (them|him|her)|thrash\w*|flog\w*|whip (them|him|her)|lynch\w*|hang (them|him|her)|take up arms|smash\w*|strike (them|him|her|down)|lay hands on|drag (them|him|her)|tar and feather\w*|pitchforks?|torches? in hand|kill\w*|slay\w*|slain|destroy (them|him|her))\b/i;

/** Real people of the time (and of the town's past) the model might reach for; never in the game's mouth. */
const FAMOUS = new Set(
  [
    "leopold", "victoria", "bismarck", "napoleon", "bonaparte", "gladstone", "disraeli", "thiers", "garibaldi", "lincoln", "pius", "darwin",
    "marx", "dickens", "rubens", "wagner", "verdi", "rothschild", "wilhelm", "kaiser", "czar", "tsar", "macmahon", "mac-mahon", "gambetta",
    "frere-orban", "malou", "leys", "jordaens", "brueghel", "bruegel", "plantin", "moretus", "wellington", "washington", "cromwell", "luther",
    "calvin", "voltaire", "robespierre", "metternich", "cavour", "mazzini", "lesseps", "stanley", "livingstone", "baudelaire", "hugo", "zola",
  ],
);

/** Words that are capitalised mid-sentence and name nobody real of our time: faith, days, the wide world. */
const COMMON = new Set(
  [
    "i", "o", "oh", "ho", "hey", "god", "lord", "lord's", "christ", "jesus", "mary", "our", "lady", "heaven", "hell", "saint", "saints", "sabbath",
    "almighty", "father", "son", "holy", "ghost", "spirit", "church", "mass", "amen", "devil", "satan", "gospel", "scripture", "commandment",
    "commandments", "eden", "adam", "eve", "cain", "abel", "noah", "moses", "peter", "paul", "judas", "solomon", "lazarus", "magdalene",
    "christian", "christians", "catholic", "cathedral", "easter", "christmas", "lent", "advent", "all", "souls",
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "september", "october", "november", "december",
    "antwerp", "antwerpen", "schelde", "scheldt", "belgium", "flanders", "flemish", "fleming", "flemings", "america", "american", "new", "york",
    "philadelphia", "england", "english", "france", "french", "holland", "dutch", "rhine", "germany", "german", "london", "brussels", "ghent",
    "red", "star", "line", "kempen", "north", "sea",
    // the capital He, His and Thee of the pulpit
    "he", "him", "his", "himself", "thee", "thou", "thy", "thine", "thyself", "ye", "whom", "providence", "creator", "saviour", "redeemer", "virgin", "mother",
  ],
);

const townWords = new WeakMap<DB, Set<string>>();

/** Every name the game owns: the townspeople, the named people, the places. */
function gameWords(db: DB): Set<string> {
  const kept = townWords.get(db);
  if (kept) return kept;
  const t = town(db).town;
  const words = new Set<string>();
  const add = (s: string) => {
    for (const w of s.toLowerCase().match(/[a-zà-ÿ'-]+/g) ?? []) words.add(w.replace(/'s$/, ""));
  };
  for (const r of t.residents) add(r.name);
  for (const p of Object.values(t.places)) add(p.label ?? "");
  try {
    for (const r of db.prepare("SELECT name FROM npc").all() as Array<{ name: string }>) add(r.name);
  } catch {
    /* no npc table in a bare test */
  }
  for (const w of ["rijnkaai", "vismarkt", "steenplein", "werf", "vleeshuis", "steen", "oostershuis", "poesje", "handelsblad", "hessenatie", "logement", "kempenland", "berg", "barmhartigheid", "meir", "groenplaats"]) words.add(w);
  townWords.set(db, words);
  return words;
}

/** Words a song's title may carry in capitals without naming anybody. */
const TITLE_WORDS = ["song", "songs", "ballad", "lament", "tale", "news", "true", "merry", "sad", "new", "old", "fog", "foggy", "town", "quay", "quays", "farm", "boy", "fire", "purse", "thief", "wedding", "river", "ship", "tide", "week", "day", "night", "street", "market", "square", "bells", "sermon", "sinners", "warning", "praise", "and", "of", "the", "a", "in", "on", "at", "for", "with", "to"];

/**
 * Plain words of a text: every word that also appears in small letters somewhere in it is a word,
 * not a name ("Fog" in a title when the verses say "fog").
 */
export function plainWords(texts: string[]): string[] {
  const out = new Set<string>(TITLE_WORDS);
  for (const t of texts) for (const w of t.match(/(?<![A-Za-zÀ-ÿ'-])[a-zà-ÿ][a-zà-ÿ'-]*/g) ?? []) out.add(w.replace(/'s$/, ""));
  return [...out];
}

/** The words a text may name: the game's own, the common ones, and every word of the engine's facts. */
export function allowedNames(db: DB, facts: string[]): Set<string> {
  const out = new Set<string>([...COMMON, ...gameWords(db)]);
  for (const f of facts) for (const w of f.toLowerCase().match(/[a-zà-ÿ'-]+/g) ?? []) out.add(w.replace(/'s$/, ""));
  return out;
}

/**
 * No name the game does not own. A capitalised word inside a sentence must be one of the
 * allowed words (the town, the facts, faith and places); any word, first or not, must not be a
 * famous real person. "King Leopold" fails on Leopold; "Bismarck said" fails on Bismarck.
 */
export function namesOk(text: string, allowed: Set<string>): boolean {
  for (const sentence of text.split(/[.!?;:]+|["“”]/)) {
    const words = sentence.match(/[A-Za-zÀ-ÿ'-]+/g) ?? [];
    for (let i = 0; i < words.length; i++) {
      const w = words[i].replace(/'s$/, "");
      const lw = w.toLowerCase();
      if (FAMOUS.has(lw)) return false;
      if (i === 0 || !/^[A-ZÀ-Þ]/.test(w)) continue;
      if (!allowed.has(lw)) return false;
    }
  }
  return true;
}

/** Oaths and slurs (the tavern's list, less the holy names: a priest and a hymn may say them). */
const ROUGH = /\b(fuck\w*|shit\w*|bastard\w*|whore\w*|cunt\w*|bitch\w*|damn\w*|bloody|murder\w*|rape\w*|nigg\w*|jew\w*|gypsy|goddam\w*)\b/i;

/** Plain, tame, no sum, no machine talk (as interiors/tavern.ts cleanLine, with the holy names allowed). */
function baseClean(s: string, max: number): string | null {
  const t = plainEnglish(String(s ?? "").replace(/[\r\n\t]+/g, " ")).slice(0, max).trim();
  if (!t) return null;
  if (ROUGH.test(t)) return null;
  if (/\d|\bfrancs?\b|\bcentimes?\b|\bsous?\b|\bguilders?\b/i.test(t)) return null;
  if (/[<>{}`\\]|https?:|\bsystem prompt\b|\bAI\b|\bmodel\b/i.test(t)) return null;
  return t;
}

/** One line the singer or the priest may say: clean, tame, no sums, nothing violent, no stranger's name. */
export function cleanVerse(s: string, allowed: Set<string>, max = 110): string | null {
  const t = baseClean(s, max);
  if (!t) return null;
  if (VIOLENCE_RE.test(t) || HARM_RE.test(t)) return null;
  if (/\b(AI|assistant|language model|prompt)\b/.test(t)) return null;
  if (!namesOk(t, allowed)) return null;
  return t;
}
