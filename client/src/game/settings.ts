// Settings (Steve, 2026-09-23: "add a settings button in the esc menu"; 2026-09-26: the menus). The
// store is game/prefs.ts (read a setting anywhere with `settings.get("lightBudget")`, hear changes
// with `settings.onChange`); the menu that shows it is menu/menu.ts.

import { mountMenu } from "../menu/menu";
import { settings, type GameSettings } from "./prefs";

export * from "./prefs";

export function loadSettings(): GameSettings {
  return settings.all();
}

/**
 * The menu on the pause paper (menu/menu.ts). `apply` gets the settings at once and after every
 * change (main.ts: the render height, the PS1 colour and wobble, the people in the street).
 */
export function mountSettings(pausePaper: HTMLElement, apply: (s: GameSettings) => void): GameSettings {
  apply(settings.all());
  settings.onChange((p, changed) => {
    if (changed.some((k) => k === "height" || k === "psxColour" || k === "wobble" || k === "street" || k === "scale")) apply(p);
  });
  mountMenu(pausePaper);
  return settings.all();
}
