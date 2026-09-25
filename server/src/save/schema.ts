// M7 save and pause: the rows a save adds to the database (db.ts migrate runs this).
//
// client_state: what the browser holds and the server did not (Jef's place, height and facing, in
// the water or a boat, what is in his hands, how far the job in hand has come, the minute on the
// clock). Keyed by the player: one row today (player 1), one a player when there are more.
// The engine never takes a number from it: money, needs, jobs, trust stay the server's own.
export const CLIENT_STATE_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS client_state (
  player_id INTEGER PRIMARY KEY,
  state_json TEXT NOT NULL,
  saved_at TEXT NOT NULL
);
`;

/** In a save file only (written after the copy): what the save list shows. */
export const SAVE_META_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS save_meta (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL
);
`;
