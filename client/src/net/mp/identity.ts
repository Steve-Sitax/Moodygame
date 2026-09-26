// M8a multiplayer: who this tab is (boot/netboot.ts sets it before the game runs). On the host PC the page
// is the host (player 1) and needs no token. Anywhere else, or with ?seat=2 (a second player in the same
// browser, for tests), it carries a player token from the join (kept in localStorage per seat: a cookie
// would be shared by all tabs).

export const identity = {
  seat: 1,
  /** This computer (127.0.0.1, localhost): the host's own PC. */
  local: true,
  token: null as string | null,
  /** Played together (the server said so at the start; a push may change it). */
  together: false,
  /** The server's build version (the manifest's), and whether files came from the browser's store. */
  version: "dev",
  cached: false,
};

export const TOKEN_HEADER = "X-Scheldemist-Player";

export const tokenKey = (seat: number): string => (seat <= 1 ? "scheldemist.mp.token" : `scheldemist.mp.token.seat${seat}`);

/** A guest (a token), not the host. */
export const isGuest = (): boolean => identity.token !== null;
