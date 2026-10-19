"""Cut triangles out of a recovered furniture piece's batched meshes (a .tscn of assets/props/furniture), in place, and
optionally set its FurnitureVisual ModelParts. A plan (JSON) lists the cuts:

    {"scene": "res://assets/props/furniture/room-cathedral-source-8902-4.tscn", "offset": [x, y, z],
     "cuts": [{"name": "...", "box": [x0, x1, y0, y1, z0, z1], "materials": ["r005921", ...]},       # world boxes
              {"name": "...", "longer_than": 5.0, "materials": ["r005868"]}],                      # slivers
     "model_parts": ["church/confessional x y z yaw", ...]}                                         # piece frame

A triangle goes when its centre lies in a cut's box (world = piece + offset) and its surface's material path contains
one of the cut's materials (or the cut lists none), or when it is longer than `longer_than` metres. A mesh left with no
triangle is removed with its node. Streams: positions (vc*12) then normals/tangents (vc*8) when the format has them,
colour + uv in attribute_data (vc*12) when present; only non-indexed surfaces (the intake writes those).

    python -I native-godot/recovery/cut-recovered.py <plan.json> [--dry]

Prints what each cut took. Our own tool (#198: the cathedral's confessionals and pulpit; #196 cut the first
confessional's figures by hand the same way)."""

import base64
import json
import math
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def b64(arg):
    arg = arg.strip()
    if arg.startswith('"'):
        return base64.b64decode(arg.strip('"'))
    return bytes(int(x) for x in arg.split(",") if x.strip())


def main():
    plan = json.load(open(sys.argv[1], encoding="utf-8"))
    dry = "--dry" in sys.argv
    path = os.path.join(ROOT, plan["scene"].replace("res://", ""))
    txt = open(path, encoding="utf-8", newline="").read()
    mats = {i: p for p, i in re.findall(r'^\[ext_resource type="Material" path="([^"]+)" id="([^"]+)"\]', txt, re.M)}
    off = plan.get("offset", [0, 0, 0])
    taken = {c["name"]: 0 for c in plan.get("cuts", [])}
    emptied = []
    out = []
    pos = 0
    for m in re.finditer(r'\[sub_resource type="ArrayMesh" id="([^"]+)"\]\n_surfaces = \[\{\n(.*?)\n\}\]', txt, re.S):
        sid, body = m.group(1), m.group(2)
        if "},{" in body.replace("\n", "").replace(" ", ""):
            raise SystemExit("more than one surface in %s" % sid)
        if '"index_count"' in body:
            raise SystemExit("indexed surface %s" % sid)
        fmt = int(re.search(r'"format": (\d+)', body).group(1))
        vc = int(re.search(r'"vertex_count": (\d+)', body).group(1))
        vd = b64(re.search(r'"vertex_data": PackedByteArray\(([^)]*)\)', body).group(1))
        am = re.search(r'"attribute_data": PackedByteArray\(([^)]*)\)', body)
        ad = b64(am.group(1)) if am else b""
        nt = (len(vd) - vc * 12) // vc if vc else 0
        at = len(ad) // vc if vc else 0
        if nt not in (0, 8) or len(vd) != vc * (12 + nt) or len(ad) != vc * at:
            raise SystemExit("unexpected streams in %s (format %d)" % (sid, fmt))
        mm = re.search(r'"material": ExtResource\("([^"]+)"\)', body)
        mat = mats.get(mm.group(1), "") if mm else ""
        P = [struct.unpack_from("<3f", vd, i * 12) for i in range(vc)]
        keep = []
        for t in range(vc // 3):
            tri = [P[3 * t + k] for k in range(3)]
            c = [sum(p[k] for p in tri) / 3 + off[k] for k in range(3)]
            gone = None
            for cut in plan.get("cuts", []):
                if cut.get("materials") and not any(x in mat for x in cut["materials"]):
                    continue
                if "box" in cut:
                    b = cut["box"]
                    if b[0] <= c[0] <= b[1] and b[2] <= c[1] <= b[3] and b[4] <= c[2] <= b[5]:
                        gone = cut["name"]
                        break
                if "longer_than" in cut and max(math.dist(tri[i], tri[(i + 1) % 3]) for i in range(3)) > cut["longer_than"]:
                    gone = cut["name"]
                    break
            if gone:
                taken[gone] += 1
            else:
                keep.extend(range(3 * t, 3 * t + 3))
        if len(keep) == vc:
            continue
        if not keep:
            emptied.append(sid)
            continue
        nv = len(keep)
        Pk = b"".join(vd[i * 12:i * 12 + 12] for i in keep)
        NT = b"".join(vd[vc * 12 + i * nt: vc * 12 + i * nt + nt] for i in keep) if nt else b""
        AT = b"".join(ad[i * at:i * at + at] for i in keep) if at else b""
        kp = [P[i] for i in keep]
        lo = [min(p[k] for p in kp) for k in range(3)]
        hi = [max(p[k] for p in kp) for k in range(3)]
        g = lambda v: "%.9g" % v
        nb = re.sub(r'"aabb": AABB\([^)]*\)', '"aabb": AABB(%s)' % ", ".join(g(v) for v in lo + [max(1e-5, hi[k] - lo[k]) for k in range(3)]), body)
        nb = re.sub(r'"vertex_count": \d+', '"vertex_count": %d' % nv, nb)
        nb = re.sub(r'"vertex_data": PackedByteArray\([^)]*\)', 'PLACEHOLDER_VD', nb)
        nb = nb.replace("PLACEHOLDER_VD", '"vertex_data": PackedByteArray("%s")' % base64.b64encode(Pk + NT).decode())
        if am:
            nb = re.sub(r'"attribute_data": PackedByteArray\([^)]*\)', 'PLACEHOLDER_AD', nb)
            nb = nb.replace("PLACEHOLDER_AD", '"attribute_data": PackedByteArray("%s")' % base64.b64encode(AT).decode())
        out.append((m.start(2), m.end(2), nb))
    for a, b, nb in reversed(out):
        txt = txt[:a] + nb + txt[b:]
    for sid in emptied:
        # the mesh and the node that drew it
        txt = re.sub(r'\[sub_resource type="ArrayMesh" id="%s"\]\n_surfaces = \[\{\n.*?\n\}\]\n\n' % re.escape(sid), "", txt, flags=re.S)
        txt = re.sub(r'\[node name="[^"]+" type="MeshInstance3D" parent="\." unique_id=\d+\]\nmesh = SubResource\("%s"\)\n\n?' % re.escape(sid), "", txt)
    if "model_parts" in plan:
        line = "ModelParts = PackedStringArray(%s)" % ", ".join('"%s"' % p for p in plan["model_parts"])
        if re.search(r"^ModelParts = .*$", txt, re.M):
            txt = re.sub(r"^ModelParts = .*$", line.replace("\\", "\\\\"), txt, count=1, flags=re.M)
        else:
            txt = re.sub(r'(^\[node name="[^"]+" type="Node3D" unique_id=\d+\]\nscript = [^\n]+\n)', lambda mm: mm.group(1) + line + "\n", txt, count=1, flags=re.M)
    for k, v in taken.items():
        print("%-28s %6d triangles" % (k, v))
    print("meshes emptied:", emptied)
    if not dry:
        open(path, "w", encoding="utf-8", newline="").write(txt)
        print("written", path)


if __name__ == "__main__":
    main()
