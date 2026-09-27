# Vehicle detail: the portal crane, the omnibus, the goods train

Steve, 2026-09-27: "a new worktree for crane, omnibus and train redesign on higher details."
Branch `claude/crane-omnibus-train-redesign-7fcc9c` (worktree `.claude/worktrees/crane-omnibus-train-redesign-7fcc9c`).

## Where they were (before)
| Vehicle | Built by | Parts in the game |
|---|---|---|
| Portal crane (10 on the quays) | Blender, `tools/blender/build_boats.py` `portal_crane()` + `portal_jib()` into `boats.glb` | `world/boats.ts crane()`; `world/railway.ts` folds the model's own hook and bogie wheels away and draws its own hook, falls, sling and turning bogie wheels (Kit) |
| Omnibus (6, three lines) | code, `world/omnibus.ts` (`Kit` boxes) | one InstancedMesh per part: body, paint (line colour per instance), saloon, far glass, rear and front wheels, front carriage; boards and lamps apart |
| Goods train (5 wagons) | code, `world/railway.ts` (`Kit` boxes) | one InstancedMesh per wagon kind (open, flat, van), wheel sets, coupling chains, goods units |

Before pictures: `data/shots/before_*.jpg` (test save, not in git).

## The aim
The same three vehicles, far more detail, still the PS1 look (`docs/05-art-direction.md`: low poly, 64 px painted
textures with nearest filter, vertex wobble, fog). Detail means real parts you can name, at their true size:
rivets and plates, springs and axle boxes, spoked wheels with tyres and hubs, lined panels, lamps, steps and
hand rails. Nothing the game relies on moves.

- **Omnibus and wagons move to Blender**, like the dray and the handcart (`build_props.py dray(part=...)`):
  `tools/blender/build_omnibus.py` writes `client/public/models/omnibus.glb`, `tools/blender/build_wagons.py`
  writes `client/public/models/wagons.glb`. One node per part the game instances today (same origins), so every
  omnibus and wagon still is one InstancedMesh per part (no new draw calls per vehicle). The code-built `Kit`
  geometry stays as the fallback if the model does not load.
- **The crane stays in `build_boats.py`**, with more detail inside the same envelope; the hook, falls and sling
  that `railway.ts` draws get the same care.

## What must not change (the game relies on it)
- **Crane**: `PORTAL_TOP`, `DECK_Z`, `CAB_FLOOR`, `CAB`, `CAB_WALL`, `CAB_TOP`, `CAB_DOOR`, `DECK_OUTLINE`, `RAIL_RIGHT`,
  `LADDER_Y`, `LADDER_HALF`, the jib's foot, angle, length and tip (`TIP`, `R_HOOK` in railway.ts,
  `shared/cranes.ts` capsules), the legs' feet and bogies (`CRANE_FEET`, `CRANE_WHEELS`, `CRANE_WHEEL_R`, boats.ts
  collision boxes). The walk areas up on the crane (`DECK_AREAS`) stay free: nothing new on the gallery floor,
  in the cabin's aisle or at the driver's window. Everything new stays inside the capsules of `shared/cranes.ts`.
  `foldPortal` and `foldHook` in railway.ts fold vertices by position: new parts must not be caught by those
  rules by accident, and the model's own hook and bogie wheels must still fold (or the rules change with them).
- **Omnibus**: `Z0`, `Z1`, `W`, `FLOOR_Y`, `WIN_LO`, `WIN_HI`, `BOARD_Y`, `ROOF_Y`, `TOP`, `DOOR`, `DOOR_TOP`,
  `WINDOWS`, `WIN_W`, `WHEELBASE`, `HORSES`, `R_REAR`, `R_FRONT`, `NOSE`, `TAIL`, `SEATS`, `WALK`, `PLATFORM_Y`,
  `PLATFORM_SPOT`, `LADDER_SPOT`, `LAMPS`, the boards (`BOARDS`), the driver's and conductor's places. Seats,
  aisle, doorway, platform and ladder stay where riders sit and stand.
- **Wagons**: `FLOOR`, `L_BODY`, `L_BUF`, `WB`, `WHEEL_R`, `RAIL_TOP`, the width (sides at x +-1.22), the open
  wagon's side height (the crane's `TRAVEL` clears it), the goods slots (`ROWS`, `ACROSS`), the wagon rect's
  `top`, the coupling chain's ends.
- **Rendering rules** (`docs/rendering.md`): no new lights, nothing drawn to the screen, no new shader kinds
  without need. Reuse the psx material settings that exist (a new texture with the same settings is no new
  program). `__scheldemist.shaders()`: `problems` empty, `programs` before and after noted.
- **Cost**: the same draw calls as before; triangles noted per part before and after.

## Checks before it is done
`npm run build`; `npm test`; in a test tab: `shaders()`, `paths()` empty; close shots (front, side, back, from
below and above, 1-3 m, midday clear) of every changed part; the vehicle moving (wheels turn the right way and
at the right speed, parts stay attached on bends); riding the omnibus (board, sit inside, sit on the roof),
climbing the crane (ladder, gallery, cabin), a crane loading a wagon (goods on the floor, the hook clear of the
sides); the frame time near each vehicle before and after.

## Log
| Date | What |
|---|---|
| 2026-09-27 | Worktree set up, before pictures, this plan. Three helpers: crane, omnibus, wagons. |
| 2026-09-27 | All three done and checked together (build, 1239/1240 server tests: `m8e-limits` times out only in the full run and passes alone, no server code changed; `shaders()` no problems, 208 programs against 214 before; `paths()` empty; no console errors; every part loads from its model, none falls back). |
| 2026-09-27 | The draught horse (helper): a new model on its own atlas, legs that bend at the knee and hock, full harness, four coats; the omnibus pole chains, the dray shafts, the train's traces and the hearse's and pump's poles meet it (below). |

## Result
| Vehicle | Triangles before -> after | Draw calls | What it has now |
|---|---|---|---|
| Portal crane | ~5.6k -> ~19.3k per crane (model 4,272 -> 14,588) | 4 -> 3 per crane (the cut-out lattice mesh is gone) | Plated riveted legs with angle irons and gussets, lattice knee ties, bogies with horn plates, axle boxes, rail guards and a hand travelling gear; double-flanged spoked wheels that turn; slewing rollers and rack; chequer-plate deck with toe boards; a boarded cabin with glazed sashes, ledged door, tarred roof, stove pipe, whistle and lamp; boiler fittings, rope turns, spoked flywheel; a flat-bar lattice jib with a spoked head sheave; ties with eyes and turnbuckles; a real hook block and forged hook. `build_boats.py` checks the crane against `foldPortal`/`foldHook` on every build; other boats hash the same. |
| Omnibus | 3,092 -> 12,196 per bus | the same (one per part) | Blender (`build_omnibus.py`, `omnibus.glb`, 16 painted 64 px cells on the props' atlas settings): lined and moulded panels curving to the sill, wheel arches, cream band with framed droplights, cambered roof with knifeboard seat and rail, iron ladder, rear platform with step, pole and grab handles, driver's box with cushion, dash, apron, whip and brake lever, lamp cases, elliptic springs, fifth wheel, perch, 14/12-spoke wheels with tyres and brass caps, the pole with splinter bar, swingletrees and chains; inside buttoned velvet, panelling, straw, grab rails, straps, the lamp. `--zcheck` in the script checks flicker. |
| Goods wagons | ~8.6k -> ~39k the whole train | the same (9 InstancedMeshes) | Blender (`build_wagons.py`, `wagons.glb`, loader `world/wagons3d.ts`, the props' goods atlas): oak solebars with bolts, red headstocks, W-irons, axle boxes, leaf springs, the lever brake with its rack, square-plate buffers, draw hooks and three-link couplings, 10-spoke wheels; open wagon with doors and stanchions, flat wagon with dropsides, van with sliding door, canvas roof, hand rails and lamp iron; "ETAT BELGE" lettering; goods units on the same atlas. |

Both Blender vehicles keep the old code-built parts as a fallback if their model does not load.

## Still open
- The omnibus driver stands on his box: his figure (a carter) has no sit pose. A seated figure changes his look: Steve's call.
- Omnibus traces can sit up to 20 cm off the collars for a moment on 5 m bends; the lamp glow is large up close at night.
- Wagon buffers overlap on the 10 m bends (as before); the small lettering reads only up close.
- The crane's hand travelling gear does not turn; about 1,000 rivets and angle irons sit 1-1.5 cm over their plates (dark on dark, may shimmer far off); the rail guards stand 5 mm past `PORTAL_HALF_X`.
- `zfight()` skips the omnibus, railway and crane groups (they hold moving or skinned parts); each Blender script has its own overlap check instead.
- Test kit: after a reload in a hidden tab the railway does not move until one `world.update(0, 0.016, player.camera)`.

## The draught horse (2026-09-27, second pass)
Steve: the horses were missed. The horse that pulls the drays, the omnibuses, the goods train, the hearse and the fire
pump (and stands in the Rijnkaai's `dray_horse`) got the same treatment. Built in `tools/blender/build_props.py`
(`horse()`, the section "the draught horse"), into `props.glb` under the same names.

**What it has.** A Brabant at true size (1.72 m at the withers, the old size, hips and collar): a body of 16-sided rings
with a deep chest, a split double rump, withers and a crested neck set by its crest and throat lines; a head with a
broad forehead, round jowls, a straight face, muzzle, nostrils, eyes and cupped ears; a full mane falling to the off
side, forelock, thick tail. Heavy legs split at the knee and hock (forearm, knee, cannon, fetlock, pastern, gaskin,
point of hock), feathers at the fetlocks, big hooves with iron shoes open at the heel. Harness: a stuffed collar with its
rim and wool lining, oak hames with brass knobs, hame tugs ending in brass buckles (the traces' start), terrets, the hame
chains and kidney link under the collar (the pole chains' hook); a bridle with browband and brass rosettes, face brass,
blinkers with bosses, noseband, bit and rings; reins through the hame and pad terrets, tied back at the crupper; a back
pad with a red wool pad, brass crest and terrets, the back band down to the shaft tugs and the belly band; the crupper
with its dock and ring, hip straps and a breeching round the quarters.

**The team atlas.** The horse has its own 4 x 4 atlas of 64 px cells, material `goods_team` (props3d.ts makes it with the
goods atlas's psx settings: in the game it is the same shader program as `goods`, checked). The goods atlas is unchanged.
Coats: the mesh is painted bay; `horseGait.ts coatGeometry()` makes the others by moving the coat cells (a cached copy of
the geometry per coat, no shader change): the drays bay, the train and omnibuses red roan, the hearse black (no white),
the fire pump chestnut with a flaxen mane, the led drays of the errands chestnut, bay and roan in turn.

**The legs.** `client/src/world/horseGait.ts` (the same rig as `HORSE_RIG`/`horse_pose` in the script) bends each leg
with two-bone IK: the upper part hangs from a pivot hidden in the shoulder (1.40 m) or the hip (1.38 m), at the old
hips' x and z; the lower from the knee or hock. A hoof on the ground stays where it stands (measured: 0.000 m slide in
the stance of every leg, walk and trot) and rolls from heel to toe; the body sinks a few cm where the legs spread
(walk -6 cm, trot -10 to +3 cm); a lifted hoof folds under. Four-beat walk, trot in diagonal pairs, as before. The callers
say how far one step cycle goes (`stride`): the drays 1.35 m, the omnibus and train 1.42 m walking and 2.8 m trotting,
the hearse now 1.42 m (was 1.9: too long a step at the walk), the pump 2.6 m trotting and 1.42 m walking. About 2 us of
script per horse per frame. `horses.ts` (the pools) and `traffic.ts` (the drays, instanced and led) use it; `alive/air.ts`
takes the breath from `HORSE_NOSE`, not the body's box.

**Where the harness meets the vehicles.**
- Omnibus: the traces end at the hame-tug buckles (the same point as before). The pole chains now end at the kidney link
  (`build_omnibus.py`: only `omnibus_fore` changed).
- Dray: the hitched shafts end at 1.26 m (was 1.12) at the point of the shoulder and pass through the tugs of the back
  band (`DRAY_SHAFT_TIP_Z`, `SHAFT_TUG`; `tr_dray_fore` and `dray_hitched` changed).
- Train: trace chains from each horse's hame tugs; the rear horse's run past its quarters to a spreader behind its
  hocks, the main chain goes from there to the wagon's hook (it used to go into the tail); the lead horse's go back to
  the rear horse's tugs. Pieces of the coupling in the same InstancedMesh, thinner (`railway.ts harness()`).
- Hearse and fire pump: their code-built poles now rise to between the collars. The fire pump lay on its side
  (`body.add(cyl(...)).rotation.z` turned the whole body since it was made): fixed.

**Numbers.** Triangles per whole horse 742 -> 5,678 (body 470 -> 3,998; legs 4 x 68 -> front 140 + 272, hind 156 + 272
each). Draw calls: 3 -> 5 per pool of horses (body and four leg parts; the drays, the train and omnibuses, the hearse,
the pump), 5 -> 9 meshes per led dray. `props.glb`: only the horse meshes, `tr_dray_fore`, `dray_hitched`, the new
`tr_leg_front_lo`, `tr_leg_hind_lo` and the team atlas changed (`glbhash.mjs`; the unused `horse` and `horsehair`
pictures went). `shaders()` no problems, 204 programs on the check's route (the horse adds none); `paths()` empty; no
console errors; build; 1240/1240 server tests. Pictures: `data/shots/horse_*.jpg` (test save, not in git);
`--horse out_dir` renders the Blender close-ups and walk and trot sheets.

**Still open (horse).** From very low in front the chest shows two round lobes; the roan reads light pinkish-grey in dull
light; shaft horses have no traces to the shafts, pole horses carry empty shaft tugs; the farrier's horse
(`build_trades.py tr_horse`, trades.glb) is still the old simple one; the omnibus pair shares the train's roan coat
(one pool).
