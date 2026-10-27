"""Give every hung candle crown its own variant and turn (second pass, 2026-10-27; Codex: the burnt-down heights
repeated from crown to crown). Run from the repository root after build-crowns.gd --rebuild:
    python art-source/candle-crowns-20261027/vary-crowns.py
Each CandleCrownN in the churches' room pieces gets the model's variant a or b (alternating down a church's row,
the first by the piece's name) and a turn about its axis by whole light spacings (30 degrees on the 12-light rings,
45 on the 8), both from a stable hash of the piece and the holder: the same every run. The crown's copied
candle_flames list is dropped (the scene's own is the truth; the Flames markers turn with the crown); the hoist turns
with it.
Text-only: line endings, ids and every other line are kept.
"""
import hashlib, math, pathlib, re

ROOT = pathlib.Path(__file__).resolve().parents[2] / 'native-godot'
PROPS = ROOT / 'assets/props/furniture'
SCENE = 'res://assets/props/candle-crowns/candle-crown-%s%s.tscn'
STEP = {'large': 30.0, 'small': 45.0, 'tiered': 30.0}


def stable(*parts) -> int:
    return int(hashlib.sha1('/'.join(map(str, parts)).encode()).hexdigest()[:8], 16)


def main():
    changed = []
    for path in sorted(PROPS.glob('room-*.tscn')):
        raw = path.read_bytes()
        crlf = b'\r\n' in raw
        text = raw.decode('utf-8').replace('\r\n', '\n')
        if 'name="CandleCrown' not in text:
            continue
        lines = text.split('\n')
        # the ext_resource ids of the crown scenes already there
        ext = {}
        last_ext = 0
        for i, l in enumerate(lines):
            m = re.match(r'\[ext_resource type="PackedScene" path="res://assets/props/candle-crowns/candle-crown-(\w+?)(-b)?\.tscn" id="([^"]+)"\]', l)
            if m:
                ext[(m.group(1), m.group(2) or '')] = m.group(3)
            if l.startswith('[ext_resource'):
                last_ext = i
        out = []
        holder = None
        turns = {}
        i = 0
        new_ext = []
        while i < len(lines):
            l = lines[i]
            m = re.match(r'\[node name="(CandleCrown\d+)" type="Node3D"', l)
            if m:
                holder = m.group(1)
            m = re.match(r'(\[node name="Crown" type="Node3D" parent="(CandleCrown\d+)" unique_id=\d+ instance=ExtResource\(")([^"]+)("\)\])', l)
            if m:
                kind = None
                for (k, v), rid in ext.items():
                    if rid == m.group(3):
                        kind = k
                h = stable(path.name, m.group(2))
                n = int(m.group(2)[len('CandleCrown'):])
                variant = '-b' if (n + stable(path.name) % 2) % 2 else ''
                if (kind, variant) not in ext:
                    rid = '%d_crown%s' % (90 + len(ext), variant.strip('-'))
                    ext[(kind, variant)] = rid
                    new_ext.append('[ext_resource type="PackedScene" path="%s" id="%s"]' % (SCENE % (kind, variant), rid))
                out.append(m.group(1) + ext[(kind, variant)] + m.group(4))
                turn = math.radians(STEP[kind] * ((h >> 4) % int(360 / STEP[kind])))
                c, s = round(math.cos(turn), 7), round(math.sin(turn), 7)
                c = 0.0 if abs(c) < 1e-7 else c
                s = 0.0 if abs(s) < 1e-7 else s
                turns[m.group(2)] = 'transform = Transform3D(%s, 0, %s, 0, 1, 0, %s, 0, %s, 0, 0, 0)' % (fmt(c), fmt(-s), fmt(s), fmt(c))
                out.append(turns[m.group(2)])
                i += 1
                # its old turn and copied flame list go
                while i < len(lines) and not lines[i].startswith('['):
                    if not (lines[i].startswith('transform = ') or lines[i].startswith('metadata/candle_flames')):
                        out.append(lines[i])
                    i += 1
                continue
            # the hoist turns with it (its first link stays square to the crown's top eye)
            m = re.match(r'\[node name="Hoist" type="MeshInstance3D" parent="(CandleCrown\d+)"', l)
            if m and m.group(1) in turns:
                out.append(l)
                out.append(turns[m.group(1)])
                i += 1
                while i < len(lines) and lines[i].startswith('transform = '):
                    i += 1
                continue
            out.append(l)
            i += 1
        if new_ext:
            # after the last ext_resource (the out list has the same lines before it)
            out[last_ext + 1:last_ext + 1] = new_ext
        new = '\n'.join(out)
        if new != text:
            data = new.replace('\n', '\r\n') if crlf else new
            path.write_bytes(data.encode('utf-8'))
            changed.append(path.name)
    print('\n'.join(changed))
    print(len(changed), 'pieces')


def fmt(v: float) -> str:
    return ('%.7f' % v).rstrip('0').rstrip('.') if v not in (0.0, 1.0, -1.0) else '%d' % v


if __name__ == '__main__':
    main()
