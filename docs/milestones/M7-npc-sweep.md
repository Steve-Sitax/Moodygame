# M7: the townspeople sweep (no walking on the spot, no lost ways)

Steve, 2026-09-29: "make sure no npc glitch walk in place or can't find a way. It must seem real." Done in the night
of 2026-09-29 on a test stack (a copy of the save), no questions asked.

## How it was looked for

- **The stuck check** (`__scheldemist.stuck()`, `client/src/dev/stuckcheck.ts`): 13 places (Rijnkaai, Werf,
  Steenplein, Vismarkt, Vleeshuis, Grote Markt, cathedral, canal, lock, Petit Bassin, Handschoenmarkt, the lane behind
  the Rijnkaai, the Hessenatie) at 7:30, 12:00, 17:30 and 21:00: 52 runs of 12 game seconds. Then the cathedral
  quarter at 7, 9, 11, 15 and 18.
- **A stricter watch** (in the tab): anyone playing a walk clip while the body stays within 3 cm for 1.5 s (the check
  lists 3 s), and anyone standing (not walking) who plays a walk clip at all.
- **Lost ways**: `findcheck()` (someone due in the street near Jef but not drawn), `lagcheck()` (behind his day),
  `heldcheck()` (held by an event over 30 minutes).

## Found and fixed

1. **Walk clip left on after giving way** (`crowd.ts giveWay`): a standing townsperson steps aside for a cart and
   walks back to his spot; at the spot the walk clip was never stopped, so he "walked" on the spot until the town
   gave him a new pose. Also while he waited beside the lane. Now he stands.
2. **Walking on the spot when pushed back** (`crowd.ts walk`): someone in the way pushes a walker back (keepApart)
   and he got nowhere for up to 2.5 s with the walk clip on, before trying another way. After 1 s without getting
   nearer he now stands and waits; he walks on when the way is free, or finds another at 2.5 s as before.
3. **A body from the pool kept its last clip** (`crowd.ts make`): a new townsperson took a body that had been
   walking and stood "walking" till the town gave him a pose. The body starts idle now.
4. **Late all day after a jump of the clock** (sleep, a skip): the people near Jef were compared with the new time
   from where they stood before it, and got nearly an hour's lag at once; at exactly the most (1 hour) the lag never
   cleared ("past the most" was never reached, the lag is clamped to it). Now: a lag at the most clears
   (`whereabouts.ts settleLag`, `reportLag`); the town and the server forget all lags across a jump of over half an
   hour (`town.ts progress`, `town/lags.ts sweep`); and a lag grows no faster than the clock runs on the PC too (the
   server already held that). Worst lag after jumps: 59 minutes before, 1.2 minutes after.

## After

- The stuck check: 0 at every place and hour tried after the fixes (Rijnkaai 7:30 with 110 walking, Grote Markt
  17:30 with 65, Vleeshuis, Vismarkt, the back lane, the Hessenatie).
- The stricter watch: 6 finds before, 1 after, over the same places. The one left (a seamstress at 7:30, out of view,
  "pause" with a walk clip) did not come back when looked for.
- `findcheck`: nothing. `heldcheck`: nothing over 30 minutes.
- Tests: `server/test/runs.test.ts` (a lag at the most clears; the server forgets lags across a jump). All 1339
  server tests pass.

## Not done

- A walker who steps aside for a cart into someone standing can be held still with the walk clip for a moment (seen
  once, out of view, in the first second after a jump there).
- A townsperson who roams all day (a patrol, a round) keeps a small lag until he stops at a place of his day; it only
  moves where the sum puts him when unseen, by up to a minute or two.
