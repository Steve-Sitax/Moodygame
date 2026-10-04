# The Godot port: sound (G5)

The browser's sound (`client/src/audio/`, 11 files) in Godot: `godot/src/Audio/`. This note lists every sound the
browser game makes and how each is done in Godot. The numbers (gains, reaches, times) are the browser's.

## How it is built in Godot

- **Recordings** stay where they are (`client/public/audio/`, licences in `assets/ATTRIBUTION.md`) and are loaded at
  loading time with `AudioStreamOggVorbis.LoadFromFile`, on a worker. Every compressed recording, including long
  ones and loops, is decoded once to mono PCM before play: no decoder setup on a step, bell or loop start. Long
  recordings retain their native sample rate and loop length; the existing short one-shots retain their PCM.
  The folder comes from one place (`AudioPaths.Audio`: option
  `--audio <dir>`, or the environment variable `SCHELDEMIST_AUDIO`, or `../client/public/audio` beside the project).
- **Made sounds** are built by the same graph as in the browser: `Wa.cs` is a small Web Audio that runs ahead of time
  (oscillators, noise, biquad filters with the Web Audio formulas, gains, and the AudioParam timeline:
  setValueAtTime, linear and exponential ramps, setTargetAtTime, value curves). Each made sound is rendered once to a
  buffer on a worker thread when it is asked for, and played as an `AudioStreamWav`. Graph construction runs on
  that worker too. The beds that never change (water, wind, downpour, lamp hiss, organ) are rendered as loops
  during loading, before play. Only the great storm's howl changes while
  it plays (its pitch follows the gusts): an `AudioStreamGenerator`, fed each frame while a storm blows.
- **Place** (the browser's `Spot`: fog gain, air lowpass, panner, reverb send): an `AudioStreamPlayer3D` with
  Godot's own distance curve off. The gain by distance is ours, set every frame, because Godot's inverse curve is
  `ref / d` only and cannot do Web Audio's `ref / (ref + rolloff x (d - ref))` with a rolloff other than 1 (the
  game uses 0.8 to 2.2). Godot still does the left and right. Each playing place takes a bus from a pool of 48, with
  a lowpass on it (the air lowpass, one biquad, the same formula); the reverb send is a second player of the same
  stream on the Reverb bus (a Godot bus has one send). Loading also prepares 128 3D and 48 flat players and
  exercises the native mixer, layered/event paths and storm generator once. The loading card waits for sound.
- **Buses** (the browser's gain groups):
  `Master` (compressor, limiter; the speaker) <- `Street` (the street's level and the wall lowpass when Jef is
  inside) <- `Ambience`, `Voices`, `Music`, `Effects` (the Sound settings) and `Reverb` (the foggy outdoor tail);
  `Master` <- `Room` (the room's own reverb and the hall's) <- `RoomAmbience`, `RoomVoices`, `RoomMusic`,
  `RoomEffects`.
- **Reverb**: the browser convolves with decaying noise (3.8 s outdoors, 0.7 s in a room, 1.6 to 4.8 s in a hall).
  Godot has no convolver: `AudioEffectReverb`, set to the same length and to the same level for noise (measured in
  the self-test). Close, not the same tail.
- **Compressor**: Web Audio's (threshold -18 dB, ratio 3, knee 30 dB) is nearly straight up to full level and adds
  0.9 dB. Godot: compressor at -18 dB, 1.04 to 1, +0.9 dB, and a limiter under it.

## Connections to the game

`SoundWiring.cs` subscribes to the store's clock and weather events and follows `HourF` four times a second.
`--hour`, `--weather` and `--rain` hold their own inputs. Rain comes from `Daylight.I.Rain`; street murmur comes
from the townspeople's positions. Jef's step, landing, splash and stroke events call the sound; the browser's
timber pier, pontoon, gangway and deck give wood steps, stone elsewhere. `Bubbles.I.Speak` calls the made voice,
and `Dice.I.Sfx` calls `Play`. No change to Main, Jef or the shared Wiring was needed.

The mixer reuses the menus' Master, Music, Ambience, Voices and Effects buses. Room categories, the organ and
the outdoor echo follow the same settings. Baked house linings supply room bounds; a roof ray identifies the
cathedral, churches, town hall and Steen. `InteriorAt` and `SurfaceAt` let the rooms and moving decks supply
their exact answers when those parts are ported. This fallback uses box bounds for houses, not the browser's
threshold blending.

Still to connect as their game parts arrive: room occupancy, exact puddle positions, moving ships and vehicles,
railway triggers, animals, street trades and event cues. Their sound methods are ported and tested. Daylight
currently exposes rain but no great-storm event level or gust; `TempestNow` accepts that level, gust and shelter
from the event/wind parts. An ordinary storm day does not turn on the great storm's howl.

## The sounds

Reach: `ref / rolloff / max` in metres (full level within `ref`, silent past `max`; `-` for no place: it plays
at the ear). S = recording, C = made in code.

### Always there

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Water at the quay | C (brown and white noise) + S `water-wall` | 4 / 1.2; gone 6 m from the edge | always; louder at night, in a storm | two loops at the nearest quay edge (`shared/city.json` water) |
| Water laps | C (noise burst) | same place | every 0.25 to 1.4 s | rendered per lap |
| Wind | C (brown noise) | - | always; more at night, by open water, in a storm | loop |
| Wind in the rigging | S `wind-masts` | - ; by the ships, 25 to 100 m | always | loop |
| Crowd murmur | S `walla` | - ; people talking within 5 to 18 m | `SetCrowdAround` | loop, lowpass 2.2 kHz |
| Rain on roofs, on cobbles | S `rain-roofs`, `rain-puddle` | - | `SetRain` | loops |
| Storm: howl | C (three noise bands) | - | `SetTempest` | generator |
| Storm: downpour | C (noise) | - | `SetTempest` and rain | loop |
| Storm: gale, heavy rain, wind heard inside | S `gale-trees`, `rain-heavy`, `wind-inside` | - | `SetTempest` | loops |

### Loops at places (the nearest 12)

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Water under a bridge | S `water-boardwalk` | 2 / 2 / 7 | always | place loop |
| Water round a pontoon | S `water-pontoon` | 2 / 2 / 8 | always | place loop |
| Smithy | S `anvil` | 4 / 1.1 / 80 | 7:00 to 19:00, works and rests | place loop |
| Ship creak | S `ship-creak` | 3 / 1.4 / 30 | always | place loop |
| Tavern door: talk, song | S `tavern-crowd`, `tavern-song` | 3 / 1.4 / 20, lowpass 750 Hz | people inside; song 18:00 to 2:00 | place loop, two layers |
| Market | S `market-venice` | 6 / 1.1 / 50 | 6:00 to 15:00, people there | place loop |
| Gas lamp hiss | C (noise, highpass) | 0.6 / 2.2 / 12 | when the lamps are lit | place loop |
| Unseen horse and cart | S `horse-walk`, `cart-wheels` | 4 / 1.2 / 60 | by day, beyond what you can see | place loop, moves |
| Dray; handcart | S same; `cart-wheels` | 4 / 1.2 / 60; 2.5 / 1.2 / 40 | `SetVehicles`, while it rolls (nearest 6) | place loop, moves |
| Paddle steamer; screw steamer | S `paddle-steamer`, `ship-engine`, `water-boardwalk` | 6 / 1 / 120 | `SetMovingShips` | place loop, moves |

### By the clock and by chance

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Hour strokes | S `bell-hour-stroke`, rate 0.82 | 20 / 1.5 / none | on the hour, 7:00 to 21:00 | place, queued 2.6 s apart |
| Carillon, whole and short | S `carillon-brussels` | 20 / 1.5 / none | on the hour; the half hour | place |
| Ship's watch bells | S `ship-bell` | 4 / 1 / 180 | every half hour, a ship within 160 m | place, queued |
| Foghorn | C (four oscillators) | 15 / 0.8 / none | in fog, every 40 to 90 s | rendered |
| Gulls | S `gulls-harbor` | 6 / 1 / 160, lowpass 3.2 kHz | by day, within 130 m of the water | place |
| Rope creak | S `pulley-creak` (C when missing) | 4 / 1 / 70 | a ship within 60 m | place |
| Dog far off | S `dog-far` | 3 / 1 / 110 | every 15 to 90 s | place |
| Steam whistle far off | S `steam-whistle-far`, `steamboat-whistle` | 10 / 1 / 380 | no ships of the world's own | place |
| Crane: ratchet or winch, chain | S `ratchet`, `winch`, `chain-pulley` | 4 / 1 / 130 | by day, a crane within 90 m; the rail crane | place |
| Cooper's mallet | S Kenney wood, plank | 3 / 1 / 80 | by day, a cooper within 70 m | place, queued |
| Pump | S `pump` | 3 / 1 / 60 | a pump within 50 m | place |
| Carriage far off | S `horse-carriage-far`, `horse-arches` | 4 / 1 / 140 | by day | place |

### Ships, rail, the world

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Ship's whistle: pass, greet, signal | S `steamboat-whistle`, `steamboat-toots` | 7 to 10 / 1 / 380 | a steamer comes by, two meet, asks a bridge | place, queued |
| Ship's bell on a sailing ship | S `ship-bell` | 4 / 1 / 150 | within 70 m | place |
| Order called on deck | S `heave-shout` | 3 / 1 / 80 | within 70 m | place |
| Bridge-keeper's bell | S `handbell` | 4 / 1 / 150 | answers a signal | place |
| Railway gate bell, crane bell | S `handbell` | 3 / 1 / 110 | `GateBell` | place |
| Wheel over a rail joint | C (two bursts, a thump) | 4 / 1.2 / 70 | `RailClack` | rendered |

### Jef and the jobs

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Footstep, stone and wood | S Kenney footsteps (C while missing) | - | `Step`, `Footstep` | lowpass 2.2 or 2.6 kHz, a little reverb |
| Boot in a puddle | S `puddle-walk`, `puddle-steps` (C while missing) | - | `Footstep` with a puddle, `SplashStep` | highpass 110 Hz, lowpass |
| Swim stroke | C (two bursts) | - | `SwimStroke` | rendered |
| Thud: wood, soft, plank; lift; coins | S Kenney impacts | 2 / 1.1 / 60, or far off | `Play` | place, or dull at the ear |
| Splash | S `splash-big` | 2 / 1.1 / 60 | `Play("splash")` | place |
| Bell | S `bell-5-oclock` | 2 / 1.1 / 120 | `Play("bell")` | place |

### Voices and street trades

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Speech without words | C (voice: saw, breath, two formants) | 2 / 1.2 / 35 | `Speech` | rendered |
| Sung line: ballads, the 8 street cries | C (the singing voice) | 3 / 1.1 / 60 | `Sing` | rendered |
| Knife grinder; brush on the step; milk cans | C | 2 / 1.3 / 40 | `StreetWork` | rendered |
| Mussel seller's rattle | C | 2 / 1.3 / 50 | `StreetWork` | rendered |

### Events

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| Peal; fire alarm | S `bell-hour-stroke` at six rates, or one | 20 / 1.5 / none | `EventSound` | place, queued |
| Procession handbell | S `handbell` | 3 / 1.2 / 90 | `EventSound` | place, moves |
| Music; murmur | S `tavern-song`; `walla` | 3 / 1.2 / 90; 3 / 1.4 / 35 | `EventSound` | place loop, moves |
| Cues made in code (13): cheer, laughter, applause, shout, cry, hymn, fiddle, drum, whistle, glass, clatter, crackle, horse | C | 3 / 1.15 / 100 (a crowd 35, a voice 60) | `EventCues` | rendered per hit |
| Cues from recordings (11): murmur, handbell, bell, ship_bell, chain, anvil, pump, steam_whistle, hooves, wheels, dog | S | 3 / 1.15 / 100 | `EventCues` | slices |

### Rooms

| Sound | From | Reach | When | Godot |
|---|---|---|---|---|
| The street heard through the walls | - | - | `SetInterior` | `Street` bus: level and lowpass |
| Room echo; hall echo (church, hall, vault, museum, store) | reverb | - | `SetInterior` | `Room` bus: two reverbs |
| Tavern talk and song; cellar, church, hall murmur | S `tavern-crowd`, `tavern-song`, `walla` | - | people in the room | loops on `Room` |
| Organ | C (four voices, eight chords) | - | `Organ` | rendered loop (33.6 s) |
| Altar bell | C (three strikes) | - | `AltarBell` | rendered |

### The town's life (`Placed`, each caller gives the reach)

| Sound | From | Reach (the browser's callers) | Godot |
|---|---|---|---|
| Leaves | C | 1.5 / 1.4 / 8 | rendered |
| Wings: pigeons, sparrows | C | 3 / 1 / 60; 1.5 / 1 / 18 | rendered |
| Sparrow chirp | C | 1.5 / 1 / 18 | rendered |
| Jackdaw | C | 3 / 1 / 120 | rendered |
| Drip; gutter splash | C | 0.8 / 1.3 / 5 | rendered |
| Thunder | S `thunder-*` (11) with a made tear and blast; C when missing | 400 / 1 / none | recording and rendered part |
| Cat's hiss | C | 1 / 1 / 7 | rendered |
| Buoy bell | C | 8 / 1 / 650 | rendered |
| Bilge pump | C | 2 / 1 / 45 | rendered |
| Owl | C | 5 / 1 / 260 | rendered |
| Horse's snort | C | 1.5 / 1 / 12 | rendered |
| Storm: shutter, slate, sign, gust, cask, wave | C | 4 / 1 / 110; 4 / 1 / 90; 2.5 / 1 / 45; 30 / 1 / none; 3 / 1 / 60; 5 / 1 / 120 | rendered |

Counts: 119 sounds; 62 from recordings (76 files), 57 made in code.

## What every placed sound gets (as in the browser)

- Gain by distance: `ref / (ref + rolloff x (max(d, ref) - ref))`.
- Fades out from 0.6 of `max`, silent past it; not started past it. At most 28 placed sounds at once: past that only
  one within 25 m still starts.
- Air lowpass: 14 kHz within 10 m, down to the weather's cutoff at `reach`, duller beyond (fog 1.3 kHz, rain 2 kHz,
  mist 2.3 kHz, storm 1.6 kHz, clear 6 kHz).
- Fog loss: none within 30 m, the weather's full loss by 300 m (fog 0.6, rain 0.75, mist 0.8, storm 0.7).
- Houses in the way (`shared/city.json` blocks and landmarks): 12 m of houses halve it, at most -10 dB, and dull it.
- Reverb send grows with distance: `wet x (0.6 + 1.4 x ramp(d, 20, 400))`.

## The self-test

`-- --soundtest <dir>` (see `godot/README.md`): plays every trigger once and the layers at three hours and in rain,
records the master bus with the speaker muted after the recorder, and writes `soundtest.wav` and `soundtest.json`.
The results of the last run are at the end of this note.

## Check on 2026-10-04

The restarted sound worktree was merged with `godot-port` (`a7702eb`), then the wiring and test fixes were
committed (`e31d717`). `dotnet build godot` passes (the existing Townspeople nullability warning remains).
The console editor imported the new script once. No bake, new sound assets or new dependencies.

Full silent run on the shared town, with no AI and the server on 8962:

- 119 sound implementations: 62 sampled (76 files), 57 made in code.
- 156 trigger and measurement rows: 154 played; the 23:00 tower-bell and clear-day foghorn rows correctly stayed
  silent. Every row has peak, RMS and duration results. No gain, duration or layer mismatches.
- 61 wiring checks passed, including 33 baked rooms, tavern/shop kinds, the settings' room and echo levels and
  mutes, store inputs and command-line overrides. Three hours, rain and the great storm's five layer rows passed.
- 49 named recordings and 10 step variants loaded; no failed files. 29 short recordings decoded once at load.
- Stereo WAV: 474.9 seconds, 48 kHz. Results: `godot/baked/soundtest-final/soundtest.json` and `soundtest.wav`
  in this worktree (generated evidence, not committed).
- Sound frame cost over 28,492 frames: mean 0.0255 ms, p95 0.0404 ms, p99 0.0542 ms. Eleven frames exceeded
  0.3 ms; worst 7.205 ms before the first trigger row. Individual trigger calls are reported separately;
  the most expensive was the paddle-steamer loop start, 5.27 ms. The average and p99 fit the budget; a strict
  worst-frame limit is not proven. Startup, decoder starts and runtime scheduling still need profiling if that
  limit must hold for every frame.

The earlier failed run exposed a test listener error: Jef put the camera back at his feet between sound frames.
The test now disables his processing and places the listener before the sound update. It also predicts the
louder channel for lateral sources rather than applying the centre's 0.7071 to every position. It returns exit
code 1 for mismatches. The speakers remained muted after the recorder throughout.

Godot still prints the existing font/CanvasItem/ObjectDB cleanup warnings at exit. No Main.cs, Jef.cs,
Game/Wiring.cs, Psx.cs or shader was changed. The pending game-part connections are listed above.

## Strict frame budget investigation, 2026-10-04

Merged `godot-port` into `godot/sound` first (fast-forward to `d16f387`). This fixes
[#41](https://github.com/Steve-Sitax/Moodygame/issues/41). All work and evidence remain in the sound worktree.

The original numbers above excluded the synchronous trigger call from the frame total. The test now includes
actual gameplay calls, including graph requests and loop/event starts; calibration's own nodes and decoding
remain excluded. Every frame above 0.3 ms prints and retains its frame number, time, trigger, last sound started,
update step costs, mixer start costs and generation 0/1/2 collection counts. Any such frame fails the test.

The unchanged-code trace (`baked/soundtest-trace/soundtest.json`) found these **13** over-budget frames. The
original run had 11; cold paths and random choices vary between runs. These are the net sound costs, with the
test's own measurement decoding subtracted; the initial trace's per-step figures included that decoding, so
only the responsible step is listed here.

| Frame | Cost, ms | Trigger / sound | Responsible step |
|---|---:|---|---|
| 1 | 6.9051 | first sound frame | cold wiring, state, update, mixer and howl paths |
| 2 | 0.6648 | water/wind beds arrive | ready callback / first player use |
| 15 | 1.5556 | first periodic update | cold update helpers |
| 8396 | 0.7003 | short carillon | delayed compressed playback start in mixer |
| 8565 | 0.6668 | whole carillon | delayed compressed playback start in mixer |
| 8735 | 0.6604 | clock crosses 10:00 / carillon | delayed compressed playback start in mixer |
| 8905 | 0.6402 | clock crosses 10:30 / short carillon | delayed compressed playback start in mixer |
| 9979 | 0.7339 | gulls | delayed compressed playback start in mixer |
| 16026 | 0.5329 | stop event music | cold timer callback |
| 20360 | 0.4719 | repeating drum cues | graph construction / timer callback |
| 21514 | 0.9553 | near thunder / thunderNear2 | delayed compressed playback start in mixer |
| 28109 | 0.7662 | first great storm | first generator buffer submission |
| 28119 | 0.3298 | downpour arrives | ready callback / player start |

None of these frames coincided with a managed GC collection. The files were already loaded: the steady-play
recording spikes came from starting another Ogg decoder, rather than reading the file again. The trace's mean
was 0.0248 ms, worst 6.905 ms; its separately measured paddle-steamer trigger was 4.85 ms.

The fixes:

- Load and decode the recordings on a worker during loading; preserve original short one-shot PCM, long-source
  rates and exact loop ends. Decoding failure is listed as a failed recording rather than leaving a compressed
  stream to set up its decoder during play.
- Render every constant bed, including the downpour and organ, before readiness. Create the buses, player pool
  and generator during loading, compile the audio methods and constructors there, and warm the actual mixer,
  ship/cart loops, peal and event-stop helpers and generator's first buffer.
- Build dynamic synth graphs and render their buffers on the worker. The main thread only installs ready voices.
  Cue repetition still uses the maker's exact duration, measured from the original fire time. Singing returns
  its original note/beat duration immediately.
- Reuse crowd, vehicle-distance and nearby-steamer scratch lists. Remove ship/loop LINQ allocations and reuse
  category names in the settings update. Graphs, envelopes, filters, reach, gain, pitch distributions and sources
  are unchanged (`Wa.cs`, `Voices.cs`, `AliveSounds.cs` and `Samples.cs` have no changes).

The stricter follow-up isolated a 2.046 ms frame in the completion queue, without a voice start or GC. An
unpublished producer slot is a plausible cause: the [.NET queue implementation](https://github.com/dotnet/runtime/blob/main/src/libraries/System.Private.CoreLib/src/System/Collections/Concurrent/ConcurrentQueueSegment.cs)
explicitly spins in TryDequeue until that slot is published. The audio queue now publishes fully initialized
callback nodes atomically; the main thread takes and reverses complete batches, with no lock or producer wait.
Empty graph-ready callbacks are omitted. The self-test checks 4,096 callbacks from four concurrent workers for
FIFO ordering and loss. The first cue-stage call also belongs to the loading warm-up; its LINQ iterator is gone.

### Comparing sound levels honestly

The earlier JSON was not seeded. Repeating the unchanged code changed **84/156 recorded peaks**, **102/156 RMS
values** and **18 selected gains** against it. Random sample selection, pitch, loop position, noise, voice
variation and time spent fading make a literal per-row peak match impossible even before a fix. The final
comparison retains every row's before/after values; it does not relabel different readings as equal.

The loading test additionally compares each decoded recording's original and PCM peak/RMS directly at the same
rate and reports both rounded to 0.1 dB, plus the unrounded quantization differences. This isolates the actual
sample conversion from the randomized test triggers.

Ogg decoding can produce samples above full scale. Newly unpacked recordings keep this headroom: their PCM is
stored lower and the voice restores the exact scale. The pre-existing short PCM conversion remains unchanged,
including its original clipping. The level report marks which path was already PCM before this fix, so it
compares against the earlier playback format rather than claiming that earlier clipping is new damage.

Run `node tools/godot/check-soundtest.mjs <new soundtest.json> <earlier soundtest.json>` after the engine test.
It fails on any over-budget frame, missing sound row, changed configured gain, failed recording, or PCM peak/RMS
error greater than 0.001 dB. It writes every row's literal earlier/after values to `comparison.json` beside the
new test. One displayed rounding unit at a boundary is permitted only while the actual error stays below
0.001 dB. No audio asset, synth graph or dependency was changed. The browser's audio is unaffected by this Godot
runtime preparation work.

### Final verification

Full silent run on port **8885**, no AI, a new test database and preferences in the evidence directory, with
the shared town and model bake. The console run had a 600-second timeout and quit normally with exit code 0.
Evidence: `godot/baked/soundtest-release/soundtest.json`, `soundtest.wav` and `comparison.json` (not committed).

| Sound main-thread cost | Earlier test | Final test |
|---|---:|---:|
| Frames | 28,492 | 28,473 |
| Mean, ms | 0.0255 | 0.0270 |
| p95, ms | 0.0404 | 0.0422 |
| p99, ms | 0.0542 | 0.0581 |
| Worst, ms | 7.205 | **0.268** |
| Frames above 0.3 ms | 11 | **0** |

The final statistic is stricter: it includes gameplay trigger calls and rain/storm activation, which the
earlier frame statistic excluded. The most expensive final gameplay call was the cooper's mallet, 0.22 ms.
There are **no remaining over-budget frames to list**; `cost.overBudget` is empty. A separate layer activation
run also passed: mean 0.0355 ms, worst 0.189 ms, no frames above 0.3 ms.

- 156 sound rows, 154 played (the two intended silent rows remain silent), no gain/duration/layer mismatches.
- 62 wiring checks passed, including the new four-worker FIFO test (4,096 callbacks).
- 49 named recordings, 10 step variants, no failed files; all 70 compressed recordings decoded during loading.
  The 29 pre-existing short PCM conversions remain unchanged. Seven newly unpacked thunder recordings need
  headroom restoration; the level check confirms that their playback levels are preserved.
- **All 70 recording peak and RMS readings match at the displayed 0.1 dB rounding.** Maximum unrounded
  peak error: **0.00049665 dB**; RMS error: **0.00026910 dB**. No rounding-boundary differences remain.
- All configured sound gain ranges and layer gains match the earlier JSON. Literal unseeded playback readings
  differ in 91/156 peaks and 110/156 RMS values (the unchanged-code control already differed in 84 and 102).
  Those differences, and every row's actual earlier/after values, are retained in `comparison.json`.
- The mixer finishes with 128 3D and 48 flat players, exactly the loading pool sizes: no pool growth during
  play. No renders or timers remain pending. Stereo recording: 474.5 seconds at 48 kHz.

`dotnet build godot`, `npm run build`, and the comparison checker pass. The existing Townspeople nullability,
Vite bundle/import and Godot font/CanvasItem cleanup warnings remain. No shader, model, audio asset, synthesis
graph or browser sound code changed. No test process remains. Automatic approval review rejected deletion of
the generated test SQLite files with "blocked by policy" without a more specific reason; those ignored files
remain in the soundtest evidence directories.
