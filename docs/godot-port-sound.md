# The Godot port: sound (G5)

The browser's sound (`client/src/audio/`, 11 files) in Godot: `godot/src/Audio/`. This note lists every sound the
browser game makes and how each is done in Godot. The numbers (gains, reaches, times) are the browser's.

## How it is built in Godot

- **Recordings** stay where they are (`client/public/audio/`, licences in `assets/ATTRIBUTION.md`) and are loaded at
  run time with `AudioStreamOggVorbis.LoadFromFile`. The folder comes from one place (`AudioPaths.Audio`: option
  `--audio <dir>`, or the environment variable `SCHELDEMIST_AUDIO`, or `../client/public/audio` beside the project).
- **Made sounds** are built by the same graph as in the browser: `Wa.cs` is a small Web Audio that runs ahead of time
  (oscillators, noise, biquad filters with the Web Audio formulas, gains, and the AudioParam timeline:
  setValueAtTime, linear and exponential ramps, setTargetAtTime, value curves). Each made sound is rendered once to a
  buffer on a worker thread when it is asked for, and played as an `AudioStreamWav`. The beds that never change
  (water, wind, downpour, lamp hiss) are rendered once at start as loops. Only the great storm's howl changes while
  it plays (its pitch follows the gusts): an `AudioStreamGenerator`, fed each frame while a storm blows.
- **Place** (the browser's `Spot`: fog gain, air lowpass, panner, reverb send): an `AudioStreamPlayer3D` with
  Godot's own distance curve off. The gain by distance is ours, set every frame, because Godot's inverse curve is
  `ref / d` only and cannot do Web Audio's `ref / (ref + rolloff x (d - ref))` with a rolloff other than 1 (the
  game uses 0.8 to 2.2). Godot still does the left and right. Each playing place takes a bus from a pool of 48, with
  a lowpass on it (the air lowpass, one biquad, the same formula); the reverb send is a second player of the same
  stream on the Reverb bus (a Godot bus has one send).
- **Buses** (the browser's gain groups):
  `Master` (compressor, limiter; the speaker) <- `Street` (the street's level and the wall lowpass when Jef is
  inside) <- `Ambience`, `Voices`, `Music`, `Effects` (the Sound settings) and `Reverb` (the foggy outdoor tail);
  `Master` <- `Room` (the room's own reverb and the hall's) <- `RoomAmbience`, `RoomVoices`, `RoomMusic`,
  `RoomEffects`.
- **Reverb**: the browser convolves with decaying noise (3.8 s outdoors, 0.7 s in a room, 1.6 to 4.8 s in a hall).
  Godot has no convolver: `AudioEffectReverb`, set to the same length and to the same level for noise (measured in
  the self-test). Close, not the same tail.
- **Compressor**: Web Audio's (threshold -18 dB, ratio 3, knee 30 dB) is nearly straight up to full level and adds
  0.9 dB. Godot: compressor at -18 dB, 1.1 to 1, +0.9 dB, and a limiter under it.

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
