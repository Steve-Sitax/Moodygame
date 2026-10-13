"""The clips: gaits from footfall tables, and the actions of each species.

A gait (walk, trot, run) is one stride cycle: each foot touches down at its phase, stays put on the ground for the
duty factor of the cycle while the body passes over it (in the clip's frame the toe sweeps back at exactly the speed
the game moves the animal at one stride per cycle, so on the street it stands still), then swings forward lifted
and folded. The heel rolls up over the toes before it leaves. The body's height is not drawn by hand: at every
sample it is the highest the standing legs can reach, smoothed round the cycle into the wave the legs give the body
(the horse's rule, Movers/Horses.cs), and the spine, neck, head, ears and tail move with the footfalls.

Gait timings from life (Froude-scaled by shoulder height): a lateral-sequence walk (left hind, left fore, right hind,
right fore) with the feet down 62 % of the cycle; a diagonal trot, 42 %; a rotary gallop (hinds close together,
then the fores) with the feet down under 30 % and the spine flexing and stretching. The pig walks and trots the
same and canters for its run.

Actions are posed by angles and IK targets and loop on their first frame; the one-off flourishes (scratch, shake,
bark, beg, stretch, groom, nod) start and end on their base pose (stand or sit), so the game can play one through
and fade back.
"""

import math

import numpy as np

from .anatomy import LEGS, TAIL
from .pose import Pose, Rx, bump, smooth, unit


# ---------------------------------------------------------------- gait tables

class Gait:
    def __init__(self, name, stride, secs, duty, ph, lift, heel, curl, flex, girdle, zshift, bob=0.0):
        self.name, self.stride, self.secs, self.duty, self.ph = name, stride, secs, duty, ph
        self.lift, self.heel, self.curl, self.flex, self.girdle, self.zshift, self.bob = lift, heel, curl, flex, girdle, zshift, bob

    @property
    def speed(self):
        return self.stride / self.secs


WALK_PH = dict(HL=0.0, FL=0.25, HR=0.5, FR=0.75)
TROT_PH = dict(HL=0.0, FR=0.0, HR=0.5, FL=0.5)
GALLOP_PH = dict(HL=0.0, HR=0.11, FR=0.40, FL=0.52)
CANTER_PH = dict(HR=0.0, HL=0.2, FR=0.2, FL=0.45)


def gaits(R):
    H = R.H
    k = math.sqrt(H / 0.5)
    if R.sp == "dog":
        return {
            "walk": Gait("walk", 1.15 * H, 0.64 * k, 0.64, WALK_PH, dict(F=0.10 * H, H=0.085 * H), dict(F=34, H=38),
                         dict(F=78, H=55), dict(F=92, H=36), 20.0, dict(F=-0.02 * H, H=0.01 * H)),
            "trot": Gait("trot", 1.85 * H, 0.46 * k, 0.42, TROT_PH, dict(F=0.15 * H, H=0.13 * H), dict(F=44, H=48),
                         dict(F=92, H=62), dict(F=108, H=44), 24.0, dict(F=0.0, H=0.03 * H)),
            "run": Gait("run", 2.7 * H, 0.38 * k, 0.28, GALLOP_PH, dict(F=0.20 * H, H=0.18 * H), dict(F=55, H=58),
                        dict(F=110, H=75), dict(F=120, H=55), 30.0, dict(F=0.08 * H, H=0.08 * H)),
        }
    if R.sp == "cat":
        return {
            "walk": Gait("walk", 1.15 * H, 0.66, 0.64, WALK_PH, dict(F=0.11 * H, H=0.10 * H), dict(F=30, H=36),
                         dict(F=70, H=50), dict(F=85, H=34), 20.0, dict(F=-0.02 * H, H=0.01 * H)),
            "trot": Gait("trot", 2.0 * H, 0.40, 0.44, TROT_PH, dict(F=0.15 * H, H=0.14 * H), dict(F=42, H=46),
                         dict(F=88, H=60), dict(F=100, H=42), 24.0, dict(F=0.0, H=0.03 * H)),
            "run": Gait("run", 2.9 * H, 0.26, 0.27, GALLOP_PH, dict(F=0.22 * H, H=0.2 * H), dict(F=55, H=60),
                        dict(F=110, H=75), dict(F=120, H=55), 30.0, dict(F=0.08 * H, H=0.08 * H)),
        }
    return {  # the pig
        "walk": Gait("walk", 1.0 * H, 0.85, 0.64, WALK_PH, dict(F=0.07 * H, H=0.065 * H), dict(F=26, H=30),
                     dict(F=55, H=40), dict(F=70, H=28), 14.0, dict(F=-0.01 * H, H=0.01 * H)),
        "trot": Gait("trot", 1.38 * H, 0.55, 0.45, TROT_PH, dict(F=0.10 * H, H=0.09 * H), dict(F=36, H=40),
                     dict(F=70, H=50), dict(F=85, H=36), 18.0, dict(F=0.0, H=0.02 * H)),
        "run": Gait("run", 1.9 * H, 0.45, 0.34, CANTER_PH, dict(F=0.13 * H, H=0.12 * H), dict(F=45, H=48),
                    dict(F=85, H=60), dict(F=95, H=45), 22.0, dict(F=0.04 * H, H=0.04 * H)),
    }


def leg_state(R, g, key, t):
    """Where foot `key` is at cycle phase t: (toe, paw, low, girdle, stance u or None)."""
    s = (t - g.ph[key]) % 1.0
    beta = g.duty
    S = beta * g.stride
    fr = key[0]
    rest = R.toe_rest(key)
    z0 = rest[2] + g.zshift[fr]
    x0 = rest[0]
    heel, curl, flex = g.heel[fr], g.curl[fr], g.flex[fr]
    if s < beta:
        u = s / beta
        z = z0 + S / 2 - S * u
        paw = heel * smooth((u - 0.66) / 0.34)
        if fr == "F":
            low = -6.0 * math.sin(math.pi * u)
            gird = -g.girdle * (0.5 - u)
        else:
            low = 6.0 - 20.0 * u
            gird = 0.0
        return np.array((x0, 0.0, z)), paw, low, gird, u
    q = (s - beta) / (1.0 - beta)
    z = z0 - S / 2 + S * smooth(q)
    y = g.lift[fr] * bump(q, 0.42)
    if fr == "F":
        paw = heel + (curl - heel) * smooth(q / 0.35) if q < 0.35 else curl + (-6.0 - curl) * smooth((q - 0.35) / 0.53)
        if q > 0.88:
            paw = -6.0 * (1 - smooth((q - 0.88) / 0.12))
        low = flex * bump(q, 0.38)
        gird = g.girdle * (0.5 - smooth(q))
    else:
        paw = heel + (curl - heel) * smooth(q / 0.3) if q < 0.3 else curl * (1 - smooth((q - 0.3) / 0.6))
        low = -14.0 + (flex + 14.0) * smooth(q / 0.5) if q < 0.5 else flex + (6.0 - flex) * smooth((q - 0.5) / 0.5)
        gird = 0.0
    return np.array((x0, y, z)), paw, low, gird, None


# ---------------------------------------------------------------- gait baking with the body wave

def gait_pose(R, g, t, design, dy):
    ps = Pose(R)
    b = design(t)
    root = np.asarray(b.pop("root", (0, 0, 0)), float) + np.array((0, dy, 0))
    hips = b.pop("hips", (0, 0, 0))
    ps.body(root=root, hips=hips, **b)
    stance_miss = 0.0
    for key in ("FL", "FR", "HL", "HR"):
        toe, paw, low, gird, u = leg_state(R, g, key, t)
        ps.leg(key, toe, paw=paw, low=low, girdle=gird, reach=0.965)
        if u is not None:
            stance_miss = max(stance_miss, ps.misses[key], ps.strain[key])
    return ps, stance_miss


def bake_gait(R, g, design, n=48):
    """The poses of one cycle (n samples) with the body at the height the standing legs allow, smoothed."""
    ts = [i / n for i in range(n)]
    top = np.zeros(n)
    for i, t in enumerate(ts):
        ps, m = gait_pose(R, g, t, design, 0.0)
        if m < 1e-6:
            top[i] = 0.0
            continue
        lo, hi = -0.45 * R.H, 0.0
        for _ in range(30):
            mid = (lo + hi) / 2
            if gait_pose(R, g, t, design, mid)[1] < 1e-6:
                lo = mid
            else:
                hi = mid
        top[i] = lo
    # the wave: a cyclic moving minimum, blurred twice, never above what the legs reach
    w = max(1, n // 10)
    low = np.array([min(top[(i + d) % n] for d in range(-w, w + 1)) for i in range(n)])

    def blur(a, r):
        return np.array([np.mean([a[(i + d) % n] for d in range(-r, r + 1)]) for i in range(n)])
    wave = blur(blur(low, max(1, w // 2)), max(1, w // 2))
    dy = np.minimum(wave, top) + g.bob
    poses = []
    worst = 0.0
    for i, t in enumerate(ts):
        ps, m = gait_pose(R, g, t, design, float(min(dy[i], top[i])))
        worst = max(worst, m)
        poses.append(ps)
    return poses, dict(stance_miss_mm=round(worst * 1000, 3), drop_mm=round(-float(dy.min()) * 1000, 1),
                       wave_mm=round(float(dy.max() - dy.min()) * 1000, 1))


# ---------------------------------------------------------------- shared bits of motion

def tail_curve(R, base=None, yaw=0.0, wag=0.0, phase=0.0, t=0.0, lift=0.0, freq=1.0):
    """Local angles for the five tail bones: a carriage lift (degrees, + raises the tail, - drops it), a wag
    travelling to the tip."""
    out = {}
    for i, b in enumerate(TAIL):
        w = wag * (0.35 + 0.65 * i / 4) * math.sin(2 * math.pi * (freq * t + phase) - 0.55 * i)
        out[b] = ((lift if i == 0 else lift * 0.25), yaw * (1 if i == 0 else 0.3) + w, 0.0)
    return out


def ears(p=0.0, y=0.0, r=0.0, p2=0.0):
    return {"earL": (p, y, r), "earR": (p, -y, -r), "ear2L": (p2, 0, 0), "ear2R": (p2, 0, 0)}


def flick(t, at, width=0.04):
    d = (t - at) % 1.0
    return bump(d / width, 0.3) if d < width else 0.0


# ---------------------------------------------------------------- the gaits' body motion, per species

def design_walk(R, g):
    dog, cat, pig = R.sp == "dog", R.sp == "cat", R.sp == "pig"

    def f(t):
        p = 2 * math.pi * t
        roll = 2.5 * math.sin(p + 0.3)
        b = dict(hips=(0.6 * math.sin(2 * p), 2.2 * math.sin(p), roll),
                 spine=(0, -1.0 * math.sin(p), -roll * 0.4), chest=(0, -1.4 * math.sin(p), -roll * 0.5),
                 neck=(-3 + 2.0 * math.sin(2 * p + 1.0), 1.2 * math.sin(p), 0),
                 neck2=(0, 0.8 * math.sin(p), 0), head=(1.5 - 2.0 * math.sin(2 * p + 1.0), 0, -1.0 * math.sin(p)),
                 jaw=(0, 0, 0))
        b.update(ears(-4 * math.sin(2 * p + 1.6), 0, 0, 4 * math.sin(2 * p + 2.2)))
        if dog:
            b.update(tail_curve(R, wag=14, t=t, lift=6, freq=1.0))
        elif cat:
            b.update(tail_curve(R, wag=5, t=t, lift=18, freq=1.0, phase=0.2))
        else:
            b.update(tail_curve(R, wag=10, t=t, lift=0, freq=2.0))
        return b
    return f


def design_trot(R, g):
    def f(t):
        p = 2 * math.pi * t
        b = dict(hips=(0.8 * math.sin(2 * p + 0.5), 1.2 * math.sin(p), 1.2 * math.sin(p)),
                 spine=(0, -0.6 * math.sin(p), 0), chest=(0, -0.8 * math.sin(p), -0.8 * math.sin(p)),
                 neck=(-6 + 1.6 * math.sin(2 * p + 1.4), 0, 0), neck2=(0, 0, 0),
                 head=(4 - 1.8 * math.sin(2 * p + 1.4), 0, 0))
        b.update(ears(-6 * math.sin(2 * p + 2.0), 0, 0, 7 * math.sin(2 * p + 2.6)))
        b.update(tail_curve(R, wag=8 if R.sp == "dog" else 4, t=t, lift=10 if R.sp != "pig" else 0, freq=1.0))
        return b
    return f


def design_run(R, g):
    def f(t):
        # +1 gathered (spine arched, hinds under), -1 stretched
        c = math.cos(2 * math.pi * (t - 0.08))
        k = 1.0 if R.sp != "pig" else 0.4
        b = dict(root=(0, 0, 0.012 * R.H * c), hips=(-9 * c * k, 0, 0), spine=(7 * c * k, 0, 0), chest=(5 * c * k, 0, 0),
                 neck=(-14 - 6 * c, 0, 0), neck2=(0, 0, 0), head=(10 + 4 * c, 0, 0))
        b.update(ears(-12 - 6 * c, 0, 0, 10))
        b.update(tail_curve(R, wag=0, lift=(16 + 8 * c) if R.sp != "pig" else 0, t=t))
        return b
    return f


# ---------------------------------------------------------------- the actions

def stand_legs(ps, R, spread=0.0, front_dz=0.0, hind_dz=0.0, side=None):
    for key in ("FL", "FR", "HL", "HR"):
        toe = R.toe_rest(key)
        toe[0] *= 1 + spread
        toe[2] += front_dz if key[0] == "F" else hind_dz
        ps.leg(key, toe, side=side)


def idle(R, kind="dog"):
    def fn(ps, t, c):
        p = 2 * math.pi * t
        br = math.sin(5 * p)  # breathing, five breaths a loop
        look = 22 * math.sin(p) * math.sin(0.5 * p) ** 2 - 8 * math.sin(2 * p) * math.cos(p) ** 2
        ps.body(root=(0.006 * R.H * math.sin(p), 0.003 * R.H * br, 0), hips=(0.4 * math.sin(p), 0, 0.8 * math.sin(p)),
                spine=(0.3 * br, 0, 0), chest=(0.6 * br, 0, -0.6 * math.sin(p)),
                neck=(-2 + 3 * math.sin(p + 1), look * 0.35, 0), neck2=(0, look * 0.3, 0),
                head=(2 * math.sin(3 * p), look * 0.35, 3 * math.sin(2 * p) * math.sin(0.5 * p)),
                **ears(-6 * flick(t, 0.3, 0.05), 10 * flick(t, 0.62, 0.05), 0, 0),
                **tail_curve(R, wag=20 if R.sp == "dog" else 9, t=t, lift=6 if R.sp == "dog" else 20, freq=3.0 if R.sp == "dog" else 1.0))
        stand_legs(ps, R)
    return fn, 5.0, "pose", "stand"


def sniff(R):
    """Nose to the ground ahead of the forepaws, working from side to side; the chest lowered on bent forelegs and
    the neck reaching forward and down (the pig roots, pushing into the ground)."""
    def pose(ps, t, a, h, low=0.09):
        p = 2 * math.pi * t
        jit = 3 * math.sin(2 * math.pi * 9 * t) * (0.5 + 0.5 * math.sin(2 * p))
        sway = 14 * math.sin(p)
        ps.body(root=(0, -low * R.H, 0.0), hips=(-4 + 50 * (low - 0.09), 0, 0), spine=(6, 0, 0), chest=(14 + 60 * (low - 0.09), 0, 0),
                neck=(a, sway * 0.6, 0), neck2=(a * 0.35, sway * 0.4, 0), head=(h + jit, -sway * 0.3, 0),
                jaw=(0, 0, 0), **ears(-8, 0, 0, 0), **tail_curve(R, wag=18 if R.sp == "dog" else 4, t=t, lift=10, freq=3))

    def fn(ps, t, c):
        if "a" not in c:
            # the neck angle that puts the nose furthest ahead while the head, pitched down, reaches the ground;
            # the forequarters lower (the forelegs bend) only as far as that needs
            want = 0.025 * R.H if R.sp != "pig" else 0.004
            toe = R.toe_rest("FL")[2]
            best = None
            for low in (0.09, 0.14, 0.19, 0.24, 0.29):
                best = search(low, want, toe)
                if best:
                    c["low"] = low
                    break
            c["a"], c["h"] = (best[2], best[3]) if best else (60, 40)
        pose(ps, t, c["a"], c["h"] + (4 * math.sin(2 * math.pi * 2 * t) if R.sp == "pig" else 0), c.get("low", 0.09))
        stand_legs(ps, R, front_dz=-0.02 * R.H, hind_dz=0.02 * R.H)

    def search(low, want, toe):
        cands = []
        for a in range(0, 136, 4):
            if True:
                lo, hi = -100.0, 80.0
                q = None
                for _ in range(24):
                    mid = (lo + hi) / 2
                    q = Pose(R)
                    pose(q, 0.0, a, mid, low)
                    if q.point("head", R.J["nose"])[1] > want:
                        lo = mid
                    else:
                        hi = mid
                    nose = q.point("head", R.J["nose"])
                if abs(nose[1] - want) > 0.01 * R.H:
                    continue
                hd = q.A["head"] @ (R.tail0["head"] - R.head0["head"])
                down = math.degrees(math.atan2(-hd[1], hd[2]))
                cands.append((nose[2] - toe, down, a, (lo + hi) / 2))
        # the nose furthest ahead with the head pitched 45-92 degrees down
        ok = [cd for cd in cands if 45 < cd[1] < 92 and cd[0] > 0.02 * R.H]
        return max(ok) if ok else None
    return fn, 3.0, "pose", "stand"


def ground_parts():
    return {"torso", "belly", "chest", "thigh", "shoulder", "arm", "ruff", "throat", "neck"}


def sit_body(R, ps, t, c, **over):
    p = 2 * math.pi * t
    br = math.sin(4 * p)
    dog, cat, pig = R.sp == "dog", R.sp == "cat", R.sp == "pig"
    hp = c.get("hp", -38 if dog else -44 if cat else -32)
    look = 24 * math.sin(p) * math.sin(0.5 * p) ** 2
    b = dict(hips=(hp, 0, 0), spine=(-6 + 0.3 * br, 0, 0), chest=(-4 + 0.6 * br, 0, 0),
             neck=(26 if not cat else 36, look * 0.4, 0), neck2=(8, look * 0.3, 0), head=(-hp - 30 + 2 * math.sin(3 * p), look * 0.3, 0))
    b.update(ears(-6 * flick(t, 0.4, 0.06), 8 * flick(t, 0.75, 0.05), 0, 0))
    # the tail on the ground behind (cats: round the feet)
    if cat:
        b.update({bn: v for bn, v in zip(TAIL, [(-58, 0, 0), (-30, 38, 0), (0, 40, 0), (0, 38, 0), (0, 34 + 6 * math.sin(2 * p), 0)])})
    elif dog:
        b.update(tail_curve(R, lift=-hp * 0.45 - 30, wag=6, t=t, freq=2))
    else:
        b.update(tail_curve(R, lift=-hp * 0.5 - 20, wag=8, t=t, freq=2))
    b.update(over)
    hips = b.pop("hips")
    ps.body(root=(0, c.get("dy", 0.0), c.get("dz", 0.0)), hips=hips, **b)


def sit_legs(R, ps, skip=()):
    H = R.H
    cat = R.sp == "cat"
    for S_ in "LR":
        if "F" + S_ not in skip:
            sh = ps.girdle_top("F" + S_)
            toe = R.toe_rest("F" + S_)
            ps.leg("F" + S_, np.array((toe[0], 0.0, sh[2] + (0.09 if not cat else 0.06) * H)))
        if "H" + S_ not in skip:
            hip = ps.girdle_top("H" + S_)
            ht = R.toe_rest("H" + S_)
            ps.leg("H" + S_, np.array((ht[0] * 1.15, 0.0, hip[2] + 0.36 * H)), low=-72, paw=0, out=10)


def sit(R):
    def fn(ps, t, c):
        sit_body(R, ps, t, c)
        sit_legs(R, ps)
    return fn, 4.0, "settle", "sit"


def lie(R):
    def fn(ps, t, c):
        p = 2 * math.pi * t
        br = math.sin(3 * p)
        cat, pig = R.sp == "cat", R.sp == "pig"
        H = R.H
        look = 18 * math.sin(p) * math.sin(0.5 * p) ** 2
        ps.body(root=(0, c.get("dy", 0.0), 0), hips=(2, 0, 0), spine=(0.4 * br, 0, 0), chest=(0.8 * br - 2, 0, 0),
                neck=(10 if not cat else 18, look * 0.4, 0), neck2=(0, look * 0.3, 0), head=(-6 if not pig else 10, look * 0.3, 0),
                **ears(-8, 0, 0, 0),
                **tail_curve(R, lift=-40, yaw=25 if cat else 15, wag=3, t=t))
        for S_ in "LR":
            if cat:
                # the loaf: forepaws tucked under the chest
                sh = ps.girdle_top("F" + S_)
                ft = R.toe_rest("F" + S_)
                ps.leg("F" + S_, np.array((ft[0] * 0.9, 0.0, sh[2] + 0.02 * H)), low=-88, paw=-60)
            else:
                ps.front_flat("F" + S_, elbow_y=0.045 * H)
            hip = ps.girdle_top("H" + S_)
            ht = R.toe_rest("H" + S_)
            ps.leg("H" + S_, np.array((ht[0] * 1.5, 0.0, hip[2] + 0.30 * H)), low=-80, paw=0, out=24 if not cat else 14)
    return fn, 5.0, "settle", "lie"


def sleep(R):
    """Curled on the side (dogs, cats), flat out on the side (the pig)."""
    def fn(ps, t, c):
        p = 2 * math.pi * t
        br = math.sin(2 * p)
        pig = R.sp == "pig"
        cu = 0.0 if pig else 1.0
        # on the left side; the curl is the spine flexing (pitch), the head round to the hind legs, the tail round the nose
        ps.body(root=(0.0, c.get("dy", 0.0), 0), hips=(-8 * cu, 0, -80), spine=(30 * cu, 0, 0), chest=(26 * cu + 0.6 * br, 0, 0),
                neck=(10 if pig else 36, 0, 0), neck2=(0 if pig else 30, 0, 0), head=(-8 if pig else 32, 0, -10 * cu),
                **ears(-10, 0, 0, 0),
                **{b: (-40 * cu, 0, 0) for b in TAIL})
        # the legs folded beside the body (fk)
        if pig:
            fk = {"humerus": (-30, 0, 0), "forearm": (18, 0, 0), "pastern": (-10, 0, 0), "thigh": (28, 0, 0), "shin": (-10, 0, 0), "meta": (10, 0, 0)}
        else:
            fk = {"scapula": (-10, 0, 0), "humerus": (-30, 0, 0), "forearm": (80, 0, 0), "pastern": (-30, 0, 0), "fpaw": (20, 0, 0),
                  "thigh": (-75, 0, 0), "shin": (95, 0, 0), "meta": (-50, 0, 0), "hpaw": (15, 0, 0)}
        loc = {}
        for S_ in "LR":
            for b, a in fk.items():
                loc[b + S_] = a
        ps.set(**loc)
    return fn, 6.0, "settle", "lie"


# ---------------------------------------------------------------- flourishes

def scratch(R):
    """Sitting, a hind foot scratches behind the ear, the head bent to meet it."""
    def fn(ps, t, c):
        env = smooth(t / 0.15) * (1 - smooth((t - 0.82) / 0.18))
        sit_body(R, ps, 0.0, c, hips=(c.get("hp", -38), 0, -8 * env), neck=(40 * env + 26 * (1 - env), 30 * env, -26 * env),
                 neck2=(14 * env, 12 * env, -10 * env), head=(8 - 4 * env, 10 * env, -24 * env), **ears(-8 * env, 0, 0, 0))
        sit_legs(R, ps, skip=("HL",))
        H = R.H
        ear = ps.point("neck2", R.J["neck2"]) + np.array((0.1 * H, -0.02 * H, -0.02 * H))
        hip = ps.girdle_top("HL")
        reach = 0.72 * (R.len["thighL"] + R.len["shinL"] + R.len["metaL"])
        d = ear - hip
        target = hip + d / np.linalg.norm(d) * min(np.linalg.norm(d), reach)
        sc = math.sin(2 * math.pi * 7.0 * t)
        target = target + np.array((0, 0.03 * H, -0.035 * H)) * sc
        ht = R.toe_rest("HL")
        folded = np.array((ht[0] * 1.15, 0.0, hip[2] + 0.36 * H))
        toe = folded + (target - folded) * env
        ps.leg("HL", toe, low=-72 + 82 * env, paw=30 * env, out=10 + 34 * env, pole_out=0.8 * env)
    return fn, 2.6, "settle", "sit"


def shake(R):
    """Standing, the wet-dog shake: a roll that runs from the head down the body to the tail."""
    def fn(ps, t, c):
        env = smooth(t / 0.12) * (1 - smooth((t - 0.7) / 0.3))
        w = 2 * math.pi * 5.5 * t
        a = 40 * env
        ps.body(root=(0, -0.07 * R.H * env, 0), hips=(0, 0, 0.12 * a * math.sin(w - 1.4)), spine=(0, 0, 0.35 * a * math.sin(w - 0.9)),
                chest=(0, 0, 0.5 * a * math.sin(w - 0.5)), neck=(-4 * env, 0, 0.6 * a * math.sin(w - 0.2)),
                neck2=(0, 0, 0.4 * a * math.sin(w)), head=(0, 0, 0.6 * a * math.sin(w + 0.2)),
                **ears(-20 * env, 0, 35 * env * math.sin(w + 1.0), 30 * env * math.sin(w + 1.3)),
                **tail_curve(R, wag=40 * env, lift=6, t=t, freq=5.5, phase=-0.3))
        stand_legs(ps, R, spread=0.25 * env)
    return fn, 1.8, "pose", "stand"


def bark(R):
    """Standing, braced, three barks: the head thrown up and forward, the jaw open, the chest heaving."""
    def fn(ps, t, c):
        s = 0.0
        for at in (0.18, 0.42, 0.62):
            d = t - at
            s = max(s, bump(d / 0.14, 0.25) if 0 <= d < 0.14 else 0.0)
        env = smooth(t / 0.1) * (1 - smooth((t - 0.85) / 0.15))
        ps.body(root=(0, -0.01 * R.H * env, -0.01 * R.H * s), hips=(1 * env, 0, 0), chest=(-2 * s, 0, 0),
                neck=(-10 * env - 8 * s, 0, 0), neck2=(-4 * s, 0, 0), head=(6 * env - 6 * s, 0, 0), jaw=(-26 * s, 0, 0),
                **ears(-14 * env, -6 * env, 0, 0), **tail_curve(R, lift=14 * env + 6, wag=10 * env, t=t, freq=4))
        stand_legs(ps, R, front_dz=0.04 * R.H * env, spread=0.06 * env)
    return fn, 1.8, "pose", "stand"


def beg(R):
    """From the sit up onto the haunches, the forepaws held up and bent."""
    def fn(ps, t, c):
        env = smooth(t / 0.22) * (1 - smooth((t - 0.78) / 0.22))
        sway = 2.5 * math.sin(2 * math.pi * 1.5 * t) * env
        hp = c.get("hp", -38)
        c2 = dict(c)
        c2["dy"] = c.get("dy", 0.0) - 0.07 * R.H * env
        c2["dz"] = -0.05 * R.H * env
        sit_body(R, ps, 0.0, c2, hips=(hp - 16 * env, 0, sway), spine=(-6 - 8 * env, 0, 0), chest=(-4 - 4 * env, 0, 0),
                 neck=(26 + 8 * env, 0, 0), head=(-hp - 30 - 10 * env, 0, 0), **ears(-6 * env, 0, 0, 0))
        H = R.H
        sit_legs(R, ps, skip=("FL", "FR"))
        for S_ in "LR":
            sh = ps.girdle_top("F" + S_)
            ft = R.toe_rest("F" + S_)
            ground = np.array((ft[0], 0.0, sh[2] + 0.09 * H))
            up = sh + np.array((0, -0.24 * H, 0.14 * H))
            ps.leg("F" + S_, ground + (up - ground) * env, low=100 * env, paw=70 * env)
    return fn, 3.0, "settle", "sit"


def stretch(R):
    """The cat's stretch: forelegs out and chest down, the rump up; then a stand."""
    def fn(ps, t, c):
        env = smooth(t / 0.3) * (1 - smooth((t - 0.7) / 0.3))
        H = R.H
        ps.body(root=(0, -0.10 * H * env, -0.10 * H * env), hips=(14 * env, 0, 0), spine=(8 * env, 0, 0), chest=(8 * env, 0, 0),
                neck=(-14 * env, 0, 0), head=(-8 * env, 0, 0), jaw=(-18 * bump((t - 0.35) / 0.3) if 0.35 < t < 0.65 else 0, 0, 0),
                **ears(-20 * env, 0, 0, 0), **tail_curve(R, lift=40 * env + 20 * (1 - env), wag=0, t=t))
        for key in ("FL", "FR", "HL", "HR"):
            toe = R.toe_rest(key)
            if key[0] == "F":
                toe[2] += 0.30 * H * env
                ps.leg(key, toe, low=-70 * env, paw=0)
            else:
                ps.leg(key, toe, low=-10 * env)
    return fn, 3.0, "pose", "stand"


def groom(R):
    """The cat sits and licks a forepaw, then wipes its face with it."""
    def fn(ps, t, c):
        env = smooth(t / 0.18) * (1 - smooth((t - 0.82) / 0.18))
        lick = math.sin(2 * math.pi * 4 * t)
        sit_body(R, ps, 0.0, c, neck=(36 + 18 * env, -10 * env, 0), head=(-6 + 22 * env + 4 * lick * env, -12 * env, 10 * env),
                 jaw=(-10 * env * max(0.0, lick), 0, 0))
        sit_legs(R, ps, skip=("FL",))
        H = R.H
        mouth = ps.point("head", R.J["chin"])
        sh = ps.girdle_top("FL")
        ft = R.toe_rest("FL")
        ground = np.array((ft[0], 0.0, sh[2] + 0.06 * H))
        up = mouth + np.array((0.0, -0.06 * H, 0.02 * H))
        ps.leg("FL", ground + (up - ground) * env, low=110 * env, paw=60 * env, out=12 * env)
    return fn, 3.0, "settle", "sit"


def nod(R):
    """The pig's grunt: two nods of the head, the snout twitching."""
    def fn(ps, t, c):
        n = 0.0
        for at in (0.15, 0.5):
            d = t - at
            n = max(n, bump(d / 0.22, 0.4) if 0 <= d < 0.22 else 0.0)
        ps.body(hips=(0, 0, 0), chest=(-1.5 * n, 0, 0), neck=(-4 + 10 * n, 0, 0), head=(16 * n, 0, 0), jaw=(-8 * n, 0, 0),
                **ears(8 * n, 0, 0, 6 * n), **tail_curve(R, wag=14, t=t, lift=0, freq=4))
        stand_legs(ps, R)
    return fn, 2.0, "pose", "stand"


def wallow(R):
    """On its side in the mud, rolling a little each way, the legs paddling."""
    sl, _, _, _ = sleep(R)

    def fn(ps, t, c):
        sl(ps, 0.0, c)
        p = 2 * math.pi * t
        roll = -78 + 22 * math.sin(p) + 8 * math.sin(3 * p)
        ps.set(hips=(0, 0, roll), neck=(10, 8 * math.sin(p + 0.6), 0), head=(-8 + 10 * math.sin(2 * p), 0, 0))
        loc = {}
        for S_, ph in (("L", 0.0), ("R", 0.5)):
            k = math.sin(p * 2 + ph * 6.28)
            loc.update({"humerus" + S_: (-30 + 18 * k, 0, 0), "forearm" + S_: (18 + 12 * k, 0, 0),
                        "thigh" + S_: (28 - 16 * k, 0, 0), "shin" + S_: (-10 + 10 * k, 0, 0)})
        ps.set(**loc)
    return fn, 5.0, "settle", "lie"


def clip_list(R):
    """(name, fn, secs, kind, base) for the rig; kinds: gait, pose (loops on its own), settle (resting on the
    ground: the bake finds the drop), once-flourishes end in their base."""
    sp = R.sp
    out = [("idle",) + idle(R), ("sniff",) + sniff(R), ("sit",) + sit(R), ("lie",) + lie(R), ("sleep",) + sleep(R)]
    if sp == "dog":
        out += [("scratch",) + scratch(R), ("shake",) + shake(R), ("bark",) + bark(R), ("beg",) + beg(R)]
    elif sp == "cat":
        out += [("stretch",) + stretch(R), ("groom",) + groom(R)]
    else:
        out += [("nod",) + nod(R), ("wallow",) + wallow(R)]
    return out


ONCE = {"scratch", "shake", "bark", "beg", "stretch", "groom", "nod"}


def bake_action(R, fn, secs, kind, verts=None, W=None, mask=None, fps=30, base="stand"):
    """Poses of an action at fps; `settle` actions first find the drop that puts the lowest point of the body on
    the ground (with the game's skinning)."""
    from .pose import skin
    c = {"dy": 0.0}
    info = {}
    if kind == "settle" and verts is not None:
        def settle():
            for _ in range(8):
                ps = Pose(R)
                fn(ps, 0.0, c)
                low = skin(ps, verts[mask], W[mask])[:, 1].min()
                if abs(low) < 2e-4:
                    break
                c["dy"] -= low
            return ps
        ps = settle()
        if base == "sit":
            # sit as upright as the forelegs allow: ease the hips' pitch until both forepaws stand on the ground
            hp = {"dog": -38, "cat": -44, "pig": -32}[R.sp]
            for _ in range(20):
                if max(ps.misses.get("FL", 0), ps.misses.get("FR", 0)) < 5e-4:
                    break
                hp += 2.0
                c["hp"] = hp
                ps = settle()
            info["hips_pitch"] = c.get("hp", hp)
        info["drop_mm"] = round(-c["dy"] * 1000, 1)
    n = max(2, int(round(secs * fps)))
    poses = []
    miss = 0.0
    for i in range(n):
        ps = Pose(R)
        fn(ps, i / n, c)
        miss = max(miss, ps.miss)
        poses.append(ps)
    info["ik_miss_mm"] = round(miss * 1000, 2)
    return poses, info
