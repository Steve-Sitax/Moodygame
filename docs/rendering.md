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
- **Held until built** (issue #7, 2026-09-29). `compileAsync` only starts a build; the first frame that touches a
  program still linking waits for the driver (0.3 to 2.5 s after a jump, in `getProgramInfoLog` behind
  `getUniforms`). So an object the warm-up finds after the loading stays on a layer no camera sees (`L_HOLD`) for
  every pass of each render until its build is ready (`ShaderWarmer.hide/show`, called by `retro/retroPass.ts`; the
  culler keeps it there too), and the uniform cache (`retro/uniformCache.ts`) patches a program only once
  `isReady()`. A build that was ready already costs no frame. `shaders().warmer`: `held`, `heldMaxMs`, `onHold`.
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
   A gas lamp's light stops under its cap (issue #11, 2026-09-29): in every lit psx material a point light or spill
   source with decay `GAS_LAMP_DECAY` (1.7, retro/psx.ts) fades out from 30 to 53 degrees over the flame
   (`psxLampCap`). No other light may use that decay.
   Every lamp and lantern is one of the kinds in `world/lampLight.ts` (street, post, bracket, oil, hand: strength,
   reach, fall-off, flame colour, halo), built from one design (`tools/blender/lantern_kit.py`). Gas kinds use
   `GAS_LAMP_DECAY`, oil ones the softer 1.25. A new lamp takes its kind's light, never values of its own.
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

## Bumps (the bump audit, 2026-09-26)
Every textured surface has relief from its own picture, never a second pattern:
- **Big surfaces** have height maps made from the same picture by a script and checked by hash (a picture replaced
  without running it again draws flat): the house walls (`tools/textures/wall_heights.py`), the town wall
  (`tools/textures/townwall_maps.py`, `world/townWallBumps.ts`: the pictures packed in `wall.glb`), the landmarks
  (`tools/textures/*_maps.py`). The ground has the psx `relief` and `slabs`.
- **Everything else** gets a bump from its picture in the warm-up (`world/bumps.ts`, before its shader is first built):
  the strength by what the surface is, read from the material's name, then its picture's name or file, then its
  object's name (stone and brick 1.4, wood 1.1, rope and straw 1.0, iron 0.6, plaster 0.4, cloth 0.28, marble and
  brass 0.18; glass, paper, bills, signs, paintings, gilt and skin none). Name a new material or texture for what it
  is (`rooms.ts mat(key)` does it from the key), or tag a painted texture with `bumpTag(t, "wood")`.
- `bumpScale` is three.js r186's: it tilts the normal by the height's change from one screen pixel to the next, so
  well under 0.3 does not show. `bumpFromMap(m, k)` reads a value under 0.05 as metres (1 cm = 1.0). Small pixel-sharp
  pictures (64 px) get a height map made 4 times bigger first (`sharp`), so a joint is as sharp as a pixel. Atlas
  materials (psx `atlas`: boats, props, roofs) read their bump in their cell (`retro/psx.ts atlasBumpGlsl`).
- Check: `bumpaudit()` (docs/testing.md). Cost: no measurable frame time (the same view with and without, in one tab),
  about 5 more shader programs.

**Relief always means a lit normal** (Steve, 2026-09-27: "it must look like the ground has relief and not all parts
are equally lit ... and that needs to be done with all textures"). A relief that only darkens the colour looks flat
toward a light. Every relief tilts the normal that all the lights see (the sun, the sky, the gas lamps, the lantern,
the spilt light), so a stone is lit on the side toward a light and shaded on the other:
- **The ground** (psx `relief`, `slabs`): the slope of its height map at the relief's own uv (after the parallax,
  detile's turned sample turned back) tilts the normal in world space (`gGroundDN`, `psxGroundTilt`): the sharp edges
  (`PSX_TILT`) and the dome of each stone from a softer mip (`PSX_DOME`). The painted one-sided light stays as it was.
  It melts away from 12 to 28 m and where a pixel covers a stone's worth of texels (no sparkle at 270 lines).
- **The house walls** (`wallRelief`): `gWallDN`, the same way, in the wall's frame.
- **Bump maps** (three.js `bumpMap`: landmarks, the town wall, props, rooms): three.js counts the height's change from
  one screen pixel to the next, so at the full window a bump was 3.3 times flatter than at the 270 lines it was set up
  at. The psx bump chunk multiplies it by `uBumpRes` (render height / 270, set by `retro/retroPass.ts`) and up close by
  `PSX_BUMP_GAIN` (2.5 where a 270-line pixel covers up to two texels, back to 1 by eight: no sparkle far off).
  A material with a bump map is a psx material, or its bump stays per pixel.
- **Brightness stays**: every lit psx material divides its colour by how far the normal was tilted (the cosine to the
  flat normal, `psxBumpK`) and multiplies the sky's and the ambient light by it. A bumped surface is as bright as a flat
  one on average; only the lights from one side draw the relief.
- Check with the lights in view: toward the sun (in mist, toward the cathedral from the streets) and toward a lamp at
  night, at the full window and at 270 lines, the stone-scale contrast (the std of the picture blurred 3 px minus
  blurred 14 px) against the same view without.

## Light in the halls (2026-09-27, milestones/hall-light.md)
- The landmarks' and churches' windows glow all night from outside (`world/landmarkWindows.ts`): a copy of the glass
  3 cm out, additive, one material per building (all one shader), faded by the building's distance in the fog on its
  own (no three.js fog on an additive light). Their low windows register spill sources (kind `hall`).
- The sun and the moon inside the churches (`world/hallSun.ts`): traced once at build onto the floor and the arcades'
  walls, drawn as quads that multiply what is under them (`dst * (1 + src)`), plus additive shafts. No light, no shadow
  map. A new hall with windows gives its windows, piers, arcade walls and galleries to `buildHallSun`.

## Daylight and the houses' shadows (2026-09-30)

Steve: "Lighting during day is flat, is it realistic to have more shadow play?" Four parts, no new light and no new shader kind:
- The sun follows its October path over Antwerp (`sunAt` in world/rijnkaai.ts): up in the south-east, about 33 degrees at noon, down in the west. On clear and misty days the sky light is lower and the sun stronger; a fog day keeps its even light.
- `tools/city/skyshade.mjs` bakes `client/public/textures/skyshade.png` (1 m a pixel, over the town box) from the houses' footprints and eaves (shared/city_build.json) and the landmarks: red the sky a point on the ground sees, green the houses' height round it, blue the houses' own height. Run it again after the houses change.
- `psxSkyShade` (retro/psx.ts) scales only the sky's and ambient light by the red, never under 30 % and at 65 % strength, fading up the walls. `psxSunShadow` walks 20 steps of 2 m toward the sun over the blue and dims only the sun (`directLight.color` of the directional light), hard on a clear day, 30 % in fog (`uSunShade`).
- world/blobs.ts: one instanced soft dark patch under the walkers, Jef, the handcarts and the drays within 45 m (one draw).

Measured: no frame cost above the noise (Grote Markt, 3 runs each, on 38.5 ms, off 39.7 ms on a busy PC).

## Frame time
The frame budget, where the time goes, the rules for new models, textures, materials, mirrors and every-frame logic,
and how to prove a speed change: [performance.md](performance.md).

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

## The water and the shared switches (D3, 2026-10-11)
- **The wave normal.** The water's ripples are no picture any more: the 64 px dash texture (`world/textures.ts`) drew a
  zigzag stamp and bands over every water (the look survey's point 10). One tiling noise of 256 px (`retro/psx.ts`
  `waveNormalData`, Godot's `Render/Psx.cs WaveNormalData`, the same numbers: R and G its slope, B its height,
  mipmapped) is read twice per pixel (`psxWaves` / `psx_waves`), at 9 m and at 3.1 m, turned against each other and
  drifting their own ways. The swell's vertex normal keeps only its long waves (the short ones fell between the
  sheet's vertices, 5 m apart: the bands). The ripples tilt the normal every light sees, bend the mirror's picture
  (no more chunky 17 cm world pixels) and lighten the slopes that face the eye (a grey sky mirrored higher up). The
  sun's highlight is lower and wider (river specular `0x2a2823`, shininess 40, was 120).
- **Rain on the water** (Steve, 2026-10-11: "the rounds the rain creates seem very drawn"): `rainRipples` /
  `rain_ripples`, three layers of cells, one drop at a time in each, many small rings of their own sizes that spread
  and fade within a second and a dimple where each lands, as many as the rain is hard; only in the normal, nothing drawn
  on top. The puddles use it for their wobble; the wet stone has no rings (a drop on stone splashes). In a downpour the
  ripples roughen as a whole (`1 + 0.9 rain^2`).
- **Wakes and rings** (`ripples` in psx.ts, Godot's `World/Waters.cs` Ring/Wake/Swim/Moored): a fixed list of
  `MAX_RIPPLES` (16) sources, the nearest to the eye, the active ones first (strength 0 ends the list), light counts
  style: the shader never changes. A ring (an oar dipping, a swimmer's stroke, a moored hull bobbing) spreads and fades;
  a wake (a boat under way, a swimmer) is the Kelvin V (19.5 degrees each side, its waves standing still to the boat,
  their length from the speed), the waves across inside it and the bow wave. Browser: uniform arrays `uRipA`/`uRipB`;
  Godot: a 16 x 2 float picture `psx_ripples`. Fed by: `world/rijnkaai.ts` (every ship of `boats.moving()`, and
  `ripples.update` each frame), `world/boats.ts` (the floats and the moored rows: `moored`), `game/rowing.ts` (the
  stroke's two rings, the boat's wake), `player/firstPerson.ts` updateSwim (`swim`); Godot `World/Waters.cs` (the river's
  movers, the send), `Movers/Boats.cs` (floats and rows), `Play/Rowing.cs` Drive, `Player/Jef.cs` UpdateSwim. Dev:
  `-- --ripple-test` in Godot, `.scratch`'s look-refs `--before` in the browser: a boat at 3 m/s, a swimmer, a ring.
- **Cost**: two texture reads and the rain's three cells per water pixel, the ripple loop stops at the first empty slot.

Two switches for other parts, each fixed when the material is made (rule 3: one shader kind each, made once):
- **`nameCell: N`** (psx option; Godot `Kind.NameCell = N`): an instanced name plate draws one cell of an N x N names
  atlas (its map / `tex`). Browser: an `InstancedMesh` whose instance colour names the cell, `setNameCell(mesh, i, cell,
  N)` (red the column, green the row from the top, as n / 255; the colour then tints nothing), set before the first draw.
  Godot: a MultiMesh with `UseCustomData`, custom data x the column, y the row from the top. The plate's uv runs 0..1.
- **`tideWet: k`** (psx option; Godot `Kind.TideWet` with the material's `tide_wet` = k): walls and mud go darker by up to
  k (about 0.35 for stone) where the ebb has just uncovered them, drying over the game hours after; dry above the last
  high water. One shared value, `uTideWet` / `psx_tide_wet` (the last high water's level, the hours since, the lowest
  water since, how long the ebb ran: `setTideWet` from rijnkaai.ts updateTide, `Psx.TideWetNow` from World/Waters.cs);
  `psxTideWet(y)` / `psx_tide_wet_at(y)` for a part that wants the wetness itself (weed, a sheen).
- **Stencil bits** (the water's): 1 the hull caps (`boats.ts`), 2 the basins' and the canals' calm water, 4 the canal and
  vliet beds while the river stands below `TOE_TOP` (`tidemud.ts`: the river's sheet, which draws only where the stencil
  is 0, keeps off the bed then and the beds' calm sheet takes its place), 8 the beds' pools. Godot has no such stencil
  for the beds: its river shader discards over the canals while `river` is 2 (`Psx.cs in_canal`, set by `Waters.cs`).
- Their tiny test: `(await import("/src/retro/psx.ts")).psxSwitchTest(__scheldemist.world.scene, x, y, z)` in the test
  tab, Godot `-- --switch-test x,y,z`: four plates showing cells 3, 2, 1, 0 of a 2 x 2 atlas (yellow, blue, green, red,
  a white mark top left) and a stone pillar from 6 m down to the quay top with its wet band.
