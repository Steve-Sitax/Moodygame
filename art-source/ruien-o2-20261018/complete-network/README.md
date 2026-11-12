# Complete Ruien construction inputs

`inputs/` preserves the final editable layout jobs and native configuration from
the complete-network construction. It includes only active room, hall and route
jobs, their bindings and shared plans, plus the final entrances, gates and buried
drainage. Five original areas remain retained; 162 additional areas are built.

`inventory.json` hashes every input and records the generator revision. Paths use
`${RUIEN_STAGE}` and `${PROJECT_ROOT}` so the inputs can move with the checkout.
Meshes, textures and their intake receipts live in the installed native world;
the Blender generators and shared artwork remain in this art-source directory.

To restore into an empty staging directory, run from the project root:

```powershell
python tools/ruien/construction_inputs.py restore
```

The default destination is `.scratch/ruien-complete`. Existing inputs are never
overwritten. `--stage <directory>` selects another destination for inspection or
export; the later intake and proof tools currently use the default destination.
`build_network.py --kind rooms`, `--kind halls` and `--kind routes` rebuild their
respective jobs. Rebuild the shared gate/drain kits with their generator scripts,
then run native intake and the joined, entrance, drainage and full-game checks.
Keep the restored native configuration: it includes measured final corrections
that a fresh planning pass must not discard.

These files are construction sources, not proof of acceptance. Installation still
requires current physics, burial and visual checks through `install_network.py`.
To preserve a later accepted edit, use `construction_inputs.py snapshot` after
the staging inputs are final; it excludes retired jobs and build caches.
