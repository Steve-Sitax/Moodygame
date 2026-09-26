// M7 character: the player's profile on the client. The server keeps it by player id
// (server/src/player/); this side fetches it once, keeps it for the few lines the client writes
// itself ("lad" or "lass" in a hand-written line), and hands it to the body (player/body.ts) and
// the creator (menu/character.ts). Another player's look only ever comes from the server as a code.

import { real } from "../game/pause";
import { JEF, addressed, aboutPlayer, clampProfile, type Profile } from "../../../shared/character";

let mine: Profile = JEF;
let made = false;
const listeners: Array<(p: Profile) => void> = [];

/** This player's profile now (today's Jef until the server says otherwise). */
export const me = (): Profile => mine;
/** Did the player make a character (false: today's Jef, an old save)? */
export const madeCharacter = (): boolean => made;

/** Called when the profile changes (the body dresses again). */
export function onProfile(f: (p: Profile) => void): void {
  listeners.push(f);
}

function set(p: Profile, isMade: boolean): void {
  mine = p;
  made = isMade;
  for (const f of listeners) f(p);
}

/** GET /api/player/profile: the server's profile for this player. */
export async function loadProfile(): Promise<Profile> {
  // the untouched fetch (game/pause.ts): the page's first seconds may be a pause, and the body waits for this
  for (let i = 0; i < 4; i++) {
    try {
      const r = await real.fetch("/api/player/profile", { signal: real.abortTimeout(8000) });
      if (!r.ok) throw new Error(String(r.status));
      const d = (await r.json()) as { profile: unknown; made?: boolean };
      set(clampProfile(d.profile).profile, !!d.made);
      return mine;
    } catch {
      await new Promise((res) => real.setTimeout(res, 1500 * (i + 1)));
    }
  }
  return mine; // the server not there: today's Jef
}

/** PUT /api/player/profile: the server checks and clamps; its answer is the profile now. */
export async function saveProfile(p: Profile): Promise<{ profile: Profile; fixed: string[] }> {
  const r = await real.fetch("/api/player/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ profile: p }),
    signal: real.abortTimeout(8000),
  });
  const d = (await r.json().catch(() => ({}))) as { profile?: unknown; fixed?: string[]; error?: string };
  if (!r.ok || !d.profile) throw new Error(d.error ?? `HTTP ${r.status}`);
  const got = clampProfile(d.profile).profile;
  set(got, true);
  return { profile: got, fixed: d.fixed ?? [] };
}

/** A hand-written line said TO the player: "lad" becomes "lass" for a woman, "mister" "missus" ... */
export const toMe = (text: string): string => (made ? addressed(mine, text) : text);

/** A hand-written line ABOUT the player: "Jef" is the name, "the farm boy" follows the profile. */
export const aboutMe = (text: string): string => (made ? aboutPlayer(mine, text) : text);

/** toMe for a line that may not be there. */
export const toMeOr = (text: string | null): string | null => (text === null ? null : toMe(text));
