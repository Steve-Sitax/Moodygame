# Original artwork and migration references

These files preserve the original media, authored city facts, DCC helpers and interior templates after the
Godot migration. They are references and art masters; the game and server use the native resources under
`native-godot`, with no runtime dependency on this archive or the old browser exporter.

`retirement-manifest.json` records the retained migration files with their original paths and SHA256 values.
The unused browser service worker was deleted on 2026-10-19; art masters remain available for native authoring.
Historical launch/release/oracle tools are saved as text under `../docs/archive`, also covered by that manifest.
The active projects and commands are documented in `../native-godot/README.md`. Main and external art
worktrees, user layouts, preferences and provider credentials were left intact.

People2 is an active authoring kit under `tools/blender/people2/`, entered through
`tools/blender/build_people2.py`. Its masters are `client/public/models/people2.glb`
and `shared/peopleRig.json`. `--plain <ignored-path>` writes temporary native intake
geometry with dense morphs; check pictures go to `../.scratch/people2-build/shots`.
The native game uses its stored people2 scene and checksummed shared data. Build,
additive intake and bounded proof commands are in `../docs/godot-people2.md`.
