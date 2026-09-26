// Your character (M7 character, Steve 2026-09-26: "some character customisation in the menu before
// start of a new game. Gender, age, some clothes and colours, name. This in preparation for
// multiplayer."). ONE place for what a character is: the options and their order, the period palette,
// the defaults (a missing profile is today's Jef), the clamp, the short appearance code a network
// message can carry, the look in words for the models, and the words people use for him or her.
// No imports: the server (node, .ts) and the client (vite) both read this file.
//
// The lists are append-only: the appearance code stores indexes into them.

export type Sex = "man" | "woman";
export type Build = "slight" | "middling" | "stout";

export interface Swatch {
  id: string;
  /** What it is called in the look line and on the picker. */
  label: string;
  hex: number;
}

/** The period palette for cloth (Antwerp 1873: dyed wool and linen, worn and faded; black and white linen for Sunday). */
export const CLOTH: Swatch[] = [
  { id: "indigo", label: "worn indigo", hex: 0x34425a },
  { id: "faded_indigo", label: "faded blue", hex: 0x5a6a80 },
  { id: "blue_grey", label: "blue-grey", hex: 0x46505a },
  { id: "brown", label: "brown", hex: 0x5a4432 },
  { id: "dark_brown", label: "dark brown", hex: 0x3a2a1e },
  { id: "grey", label: "grey", hex: 0x6e6a62 },
  { id: "charcoal", label: "charcoal", hex: 0x38383a },
  { id: "black", label: "black", hex: 0x1a1a1c },
  { id: "faded_red", label: "faded red", hex: 0x8a3e32 },
  { id: "green", label: "bottle green", hex: 0x3e5236 },
  { id: "linen", label: "undyed linen", hex: 0xc4baa0 },
  { id: "white", label: "white linen", hex: 0xe2ded2 },
  { id: "ochre", label: "ochre", hex: 0x9a7a40 },
];
export const LEATHER: Swatch[] = [
  { id: "black_leather", label: "black", hex: 0x161412 },
  { id: "brown_leather", label: "brown", hex: 0x3e2c1e },
  { id: "worn_leather", label: "worn", hex: 0x5a4632 },
];
export const WOOD: Swatch[] = [
  { id: "willow", label: "pale wood", hex: 0xbfa070 },
  { id: "tarred", label: "tarred", hex: 0x2a2420 },
  { id: "yellow", label: "yellow-painted", hex: 0xb89a48 },
];
export const SKIN: Swatch[] = [
  { id: "pale", label: "pale", hex: 0xdcb49e },
  { id: "fair", label: "fair", hex: 0xcc9e84 },
  { id: "rosy", label: "ruddy", hex: 0xc88a70 },
  { id: "weathered", label: "weathered", hex: 0xae7a5e },
  { id: "olive", label: "olive", hex: 0x9e7454 },
  { id: "brown", label: "brown", hex: 0x7a5440 },
];
export const HAIR: Swatch[] = [
  { id: "flaxen", label: "flaxen", hex: 0xc0a068 },
  { id: "fair", label: "fair", hex: 0x9a7a48 },
  { id: "red", label: "red", hex: 0x8a4222 },
  { id: "light_brown", label: "light brown", hex: 0x6a4a2a },
  { id: "dark_brown", label: "dark brown", hex: 0x3a2a1c },
  { id: "black", label: "black", hex: 0x16120e },
  { id: "grey", label: "grey", hex: 0x8e8a82 },
  { id: "white", label: "white", hex: 0xc8c4bc },
];

export interface Choice {
  id: string;
  label: string;
  /** Who may wear it. */
  sex?: Sex;
}

export const BUILDS: Choice[] = [
  { id: "slight", label: "Slight" },
  { id: "middling", label: "Middling" },
  { id: "stout", label: "Stout" },
];
export const HAIR_STYLES: Choice[] = [
  { id: "short", label: "Short", sex: "man" },
  { id: "long", label: "Long to the collar", sex: "man" },
  { id: "balding", label: "Thinning", sex: "man" },
  { id: "bun", label: "In a bun", sex: "woman" },
  { id: "plaits", label: "In plaits", sex: "woman" },
  { id: "coronet", label: "Plaits pinned round", sex: "woman" },
];
/** Facial hair (men); a woman's is always "none". The ids of the townspeople's faces (build_people.py) where they match. */
export const FACES: Choice[] = [
  { id: "none", label: "None", sex: "woman" },
  { id: "clean", label: "Clean-shaven", sex: "man" },
  { id: "light_stubble", label: "A few days' growth", sex: "man" },
  { id: "stubble", label: "Stubble", sex: "man" },
  { id: "moustache", label: "Moustache", sex: "man" },
  { id: "whiskers", label: "Side whiskers", sex: "man" },
  { id: "beard", label: "Short beard", sex: "man" },
  { id: "walrus", label: "Walrus moustache", sex: "man" },
];
export const HEADS: Choice[] = [
  { id: "none", label: "Bare-headed" },
  { id: "cap", label: "Flat cap", sex: "man" },
  { id: "knitcap", label: "Knitted cap", sex: "man" },
  { id: "bowler", label: "Round hat", sex: "man" },
  { id: "tophat", label: "Tall hat", sex: "man" },
  { id: "bonnet", label: "Bonnet", sex: "woman" },
  { id: "whitecap", label: "White cap", sex: "woman" },
  { id: "headscarf", label: "Headscarf", sex: "woman" },
];
export const COATS: Choice[] = [
  { id: "none", label: "Shirt and waistcoat", sex: "man" },
  { id: "jacket", label: "Short jacket", sex: "man" },
  { id: "coat", label: "Long coat", sex: "man" },
  { id: "smock", label: "Blue smock (kiel)", sex: "man" },
  { id: "no_shawl", label: "No shawl", sex: "woman" },
  { id: "shawl", label: "Shawl", sex: "woman" },
  { id: "check_shawl", label: "Check shawl", sex: "woman" },
];
export const APRONS: Choice[] = [
  { id: "none", label: "No apron" },
  { id: "apron", label: "Apron" },
];
export const FEET: Choice[] = [
  { id: "boots", label: "Boots" },
  { id: "clogs", label: "Clogs" },
];

export const AGE_MIN = 16;
export const AGE_MAX = 60;
export const AGE_BANDS = [
  { id: "16-20", min: 16, max: 20 },
  { id: "21-30", min: 21, max: 30 },
  { id: "31-45", min: 31, max: 45 },
  { id: "46-60", min: 46, max: 60 },
] as const;
export type AgeBand = (typeof AGE_BANDS)[number]["id"];
export const ageBand = (age: number): AgeBand => (AGE_BANDS.find((b) => age >= b.min && age <= b.max) ?? AGE_BANDS[0]).id;

export const NAME_MAX = { first: 20, last: 24 } as const;

export interface Clothes {
  head: { kind: string; colour: string };
  coat: { kind: string; colour: string };
  /** Shirt (men) or blouse (women). */
  shirt: { colour: string };
  /** A man's waistcoat (under the jacket; hidden by the smock). */
  vest: { colour: string };
  /** Trousers (men) or skirt (women). */
  lower: { colour: string };
  apron: { kind: string; colour: string };
  feet: { kind: string; colour: string };
}

export interface Profile {
  /** Schema version. */
  v: 1;
  first: string;
  /** May be empty (Jef never had one). */
  last: string;
  sex: Sex;
  /** The exact age, 16 to 60; the band follows from it. */
  age: number;
  build: Build;
  skin: string;
  hair: { colour: string; style: string };
  face: string;
  clothes: Clothes;
  /** Dressed in Sunday best (the look line says so). */
  best: boolean;
}

/** Today's Jef: a farm boy from the Kempen, 19, a thin brown jacket, a cap. A missing profile is this one. */
export const JEF: Profile = {
  v: 1,
  first: "Jef",
  last: "",
  sex: "man",
  age: 19,
  build: "middling",
  skin: "weathered",
  hair: { colour: "dark_brown", style: "short" },
  face: "light_stubble",
  clothes: {
    head: { kind: "cap", colour: "charcoal" },
    coat: { kind: "jacket", colour: "brown" },
    shirt: { colour: "linen" },
    vest: { colour: "charcoal" },
    lower: { colour: "grey" },
    apron: { kind: "none", colour: "linen" },
    feet: { kind: "boots", colour: "worn_leather" },
  },
  best: false,
};

/** A woman's starting look (the creator's first "woman" pick). */
export const MIE: Profile = {
  v: 1,
  first: "Mie",
  last: "",
  sex: "woman",
  age: 19,
  build: "middling",
  skin: "fair",
  hair: { colour: "light_brown", style: "bun" },
  face: "none",
  clothes: {
    head: { kind: "whitecap", colour: "white" },
    coat: { kind: "check_shawl", colour: "faded_red" },
    shirt: { colour: "blue_grey" },
    vest: { colour: "charcoal" },
    lower: { colour: "brown" },
    apron: { kind: "apron", colour: "linen" },
    feet: { kind: "clogs", colour: "willow" },
  },
  best: false,
};

export const defaultFor = (sex: Sex): Profile => (sex === "woman" ? MIE : JEF);

const byId = <T extends { id: string }>(list: T[], id: unknown): T | undefined => list.find((x) => x.id === id);

/** Options open to this sex (the creator's pickers). */
export const optionsFor = (list: Choice[], sex: Sex): Choice[] => list.filter((c) => !c.sex || c.sex === sex);

/** The colours a slot may take. */
export function swatchesFor(slot: "feet", kind: string): Swatch[];
export function swatchesFor(slot: string, kind?: string): Swatch[];
export function swatchesFor(slot: string, kind?: string): Swatch[] {
  if (slot === "feet") return kind === "clogs" ? WOOD : LEATHER;
  if (slot === "skin") return SKIN;
  if (slot === "hair") return HAIR;
  return CLOTH;
}

/** A long apron would hang under a long coat or a smock: a man wears one only in shirt sleeves or a short jacket. */
export const apronAllowed = (p: { sex: Sex; clothes: { coat: { kind: string } } }): boolean =>
  p.sex === "woman" || p.clothes.coat.kind === "none" || p.clothes.coat.kind === "jacket";

// ------------------------------------------------------------------ names

/** Letters (any script's accents), inner spaces, hyphens and apostrophes; nothing else. */
const NAME_CHARS = /[^\p{L}\p{M} '\-]/u;
/**
 * Words that may not be a name: they would read as ordinary English in every line about the player
 * (and the engine maps the name back and forth in the models' text), or they are the town's own people.
 */
const NOT_NAMES = new Set(
  [
    "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "it", "its", "we", "us", "they", "them", "the", "a", "an", "and", "or", "but", "not", "no",
    "yes", "of", "to", "in", "on", "at", "by", "for", "with", "from", "this", "that", "who", "what", "one", "some", "all", "any",
    "god", "lord", "jesus", "christ", "devil", "satan", "mister", "missus", "sir", "madam", "lad", "lass", "man", "woman", "boy", "girl", "friend",
    "nobody", "somebody", "someone", "everyone", "police", "agent", "father", "mother", "sister", "brother", "king", "queen", "priest",
    "jenever", "antwerp", "schelde", "kempen", "system", "assistant", "user", "claude", "model", "prompt",
    // the game's own named people (server town/population.ts TAKEN); Jef is the player's own default
    "sooi", "tuur", "fientje", "peeters", "cools", "verhulst", "leentje", "van dyck",
  ].map((w) => w.toLowerCase()),
);
/** The free-text gate's worst phrases (server hooks/dialogue.ts BLOCK), for names. */
const HOSTILE = [
  /ignore\b|previous|instruction|system ?prompt|you are now|jailbreak|developer mode|pretend\b/i,
  /\b(assistant|system|user|tool)\b/i,
  /\b(claude|anthropic|openai|chatgpt|gpt|llm|language model|ai model)\b/i,
  /\b(api ?key|password|sudo|powershell)\b/i,
];

/**
 * A name as typed, made safe: one form for look-alike letters, only letters, spaces, hyphens and
 * apostrophes, at most three words and `max` characters, the first letter upper case. Null when
 * nothing usable is left or it is not a name (a common word, a town person's name, an order to a model).
 */
export function cleanName(raw: unknown, max: number, allowEmpty = false): string | null {
  if (typeof raw !== "string") return allowEmpty ? "" : null;
  const typed = raw.normalize("NFKC").replace(/[‘’ʼ]/g, "'").replace(/\s+/g, " ").trim();
  // anything but letters, spaces, hyphens and apostrophes (digits, markup, quotes, control or invisible
  // characters): not a name at all, so nothing of it is kept
  if (NAME_CHARS.test(typed)) return typed ? null : allowEmpty ? "" : null;
  let s = typed.replace(/^['\-\s]+|['\-\s]+$/g, "");
  if (!s) return allowEmpty ? "" : null;
  if (HOSTILE.some((re) => re.test(s))) return null;
  s = s.split(" ").slice(0, 3).join(" ");
  if (s.length > max) s = s.slice(0, max).replace(/['\-\s]+$/, "");
  if (s.length < 2) return allowEmpty && !s ? "" : null;
  if (NOT_NAMES.has(s.toLowerCase())) return null;
  if (s.split(" ").some((w) => NOT_NAMES.has(w.toLowerCase()) && w.length > 3)) return null;
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

// ------------------------------------------------------------------ the clamp

const pickId = (list: Choice[] | Swatch[], v: unknown, dflt: string, sex?: Sex): string => {
  const c = byId(list as Array<{ id: string; sex?: Sex }>, v);
  if (!c) return dflt;
  if (sex && "sex" in c && c.sex && c.sex !== sex) return dflt;
  return c.id;
};

type Loose = Record<string, unknown>;
const obj = (v: unknown): Loose => (v && typeof v === "object" && !Array.isArray(v) ? (v as Loose) : {});

export interface Clamped {
  profile: Profile;
  /** Fields that were not usable as sent and were put back to a default. */
  fixed: string[];
}

/** Any object in, a whole valid profile out: every field checked, clamped, or set to the sex's default. */
export function clampProfile(raw: unknown): Clamped {
  const r = obj(raw);
  const fixed: string[] = [];
  const sex: Sex = r.sex === "woman" ? "woman" : "man";
  if (r.sex !== undefined && r.sex !== "man" && r.sex !== "woman") fixed.push("sex");
  const d = defaultFor(sex);
  const first = cleanName(r.first, NAME_MAX.first);
  if (first === null) fixed.push("first");
  const last = cleanName(r.last ?? "", NAME_MAX.last, true);
  if (last === null) fixed.push("last");
  const ageN = Math.round(Number(r.age));
  const age = Number.isFinite(ageN) ? Math.max(AGE_MIN, Math.min(AGE_MAX, ageN)) : d.age;
  if (!Number.isFinite(ageN) || ageN !== age) fixed.push("age");
  const hair = obj(r.hair);
  const c = obj(r.clothes);
  const slot = (k: keyof Clothes) => obj(c[k]);
  const note = <T>(name: string, v: T, want: unknown): T => {
    if (want !== undefined && want !== v) fixed.push(name);
    return v;
  };
  const head = slot("head"), coat = slot("coat"), shirt = slot("shirt"), vest = slot("vest"), lower = slot("lower"), apron = slot("apron"), feet = slot("feet");
  const feetKind = note("feet.kind", pickId(FEET, feet.kind, d.clothes.feet.kind), feet.kind);
  const p: Profile = {
    v: 1,
    first: first ?? d.first,
    last: last ?? "",
    sex,
    age,
    build: note("build", pickId(BUILDS, r.build, d.build) as Build, r.build),
    skin: note("skin", pickId(SKIN, r.skin, d.skin), r.skin),
    hair: {
      colour: note("hair.colour", pickId(HAIR, hair.colour, d.hair.colour), hair.colour),
      style: note("hair.style", pickId(HAIR_STYLES, hair.style, d.hair.style, sex), hair.style),
    },
    face: note("face", pickId(FACES, r.face, d.face, sex), r.face),
    clothes: {
      head: { kind: note("head.kind", pickId(HEADS, head.kind, d.clothes.head.kind, sex), head.kind), colour: note("head.colour", pickId(CLOTH, head.colour, d.clothes.head.colour), head.colour) },
      coat: { kind: note("coat.kind", pickId(COATS, coat.kind, d.clothes.coat.kind, sex), coat.kind), colour: note("coat.colour", pickId(CLOTH, coat.colour, d.clothes.coat.colour), coat.colour) },
      shirt: { colour: note("shirt.colour", pickId(CLOTH, shirt.colour, d.clothes.shirt.colour), shirt.colour) },
      vest: { colour: note("vest.colour", pickId(CLOTH, vest.colour, d.clothes.vest.colour), vest.colour) },
      lower: { colour: note("lower.colour", pickId(CLOTH, lower.colour, d.clothes.lower.colour), lower.colour) },
      apron: { kind: note("apron.kind", pickId(APRONS, apron.kind, d.clothes.apron.kind), apron.kind), colour: note("apron.colour", pickId(CLOTH, apron.colour, d.clothes.apron.colour), apron.colour) },
      feet: { kind: feetKind, colour: note("feet.colour", pickId(swatchesFor("feet", feetKind), feet.colour, swatchesFor("feet", feetKind)[0].id), feet.colour) },
    },
    best: r.best === true,
  };
  if (!apronAllowed(p) && p.clothes.apron.kind !== "none") {
    p.clothes.apron.kind = "none";
    fixed.push("apron.kind");
  }
  return { profile: p, fixed: [...new Set(fixed)] };
}

// ------------------------------------------------------------------ the appearance code

/**
 * A short string for the look alone (no name): what a network message carries so every client can
 * draw another player the same (Steve: multiplayer later). "A" is the version, then one character
 * per field, an index into its list above (the lists only ever grow at the end).
 */
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
type Field = [get: (p: Profile) => string | number, list: Array<{ id: string }> | null];
const idx = (list: Array<{ id: string }>, id: string) => Math.max(0, list.findIndex((x) => x.id === id));
const FIELDS: Field[] = [
  [(p) => (p.sex === "woman" ? 1 : 0), null],
  [(p) => p.age - AGE_MIN, null],
  [(p) => p.build, BUILDS],
  [(p) => p.skin, SKIN],
  [(p) => p.hair.colour, HAIR],
  [(p) => p.hair.style, HAIR_STYLES],
  [(p) => p.face, FACES],
  [(p) => p.clothes.head.kind, HEADS],
  [(p) => p.clothes.head.colour, CLOTH],
  [(p) => p.clothes.coat.kind, COATS],
  [(p) => p.clothes.coat.colour, CLOTH],
  [(p) => p.clothes.shirt.colour, CLOTH],
  [(p) => p.clothes.vest.colour, CLOTH],
  [(p) => p.clothes.lower.colour, CLOTH],
  [(p) => p.clothes.apron.kind, APRONS],
  [(p) => p.clothes.apron.colour, CLOTH],
  [(p) => p.clothes.feet.kind, FEET],
  [(p) => (p.clothes.feet.kind === "clogs" ? idx(WOOD, p.clothes.feet.colour) : idx(LEATHER, p.clothes.feet.colour)), null],
  [(p) => (p.best ? 1 : 0), null],
];
export const CODE_LENGTH = 1 + FIELDS.length;

export function appearanceCode(p: Profile): string {
  return (
    "A" +
    FIELDS.map(([get, list]) => {
      const v = get(p);
      const n = list ? idx(list, String(v)) : Number(v);
      return B64[Math.max(0, Math.min(63, n))];
    }).join("")
  );
}

/** The look from a code (the name is not in it): a profile with a placeholder name, clamped like any other. Null if it is not a code. */
export function fromAppearanceCode(code: unknown, name = { first: "Stranger", last: "" }): Profile | null {
  if (typeof code !== "string" || code.length !== CODE_LENGTH || code[0] !== "A") return null;
  const n = [...code.slice(1)].map((ch) => B64.indexOf(ch));
  if (n.some((x) => x < 0)) return null;
  const at = (i: number, list: Array<{ id: string }>) => list[n[i]]?.id;
  const feetKind = at(16, FEET) ?? "boots";
  const raw = {
    first: name.first,
    last: name.last,
    sex: n[0] === 1 ? "woman" : "man",
    age: AGE_MIN + n[1],
    build: at(2, BUILDS),
    skin: at(3, SKIN),
    hair: { colour: at(4, HAIR), style: at(5, HAIR_STYLES) },
    face: at(6, FACES),
    clothes: {
      head: { kind: at(7, HEADS), colour: at(8, CLOTH) },
      coat: { kind: at(9, COATS), colour: at(10, CLOTH) },
      shirt: { colour: at(11, CLOTH) },
      vest: { colour: at(12, CLOTH) },
      lower: { colour: at(13, CLOTH) },
      apron: { kind: at(14, APRONS), colour: at(15, CLOTH) },
      feet: { kind: feetKind, colour: (feetKind === "clogs" ? WOOD : LEATHER)[n[17]]?.id },
    },
    best: n[18] === 1,
  };
  return clampProfile(raw).profile;
}

// ------------------------------------------------------------------ words

export interface Words {
  first: string;
  full: string;
  he: string;
  him: string;
  his: string;
  He: string;
  /** "young man", "man", "young woman", "woman" (by age). */
  youngMan: string;
  man: string;
  lad: string;
  boy: string;
  mister: string;
  son: string;
}

export function wordsFor(p: Profile): Words {
  const w = p.sex === "woman";
  const young = p.age <= 30;
  return {
    first: p.first,
    full: p.last ? `${p.first} ${p.last}` : p.first,
    he: w ? "she" : "he",
    him: w ? "her" : "him",
    his: w ? "her" : "his",
    He: w ? "She" : "He",
    youngMan: `${young ? "young " : ""}${w ? "woman" : "man"}`,
    man: w ? "woman" : "man",
    lad: w ? "lass" : "lad",
    boy: w ? "girl" : "boy",
    mister: w ? "missus" : "mister",
    son: w ? "daughter" : "son",
  };
}

const label = (list: Array<{ id: string; label: string }>, id: string) => list.find((x) => x.id === id)?.label ?? id;
const cloth = (id: string) => label(CLOTH, id);

/** The look in a line, for the models: "a woman of about 30, slight, ..., in a faded red check shawl, ... and clogs". */
export function lookLine(p: Profile): string {
  const w = p.sex === "woman";
  const c = p.clothes;
  const who = `a ${p.age <= 20 ? "young " : ""}${w ? "woman" : "man"} of about ${p.age}`;
  const build = p.build === "middling" ? "" : `, ${p.build}`;
  const hairCol = label(HAIR, p.hair.colour);
  const hair =
    p.hair.style === "balding" ? `thinning ${hairCol} hair` : p.hair.style === "long" ? `${hairCol} hair to the collar` : w ? `${hairCol} hair ${p.hair.style === "bun" ? "in a bun" : p.hair.style === "plaits" ? "in plaits" : "in plaits pinned round the head"}` : `short ${hairCol} hair`;
  const faceWords: Record<string, string> = { clean: "clean-shaven", light_stubble: "a few days' growth on the chin", stubble: "stubble", moustache: "a moustache", whiskers: "side whiskers", beard: "a short beard", walrus: "a walrus moustache" };
  const face = !w && faceWords[p.face] ? `, ${faceWords[p.face]}` : "";
  const skin = label(SKIN, p.skin);
  const parts: string[] = [];
  const headNames: Record<string, string> = { cap: "flat cap", knitcap: "knitted cap", bowler: "round hat", tophat: "tall hat", bonnet: "bonnet", whitecap: "white cap", headscarf: "headscarf" };
  if (c.head.kind !== "none") parts.push(c.head.kind === "whitecap" ? "a white cap" : `a ${cloth(c.head.colour)} ${headNames[c.head.kind] ?? c.head.kind}`);
  if (w) {
    if (c.coat.kind !== "no_shawl") parts.push(`a ${cloth(c.coat.colour)} ${c.coat.kind === "check_shawl" ? "check shawl" : "shawl"} over a ${cloth(c.shirt.colour)} blouse`);
    else parts.push(`a ${cloth(c.shirt.colour)} blouse`);
    parts.push(`a ${cloth(c.lower.colour)} skirt`);
  } else {
    if (c.coat.kind === "jacket") parts.push(`a ${cloth(c.coat.colour)} jacket over a ${cloth(c.shirt.colour)} shirt and ${cloth(c.vest.colour)} waistcoat`);
    else if (c.coat.kind === "coat") parts.push(`a long ${cloth(c.coat.colour)} coat`);
    else if (c.coat.kind === "smock") parts.push(`a ${cloth(c.coat.colour)} smock`);
    else parts.push(`shirt sleeves (${cloth(c.shirt.colour)}) and a ${cloth(c.vest.colour)} waistcoat`);
    parts.push(`${cloth(c.lower.colour)} trousers`);
  }
  if (c.apron.kind === "apron") parts.push(`a ${cloth(c.apron.colour)} apron`);
  parts.push(c.feet.kind === "clogs" ? "clogs" : `${label(LEATHER, c.feet.colour)} boots`);
  const dressed = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
  return `${who}${build}, ${skin} skin, ${hair}${face}; ${p.best ? "in Sunday best: " : "in "}${dressed}`.replace(/\ba (?=[aeiou])/g, "an ");
}

// ------------------------------------------------------------------ lines about and to the player

/**
 * The engine's own text calls the player "Jef" and, here and there, "the farm boy", "a young man on
 * the quays", "that lad Jef". These phrases always mean the player: they take the profile's name, sex
 * and age. (Plain "lad", "he" elsewhere may be somebody else: those lines are changed where they are
 * written, with addressed() below.)
 */
export function aboutPlayer(p: Profile, text: string): string {
  if (p.first === "Jef" && p.sex === "man" && p.age <= 30) return text;
  const w = wordsFor(p);
  let t = text;
  if (p.sex === "woman" || p.age > 30) {
    t = t
      .replace(/\bJef, a young man\b/g, `Jef, a ${w.youngMan}`)
      .replace(/\b([Aa]) young man (called|named) Jef\b/g, `$1 ${w.youngMan} $2 Jef`)
      .replace(/\bthe young man Jef\b/g, `the ${w.youngMan} Jef`)
      .replace(/\bJef, the young man\b/g, `Jef, the ${w.youngMan}`)
      .replace(/\b([Aa]) young man on the quays\b/g, (_m, a: string) => `${a} ${w.youngMan} on the quays`)
      .replace(/\b([Tt])he young man's\b/g, (_m, a: string) => `${a}he ${w.youngMan}'s`)
      .replace(/\b([Tt]hat|[Tt]he|[Aa]) lad Jef\b/g, `$1 ${w.lad} Jef`);
  }
  if (p.sex === "woman") {
    t = t
      .replace(/\bfarm boy\b/g, "farm girl")
      .replace(/\bFarm Boy\b/g, "Farm Girl")
      .replace(/\bKempen boy\b/g, "Kempen girl")
      .replace(/\bJef, a man\b/g, "Jef, a woman");
  }
  t = t.replace(/\blet him look to his conduct\b/g, `let ${w.him} look to ${w.his} conduct`);
  // (the prompts' block headers, "JEF SAYS", "YOU AND JEF", stay as they are: the free-text gate knows them)
  if (p.first !== "Jef") t = t.replace(/\bJef\b/g, p.first);
  return t;
}

/**
 * The other way (a model's answer, after its name went back to "Jef"): the phrases aboutPlayer puts in
 * become the engine's own again ("a young woman on the quays" -> "a young man on the quays", "the farm
 * girl" -> "the farm boy"), so the engine's checks on them hold (the sermon's hint, the ballad's title).
 */
export function phrasesBack(p: Profile, text: string): string {
  if (p.sex === "man" && p.age <= 30) return text;
  const who = p.sex === "woman" ? "(?:young )?woman" : "man";
  let t = text
    .replace(new RegExp(`\\b([Aa]) ${who} on the quays\\b`, "g"), "$1 young man on the quays")
    .replace(new RegExp(`\\bJef, (a|the) ${who}\\b`, "g"), "Jef, $1 young man")
    .replace(new RegExp(`\\b(a|the) ${who} (called |named )?Jef\\b`, "g"), "$1 young man $2Jef")
    .replace(/\blet her look to her conduct\b/g, "let him look to his conduct");
  if (p.sex === "woman") {
    t = t
      .replace(/\bfarm girl\b/g, "farm boy")
      .replace(/\bFarm Girl\b/g, "Farm Boy")
      .replace(/\bKempen girl\b/g, "Kempen boy")
      .replace(/\b([Tt]hat|[Tt]he|[Aa]) lass Jef\b/g, "$1 lad Jef");
  }
  return t;
}

/**
 * A line said TO the player (a fallback line, a canned reply): the forms of address follow the sex.
 * "Not today, lad." -> "Not today, lass."; "mister" -> "missus"; "sir" -> "missus"; "my son" -> "my
 * daughter"; "young man" -> "young woman" (or "woman" past 30); "farm boy" -> "farm girl".
 */
export function addressed(p: Pick<Profile, "sex" | "age">, text: string): string {
  const young = p.age <= 30;
  if (p.sex === "man") return young ? text : text.replace(/\byoung man\b/g, "man").replace(/\bYoung man\b/g, "Man");
  const yw = young ? "young woman" : "woman";
  return text
    .replace(/\blad\b/g, "lass")
    .replace(/\bLad\b/g, "Lass")
    .replace(/\bfarm boy\b/g, "farm girl")
    .replace(/\bKempen boy\b/g, "Kempen girl")
    .replace(/\berrand boy\b/g, "errand girl")
    .replace(/\byoung man\b/g, yw)
    .replace(/\bYoung man\b/g, yw.charAt(0).toUpperCase() + yw.slice(1))
    .replace(/\bmy son\b/g, "my daughter")
    .replace(/\bmister\b/g, "missus")
    .replace(/\bMister\b/g, "Missus")
    .replace(/\bsir\b/g, "missus")
    .replace(/\bSir\b/g, "Missus")
    .replace(/\ba man who\b/g, "a woman who")
    .replace(/\ba better man\b/g, "a better woman")
    .replace(/\bListen to him!/g, "Listen to her!")
    .replace(/\bhis own\b/g, "her own");
}

// ------------------------------------------------------------------ random (the creator's "Random")

export const NAMES = {
  man: {
    flemish: ["Jan", "Pieter", "Frans", "Karel", "Jozef", "Lowie", "Rik", "Kees", "Guust", "Pier", "Jaak", "Pol", "Constant", "Victor", "Emiel", "Alfons", "Fiel", "Remi", "Staf", "Tist", "Door", "Mon", "Sus", "Nand", "Bert"],
    walloon: ["Jean", "Joseph", "Pierre", "Henri", "Jules", "Emile", "Arthur", "Léon", "Alphonse", "Camille", "Hubert", "Nicolas", "Lambert", "Gilles", "Désiré", "Auguste"],
  },
  woman: {
    flemish: ["Mie", "Anna", "Lies", "Trien", "Rosalie", "Leonie", "Sidonie", "Coleta", "Babette", "Clementine", "Tilde", "Virginie", "Fanny", "Mena", "Paulina", "Hortense", "Melanie", "Mieke", "Stien", "Net"],
    walloon: ["Marie", "Jeanne", "Catherine", "Joséphine", "Louise", "Adèle", "Julie", "Elise", "Hélène", "Céline", "Pauline", "Victorine", "Marguerite", "Clémence"],
  },
  surname: {
    flemish: ["Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens", "Wouters", "De Smedt", "Van den Bergh", "Verhoeven", "Hermans", "Aerts", "Vermeulen", "De Backer", "Laenen", "Nys", "Luyten", "Verbruggen", "Geerts", "Smets", "Michiels", "Bosmans", "Van Gorp", "Cuypers"],
    walloon: ["Dubois", "Lambert", "Dupont", "Martin", "Leclercq", "Renard", "Lejeune", "Simon", "Laurent", "Delvaux", "Collard", "Gilson", "Dumont", "Lemaire", "Hardy", "Piret", "Masson", "Charlier"],
  },
};

/** A period-true character at random: a Flemish or Walloon name, a look people of that station wore. */
export function randomProfile(rnd: () => number = Math.random, sexIn?: Sex): Profile {
  const pick = <T>(a: T[]): T => a[Math.floor(rnd() * a.length) % a.length];
  const sex: Sex = sexIn ?? (rnd() < 0.5 ? "man" : "woman");
  const walloon = rnd() < 0.3;
  const names = NAMES[sex][walloon ? "walloon" : "flemish"];
  const surnames = NAMES.surname[walloon ? "walloon" : "flemish"];
  const band = pick([...AGE_BANDS, AGE_BANDS[0], AGE_BANDS[1], AGE_BANDS[1]]);
  const age = band.min + Math.floor(rnd() * (band.max - band.min + 1));
  const ids = (list: Choice[]) => optionsFor(list, sex).map((c) => c.id);
  const work = ["indigo", "faded_indigo", "blue_grey", "brown", "dark_brown", "grey", "charcoal", "black", "faded_red", "green", "ochre"];
  const hairs = age > 50 ? ["grey", "white", "grey", "dark_brown"] : age > 40 ? ["grey", "dark_brown", "light_brown", "black", "fair"] : HAIR.filter((h) => h.id !== "white" && h.id !== "grey").map((h) => h.id);
  const feet = rnd() < 0.45 ? "clogs" : "boots";
  const raw: Profile = {
    v: 1,
    first: pick(names),
    last: pick(surnames),
    sex,
    age,
    build: pick(["slight", "middling", "middling", "stout"]) as Build,
    skin: pick(["pale", "fair", "fair", "rosy", "weathered", "weathered", "olive"]),
    hair: { colour: pick(hairs), style: sex === "man" ? (age > 38 && rnd() < 0.4 ? "balding" : pick(["short", "short", "long"])) : pick(["bun", "bun", "plaits", "coronet"]) },
    face: sex === "man" ? pick(age < 21 ? ["clean", "light_stubble", "light_stubble", "clean"] : ids(FACES)) : "none",
    clothes: {
      head: { kind: pick(ids(HEADS).filter((h) => h !== "tophat")), colour: pick(["charcoal", "black", "brown", "dark_brown", "grey", "indigo", "faded_red", "green", "blue_grey"]) },
      coat: { kind: pick(ids(COATS)), colour: pick(work) },
      shirt: { colour: pick(sex === "man" ? ["linen", "linen", "white", "faded_indigo", "grey"] : ["blue_grey", "indigo", "brown", "black", "faded_red", "green", "grey", "dark_brown"]) },
      vest: { colour: pick(["charcoal", "black", "dark_brown", "brown", "grey", "green"]) },
      lower: { colour: pick(sex === "man" ? ["grey", "charcoal", "brown", "dark_brown", "indigo", "blue_grey"] : ["brown", "dark_brown", "black", "indigo", "grey", "green", "faded_red"]) },
      apron: { kind: rnd() < (sex === "woman" ? 0.7 : 0.25) ? "apron" : "none", colour: pick(["linen", "white", "faded_indigo", "indigo", "grey", "brown"]) },
      feet: { kind: feet, colour: pick(feet === "clogs" ? WOOD : LEATHER).id },
    },
    best: false,
  };
  if (sex === "woman" && raw.clothes.head.kind === "whitecap") raw.clothes.head.colour = "white";
  return clampProfile(raw).profile;
}

/** Sunday best: black and white linen, boots, a hat for a man and a bonnet for a woman (the creator's button). */
export function sundayBest(p: Profile): Profile {
  const w = p.sex === "woman";
  return clampProfile({
    ...p,
    best: true,
    clothes: {
      head: { kind: w ? "bonnet" : p.age > 35 ? "tophat" : "bowler", colour: "black" },
      coat: { kind: w ? "shawl" : "coat", colour: w ? "black" : "black" },
      shirt: { colour: w ? "black" : "white" },
      vest: { colour: "black" },
      lower: { colour: w ? "black" : "charcoal" },
      apron: { kind: "none", colour: "white" },
      feet: { kind: "boots", colour: "black_leather" },
    },
  }).profile;
}
