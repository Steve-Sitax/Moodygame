// Fonts in the game, not the system's (Steve 2026-09-26: "Fonts included in game, not system").
// Five free faces under the SIL Open Font License 1.1, as declared npm packages (@fontsource/*,
// assets/ATTRIBUTION.md), each under one name of our own so no file has to know which face it is:
//
//   "Scheldemist Hand"   Kalam (Indian Type Foundry): the pencil and ink of notes, the HUD, headings
//   "Scheldemist Print"  Old Standard TT (Alexey Kryukov): a late 19th-century book face for reading
//   "Scheldemist Slab"   Alfa Slab One (JM Sole): the fat slab of posters and bills, headlines
//   "Scheldemist Black"  UnifrakturMaguntia (J. "Mach" Wust): the newspaper's blackletter masthead
//   "Scheldemist Mono"   Courier Prime (Alan Dague-Greene): telegrams and the typewriter's lines
//
// CSS uses them as font-family with a system fallback after (the `FONT` strings below for canvas).
// Imported by main.ts before the world is built: the module waits (top-level await, at most
// FONT_WAIT ms) until the faces are in, so every canvas painted at build time (signs, posters,
// the map) draws in them and not in the fallback.

import handLight from "@fontsource/kalam/files/kalam-latin-300-normal.woff2?url";
import hand from "@fontsource/kalam/files/kalam-latin-400-normal.woff2?url";
import handBold from "@fontsource/kalam/files/kalam-latin-700-normal.woff2?url";
import print from "@fontsource/old-standard-tt/files/old-standard-tt-latin-400-normal.woff2?url";
import printItalic from "@fontsource/old-standard-tt/files/old-standard-tt-latin-400-italic.woff2?url";
import printBold from "@fontsource/old-standard-tt/files/old-standard-tt-latin-700-normal.woff2?url";
import slab from "@fontsource/alfa-slab-one/files/alfa-slab-one-latin-400-normal.woff2?url";
import black from "@fontsource/unifrakturmaguntia/files/unifrakturmaguntia-latin-400-normal.woff2?url";
import mono from "@fontsource/courier-prime/files/courier-prime-latin-400-normal.woff2?url";
import monoBold from "@fontsource/courier-prime/files/courier-prime-latin-700-normal.woff2?url";

/** The family names with their fallbacks, for CSS in code and for canvas `ctx.font`. */
export const FONT = {
  hand: `"Scheldemist Hand", "Segoe Print", "Bradley Hand", cursive`,
  print: `"Scheldemist Print", Georgia, "Times New Roman", serif`,
  slab: `"Scheldemist Slab", "Rockwell Extra Bold", Georgia, serif`,
  black: `"Scheldemist Black", "Old English Text MT", Georgia, serif`,
  mono: `"Scheldemist Mono", "Courier New", monospace`,
} as const;

const FACES: Array<[family: string, url: string, weight: string, style: string]> = [
  ["Scheldemist Hand", handLight, "300", "normal"],
  ["Scheldemist Hand", hand, "400", "normal"],
  ["Scheldemist Hand", handBold, "700", "normal"],
  ["Scheldemist Print", print, "400", "normal"],
  ["Scheldemist Print", printItalic, "400", "italic"],
  ["Scheldemist Print", printBold, "700", "normal"],
  // one weight only: the bold of a canvas "bold 30px" asks for is this same face (no fake bold)
  ["Scheldemist Slab", slab, "100 900", "normal"],
  ["Scheldemist Black", black, "100 900", "normal"],
  ["Scheldemist Mono", mono, "400", "normal"],
  ["Scheldemist Mono", monoBold, "700", "normal"],
];

/** How long the game waits for the fonts before it builds the town anyway (fallback faces then). */
const FONT_WAIT = 4000;

let loaded = 0;
const failed: string[] = [];
async function loadAll(): Promise<void> {
  if (typeof FontFace === "undefined" || !document.fonts) return;
  await Promise.all(
    FACES.map(async ([family, url, weight, style]) => {
      try {
        const f = new FontFace(family, `url(${JSON.stringify(url)}) format("woff2")`, { weight, style, display: "swap" });
        document.fonts.add(f);
        await f.load();
        loaded++;
      } catch (e) {
        failed.push(`${family} ${weight} ${style}: ${String(e)}`);
      }
    }),
  );
}

/** Resolves when every face is in (or failed, or FONT_WAIT passed). */
export const fontsReady: Promise<void> = Promise.race([loadAll(), new Promise<void>((r) => setTimeout(r, FONT_WAIT))]);

/** Dev: how the fonts came in. */
export function fontInfo(): { faces: number; loaded: number; failed: string[] } {
  return { faces: FACES.length, loaded, failed: [...failed] };
}

// top-level await: the town's canvases are painted after this (main.ts imports this before the world)
await fontsReady;
