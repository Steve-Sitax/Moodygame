# Performance: the frame budget

The frame budget: every frame the game must fit in 16.7 ms (60 fps) on Steve's PC at the default settings (720 lines,
"high"), with room left for the quests and things still to come. `node tools/perfcheck.mjs` measures it. This file
says where the time goes, the rules for anything new that draws or runs every frame, how to prove a speed change,
and what was tried and left. Shaders, lights and stutter at first sight: [rendering.md](rendering.md).

## Where the time goes (measured 2026-09-28)
- **One CPU core does it all.** The graphics card waits 1-3 ms a frame; three.js's bookkeeping per draw is the cost.
  Drawing is ~60% of the frame, the game's logic the rest.
- **A draw** after one with the same material costs ~2 us; a **material switch** ~4-5 us more (all its uniforms go
  again). ~600 switches a frame.
- **A pass** walks the scene and sets up its materials again: the main view, the puddles' mirror (every frame, only
  what stands within 50 m), the river mirror (every second frame, when its water is in view), each room seen through
  a door or window, the lantern's shadow (every second frame at night). Something drawn near water or on the street
  is paid for two or three times.
- **The scene walk**: ~7,000 nodes; every node costs a little in every pass, visible or not.
- Busy squares (the Grote Markt, the cathedral, the Handschoenmarkt) are the heaviest; so are evening crowds.

## Rules for anything new
**Models**
- One material per kind of thing, shared by every copy (`sharedMaterial()` in `world/staticMerge.ts` marks it for the
  dev switch). Two materials with the same settings are two switches for nothing.
- Many copies of one thing (sacks, casks, lamps, leaves): one `InstancedMesh`. A material used by an InstancedMesh is
  used by nothing else, and a skinned body's material by no plain mesh: each mix makes three.js look the shader up
  again every frame.
- Still parts of a code-made model under one parent, sharing their materials; few meshes per object.
- See-through (`transparent`) and two-sided together is drawn twice (back, then front): use `side: FrontSide` unless
  both sides show.

**Textures**
- Reuse a texture; never make one per frame, per bubble or per event without `dispose()` when it goes
  (issue #19: the count still grows). Name the material or texture for what it is (bumps, rendering.md).

**Materials and shaders**
- `psx()` with the options that exist; settings fixed when the material is made (rendering.md, Rules 3). A shared
  value every psx material reads belongs in `psxUniforms` (sent once per program and pass, `retro/uniformCache.ts`),
  set before a render call, never inside one.

**Mirrors**
- A mirror draws the scene again. Small, far or hidden things are left out by the culler (`minPx`, `reach`, the
  houses' horizon); a thing that needs no reflection at all goes in `mirror.hide(...)`. A new water surface uses the
  mirror that exists (`attach`), never a new one. Budget and options: `world/mirror.ts mirrorBudget`.

**Lights and rooms**
- Fixed light counts, new light as spill (rendering.md, Rules 1). A room is a pass of its own: few meshes, shared
  materials, at most `ROOM_POINT_LIGHTS` lamps.

**Every-frame logic**
- No loop over every person, prop or collider every frame: the 4 m collider cells (`staticHit`, `groundAt` in
  `world/rijnkaai.ts`), a plain list, or a cache.
- What is unseen or far updates in turns (the unseen townspeople every 4th frame, `COARSE_EVERY` in `game/town.ts`;
  far trees' leaves every 8th); what follows from the clock is worked out from the clock, so a skipped frame costs
  nothing.
- A pure answer that is asked every frame is kept (the day routes: `server/src/town/whereabouts.ts routeCache`).
- A matrix written by hand: `matrixAutoUpdate = false` (the matrix skip, `retro/matrixSkip.ts`, keeps it otherwise).
- More than ~1 ms of pure calculation that the drawing does not need at once: a Web Worker is the next step (the town's
  simulation first). The drawing itself stays on the main thread.

## Proving a speed change
1. **Same picture.** A speed change gives 0 differing pixels, or Steve decides first. Add a switch for it to
   `__scheldemist.pixelDiff(what)` (main.ts) and run it at several places after moving frames; the `"control"` switch
   must differ (~1 M pixels), else the test sees nothing. (It read an empty picture until 2026-09-28: every result
   was 0.)
2. **A and B in one run**, back and forth at the same places (`__scheldemist.frameProf({ n: 90, turn: 2 })`):
   numbers between runs drift with whatever else the PC does (Steve's own game in Chrome takes ~2 cores).
3. **The whole game**: `node tools/perfcheck.mjs` before and after a batch (its own test stack; `--vite 5341` for a
   running one). No place over the budget; the results go to `data/perf/`.
4. Tools: `frameProf` (parts, passes, draw calls), `drawAudit` (draws by group and pass), the CPU profile over the
   debug port (the headless Chrome recipe is in tools/perfcheck.mjs). docs/testing.md has the calls.

## What is in place (2026-09-28)
- **Mirrors**: the river's at most every second frame, 12 degrees wider than the view (1.5 times the pixels) so an
  older picture still covers a turn; the puddles' every frame (an older one lagged at Jef's feet) within 50 m
  (`reach`: the oblique near plane tilts the far plane away, so `far` alone culls nothing); no mirror when the
  culler hides all its surfaces (`mirrorView`). Puddle ripples: retro/psx.ts.
- **Uniforms** (`retro/uniformCache.ts`): array uniforms only when a program's copy differs; the shared psx uniforms
  once per program and render call. 0 pixels.
- **Matrices** (`retro/matrixSkip.ts`): the local matrix composed only when position, rotation or scale changed; the
  world matrix every frame as before. 0 pixels.
- **The culler** (`world/cull.ts`): its full check in three slices over three frames, started at 55% of its slack; a
  change of the lit lamps draws the fogged things again and starts a slice. `pixelDiff("cull")`: 0 pixels.
- **Collisions, routes, the town, the leaves**: see the rules above.

## Tried and left (do not repeat without a new idea)
- **Texture atlases**: the materials in view differ in shader settings, not pictures; an atlas joins ~10 of 400.
- **Merging still parts** (`world/staticMerge.ts mergeParts`, off unless `?merge` in dev): 10-21% fewer draws,
  ~0.4 ms, but ~470 edge pixels flip at the Rijnkaai (two surfaces in one plane change order). Steve's decision.
- **The river mirror in two halves over two frames**: even, but 1.6 ms more (each half walks and sets up again).
- **Sorting by shader first**: 30% fewer shader switches, 0.6 ms slower. **Sharing all equal materials**: no gain.
- **Hidden subtrees out of the matrix walk**: ~0.7 ms, but game code may read a hidden thing's world matrix.
- **The whole drawing in a worker** (OffscreenCanvas): every part of the game moves 3D objects directly; a rebuild.
