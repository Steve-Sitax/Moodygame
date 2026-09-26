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
- Lantern shadows (night) build their depth shader the first time a person throws a shadow: once.
- The back streets (`game/lively.ts`) build once, 1 s after the town loads: about 0.2 s. It runs on
  the first screen when the player waits a moment.
