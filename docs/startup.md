# Start-up

How the game gets from the icon to play, what each step costs, and how to keep it fast. Rules: AGENTS.md
"Adding to the start". Goal: under 60 s on a warm cache.

## Measure

```powershell
pwsh -File native-godot/scripts/measure-startup.ps1 -Name base -Runs 3
& native-godot/scripts/measure-startup.ps1 -Name ref -Extra @('--no-startup-cache','--ruien-in-order')  # from PowerShell: -File cannot pass a list
```

Each run writes `.scratch/startup-perf/<name>-<n>.json` (every `StartupTiming` stage) and `.log`. Compare medians of
three runs taken close together: the same build varies about 15% over a day on the test PC. The first run after a change to a
`StartupGeometrySource` file rebuilds the caches (about 5 min); time it separately. `ref` must print the same
`town digest`, `map digest` and `ruien pieces` as a cached run.

## Where the time goes (2026-11-07, warm, about 87 s)

| Step | Thread | s | Notes |
|---|---|---|---|
| Town, district and declared files read | loader workers | 9-11 | `NativeTownPrefetch`, level by level |
| Town passes (cuts, razed, shop fronts, squares, benches...) | loading thread | 12 | cut cache hit 1.4 s |
| Ruien entrances and areas built | Ruien worker | 7 | hidden behind the passes |
| Town enters the tree, ready passes | main | 9 | about 4.5 s is collision and furniture |
| Solid (town collision) | main | 8.5 | 5.6 s Jolt shape building, 2 s mesh reads |
| Other parts (walk map 4, Ruien lay-in 4.5, railway 2, sound floors 2.3...) | main | 25 | |
| Game rules, first state, shader settle and fade | main + workers | 8 | rules start after the walk map |

## Decided

- All collision is built at start (Steve, 2026-11-07). Building far collision later, near the player, was
  offered (about 6-8 s faster) and declined: far ray tests and start-up ray checks could give other results.
  Do not propose it again without a new reason.

## Traps

- A mesh read (`SurfaceGetArrays`, `GetFaces`) from the loading thread waits for a main-thread frame. Keep the loading
  card's frames unthrottled: drawing it less often made the town load 4.6 s slower.
- Resources loaded on two threads at once can fail in Godot's C# glue (`Handle is not initialized`) or leave an
  uninitialized RID. Workers that load run only beside the town's loading thread; Main joins the Ruien worker first.
- A C# wrapper of a Godot resource is shared: never `Dispose` one you did not create.
- Editing a file listed in `StartupGeometrySource` invalidates every cache of that project.
- `user://startup-cache` keeps entries by content key; entries unused for 3 days are deleted after start-up.

## Dev switches

`--no-startup-cache`, `--ruien-in-order`, `--serial-town`, `--serial-districts`, `--serial-stamps`,
`--backend-after-load`, `--load-on-main`: each restores the old way of one step, for a before-and-after.
