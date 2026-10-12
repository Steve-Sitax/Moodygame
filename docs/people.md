# People: the people2 kit (skeleton and base bodies)

Packages A and B of the people plan (`docs/plans/people.md`, section 3). The new people of both games are built on this
kit: one 62-bone skeleton for everybody and ten base bodies with faces, hands and hair (B). Clothes and kinds (C), motion
(D), the browser and Godot runtimes (E, F), Jef (G), fight motion (J) and weapons (K) all build on it. Nothing in
either game uses it yet: `people.glb` and `tools/blender/build_people.py` stay as they are until E and F switch.

## Build

```
blender -b --factory-startup -P tools/blender/build_people2.py -- [--preview] [--cast] [--faces] [--hands] [--sheet]
    [--only a,b] [--out PATH]
```

Blender 5.2 (`C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`), about 3 min (B's head is meshed once
per build: about 1 min); `--cast` adds about 4 min, `--faces --hands --sheet` about 4 min.

| Writes | What |
|---|---|
| `client/public/models/people2.glb` | 10 bodies, each an armature (named after the body) with `<body>_lod0` and `<body>_lod1`, 5 materials (colour and normal map), 36 clips, the near copies' shape keys; Draco, JPEG; 5.4 MB |
| `shared/peopleRig.json` | the bones, sockets, grab marks, the Godot BoneMap, the grips and the shape keys, and per body its joints, marks, figures and counts |
| `data/shots/people2/*.png` | the check pictures (not in git) |

Godot reads Draco only through `node tools/godot/models.mjs --only people2` (writes the plain copy to
`godot/baked/models/`).

The kit, `tools/blender/people2/`:

| File | Does |
|---|---|
| `__init__.py` | paths, the axis change `B()` (game to Blender) and `G()` (back) |
| `body.py` | the bodies: figures, landmarks, the quad cage, the stoop, `girths()` |
| `rig.py` | the 62 bones, their joints per body, the Godot names, the grab marks |
| `weights.py` | skin weights by rule; the finger sharpening |
| `lod.py` | UV unwrap and island layout, the subdivision (LOD0), the limit surface (LOD1) |
| `paint.py` | the position map and the base skin pictures |
| `clips_legacy.py` | the 36 old clips keyed on the new rig |
| `export.py` | the glb, the materials, `peopleRig.json` |
| `preview.py` | the check pictures |
| `sdf.py` | (B) signed distance tools: shapes, soft blends, surface nets, decimation, pulling points onto a surface |
| `head.py` | (B) the head: its anatomy as a field, the one reference mesh, bodies and face shapes as moves of it, eyes, UVs, weights, the join to the neck |
| `face_paint.py` | (B) the face painter: the head's square of the picture and its normal map, from a look |
| `hands.py` | (B) the hands: palm, fingers, thumb in the cage; the docker's hand; grips; the hands' paint |
| `hair.py` | (B) hair styles, beards, moustaches; hair cards for the named cast |
| `preview_b.py` | (B) the face, hand and hair check pictures and the grip fit |

## Axes and units

Game space everywhere: x the person's left, y up, z forward (the person faces +z), metres. In the glb every bone
node's local frame is its Blender bone frame in game axes: local +y runs along the bone (head to tail). Bone rolls are
0. `peopleRig.json` gives every frame in these axes (checked against the glb: socket heads and axes agree to 0.04 mm).

## The skeleton (62 bones)

| Group | Bones (L and R where it applies) | Kind |
|---|---|---|
| trunk | hips, spine, chest, upperChest, neck, head, jaw | body |
| arms | clavicle, armUp, armLow, armTwist, hand | body |
| fingers | thumb1-3, index1-3, middle1-3, ring1-3 (the little finger is weighted to the ring chain) | body |
| legs | legUp, legLow, foot, toe | body |
| cloth | skirtF, skirtB, skirtL, skirtR, coatTailL, coatTailR | spring |
| sockets | gripR, gripL, hipL, back, headTop | socket |
| eyes (B) | eyeL, eyeR (leaves of head, at the eyeballs' centres, pointing forward) | eye |

- **The 16 old bones** (hips, spine, neck, head, armUp/armLow/hand, legUp/legLow/foot) keep their names, rest
  directions and roll 0. New bones that sit between old ones (chest and upperChest between spine and neck, clavicles
  between upperChest and armUp) also point straight up with roll 0, so every old bone's rest turn relative to its
  parent is what it was. Measured: the 16 rest turns in `people2.glb` match `people.glb`'s (1 - |dot| under 1e-7).
  So **the old clips in `people.glb` play on these skeletons unchanged**, and so do the re-keyed ones here.
- Parents: hips > spine > chest > upperChest > neck > head > jaw; upperChest > clavicle > armUp > armLow > (armTwist,
  hand); hand > fingers; hips > legUp > legLow > foot > toe; hips > skirt, coat tails, hipL; upperChest > back;
  head > headTop; hand > grip.
- Directions: the trunk, neck, head and clavicles point up; arms, hands and fingers down (the thumb down, forward
  and across the palm); legs down; feet, toes and the jaw forward; skirt and coat bones down; sockets see below.
- Pivots: the elbow's (armLow head) sits 8 mm behind the arm's line and the knee's (legLow head) 8 mm in front of
  it, toward the round side of each hinge; directions are unchanged.
- **body** bones deform and are keyed by every clip (47 bones: the `keyed` list). **spring** bones deform, but the
  base bodies have no weights on them: C weights skirts and coat tails to them, E and F move them with springs.
  **socket** bones never deform and are never moved by clips.
- No root bone: the armature node (the glb's top node per body) is the root. Clips key rotations; a fight or fall
  clip that must move the body keys `hips` translation (in the armature node's space), so E and F must keep hips
  position tracks (today's loaders keep quaternion tracks only).
- **eye** bones (`eyeL`, `eyeR`, B) deform the eyeballs only; clips never key them, code turns them to look
  (`RZ` turns both left and right, `RX` up and down, about 25 and 15 degrees at the most). They are appended after the
  sockets, so every other bone keeps its index.
- **BoneMap** to Godot's `SkeletonProfileHumanoid`: `peopleRig.json boneMap.map` (profile name to our name). The
  little fingers and Root are unmapped; the eyes map to LeftEye and RightEye. Use it to retarget licensed motion later.

### The pose convention (for D, J and code)

As in the old kit: a pose is a dict bone -> quaternion in armature axes (Blender: X the left, -Y forward, Z up),
each a turn relative to the parent's turned frame (Q_bone = Q_parent * q_bone); the key is `rest^-1 * q * rest`.
`clips_legacy.set_pose(ao, pose)` applies one. The old helpers work unchanged (`build_people.limb()`, `RX/RY/RZ`):
`RX(-a)` swings a hanging arm forward and bends an elbow, `RX(a)` bends a knee, `limb(S, out=a)` raises an arm
sideways. New bones:
- finger curl toward the palm: `RY(+a)` on the left hand's index/middle/ring bones, `RY(-a)` on the right;
- thumb: two axes per side from `clips_legacy.thumb_axes(J)` (flex toward the palm, and across the palm);
- clavicle: `RY(-a)` lifts the left shoulder (`RY(+a)` the right), `RZ(-a)` brings the left shoulder forward;
- jaw: `RX(+a)` opens the mouth;
- armTwist: a turn about the forearm (`RZ` in armature axes for a hanging arm).

### What the old clips get on the new rig (`clips_legacy.py`)

The 16 old bones get exactly the old rotations (the pose functions are imported from `build_people.py`, not copied).
From the same pose the new bones get: armTwist 0.6 of the hand's turn about the forearm (no wrung wrists); the
clavicle lifts when the arm is raised past 35 degrees (0.13 of the excess, at most 13 degrees, about 3 cm at the
shoulder) and goes forward with a forward arm, the upper arm turned back by as much so it points as before; a hand
shape per clip and hand (`HANDS`, `CLIP_HANDS`: relaxed, grip, fist, pinch, open, point, cup); the jaw talks in
talk, talk_f, rifle_talk and calls in call. chest, upperChest and toes stay at rest. Every clip keys the same 47
bones. The lifts the games add (sit, kneel, crouch, ride) are unchanged.

## Sockets

Each is a bone; hang a thing on its node (three.js: `getObjectByName`; Godot: a `BoneAttachment3D` or
`GetBoneGlobalPose`). Rest frames per body: `peopleRig.json bodies.<body>.joints`; the reference frames in `sockets`.

| Socket | Parent | Where | Frame |
|---|---|---|---|
| gripR, gripL | hand | where a handle runs through the closed fist, 2.2 cm past the knuckles, on the palm side | +y the handle's axis, forward when the arm hangs; +z toward the wrist; a blade's edge points along -z (the little finger's side) |
| hipL | hips | the left hip at the belt | +y down: a scabbard or sheath hangs along it |
| back | upperChest | the middle of the upper back, on the skin | +y up the back, +z out of the back |
| headTop | head | the crown | +y up |

Model a held thing with its grip at the origin and its tip along +y. The hand must make a fist round it: the `grip`
hand shape closes round a 3-4 cm handle (checked with sticks, `sockets.png`). One model per thing: the sack, the
handcart, planks, bottles and weapons are their own models on these sockets, never part of a body.

## Grab marks

For grabs, held victims, paired moves, hits and drags (Steve's fight rules in `docs/plans/people.md` section 5): points
on the body given as an offset in a bone's rest frame. World point = the bone's posed global transform times the
offset. Per body in `peopleRig.json bodies.<body>.marks` (`bone`, `offset`, `rest`); what each is for in `marks`:
nape, collarBack, collarFront, mouth, throat, chest, belly, kidneyL/R, beltBack, wristL/R, upperArmL/R, armpitL/R,
ankleL/R, hair. `grab.png` shows a grab from behind (a hand over the mouth, a blade at the throat) and a body on its
back dragged by the wrists, both reached by plain two-bone IK onto these marks (`preview.arm_ik`).

## The bodies

| Body | Height | Build |
|---|---|---|
| man_middling, man_slight, man_stout | 1.67 m | middling, slight, stout (belly) |
| woman_middling, woman_slight, woman_stout | 1.57 m | the same |
| child_middling, child_slight | 1.27 m (about ten) | middling, slight |
| old_man | 1.64 m, stooped 17 degrees | a little slight, white hair, thinning crown |
| old_woman | 1.54 m, stooped 15 degrees | the same, grey hair |

The figures: heights from Quetelet's Belgian tables as summed up in *All the Year Round* vol. XII p. 490: "at ten
years old, four feet two; at fifteen years old, five feet; and at twenty years old, five feet six inches for young
men, and five feet two inches for young women", and a slight fall after fifty. Proportions from the textbook canon
(an adult head a 7.7th of the height, a child's a 6th; hip joint 0.52, knee 0.285, shoulder 0.818, elbow 0.63, wrist
0.485 of the height), girths of working people. Measured on the near copies (`peopleRig.json ... triangles.girths`):
man_middling chest 0.88, waist 0.79, hips 0.91, thigh 0.52, calf 0.35, upper arm 0.27, wrist 0.17 m; woman_middling
bust 0.81, waist 0.66, hips 0.89 m (uncorseted); man_stout chest 0.99, waist 0.94 m. Each body's armature has
`extras.people2` (base, build, height, female, `scaleToOld` = hips height / 0.95, the old kit's body scale).

The old: the stoop bends the upper body forward from the waist; the bones keep their directions (their heads move),
the arms still hang straight and the head still looks ahead.

**Base bodies are not kinds.** They wear painted linen drawers and a vest (a chemise for women) and a cropped head
of hair, so they can be looked at; C dresses them, B gives them faces, hands and hair.

### Topology (the same for every body)

One quad cage, 1,098 quads: a trunk tube of 16 columns from the crotch to the crown (closed by a 4 x 4 grid), arms of
8 columns from a 2 x 2 hole each side of the chest to a capped palm, legs of 10 columns from the crotch bending
forward into the feet, and 10 closed finger shells (4 columns) set into the palms. Three edge loops at the shoulder,
elbow, wrist, hip, knee and ankle. Column 0 of the trunk is the front middle, 4 the left side, 8 the back; arm
columns run from the front round the outside; the head joins the neck at the ring `neck[-1]` (B can replace the
head at that ring of 16 vertices). Because every body is made by the same code, vertex order is the same in every
body: shape keys, clothes fitting and weight transfer can rely on it.

- **LOD0** (near, under 15 m): the cage subdivided once onto the limit surface: **8,784 triangles**.
- **LOD1** (far, from 15 m, and for the mirrors and the lantern shadow): the cage with its vertices moved onto the
  same limit surface (so the switch does not change the size): **2,196 triangles**. Same UVs, material, skeleton.
- Smooth shaded, outward normals, closed shells.

### UVs and pictures

Islands (seams marked in the cage): the trunk, the head, each arm with its hand, each leg with its foot, each
finger. They are unwrapped angle-based once on man_middling and the same UVs are given to every body, so a picture
painted for one fits all. Texel density is even, except the head (2.7 times the texels per metre) and the fingers (1.15 times). Two pictures:
`people2_skin_m` (men, boys, the old man) and `people2_skin_f` (women, the old woman), 2048 px, JPEG in the glb,
painted in 3D through a position map (`paint.position_map`: for every texel the body point it shows); islands are
grown outward by 12 px against mipmap bleeding. Linear, mipmapped in the games. The plan's shared atlas (4096,
512 cells) is C's and E's to lay out: a kind's picture is this unit square moved into its cell.

### Weights

By rule, not Blender's bone heat (heat bleeds between a hanging arm and the chest beside it). From what the cage
knows about each vertex: trunk weights by height along the spine chain; shoulders shared by upperChest, clavicle
and armUp round the arm hole; hinges with a short blend on their round side (the back of the elbow, the front of the
knee) and a long one on the crease side; the forearm shared from armLow to armTwist toward the wrist; the jaw on
the lower face; legs and hips round the crotch. The subdivision carries them to LOD0; the fingers are then
sharpened on LOD0 by their position along each finger. At most 4 bones a vertex, normalised.

Measured at 120 degrees (`--cast` prints it): the section through the hinge keeps 64-77% (elbows) and 45-60%
(knees) of what two rigid tubes would show; the rest is the crease folding in, as flesh does. Shoulders hold with
the arms straight up and straight out; a deep squat, a fist and a body lying on its back hold (`bends.png`).

## Faces, hands, hair (package B)

### The head (`head.py`, `sdf.py`)

A's placeholder head stays in the cage for the subdivision (so the neck keeps its shape) and is then replaced in both
copies at A's neck ring (`head.attach`): a strip of triangles joins the head's open edge, 6 mm above, to the ring
(32 vertices near, 16 far), always in the same pattern.

- **Anatomy as a field.** The head is a signed distance field in a head frame for a reference head 0.214 m from chin
  to crown (x the left, t up from the bottom of the chin, z forward of the ear canal): a cranium and occiput, one
  face mass narrowing to the chin, cheek pads, cheek bones and arches, a jaw from the angle to the chin, a muzzle, two
  lips with a real mouth slit and a mouth inside it (so the jaw opens a dark mouth), a nose (bridge, tip, wings,
  nostrils), a brow ridge, sockets round separate eyeballs with modelled lids and an almond opening, ears (a cupped
  plate, the rolled rim, the groove inside it, the bowl, the tragus, the lobe) and the neck. Proportions from the
  textbook landmarks: eyes at half the height, the nose from the brows down about 5 cm, the mouth a third of the way
  from the nose to the chin, the ear from the brow line to the base of the nose.
- **One mesh for every head.** The reference man's field is meshed once per build (surface nets on a 0.8 mm grid,
  the neck cut and the hidden eye cavities removed, Blender's quadric decimation to 2,200 triangles with the face and
  ears weighted to keep more, a cut along the back's middle line for the UV seam, every vertex pulled back onto the
  surface, the lid margins put evenly back on the true margin). Every body (`FEMALE`, `CHILD`, `OLD_M`, `OLD_F`
  changes and A's head size `hs`, `hw`) and every face shape is that mesh moved: landmarks carry it (`warp`) and it is
  pulled onto that head's own surface. So all heads have one vertex order; the far copy has its own 330-triangle
  head (closed lids, no slit, plain ears) made the same way.
- **Eyes.** Each eyeball is its own little sphere (100 triangles, a low cornea bulge) weighted to `eyeL`/`eyeR`; the
  lids close over them by the `blink` shape key. The eye whites are dimmed (they glow in the fog otherwise).
- **Weights.** By rule: A's spine chain by height (neck to head), the jaw by a line from the mouth slit rising back to
  the jaw joint, sharp at the slit (upper lip with the head, lower lip with the jaw), shared under the chin.
- **Face shapes (shape keys of `_lod0`).** 14: long, broad, aquiline, snub, bulbous, square, weakchin, chin, gaunt,
  round, heavybrow, thinlips, fulllips, ears; and `blink`. `head.face_mix(seed)` gives a person two or three of them
  at 0.17-1.0 (never two opposites). Positions only (no shape-key normals: they cost 7 times the file size), moves
  under 0.25 mm dropped: about 60 KB a body. **E, F:** set the weights once when a person is made (three.js
  `morphTargetInfluences` per clone; Godot `set_blend_shape_value` per MeshInstance3D); the far copy has none. A kind
  mesh made by C from a body carries the same keys only if C copies them (about 60 KB a kind).

### The face painter (`face_paint.py`)

UVs: the head has its own square in the top right of a body's picture (`head.HEAD_RECT`, 512 px of 2048), the same in
every body: a chart round the head seen from a point inside it (more texels across the face), the ears' fronts and
backs, the eyeball, a dark patch for the inside of the mouth, and two swatches (strands, a plait's weave) for the
swept hair pieces. `face_paint.paint(look, size)` traces every texel back to the point of the reference head it shows
(once per size) and paints by position: skin tone (five, from fair Flemish to a dark-skinned sailor), mottling, the
weathering of outdoor people, the flush of cheeks, nose, chin and ears, lids, lashes and the lid crease, brows in hair
strokes, lips, the scalp's hair and the hairline of each style, sideburns, stubble, painted beard zones, wrinkles by
age (forehead lines, the frown, crow's feet, the fold from nose to mouth, the lines below the mouth, the neck), a
drinker's veined nose and cheeks, pox pits, freckles, soot, the eye (a dim white, the iris with its rays and a darker
ring, the pupil, the lid's shade) and the shade of the folds (from the field). A height field painted with it becomes
the tangent-space normal map (OpenGL green-up, as glTF wants). `look_for(seed, sex, age)` draws a look; `BASE_LOOKS`
are the base bodies' own. 1024 px for the named cast: `paint(look, 1024)` into the same square of a 4096 picture.

The base glb has five pictures, each with its own face: `m` (the men), `f` (the women), `boy` (the children), `old_m`,
`old_f`. A kind (C) paints its own face into its picture's head square.

### Hands (`hands.py`)

A's arm stops at its palm ring p0; from there one connected hand: a 10-column palm (six pentagons make the step from
8), four fingers grown from the palm's last loop with webs between them, the thumb out of a hole in the palm's thumb
side. The fingers follow A's finger bones (`body.hand_frame`, unchanged): rings at the joints (wider: the knuckles),
pads between them, the nail and the tip. Weights per vertex from the hand code; A's finger sharpening on the near
copy still applies. The paint (`paint_hands`): nails on the backs of the last joints only, creases at the joints and
three in the palm, red knuckles, tendons; with the normal map. **Docker's hands**: the `hands_hard` shape key (fingers
a fifth thicker, bigger knuckles, a broader thicker palm); `paint_hands(hard=1)` paints calluses.

**Grips** (`peopleRig.json grips`, fitted every build by `preview_b.fit_grips`): for a 2 cm rope, a 2.6 cm knife
handle, a 3.2 cm baton and a 4 cm cart handle: the finger curls (MCP, PIP, DIP), a thumb closed as far as it goes
without entering the handle, and `axisAt`, where the handle's axis sits in gripL/gripR's own frame (about 2.2 cm
toward the wrist from the socket and r + a little into the palm: a real power grip, the knuckle joints closed too).
No vertex goes more than 0.4 mm into any of them. **D, J, K:** to hold a thing of radius r, pose the hand with these
curls and put the thing's axis at `axisAt` (along the socket's +y); A's socket origin itself stays where it was.

### Hair (`hair.py`)

Two kinds of piece, both carried to every body and every face shape: **shells** (the head's own triangles under the
hair, pushed out by a thickness that grows from the hairline, the rims on the skin; beards the same over the face)
that take the scalp's and the beard zone's paint, and **tubes** (bun, plaits pinned up, a coronet of plaits,
moustaches, an imperial tuft) swept along paths made from the head's landmarks and bound to the nearest head
vertices, over the strand and plait swatches. Styles: men crop, side (parting), bald (a fringe of hair), long (to the
collar); women bun, plaits, coronet, undercap (flat, for under a cap), with the curled fringe of the 1870s as a
variant; beards full, short, chops (mutton chops), sideburns, chin (a chin curtain), imperial; moustaches walrus,
handlebar, chevron. `hair.style_for(seed, look, P)` picks one by sex and age; `hair.attach(mesh, P, lod, style)` joins
it into a body mesh (same draw, same material). The base bodies wear `hair.base_style`: crop, bun, bald for the old
man. A shell costs 250-400 triangles, a bun 300.

**Hair cards** (`hair.cards`, `card_material`): alpha-tested strips over a shell for the named cast's near copy only
(a second material and draw; alpha MASK in glTF). Not in the base glb.

### Counts

| | Near copy (LOD0) | Far copy (LOD1) |
|---|---|---|
| man_middling (crop hair) | 10,356 triangles | 2,342 |
| woman_middling (bun) | 10,636 | 2,432 |
| of which the head, eyes, the join | about 2,500 | about 360 |
| of which both hands | about 2,000 | about 500 |

Over A's 6,000-9,000 for the crowd by 1,400-1,650 (the plan allows up to 12,000 for the named): the face and the
hands carry the look at talking range; the scalp under the hair is coarse. The file is 5.4 MB (pictures 1.7 MB, shape
keys 0.8 MB, meshes 1.5 MB, clips 0.4 MB).

## Checks

`--preview` and `--cast` write to `data/shots/people2/`:

| Picture | Shows |
|---|---|
| `bodies_front/side/back/threequarter.png` | all ten bodies, idle |
| `bodies_closeups.png` | each body's head and left hand |
| `turntable_3m.png`, `turntable_10m.png` | man, woman, child, old man from 8 sides at 3 m and 10 m in the game's fog, at a 1080-line window's pixel size (10 m blown up 3x); `turntable_10m_lod1.png` the far copy |
| `clips_man_middling.png`, `clips_woman_middling.png` | every old clip (in the order of `CLIPS`, rows of 9) |
| `clips_child_middling.png`, `clips_old_man.png`, `clips_old_woman.png`, `clips_man_stout.png` | idle, walk, sit, crouch, hop, beg, behind, walk_f, push |
| `bends.png` | elbows and knees at 120, a deep squat, arms up and out, a turned hand, close-ups, a body lying |
| `sockets.png` | a baton in gripR, a knife in gripL, a scabbard on hipL, a load on back, a hat on headTop; idle, walk, guard, talk; four bodies; fist close-ups |
| `grab.png` | a grab from behind from three sides; a body dragged by the wrists |
| `skin_<m, f, boy, old_m, old_f>.png`, `skin_*_n.png` | the five pictures and their normal maps |
| `faces_close.png` (`--faces`) | man, woman, old man, child at 1, 2 and 5 m (2 and 5 m blown up 3x), by day and under a gas lamp, front and three-quarter |
| `faces_big.png` | man (day, gas), woman, old man, old woman (gas), child from four sides, big |
| `faces_moves.png` | rest, talking, calling (the jaw), half and full blink, the eyes turned left and up |
| `faces_shapes.png` | every face shape at full on the man and the woman |
| `faces_hero.png` | a named man's near copy (side parting, mutton chops, walrus moustache) without and with hair cards |
| `faces_40.png` (`--sheet`), `faces_40_2m.png`, `faces_40_shapesonly.png` | 40 seeded people at 5 m and 2 m (each its own look, face mix and hair); the same face mixes with one look and no hair |
| `hands.png` (`--hands`) | the hand relaxed, open and in a fist from three sides; each grip from two sides; the docker's hand |

Also: `node tools/blender/glbhash.mjs client/public/models/people2.glb` (per part hashes) and
`node tools/godot/models.mjs --only people2` (decodes: 630 nodes, 20 meshes, 10 skins, 36 clips, no other
extensions).

## For the next packages

- **B (faces, hands, hair):** done, see above.
- **C (clothes, kinds):** dress the ten bodies; vertex order and UVs are the same in all, so one fit transfers. Skirts
  and coat tails weight to the spring bones (none of the body is on them). Props are models on sockets. Fold the
  kinds' pictures into the shared atlas. A kind's face: `face_paint.paint(look, 512)` into its head square (keep the
  square whole); its hair: `hair.attach` with `hair.style_for` or a chosen style (vertices with `part_hair` are the
  hair: drop the base hair before you add another; hats sit on headTop over the hair). Keep or drop the shape keys.
- **D (motion):** author on any body (clips are rotations and play on all). Use the pose convention above; key the
  47 `keyed` bones in every clip; keep the hand shapes, clavicle and twist rules or replace them in `motion.py`.
- **E, F (runtimes):** load `people2.glb`; the bone names repeat per body (glTF adds `_1`: strip it, as today).
  Face shapes, blink and hard hands are morph targets of `_lod0` (see "Face shapes"); the eyes turn by `eyeL`/`eyeR`;
  the material has a normal map (use it or bake it into a bump; no new shader kind).
  LOD: two meshes per body on one skeleton, show `_lod1` from 15 m and in mirrors and the lantern shadow. The
  old `people.glb` clips also play on these skeletons. Keep hips position tracks for fight clips. Each frame (or in
  the clips): armTwist = 0.6 of the hand's turn about the forearm if code turns the hand. Body scale against the old
  kit: `extras.people2.scaleToOld`.
- **J (fights):** grab and hit marks above; paired moves place both armatures by their top nodes; a body on the
  ground is the hips turned and translated; the drag pose in `grab.png` is reached with two-bone IK.
- **K (weapons):** model each with its grip at the origin, tip along +y, edge along -z; hang it on gripR/gripL,
  sheathed ones on hipL; move it to the grip table's `axisAt` for its handle size and use that table's curls.

## Known limits

- The faces are plain and a little stylised; the women's and children's faces differ from the men's by moved
  landmarks on one mesh, so the differences stay moderate. Hair is shells and tubes: no loose strands but on the cards.
- The fist (`HANDS["fist"]` in clips_legacy, D1's) leaves the finger tips short of the palm; the grips are fitted.
- The face shapes have no shape-key normals: lighting follows the base face (the shapes are small).
- Beards are shells over the decimated face: big beards (mutton chops) show a small dent or two over the cheekbone
  at 1 m (`faces_hero.png`); hair cards add little on top of a shell of the same colour.
- Counts are over A's crowd budget (see Counts).
- The crown is about 1 cm higher than the table height (1.68 m for 1.67 m).
- The little finger has no bones of its own (it curls with the ring finger), as the plan allows.
- `girths()` cannot measure the old bodies' necks (the stoop tilts them out of a level cut).
