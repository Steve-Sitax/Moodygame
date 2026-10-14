# Proposed player appearance transport (not implemented)

Package G keeps `Humans.Motions`, protocol version, player-state packets, roster fields and the 20-character
version-A appearance code unchanged. Remote players continue to decode the existing look. The local profile's
optional `faceType`, `sliders`, `beard` and `moustache` fields are stored by the native profile service; they are
not appended to puppet batches or the appearance code.

For lead approval: send a reliable appearance message on join, profile change and late join. Motion packets
continue to refer to the existing player id. Apply only the newest generation; keep the previous complete look
until the new mesh is ready. Do not stream slider changes while a player drags the character-screen controls.

Suggested binary layout, little endian:

| Field | Bytes |
|---|---:|
| Message version (1), appearance-table revision | 1 + 2 |
| Existing player id, monotonically increasing generation | 4 + 4 |
| Appearance-code length and current version-A code | 1 + 20 |
| Face-type, beard, moustache table indices; slider count | 4 |
| Twenty curated sliders, signed int16 at 1/1000 | 40 |
| **Total at the current maximum** | **76** |

Zero sliders can be omitted only with a revisioned index/value encoding; the fixed 40-byte block is simpler.
Sex, age, build, skin, hair, clothes and colours already fit the appearance code. Body and face-picture selection
must be derived from the validated profile on receipt, never supplied as arbitrary resource paths.

The existing SHA-256 content fingerprint handshake covers the native source, shader, rig, pictures and shared
data. Both peers must agree on that fingerprint before accepting an appearance message. Hash the ordered slider
ids/ranges, face-type indices, clothes-cut mapping and quantization rules into the appearance-table revision's
registered schema; do not silently reorder append-only tables. A message-version mismatch is rejected; a table
revision mismatch keeps the old remote look and asks for compatible content. It must never guess indices.

The host validates sex/age compatibility, table bounds, exact length, slider count and finite ranges, clamps
using `Character.Shapes`, and broadcasts its canonical result. Allocate at most one pending appearance per player;
bound mesh jobs and cache size. Local preview meshes are not sent. Save/load stores the canonical profile, while
disconnect removes pending mesh users. Add malformed-message, revision, late-join, generation-order and identical
bake tests before enabling this proposal.
