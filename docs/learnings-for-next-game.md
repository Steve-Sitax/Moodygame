# Learnings for the next game

What this project (Scheldemist, a three.js browser game with AI-driven townspeople) taught us, written so a new game project can start with it.
Gathered 2026-09-28 from `docs/`, the milestone notes, the worklog and the rules we set while building.
Each rule has the reason, and a number or incident when we have one.
Details and measurements are in the file named after each section.

## The short list

If you read nothing else, start the next project with these rules in its CLAUDE.md:

1. **The engine owns every number. The AI only proposes.** Schema-check and clamp every proposal.
2. **Player text is data, not orders.** No tools, schema output, regex gate, hostile-line suite.
3. **Every AI call has a 20 s limit and a hand-written fallback.** The game must run with no AI at all.
4. **Spike the risky parts on day 0, and measure them.** The 4–9 s model calls shaped the whole design.
5. **A milestone ends with a run in the browser**, not with a backend test.
6. **Every standing rule has a check that must list nothing** (`paths()`, `shaders()`, `stuck()`, `overlaps()`). A rule with no check does not hold.
7. **No stutter:** build shaders before use, keep light counts fixed, never change a material's shader inputs at run time.
8. **Look at close pictures of everything you change**, at midday in clear weather. Fix it and look again.
9. **A speed fix changes no pixel.** Prove it with a pixel diff, or ask first.
10. **Never test on the player's save.** Use a copy on its own ports.
11. **The server is the authority from day one**, and player data is keyed by a player id. Multiplayer later is then possible.
12. **Nothing private in git**: a pre-commit hook checks secrets, private words and unneeded files.

## 1. Process and working with AI agents

Source: `docs/06-demo-scope.md`, `docs/08-open-questions.md`, `docs/worklog.md`, `docs/milestones/`.

- **Settle the decisions before code.** One decisions file, answered by the designer in one pass, with dated rows added later. The CLAUDE.md says "do not re-ask what it answers".
- **Spike the risky dependency first, with numbers.** The spike measured 4–9 s per model call. That gave us "prefetch, never block", the 20 s limit and a fallback per call. It also found two traps: the Codex CLI hung 180 s with an open stdin, and it read the user's own full-disk-access config.
- **One line "done when" per milestone.** Insert new milestones when play shows the need, and write down the designer's words ("way too big", "fetching is boring").
- **Use one note template per milestone:** the designer's quote, a "what is in" table with files, measured numbers, tests, browser checks with picture names, known gaps, next steps.
- **A big feature starts as a plan doc**: research with sources, an options table, a recommendation, open questions, and phases that each name their browser check.
- **Keep a worklog in the repo.** It holds "waiting for the designer", the order of work, work in progress with owners, and what merged with commit ids. A note in a session dies with the session.
- **Run at most 3–4 helpers at once.** More made tests and browser checks time out.
- **Parallel helpers only where their files do not meet.** Write down which files each helper owns. Re-read shared files just before an edit. We had helpers sweep in each other's files, break each other's builds, and refresh each other's test tabs.
- **One worktree per big branch, on its own ports.** Stage your own files by path. Never `git add -A` in a shared checkout.
- **Never link `node_modules` into a temp worktree with a Windows junction.** `git worktree remove --force` follows the junction and deletes the real folder.
- **Stopping a dev-server task does not stop its children.** Vite and the node watcher keep the ports. Kill them by port, then check the ports are free.
- **Finds outside the task go to an issue**, with the place, the way to see it again, and which work found it. That stops both scope creep and lost finds.
- **Write standing approvals down** (commit and push after a checked batch, which models are allowed). Overnight work then does not stall.
- **Plan for limits.** A usage limit stopped an overnight run for 3.5 hours. A chat's picture limit filled up, so a helper had to look at the pictures.
- **Ship when done.** A checked batch is committed, pushed, and put in the designer's play copy. Tell the designer what is new and where to look.
- **Give a clickable test link** in each hand-back, after you checked that the server answers.

## 2. AI and language models in a game

Source: `docs/03-ai-design.md`, `docs/ai-setup.md`, `docs/07-spike-results.md`, `docs/milestones/M6-models.md`, `docs/milestones/*-injection.md`.

### Authority

- **The model proposes. Only engine code changes money, needs, time, position and trust.** Every proposal goes through a schema, then a clamp.
- **Clamp numbers; do not reject the whole answer.** A pay of 99999 became 150. Trust moves at most ±2 a meeting. Prices stay within 0.5x–3x.
- **The engine decides outcomes with consequences; the model only tells them.** Guilt comes from the log. The police verdict comes from the engine's reading of the player.
- **If the engine refuses a proposed action, replace the NPC's line with the engine's line.** If not, the NPC promises something that never happens.
- **Model output must map to things the engine can play.** In M2 the jobs had varied words but all played as the same carry. The fix: goods, spots, counts and twists picked from engine lists.
- **NPCs never hand out money or items** unless the engine owns the transfer.
- **An offer counts only if the player's own words asked for it.** An invented gift, wage or errand is ignored.
- **Close exploit loops the model cannot see.** Trust from the model is held at 0 while a gift is on the table. There is a limit of 3 gifts a day.
- **Send words, not numbers, to the client** ("friendly", not trust 6).
- **Put the real facts into the prompt, or the model makes them up.** An NPC invented "twelve sacks" until the job facts went in.
- **Check invented numbers in words as well as digits.** A digit check missed "fifty centimes".
- **Tell the model the game's time scale.** Convert its units in the engine.
- **Typed answers need the AI.** With no AI route or no budget left, offer only fixed choices. No regex that judges typed words by itself.

### Schema output

- **JSON schema on every call.** One Zod object is both the TypeScript type and the model schema. Retry once, then fall back. 100% of answers were valid after the retry, over 43 prompts and 5 models.
- **Expect provider quirks.** The Claude CLI refused the `$schema` key. A big schema needed `maxTurns` 3. OpenAI strict mode needs every key required, with optional keys nullable.
- **Drop unknown keys.** A weak model's junk is a failed call, never a change in the game.

### Prompt injection defence

- **No hands:** no tools, an empty working folder, no user or project settings.
- **Lock a second provider down just as hard.** Codex: `-s read-only --ignore-user-config`, stdin closed, no shell. Any event other than text fails the call.
- **Fence typed text** between markers, labelled as a character's line and not an instruction.
- **A cheap regex gate before the call:** normalise (NFKC), strip invisible characters, 300 characters at most, one line per 5 s, a block list. A caught line gets an in-character answer and no call. It blocked 13 of 30 hostile lines.
- **Typed text never spreads.** It does not go into the shared event log. Rumours carry the engine's stored gist, not the model's words.
- **No machine data in prompts**: no user names, paths or host names. Swap the player's name for a fixed name going in, and back coming out. The prompt stays the same, so the cache still works.
- **Make injection attempts part of the story.** "Jef talked strange" becomes a memory, and NPCs gossip about it.
- **Keep a fixed hostile-line suite** (30 lines, plus 5 for the action layer). Run it on every model and every new hook that takes player text. Opus and GPT Sol each passed 35 of 35 with the gate off.
- **Read the "leak" flags by hand.** All 16 flags were NPCs repeating a strange word while staying in character.
- **Send player text only to models that passed the suite.** The router keeps those hooks on the tested model, whatever the table says.
- **Filter what a director model writes too.** Weapons or injury refuse the whole event.

### Speed, fallbacks and cost

- **Never make the player wait on a call.** Prefetch the opening line at 10 m. Make job boards during the sleep screen. Push results over WebSocket.
- **One hard 20 s limit per call, queue time included.** Then kill the process tree. Throw away late answers.
- **A hand-written fallback for every hook**, good enough to play with no AI at all. The web demo only worked because of this.
- **Re-check a slow answer against the world when it arrives.** Refuse a place that is now wrong or an event that now overlaps.
- **Benchmark models on the real prompts**, with a blind judge, the rule checks and the times. A cheaper model gets a hook only when it is as good, breaks no more rules and is fast enough 95% of the time.
- **Do not trust "fast and cheap" claims.** Under load GPT Sol took 12.8 s median. Sonnet took 38 s on the job board. Haiku took 40–60 s until thinking was off. Opus at medium effort was best and not slower (7.4 s).
- **A model that judges its own family is biased.** Treat 3–4 prompts per hook as a small sample.
- **Fall back to another provider only on a crash**, not on a schema miss.
- **Stable text first, changing text last**, for the prompt cache. A cold call cost about $0.38; a warm one about $0.01.
- **A daily call budget, a share per feature, and a reserve for core hooks.** Book the budget row before any await, so parallel calls cannot slip past the cap.
- **Piggyback.** Actions and errand plans ride in the talk reply. Ask the model to steer only when something went wrong.
- **One call at a time per hook, and a priority queue** when players share the AI. Talk goes first.
- **Swap models in a route table**, never in game code.

### Memory and director

- **NPC memory is small:** a persona with trait sliders, a relationship row, and one-sentence memories with a weight of 1–10. Only the top 8 go into the prompt; the prompt stays under 1k tokens.
- **Gossip copies strong memories as "heard"**, 2 points lighter. Every memory loses 1 weight a night. Weak old memories are deleted.
- **Rumours keep the original fact.** A retelling may add no new names, numbers or crimes; a check refuses it if it does.
- **The director thinks at most once a game hour**, picks from a fixed list of building blocks, and a scheduler enforces no overlaps and a daily cap. Templates are the fallback.
- **Tests run with an offline model by default.** Before that, tests sent background calls to the real model.
- **On start-up, close call rows a crash left "running".** A timeout or a save must never leave a result half applied.

## 3. Rendering and performance (three.js / WebGL)

Source: `docs/rendering.md`, `docs/milestones/M7-rendering.md`, `docs/milestones/M7-lamps.md`.

### Shader stutter

- **Build every shader before it is first drawn.** On Windows, Chrome runs WebGL on Direct3D 11. One shader build takes 0.1–0.4 s. We froze up to 2 s when a new place came into view, and 9 s at start. Fix: a warm-up with `compileAsync` and `KHR_parallel_shader_compile`.
- **Warm shaders against the real render target**, not the screen.
- **Never change a material's shader inputs at run time**: `fog`, `vertexColors`, a `map` that goes from null to a texture, `instanceColor`, `defines`. Set them when you make the object.
- **The shader-program count is a budget.** Check it after every change to materials, lights or rooms. A jump means new shader kinds.
- **Warm the rare paths too**: the whole scene once with nothing culled, and each shadow kind once. The first dusk used to build shaders in the middle of play.
- **Draw no frames while loading, and do not redraw a paused scene behind a menu.** Both waited on shader builds for seconds.
- **Make things that appear during play early**, behind the fog or at load, or give them a material that is already built.

### Lights

- **Keep the number of lights fixed.** three.js bakes the light count into every shader. Dim with `intensity = 0`; never add, remove or hide a light.
- **Pad every room to the same light count** with lights at intensity 0. Seven shader sets became one, with no pixel changed.
- **Give the few real lights to the lamps nearest the eye, and fake the rest.** 72 gas lamps with 6 real lights, a 0.5 s fade on handover, and no shader rebuilds.
- **Bake still light once at build time** (sunlight in a church) instead of lights or shadow maps.

### Draw calls and culling

- **In WebGL the limit is draw calls and CPU, not triangles.** The GPU needed 2–8 ms; the render CPU needed 24 ms. Mesh LOD was not worth building.
- **Cull everything past the fog's far end**, but keep things that show through fog (glows, landmarks). It cut render time 30–60% in fog.
- **A street-level city can use occlusion horizons** over a 2.5D height map. There is no GPU read-back, so nothing pops.
- **Cull with layers, never with `visible`**, so fixed light counts stay fixed.
- **Instancing is not always cheaper.** Count the shader programs first. Instanced casks added 2 programs, so we merged them instead.
- **Merge static geometry by material, in chunks.** A room seen through its door went from 177 draw calls to 45–90.
- **One InstancedMesh per vehicle part, shared by all vehicles of that kind.** Detail can then grow with no new draw calls.
- **For crowds, lower the animation rate, not the mesh**: every frame within 25 m, 15 fps to 45 m, 8 fps beyond.

### Look

- **PS1-style warp and vertex snap:** no warp on big ground triangles, and a snap grid equal to the render size. Otherwise the cobbles swirl and every edge jumps like stutter.
- **Anything drawn without fog needs its own fog reach**, or it hangs in the grey as a dark box.
- **Planar mirrors are the biggest steady cost.** Draw them small (320x180), skip them when no water shows, draw them every second frame, before the main pass.
- **A mirror is right at one height only.** Puddles on a raised walk showed the wall upside down.
- **three.js `bumpScale` works per screen pixel.** Scale it by the render height.
- **Relief tilts the lit normal and keeps the mean brightness.** Relief that only darkens looks flat.
- **Make height maps from the same picture by script, keyed by the picture's hash.** An old bump map once outlived its new texture.
- **Never bake one feature into a repeating tile.** Roll stone tone and height in world space. Repeats show as bands.

### Measuring

- **Prove a speed fix is invisible**: render the same moment with the fix off and on, and compare pixels, at random places in every weather. If only a quality trade helps, name it and ask.
- **Check the browser before you bisect code.** An Edge auto-update made the game a slideshow overnight; Chrome stayed fast. Hours went into profiling the game first.
- **Do not trust frame times from a hidden tab** (it runs at 1–2 fps). Drive the logic with a `step()` hook and compare draw calls when the machine is busy.

## 4. World building and modelling

Source: `docs/building-with-interior.md`, `docs/milestones/M3c.md`, `M3d.md`, `T1-ways.md`, `M7-tight-props.md`, `M6-cranes.md`.

- **Pipeline:** trace an open-licence (CC0) historic map with a script, design the map in code, plan plots and houses, then build headless in Blender (`blender -b --factory-startup -P build_*.py`) to Draco glTF. Line the map up on landmarks that still stand.
- **A real-size city is too big to be fun.** Shrink the ordinary streets; keep the landmarks in order and at true size. Start to main square went from about 800 m to 275 m.
- **Map-tracing traps:** a big morphological close swallows narrow quays, and ink outlines make blocks fat. Check scale against real objects (our bricks were 3 times too big).
- **Deterministic build scripts.** Hash every model object before and after a rebuild, to prove only the intended one changed.
- **A z-fight checker** (faces within 5 mm). Fix the cause in the generator, not with offsets. Visible fights went from 3,314 to 550.
- **Real interiors, not instanced.** The room is built inside its shell at true size, every window is a real hole, and portal culling draws a room only where an opening shows. A room with no door in view costs nothing. The painted windows on the prison read as fake.
- **Interior traps:** remove shell faces that stand inside a room, keep room faces 2 cm inside the shell, blend fog and light across the doorway. Find holes by clearing to magenta and rendering from a grid of points.
- **Write every opening twice from the same numbers** (a marker in the model and a row in code), and run an automatic check. A door with no room behind it shows a grey void.
- **Always a path.** A flood fill on a 0.5 m grid must reach every job spot, NPC and door; this check gates every milestone. Moving vehicles and opening bridges are not walls.
- **Collide the player as a ring of 8 points at 0.45 m**, not a point. Grow walls by the same radius in the path check.
- **Props collide with their own triangles**; boxes are only a first quick test. With boxes, the player could not climb a barrel pile.
- **NPC paths:** A* on a 0.5 m grid, pull the path tight, a stuck check (no progress for 2.5 s: block and replan), and push apart bodies closer than 0.6 m.
- **Off-screen NPCs follow one fixed function of time and route**, shared by server and client. Then nobody pops in or out.
- **Moving machines need clearance checks on every step**, with a priority order and give-up timers so nothing deadlocks.
- **Held things go on the hand bones.** Ropes that miss hands and papers that float beside them were the most common visual bug.
- **Every clock shows the game's own time**, with one shared live-hands code.
- **Textures:** an image model makes good seamless tiles from our own prompt plus a reference photo. Record the prompt, date, model and SHA-256. Keep a stand-in painted in code until the picture loads.

## 5. Testing

Source: `docs/testing.md`, `docs/milestones/M7-quest-tests.md`, `M7-walkthrough-*.md`.

- **A test stack:** copy the save (SQLite online backup, safe while the live server writes), own ports, and delete everything when done. It refuses the play ports.
- **A test kit in the page**, not waiting: set time and weather, teleport, summon an NPC, force a job or event, run or skip the clock, take a named picture, read the state. Dev routes are off in production.
- **A good view:** midday, clear weather, camera 1–3 m from the thing. A black picture proves nothing. A hidden pane draws at 300x150, so resize it first.
- **Checks that must list nothing:** paths, shaders, stuck, overlaps, pop-in, props, save audit. They found a cart parked on a statue's spot and 17 NPC overlaps.
- **Walkthroughs with the keys, not teleport**, split by map half across helpers, in day, night, fog and both tides. They found falling through the world and a stair you could not climb back.
- **Play every quest to the pay**, then check money, trust, memories, log and outcome text. One round found 21 bugs.
- **A hostile-input suite** against the real model at each milestone.
- **Browser automation traps:** background tabs run timers once a second; a long clock run blocks the page; a scripted key stays down until you send the key-up; close every test tab (one kept playing sound after the designer closed the browser).
- **Test copies are silent** except on the play port, so test sound never mixes with the designer's game.
- **Sound:** give each sound its real reach (water about 5 m, bells across town). Measure each source with an analyser before and after; guessing by ear failed twice.
- **Flaky tests under load:** run the suite on a clean copy of HEAD and file flakes as issues.

## 6. Saves, server and multiplayer

Source: `docs/milestones/M7-save-pause.md`, `M7-save-audit.md`, `docs/multiplayer-plan.md`, `M8a.md`–`M8f.md`.

- **A thin client; the server owns every number.** This made multiplayer possible later, and an engine port would only swap the client.
- **Pause is a virtual clock.** One module, imported first, patches `performance.now`, timers and `fetch`. We did not touch 60 time reads across 20 files.
- **A save waits for a quiet moment.** A save that waits for a model call froze play for 14.5 s.
- **Save = SQLite online backup to a temp file, then rename.** A load upgrades a copy, never the live file, and bumps a generation number so late AI answers are dropped.
- **A save auditor on many fresh seeds.** All 36 new games had the same tavern bug. Fix the generator, not only the old save.
- **Single player to multiplayer through a context value.** A player id from AsyncLocalStorage replaced 117 `WHERE id = 1` queries in 54 files.
- **`Math.random` is a multiplayer bug.** Seed every placement and timing by id, place or the shared clock. A two-tab mesh compare found 17 differences.
- **Each player's own movement is local**; the server only checks it is possible. The network never touches the mouse.
- **Shared objects:** the server owns the list; the client acts at once with an undo ("Someone was quicker."). Number the pushes and resync when one is missed.
- **Handover needs a gap** (claim at 55 m, let go at 68 m). Without it, ownership bounced 22–28 times at a door.
- **A protocol number rides on the join.** An old build is sent to reload.
- **Measure netcode with a harness**: a headless walker and a proxy with delay, jitter and stalls. A fixed 200 ms buffer froze figures on 41% of frames over VPN.
- **Plain http on a LAN IP is not a secure context.** No Service Worker, no `crypto.subtle`. Browser storage is per address.
- **No pause together.** The night passes only when everyone sleeps. Each player has an AI budget.

## 7. Releases, public repo and licences

Source: `docs/release.md`, `docs/web-demo.md`, `docs/public-release-check.md`, `assets/ATTRIBUTION.md`.

- **Release = push a `v*` tag.** CI builds a zip per OS with Node inside and starts each one to test it. Players install nothing.
- **The web demo is the same code in a build mode.** `/api` is answered in the browser from files baked by a throwaway server. Unknown routes fall back as with no AI.
- **Keep the demo in sync after each merge.** Git Bash turns a `/` argument into a Windows path; build it from PowerShell.
- **Before the repo goes public, scan every blob on every ref and every commit message.** Check each asset's origin, dependency licences, machine names in the docs and the author email.
- **A pre-commit hook:** paths that never belong, files over 25 MB, secret patterns, and a private-words list kept out of git. Never skip it.
- **Third-party assets enter only with a clear licence**, written in an attribution file with the file's hash.

## 8. Game design

Source: `docs/01-game-design.md`, `docs/milestones/M7-alive.md`, `M6-plan.md`.

- **Play corrects the scope, not the plan.** "Way too big" gave a compact designed map. "Fetching is boring" gave at most 2 items by hand and carts for more.
- **What made the world feel alive:** every resident has a home, a trade, a family and a schedule; events have visible people you can follow; gossip carries the player's deeds; people keep walking real routes out of sight; job figures walk up from the town.
- **Time:** one game hour is 2 real minutes. Walking costs game time, so jobs are sized from the walked route.
- **Research the period for small life** (22 ideas from period sources, 15 built), and check each against what exists.
- **Plain language in game text.** Local words only in names; no filler words from another language.

## 9. Platform traps

- **Windows PowerShell 5.1 scripts must be pure ASCII.** One smart quote breaks the parse.
- **Stop dev servers by port**, not by stopping the task.
- **Close the game's sound in every test tab** before you hand back.
- **Browsers update overnight.** Compare browsers before you blame the code.
