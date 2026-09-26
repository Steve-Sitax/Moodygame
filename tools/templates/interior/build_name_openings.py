"""TEMPLATE (docs/building-with-interior.md): the shell's side of a building with an inside. Copy the functions named
below from tools/blender/build_prison.py into tools/blender/build_<name>.py (they need its Geo, Wall, bar and B).

1. Cut every window and door through, with a label:

    W = Wall(g, (x0, z0), (x1, z0), (0, -1), FOOT, H)
    W.build([
        Hc(u, 0.8, 5.2, 7.2, arch=True, depth=0.35, frame=0.16, glaze="bars", label="front, upper floor, window 1"),
        Hc(u_door, 1.4, 0.0, 3.0, arch=True, depth=0.5, open_=True, sill=False, label="the door", kind="door"),
    ])

   glaze: "bars" (iron), "sash" (a sash's wooden bars), "lead" (cames), "" (a bare slit). Wall.opening() then keeps the
   reveal and the sill, puts the bars at the reveal's back, leaves the pane out and records the opening
   (opening_record). The same depth for all the windows of one face: the room's lining starts there.

2. Round windows in a gable: holed_triangle() for the gable with its hole, annulus() for the stone ring,
   round_opening() for the bars and the record. Roof lights: the roof built round the hole (wing_roof in
   build_prison.py), the record with its four corners (kind "roof").

3. At the end of main(), before export():

    print(f"[build_<name>] {opening_markers()} real openings")

   opening_markers() writes an empty opening_<id> per opening into the glb (kind, label, glaze, shape, hw, yb, yt, nx,
   nz, tx, tz, depth, arch, r) and shared/<name>Shell.ts (change its path and header). The game's loader keeps the
   empties (world/prison.ts shows how: they carry userData); the interior check reads them.

4. No face of the shell inside a room: cut walls another part covers, stop roofs at the faces they meet, leave out
   the inner faces of towers standing in a building. Run the plane check (it prints the pairs in one plane).
"""
