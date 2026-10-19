# Landmark stone and paving

Geometry-only extraction from `ffefa404286065ad9de07f834c86eb60de66376a` for #171 and #199.
Under the revised acceptance bar, recommend merging this improvement and keeping both issues open
for the follow-ups below. This is not a completed high-detail environment acceptance.

- 25 landmark meshes retain their stone materials: 48,891 bevelled edges and 502 narrow-face UV repairs.
  Stone triangles increase from 105,420 to 670,139; performance has not been measured.
- Closed stone arrises receive an 8 mm three-segment bevel, or 12 mm on low components, overlap-limited.
  Open boundaries, coplanar seams and edges under 25 mm are unchanged because solid construction cannot
  safely be inferred there; these remain inspection limits. The final inward-normal correction is included.
- 27 pavement meshes align 6,125.246 m² of low tops to kerbs with bisector mitres, retaining stone sides.
  Ground cobble/quay rows finish at 502/30 boundary segments, not that many distinct junctions.
- Seven gate, rail and Sint-Jansplein resources change UVs only, with exact original positions/normals.
  Scene nodes, IDs, transforms, material resources and existing collision support remain authored as before.

All 61 original resource blobs matched reviewed main `02602f0b3ec1bd279aaf5a5ac73e7d5f873bc23f`.
No newer N5/Ruien resource is replaced. Keep main's promotion helper, named-material audit selection
and configurable bevel helper; only add the missing landmark dispatch and paving generators/tests.
`resources.json` records original/final SHA-256 and historical Godot support/reload hashes.
`python native-godot/scripts/check-landmark-paving.py --against main` checks installed bytes and upstream
conflicts; `--revision <commit>` checks committed bytes. It does not run Godot or prove navigation.
Run `python -m unittest discover -s native-godot/scripts/paving -p test_*.py -v` for four paving fixtures.
Build with `dotnet build native-godot/Scheldemist.Native.csproj`; review staged paths with the commit guard.

Reproduction uses `audit-stone-corners.gd --out <audit> --materials <list> --original-dir <backup>`;
Blender runs `repair-stone-corners.py -- --landmarks <audit> <candidate>` (`--pavements` for low slabs).
Paving generators document their source arguments. Retain original dumps and street-layout pickles;
never reconstruct the source from installed meshes. Promotion guards installed source hashes.

Final corrected gameplay produced 12 day/rain/night/low PNGs and clean shutdown. Reviewed Carolus low/night,
Sint-Jans rain, railway day, town corner low and rond night: improved arrises and paving read clearly where lit;
no introduced visual defect identified. The corner is too dark to certify every join. No new runtime test here.
Follow-ups for #171: coarse statues, capitals/scrolls/soffits, rectangular relief and foot-grime bands.
Follow-ups for #199: 917 m² of step/plinth tops, park paving, close junction/rail interfaces and connected
foundation/kerb/drainage inspection. These pre-existing limits do not reject the incremental improvement.
