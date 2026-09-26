# The omnibus network on the walk map (M7 omnibus routes): the rounds before M7 (thin, grey) and
# now (in each line's colour, with arrows the way they run), the stops, and the places they serve.
#
#   python tools/city/omnibus_map.py [out.png]      (default data/shots/ob_routes_map.png)
#
# The rounds and stops come from shared/omnibusLines.ts (read through node), the ground from
# client/public/city/walk.png, the places from shared/city.json. North (+x) is up, the river left.
import json, math, os, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, "data", "shots", "ob_routes_map.png")

# the rounds before M7 (omnibus.ts at commit cb77972): the quay line, the old Grote Markt ring
OLD = {
    "kaaien": [[-305, 29.5], [-305, 8.3], [-158, 8.3], [-152, 7.6], [-140, 7.6], [-134, 8.3], [-90, 8.3], [-84, 7.8], [-68, 7.8],
               [-62, 8.3], [66, 8.3], [76, 15], [76, 37], [-54, 37], [-58, 33], [-58, 12], [-62, 8.3], [-204, 8.3], [-204, 29.5]],
    "markt": [[-84.5, 20], [-96, 20], [-96, 38], [-89.5, 45], [-89.5, 114], [-149, 114], [-149, 126.2], [-238, 126.2], [-238, 70],
              [-280, 70], [-280, 129.8], [-145, 129.8], [-145, 208.5], [-84.5, 208.5]],
}

js = (
    "import('./shared/omnibusLines.ts').then(m => console.log(JSON.stringify({"
    "lines: m.LINES.map(l => ({ id: l.id, board: l.board, colour: l.colour, buses: l.buses, route: l.route,"
    " path: Array.from(m.loopPath(l.route, 5).x).filter((_, i) => i % 8 === 0).map((x, i) => [x, m.loopPath(l.route, 5).z[i * 8]]),"
    " timing: m.lineTiming(l.id) })), stops: m.STOPS })))"
)
net = json.loads(subprocess.check_output(["node", "-e", js], cwd=ROOT, text=True))
city = json.load(open(os.path.join(ROOT, "shared", "city.json"), encoding="utf-8"))
walk = Image.open(os.path.join(ROOT, "client", "public", "city", "walk.png")).convert("RGB")

X0, Z0, RES = -480, -80, 0.5
# the town inside the wall, and a margin
XA, XB, ZA, ZB = -380, 250, -60, 370
K = 2.4  # pixels a metre
W, H = int((ZB - ZA) * K), int((XB - XA) * K)


def P(x, z):
    return ((z - ZA) * K, (XB - x) * K)


# the ground: walls dark, water blue, outside grey, streets pale
px = walk.load()
bg = Image.new("RGB", (W, H), (236, 232, 222))
bp = bg.load()
for j in range(H):
    x = XB - j / K
    r = int((x - X0) / RES)
    for i in range(W):
        z = ZA + i / K
        c = int((z - Z0) / RES)
        if 0 <= r < walk.height and 0 <= c < walk.width:
            R, G, B = px[c, r]
            if G > 0:
                bp[i, j] = (170, 196, 220)
            elif R > 0:
                bp[i, j] = (122, 112, 102)
            elif B > 0:
                bp[i, j] = (206, 204, 198)
d = ImageDraw.Draw(bg, "RGBA")
try:
    font = ImageFont.truetype("arial.ttf", 13)
    small = ImageFont.truetype("arial.ttf", 11)
    big = ImageFont.truetype("arialbd.ttf", 18)
except OSError:
    font = small = big = ImageFont.load_default()

# the rounds before M7
for pts in OLD.values():
    q = [P(x, z) for x, z in pts] + [P(*pts[0])]
    for a, b in zip(q, q[1:]):
        # dashed
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        n = max(1, int(L / 8))
        for k in range(0, n, 2):
            t0, t1 = k / n, min(1, (k + 1) / n)
            d.line([(a[0] + (b[0] - a[0]) * t0, a[1] + (b[1] - a[1]) * t0), (a[0] + (b[0] - a[0]) * t1, a[1] + (b[1] - a[1]) * t1)], fill=(40, 40, 40, 200), width=2)

# the rounds now, offset a little per line where they share a street, with arrows
for li, l in enumerate(net["lines"]):
    col = tuple(int(min(255, v * 330)) for v in l["colour"]) + (230,)
    path = l["path"]
    q = [P(x, z) for x, z in path]
    d.line(q + [q[0]], fill=col, width=5, joint="curve")
    for i in range(0, len(q) - 1, 18):
        (ax, ay), (bx, by) = q[i], q[i + 1]
        a = math.atan2(by - ay, bx - ax)
        tip = (bx, by)
        d.polygon([tip, (bx - 9 * math.cos(a - 0.5), by - 9 * math.sin(a - 0.5)), (bx - 9 * math.cos(a + 0.5), by - 9 * math.sin(a + 0.5))], fill=col[:3] + (255,))

# the stops: a dot on the post, the name once per stop
named = set()
for s in net["stops"]:
    l = next(l for l in net["lines"] if l["id"] == s["line"])
    col = tuple(int(min(255, v * 330)) for v in l["colour"])
    x, y = P(s["post"][0], s["post"][1])
    d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=(255, 255, 255), outline=col, width=3)
    if s["id"] in named:
        continue
    named.add(s["id"])
    label = s["name"].replace("the ", "")
    d.text((x + 7, y - 7), label, fill=(20, 20, 20), font=font, stroke_width=2, stroke_fill=(255, 255, 255))

# the places the lead asked for: gates, churches, the park
for name, p in city["places"].items():
    if p["kind"] in ("gate", "building", "square", "rampart") and name not in ("Entrepot",):
        x, y = P(p["x"], p["z"])
        d.rectangle([x - 3, y - 3, x + 3, y + 3], fill=(120, 30, 120))
        d.text((x + 5, y + 2), name, fill=(110, 20, 110), font=small, stroke_width=2, stroke_fill=(255, 255, 255))

# the key
y = 12
d.rectangle([8, 6, 360, 16 + 22 * (len(net["lines"]) + 2)], fill=(255, 255, 255, 225), outline=(60, 60, 60))
d.text((16, y), "Scheldemist 1873: the omnibus lines (M7)", fill=(0, 0, 0), font=big)
y += 26
for l in net["lines"]:
    col = tuple(int(min(255, v * 330)) for v in l["colour"])
    t = l["timing"]
    d.line([(16, y + 8), (46, y + 8)], fill=col, width=5)
    d.text((54, y), f"{l['board']}: {l['buses']} omnibus{'es' if l['buses'] > 1 else ''}, {t['length']} m, every {t['headwayMin']} min", fill=(0, 0, 0), font=font)
    y += 22
d.line([(16, y + 8), (46, y + 8)], fill=(40, 40, 40), width=2)
d.text((54, y), "dashed: the rounds before M7", fill=(0, 0, 0), font=font)

os.makedirs(os.path.dirname(OUT), exist_ok=True)
bg.save(OUT)
print(OUT, bg.size)
