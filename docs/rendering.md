# Rendering: no stutter

Rules for anything that draws. They come from the stutter hunt of 2026-09-26. The game froze for
up to 2 s the first time a place came into view, and for 9 s on the first screen. The cause was
shaders (the small GPU programs three.js builds for each material). On Windows, Chrome draws
through ANGLE on Direct3D 11, and there one shader build takes 0.1 to 0.4 s. The game waits for it.

## How it works now
- **The warm-up** (`client/src/world/warmup.ts`, started in `main.ts`) builds every shader before it
  is drawn: at boot, when the city is in, and twice a second for new objects (the town, the market,
  the houses' rooms, a person gone indoors, a material that gets its texture late). It uses
  `compileAsync`: the driver builds the shaders side by side in the background. On the first screen
  the picture holds until they are ready. In the game the frames always draw.
- **Into the retro target.** The game draws into a render target (linear colour). A shader built for
  the screen (sRGB) is a second, useless copy. The warm-up sets `retro.target` before it compiles.
- **Rooms share one light setting.** Every room in the world (`world/inworld.ts`) is drawn with
  `ROOM_POINT_LIGHTS` (10) point lights. The lamps a room does not have are filled up with lights at
  intensity 0. They add nothing to any pixel (checked pixel for pixel, 2026-09-26), and all rooms
  share one shader set. Before this, rooms with 2, 3, 4, 6, 8 and 9 lamps needed 7 sets.
- **The mouse** (`player/firstPerson.ts`) drops the moves the browser makes up: the first 100 ms
  after the lock, the moves piled up during a frame over 150 ms, and a lone jump over 250 px.

## Rules
1. **Fixed light counts.** In the street the number of lights must never change while the game runs:
   no `scene.add(light)` or `remove`, no `light.visible` toggles, no hiding a group that holds a light.
   Dim a light with `intensity = 0` instead. The street has 12 point lights, 1 directional, 1 hemisphere
   and 1 point shadow (the lantern pool, `world/lanternLights.ts`). In a room, lamps may come and go
   (the dark fill-up lights follow), but a room has at most `ROOM_POINT_LIGHTS` lamps and always 1
   hemisphere light. More lamps give it its own shader set (the console warns).
   Light from lit windows, open doors and the lamps and lanterns past the real lights is no light at all
   to three.js: `world/spill.ts` hands the nearest `MAX_SPILL` (retro/psx.ts) to every lit psx material as a
   uniform list and draws the rest as ground pools. A new source never changes a shader: register it there.
2. **No scene material drawn to the screen.** Draw scenes into a render target (`retro.target`, a
   mirror's target), never with `setRenderTarget(null)`. Only the final retro quad goes to the screen.
3. **Few shader kinds.** A new shader kind is a new build on every machine. Reuse materials and the
   `psx()` options that exist. Do not make a material per object when the settings are the same.
   Do not flip settings that change the shader at run time (`fog`, `vertexColors`, `map` from null to
   a texture, `instanceColor` added later, `defines`). Set them when the object is made.
4. **Build before you show.** An object made on the fly in front of the player is built in that
   frame. Make it early (beyond the fog, or at load), or reuse a material that is already built.
5. **Measure after a change** that adds materials, lights or rooms: `__scheldemist.shaders()` in the
   test tab (see testing.md). `problems` must be empty. `lightSettings` shows 2 rows: the street and
   the rooms. `programs` was 187 on 2026-09-26: a big jump means new shader kinds.

## Still open
- The water mirror draws the town a second time when water is in view: about 12 ms more per frame on
  the quays (not a stutter, a steady cost). Cheaper options change the picture, so none is taken yet.

## The loading screen (2026-09-26)
`client/index.html` shows it from the first paint: the picture, the name, a bar with the step, a tip. Its CSS
and a small script are inline, so it stands before the game's code has loaded. `client/src/boot/loader.ts` then
drives it and does the heavy work before the menu:

1. **Loading the town.** Every file three's loaders and the game's own fetches ask for, counted. The step
   ends when no file is in flight and no task over 150 ms has run for 0.8 s (at most 30 s after the town's
   data is in): the street life, litter, clutter, goods and posters are built by then, not on the first walk.
2. **Unpacking the pictures.** `renderer.initTexture` for every texture of the street and the rooms.
3. **Preparing the shaders.** The warm-up (`world/warmup.ts`) over everything, counted by programs ready
   (`isReady()`, with KHR_parallel_shader_compile).
4. **Warming the lights.** One draw of the whole street with nothing hidden and nothing culled (the rain,
   the lamps' glows, the night's things), and the lantern's shadow cube drawn once with one body of every
   kind casting: the depth shaders a first dusk used to build in the middle of play.
5. **Opening the doors.** Every room in `InWorld` drawn once, in its own light.

While it runs, `main.ts` draws no frames and skips its own draw-everything at city-ready: a frame drawn
during the loading waited on shaders still linking (6 s of the loading in a profile of 2026-09-26). Keys
and clicks wait. The screen fades into the menu. Numbers: `__scheldemistBoot` (docs/testing.md).
Add a new kind of thing that loads late? It is counted if it loads through three's loaders or `fetch`, and
drawn once if it is in the scene or a room when the loading ends.
