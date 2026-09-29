# The web demo: click to play in the browser

Steve, 2026-09-27: "is there a possibility to launch the game from github directly, but then without the whole
server part? ... only basics, run around in antwerp and some npcs also there, no interactions, no ai ... for the
click to play".

The same game, built in demo mode for GitHub Pages: https://steve-sitax.github.io/Moodygame/ (live once the repo is
public; GitHub Pages needs a public repo on the free plan).

## What it has, and what not
- Walk the whole town: the streets, the quays, the river, the weather, day and night, the lamps.
- The townspeople walk their day (about 860 of them, a fixed town, seed 1873), with the street life that runs in the
  browser anyway: stalls, carts, boats, cranes, animals.
- The clock runs in the browser: it starts at 16:30 on Monday, 5 game minutes a tick as in the game; the sky turns
  every 3 game hours (mist, clear, fog, rain).
- No E or F keys (no talking, jobs or shops), no saves, no AI setup, no play together. The
  menu says it is a limited demo, just to get a look, and links to the download.
- F9 flies (Steve 2026-09-27), in the time and weather you are in (the dev build's fly also clears the fog and sets
  noon; the demo does not). A box top right always says "Limited web demo, just a look" and "F9 fly over the
  town"; while flying it shows the keys. Controls in Settings has a Fly part too.
- Time, weather and events (Steve 2026-09-27: "make it all available"): F8 anywhere, or "Time, weather, events" in
  the menu, opens the Dev panel. The 15 director templates play there as recorded when the demo was built: at the
  build, a throwaway server (dev mode) starts each template, ticks the clock and keeps every tick's GET /api/actions
  (and the cathedral's room for the wedding and the funeral) as a frame in `demo/events/<template>.json` (about
  3.7 MB for all). A button loads one, jumps the clock to its hour, puts Jef on free ground near it facing it, and
  the demo plays one frame per tick. The people's reports (`POST actions/sync`, `actions/:id/report`) get an empty yes.
  A template the engine refuses at its hour is tried two and four hours later. The great storm (`tempest`,
  recorded last) also keeps the sky and the shut shops in each frame, and the sky it leaves (rain): the demo turns the
  weather with it (Steve 2026-09-29).
- The Dev button on the pause page (Esc) sets the time and the weather (the demo's own clock: `POST dev/set` in
  `demo.ts`, pushed to the game at once), jumps to places, and has the world's own dev events. A sky picked by hand
  stays until the next pick.

## How it works
- `client/src/demo/demo.ts` (`DEMO` = `vite build --mode demo`), installed first by `boot/netboot.ts`:
  - every `/api/...` call is answered in the browser: the baked files for the routes in `client/src/demo/routes.json`,
    `jobs` and `tick` with its own clock (no jobs on the board), `POST town/ways` with nothing (a way not baked is "no
    way known"), and 404 "Not in the web demo" for everything else, so each part takes its own fallback;
  - the game's own paths (`/models/...`) get the site's base (`/Moodygame/`): fetch, three.js's loaders (models,
    textures, the Draco decoder) and an image's `src`.
- Switched off in demo mode: the join step (`netboot.ts`), the push socket (`net/api.ts connectPush`), E and F
  (`game/jobs.ts findAll`), the menu's saves, New game and AI setup (`menu/menu.ts`), Save and Load
  (`game/saves.ts`), Together (`net/mp/together.ts`).
- `tools/demo/build.mjs` builds the client in demo mode under the base, then starts a throwaway server (a new save in
  a temp folder, `SCHELDEMIST_TOWN_SEED=1873`, walk-around mode: no AI call) and saves each route of `routes.json` as
  `demo/<route>.json` (about 1.3 MB). The server and its save are deleted after.
- `.github/workflows/pages.yml` runs it on each `v*` tag (with the downloads) or by hand, and deploys to Pages.

## Try it on this PC
    node tools/demo/build.mjs --base / --out client/dist-demo
then serve `client/dist-demo` with any static server (for example `python -m http.server` in that folder) and open
it. With the default base (`/Moodygame/`) the folder must be served under `/Moodygame/`.

## Go live (once the repo is public)
1. `gh api -X POST repos/Steve-Sitax/Moodygame/pages -f build_type=workflow` (Pages from the Action).
2. `gh workflow run pages.yml` (or wait for the next tag).
3. Put the link in the README's Play it.

## Known limits
- About 80 MB on the first visit (the models and textures); the browser keeps them after.
- A new route the game starts to need must be added to `routes.json`, or that part takes its fallback in the demo.
