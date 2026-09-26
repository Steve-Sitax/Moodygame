// The dialogs on screen (Steve 2026-09-26: "a dialog in progress stays on screen and cannot be used
// anymore" after going to another window and back). Every panel with its own keys (a talk, a card with
// number keys, a sheet, the dice, a gang's demand ...) registers here once, with how to tell it is up.
// The pause (main.ts) asks here: with a dialog up, coming back to the window with a click or any key
// goes back into the game at once, and a key the dialog uses (a digit, E, B ...) reaches it. The ink cursor
// (game/cursor.ts) shows while one is up, so its lines and keys can be clicked.

interface Entry {
  name: string;
  open: () => boolean;
  /** The mouse works it with the ink cursor (game/cursor.ts); false: the mouse keeps the look (a menace to walk away from). */
  cursor: boolean;
}
const list: Entry[] = [];

function isUp(d: Entry): boolean {
  try {
    return d.open();
  } catch {
    return false;
  }
}

export const dialogs = {
  /** A panel with its own keys: `open` says whether it is on screen now. */
  register(name: string, open: () => boolean, opts: { cursor?: boolean } = {}): void {
    list.push({ name, open, cursor: opts.cursor !== false });
  },
  /** Is any dialog up now? */
  any(): boolean {
    return list.some(isUp);
  },
  /** Is a dialog up that the mouse works (the ink cursor instead of the look)? */
  cursor(): boolean {
    return list.some((d) => d.cursor && isUp(d));
  },
  /** The names of the dialogs up now (the dev check). */
  up(): string[] {
    return list.filter(isUp).map((d) => d.name);
  },
  /** Every registered dialog's name (the dev check). */
  names(): string[] {
    return list.map((d) => d.name);
  },
};
