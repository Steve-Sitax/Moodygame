// Plain English for game text (Steve, 2026-09-23): Dutch only in names of
// people and places. The prompts ask for it; this net catches the Dutch
// forms of address the model still slips in ("Eat, jongen, you look ...").

const ADDRESS = "jongen|jong|maat|schat|manneke|manneken|baas|allee|allez|zeveraar|mijnheer|meneer|menier|madam|ventje|kerel|gast|sloeber";
const EXCLAIM = "ach|allee|allez|awel|amai|hé|goed|ja|nee|zeg|seg";
const OPEN = `(^|["\\u201c]\\s*)`; // start of the text, or just after an opening quote

/** "Eat, jongen, you" -> "Eat, you" */
const INNER = new RegExp(`,\\s*(?:${ADDRESS}),`, "gi");
/** "Not now, jongen." -> "Not now." */
const TAIL = new RegExp(`,\\s*(?:${ADDRESS})(?=\\s*(?:[.!?;:"\\u201d]|$))`, "gi");
/** "Jongen, listen" / "Goed. Come back" / "Ach, schat, I've" -> "Listen" / "Come back" / "I've" */
const LEAD = new RegExp(`${OPEN}(?:(?:${ADDRESS}|${EXCLAIM})\\s*[,.!]\\s*)+(\\S)`, "gi");

export function plainEnglish(s: string): string {
  return s
    .replace(INNER, ",")
    .replace(TAIL, "")
    .replace(LEAD, (_m, pre: string, c: string) => pre + c.toUpperCase())
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** The rule as the prompts state it. */
export const LANGUAGE_RULE = `Language: plain English. Dutch or Flemish only in the names of people, places, firms and ships
(Rijnkaai, Hessenatie, Schelde, Sooi, the Anna Maria) and for jenever, the drink. No other Dutch words or phrases:
not as forms of address (no jongen, maat, schat, manneke, baas, mijnheer), not as exclamations (no ach, allee, goed, ja).`;
