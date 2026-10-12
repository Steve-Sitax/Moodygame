# Runtime completeness audit

Route counts establish dispatch coverage. These checks also inspect active world systems,
hidden conversion faces and external process/file dependencies.

## Converted renderer faces

The retained intake lists 200 unsupported faces from its one-time material import.
They have native owners or obsolete browser functions:

| Original faces | Count | Native owner |
| --- | ---: | --- |
| Cloud sky | 1 | Sky |
| Rain and distant rain sheets | 2 | Rain, RainSheets |
| Chimney and industrial smoke | 2 | ChimneySmoke, WorksSmoke |
| Windows, gas halos, distant glow and spill pools | 30 | Lights, Lights.Far |
| Cats' eyes and moths | 2 | NightLife |
| Ship lights and bilge | 2 | ShipWater |
| River mist | 1 | Mist |
| Gutters and drips | 2 | Gutters |
| Surf, surf sheets and splashes | 8 | Surf |
| Cold breath | 1 | Breath |
| Ship funnels | 1 | FunnelSmoke |
| Boat lanterns | 1 | BoatLamps |
| Tagged open-fire faces | 14 | Fires, seven groups reconstructed from extras |
| Frozen house-fire POINTS faces | 2 | Hidden source snapshot; TownLife creates live event flames |
| Browser room punches | 130 | Rooms; native rooms stand behind actual openings |
| Fire-pump lantern | 1 | TownLife's event pump; frozen source pump is hidden |

The unnamed `Node1476/Mesh2924` belongs to retained `fire_pump`, source13360, through
child13361 to lantern mesh13419 / original mesh5410. The original unlit box stands at
local(.42,1.72,.55), from `pumpcart.ts`. Native `node-13360.scn` retains these names.
The old pump was caught at(-115.8,0,83.6); active events construct their own moving pump.
NativeTown hides only that source snapshot in memory before physics/navigation, preserving
the editable scene. The actual pump lantern now uses an unlit material and the original
32px radial glow, .8m size and .55 opacity, with native fog and additive blending.
Its glass pane corners retain their source thin-sheet construction.

The focused production-pump renderer passed seven checks with clean shutdown in
`pump-render-3da5f255947d44588bd09bb47579a5d4`. The actual box/halo shader compiled and
rendered after dark; its centre pixel was RGB(1,.761,.478). The initial failed probe
was blocked by `portal_crane3/portal`, confirmed by a ray and screenshot. The corrected
fixture selects a clear physical sightline and uses the same renderer check in the
relocated package proof. No material change was needed to resolve that test obstruction.

The full-town log `native-multiplayer-88b551.../live.log` confirms 53 chimney emitters,
four industrial stacks, 50 broken gutters, 213 live boat lanterns and 45 rooms. Its seven
fire groups produce ten burning spots. Final package `scene-renderer.json` retains exactly two
historical labels: `fires8/Mesh2869` and `fires8/Mesh2870`. The native PackedScene stores both
POINTS meshes with `visible=false`, corresponding to source nodes12605/12606 under12604.
This frozen burning-house snapshot lacks fire extras and has 26 empty glow transforms. Read-only
RSCC/packed-property decoding confirmed hidden status; NativeTown never re-enables them.
Live house-fire events use TownLife's 26 native spots. These two diagnostic labels remain
honestly recorded; they are hidden snapshots, rather than unsupported visible fire surfaces.

## Bugs caught by this audit

- Gull perches required names starting `bollard`, losing recovered `source_name` identities
  and merged bollards. `GullPerches` reads visible identities and matches prototype UV triangles,
  edge lengths and distributed vertices against actual merged geometry. It deduplicates landing
  places and creates no additional birds. Seven geometry checks pass, including movement,
  incomplete geometry refusal and duplicate refusal. The rendered log now reports 69 bollards
  and 68 quay perches, previously zero of either.
- Posted employers checked ground but ignored vehicle lanes. `PostedLaneKeepouts` uses native
  omnibus/traffic paths, source .4m padding and candidate order, and actual body clearance.
  1,770 exact original placement cases plus four geometry/boundary checks pass. Population
  replacement rebuilds these positions.
- Boat lantern rendering existed but left a stale diagnostic. `boat_lamps` now clears only
  after actual lanterns initialize.

## Runtime independence and proof boundary

NativeTown overrides the old GLB loader and reads PackedScenes. ModelLibrary.NativeScene
is configured before game parts load; file-based systems use the native packet. Relocation
supplies nonexistent legacy root/bake paths and excludes Node/.NET from the child PATH.
Optional AI Codex discovery finds a native `codex.exe` under an npm installation; it does
not start Node. HTTP AI providers and ordinary engine rules do not need that executable.

No active TODO/NotImplementedException was found. The 501 guards encountered cover unknown
routes, invalid job kinds, or missing extension hooks. The factory supplies homes, furniture,
newspaper, bike/cart ownership and Ideas trouble hooks. Static searches do not replace gameplay
tests. Captured rules, native worker/new-week proofs, rendered multiplayer and relocation each
establish their recorded scenarios. Full edge/material inspection of every asset and every
possible gameplay loop is not established by route coverage or this audit.
