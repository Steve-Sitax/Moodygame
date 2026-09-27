// The town map (docs/mapview.md): the page. Plain JS, no build, no library.
//
// World metres: x runs north along the Rijnkaai, z runs east (inland); the river is at z < 0. On the
// screen north is up and east is right. The town is drawn once into Path2D shapes (the static layer,
// redrawn only when the view moves); the things that move are drawn each frame from the feed (/feed,
// four snapshots a second), eased between snapshots over 250 ms.
"use strict";
(() => {
  // ------------------------------------------------------------------ small helpers

  const $ = (id) => document.getElementById(id);
  /** An element with text only: game text (names, personas, rumours) never goes in as HTML. */
  function h(tag, cls, ...kids) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    for (const k of kids) {
      if (k === null || k === undefined || k === false) continue;
      e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    }
    return e;
  }
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pad = (n) => String(n).padStart(2, "0");
  const ago = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    if (s < 60) return `${s} s ago`;
    if (s < 3600) return `${Math.floor(s / 60)} min ago`;
    return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
  };
  const store = {
    get(k, d) {
      try {
        const v = localStorage.getItem("townmap." + k);
        return v === null ? d : JSON.parse(v);
      } catch {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("townmap." + k, JSON.stringify(v));
      } catch {
        /* private window */
      }
    },
  };

  // ------------------------------------------------------------------ colours

  const C = {
    paper: "#efe3c6",
    street: "#ece0c2",
    fields: "#dfdcb2",
    grass: "#d3d6a2",
    earth: "#e2d1a6",
    quay: "#ddcfb0",
    flags: "#e8dbbd",
    water: "#b7c8c2",
    waterInk: "#8ea6a2",
    shore: "#4f6d73",
    house: "#d5b287",
    houseInk: "#6b4a2e",
    store: "#c3a27c",
    landmark: "#b3765a",
    rampart: "#c6ae86",
    rampartDark: "#a48a64",
    bridge: "#a7855f",
    ink: "#3a2a1a",
    ink2: "#6b5238",
    ink3: "#947a5a",
    tree: "#a2a974",
    treeInk: "#6d7450",
    live: "#2c5570",
    planned: "#8a7458",
    indoor: "#a8977e",
    dog: "#7b4a1e",
    cat: "#6f6a64",
    bus: "#6d3a6f",
    boat: "#2e6470",
    train: "#2f2a26",
    cart: "#8b5a2b",
    bridgeCat: "#a0522d",
    other: "#556b2f",
    event: "#8e2f1d",
    place: "#6b5238",
  };
  const PLAYER_COLOURS = ["#a3311f", "#2b62a0", "#3d7a3a", "#7a3d8a", "#c07a14", "#1f7f7f"];
  const playerColour = (id) => (id === 1 ? PLAYER_COLOURS[0] : PLAYER_COLOURS[1 + ((id - 2) % (PLAYER_COLOURS.length - 1))]);

  // ------------------------------------------------------------------ the categories

  const CATS = [
    { id: "players", label: "Players", colour: C.event, shape: "dot", on: true },
    { id: "live", label: "Townspeople, live", colour: C.live, shape: "dot", on: true },
    { id: "planned", label: "Townspeople, by day plan", colour: C.planned, shape: "ring", on: true },
    { id: "indoor", label: "Indoors, by day plan", colour: C.indoor, shape: "ring", on: false },
    { id: "dogs", label: "Dogs", colour: C.dog, shape: "dot", on: true },
    { id: "cats", label: "Cats (their doorsteps)", colour: C.cat, shape: "dot", on: false },
    { id: "buses", label: "Omnibuses", colour: C.bus, shape: "sq", on: true, sep: true },
    { id: "boats", label: "Boats and ships", colour: C.boat, shape: "sq", on: true },
    { id: "trains", label: "Train and cranes", colour: C.train, shape: "sq", on: true },
    { id: "carts", label: "Carts and drays", colour: C.cart, shape: "sq", on: true },
    { id: "bridges", label: "Bridges and lock", colour: C.bridgeCat, shape: "sq", on: true },
    { id: "other", label: "Other moving things", colour: C.other, shape: "sq", on: true },
    { id: "events", label: "Town events", colour: C.event, shape: "ring", on: true, sep: true },
    { id: "places", label: "Places", colour: C.place, shape: "sq", on: true },
    { id: "names", label: "Names on the map", colour: C.ink, shape: "sq", on: true },
    { id: "owners", label: "Owners overlay", colour: PLAYER_COLOURS[1], shape: "dot", on: false, sep: true },
    { id: "trails", label: "Trails", colour: C.ink2, shape: "sq", on: false },
  ];
  const saved = store.get("cats", {});
  const show = {};
  for (const c of CATS) show[c.id] = typeof saved[c.id] === "boolean" ? saved[c.id] : c.on;
  const counts = {};

  /** Which category a key of the moving world belongs to. */
  function worldCat(key) {
    const k = key.toLowerCase();
    if (/bridge|lock|sluice/.test(k)) return "bridges";
    if (/omni|bus|tram/.test(k)) return "buses";
    if (/dray|cart|wagon|carriage|coach|velo/.test(k)) return "carts";
    if (/train|rail|loco|crane|gate/.test(k)) return "trains";
    if (/boat|ship|barge|liner|lighter|steam|ferry|sail|river|punt|skiff|tug/.test(k)) return "boats";
    return "other";
  }
  const singular = (k) => k.replace(/ies$/, "y").replace(/([^s])s$/, "$1");

  // ------------------------------------------------------------------ state

  const canvas = $("map");
  const ctx = canvas.getContext("2d");
  const stat = document.createElement("canvas");
  const sctx = stat.getContext("2d");
  let W = 0;
  let H = 0;
  let DPR = 1;
  const view = { cx: 100, cz: 170, s: 1.2 }; // centre (world) and pixels a metre
  let staticKey = "";
  let city = null;
  let P = null; // the Path2D shapes
  let people = { key: null, byId: new Map(), residents: [], places: [], cats: [] };
  let snap = null;
  let snapAt = 0;
  const things = new Map(); // key -> { fx, fz, tx, tz, t0, yaw }
  const trails = new Map(); // key -> [[t, x, z]...] (the page's own, 2 minutes)
  let hits = [];
  let hover = null;
  const pins = [];
  let active = -1;
  let serverTrail = null; // { key, pts }

  // ------------------------------------------------------------------ the view

  function resize() {
    const r = canvas.getBoundingClientRect();
    DPR = window.devicePixelRatio || 1;
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    canvas.width = stat.width = Math.round(W * DPR);
    canvas.height = stat.height = Math.round(H * DPR);
    staticKey = "";
  }
  const toScreen = (x, z) => [W / 2 + (z - view.cz) * view.s, H / 2 - (x - view.cx) * view.s];
  const toWorld = (sx, sy) => [view.cx - (sy - H / 2) / view.s, view.cz + (sx - W / 2) / view.s];
  /** World (x, z) points drawn straight: x' = z * s + e, y' = -x * s + f. */
  function worldTransform(c) {
    const s = view.s * DPR;
    c.setTransform(0, -s, s, 0, (W / 2 - view.cz * view.s) * DPR, (H / 2 + view.cx * view.s) * DPR);
  }
  const screenTransform = (c) => c.setTransform(DPR, 0, 0, DPR, 0, 0);
  function fit() {
    if (!city) return;
    const t = city.town;
    view.cx = (t.x0 + t.x1) / 2;
    view.cz = (t.z0 + t.z1) / 2;
    view.s = clamp(Math.min(W / (t.z1 - t.z0), H / (t.x1 - t.x0)) * 0.96, 0.2, 40);
    for (const p of pins) p.follow = false;
    renderPins();
  }
  function zoomAt(f, sx, sy) {
    const [x, z] = toWorld(sx, sy);
    view.s = clamp(view.s * f, 0.25, 40);
    const [x2, z2] = toWorld(sx, sy);
    view.cx += x - x2;
    view.cz += z - z2;
  }

  // ------------------------------------------------------------------ the town's shapes (once)

  function ring(path, pts) {
    if (!pts || pts.length < 2) return;
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }
  function tris(path, flat) {
    for (let i = 0; i + 5 < flat.length; i += 6) {
      path.moveTo(flat[i], flat[i + 1]);
      path.lineTo(flat[i + 2], flat[i + 3]);
      path.lineTo(flat[i + 4], flat[i + 5]);
      path.closePath();
    }
  }
  function build(c) {
    const p = {};
    const mk = () => new Path2D();
    p.fields = mk();
    for (const f of c.fields) {
      ring(p.fields, f.outer);
      for (const hole of f.holes) ring(p.fields, hole);
    }
    p.water = mk();
    for (const w of c.water) {
      ring(p.water, w.outer);
      for (const hole of w.holes) ring(p.water, hole);
    }
    for (const k of ["grass", "earth", "quay", "flags"]) tris((p[k] = mk()), c.zones[k]);
    p.green = mk();
    for (const g of c.greens) ring(p.green, g);
    for (const g of c.alleys.gardens) ring(p.green, g);
    ring(p.green, c.park.outline);
    p.ponds = mk();
    for (const [x, z, r] of c.park.ponds) {
      p.ponds.moveTo(x + r, z);
      p.ponds.arc(x, z, r, 0, Math.PI * 2);
    }
    p.yards = mk();
    for (const y of c.alleys.yards) ring(p.yards, y);
    for (const y of c.alleys.courts) ring(p.yards, y);
    p.paths = mk();
    for (const l of c.park.paths) {
      if (l.length < 2) continue;
      p.paths.moveTo(l[0][0], l[0][1]);
      for (let i = 1; i < l.length; i++) p.paths.lineTo(l[i][0], l[i][1]);
    }
    p.houses = mk();
    p.stores = mk();
    for (const hs of c.houses) ring(hs.k === "w" ? p.stores : p.houses, hs.fp);
    p.landmarks = mk();
    for (const l of c.landmarks) ring(p.landmarks, l.fp);
    p.rampart = mk();
    for (const t of c.rampart.tops) ring(p.rampart, t);
    for (const b of c.rampart.bastions) ring(p.rampart, b);
    p.rampartDark = mk();
    for (const t of c.rampart.towers) ring(p.rampartDark, t);
    for (const g of c.rampart.gates) ring(p.rampartDark, g.house);
    if (c.rampart.mill) {
      const [x, z, r] = c.rampart.mill;
      p.rampartDark.moveTo(x + r, z);
      p.rampartDark.arc(x, z, r, 0, Math.PI * 2);
    }
    p.bridges = mk();
    for (const b of c.bridges) {
      const [x0, z0, x1, z1] = b.rect;
      p.bridges.rect(Math.min(x0, x1), Math.min(z0, z1), Math.abs(x1 - x0), Math.abs(z1 - z0));
    }
    const segs = (list) => {
      const q = mk();
      for (const [a, b, cc, d] of list) {
        q.moveTo(a, b);
        q.lineTo(cc, d);
      }
      return q;
    };
    p.quays = segs(c.quays);
    p.rails = segs(c.rails);
    p.craneRails = segs(c.craneRails);
    p.trees = mk();
    for (const [x, z] of c.trees) {
      p.trees.moveTo(x + 1.6, z);
      p.trees.arc(x, z, 1.6, 0, Math.PI * 2);
    }
    p.lamps = mk();
    for (const [x, z] of c.lamps) {
      p.lamps.moveTo(x + 0.35, z);
      p.lamps.arc(x, z, 0.35, 0, Math.PI * 2);
    }
    if (c.rond) {
      p.green.moveTo(c.rond.c[0] + c.rond.r, c.rond.c[1]);
      p.green.arc(c.rond.c[0], c.rond.c[1], c.rond.r, 0, Math.PI * 2);
    }
    // the landmarks' names at their middle
    c.landmarks.forEach((l) => {
      let x = 0;
      let z = 0;
      for (const q of l.fp) {
        x += q[0];
        z += q[1];
      }
      l.cx = x / l.fp.length;
      l.cz = z / l.fp.length;
    });
    for (const b of c.bridges) {
      b.cx = (b.rect[0] + b.rect[2]) / 2;
      b.cz = (b.rect[1] + b.rect[3]) / 2;
    }
    return p;
  }

  /** Lines on the water, as old maps have them: fixed on the screen, whatever the zoom. */
  let hatch = null;
  function waterPattern(c) {
    if (!hatch) {
      const t = document.createElement("canvas");
      t.width = 8;
      t.height = 6;
      const g = t.getContext("2d");
      g.fillStyle = C.water;
      g.fillRect(0, 0, 8, 6);
      g.strokeStyle = C.waterInk;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(0, 5.5);
      g.lineTo(8, 5.5);
      g.stroke();
      hatch = t;
    }
    const pat = c.createPattern(hatch, "repeat");
    try {
      pat.setTransform(c.getTransform().inverse().scale(DPR, DPR));
    } catch {
      /* old browsers: the lines zoom with the map */
    }
    return pat;
  }

  function drawStatic() {
    const key = `${W}x${H}@${DPR}|${view.cx.toFixed(3)},${view.cz.toFixed(3)},${view.s.toFixed(4)}|${show.names}`;
    if (key === staticKey) return;
    staticKey = key;
    const c = sctx;
    screenTransform(c);
    c.fillStyle = C.paper;
    c.fillRect(0, 0, W, H);
    if (!P) return;
    worldTransform(c);
    const px = 1 / view.s; // one screen pixel in metres
    c.lineJoin = "round";
    c.lineCap = "round";
    c.fillStyle = C.street;
    c.fill(new Path2D(`M${city.area.map((q) => q.join(",")).join("L")}Z`));
    c.fillStyle = C.fields;
    c.fill(P.fields, "evenodd");
    c.fillStyle = C.earth;
    c.fill(P.earth);
    c.fillStyle = C.grass;
    c.fill(P.grass);
    c.fillStyle = C.quay;
    c.fill(P.quay);
    c.fillStyle = C.flags;
    c.fill(P.flags);
    c.fillStyle = C.grass;
    c.fill(P.green);
    // the water with its lines, and the shore in ink
    c.fillStyle = waterPattern(c);
    c.fill(P.water, "evenodd");
    c.fill(P.ponds);
    c.strokeStyle = C.shore;
    c.lineWidth = 1.2 * px;
    c.stroke(P.water);
    c.stroke(P.ponds);
    c.strokeStyle = "rgba(107, 82, 56, 0.45)";
    c.lineWidth = Math.max(0.6 * px, 0.8);
    if (view.s > 1.2) c.stroke(P.paths);
    // the wall
    c.fillStyle = C.rampart;
    c.fill(P.rampart);
    c.fillStyle = C.rampartDark;
    c.fill(P.rampartDark);
    c.strokeStyle = C.ink2;
    c.lineWidth = 0.9 * px;
    c.stroke(P.rampart);
    c.stroke(P.rampartDark);
    // the houses: one wash, the ink line only when near enough to read it
    c.fillStyle = C.house;
    c.fill(P.houses);
    c.fillStyle = C.store;
    c.fill(P.stores);
    c.fillStyle = C.landmark;
    c.fill(P.landmarks);
    c.fillStyle = "rgba(239, 227, 198, 0.75)";
    c.fill(P.yards);
    if (view.s > 0.9) {
      c.strokeStyle = C.houseInk;
      c.lineWidth = (view.s > 3 ? 0.8 : 0.5) * px;
      c.stroke(P.houses);
      c.stroke(P.stores);
    }
    c.strokeStyle = C.ink;
    c.lineWidth = 1 * px;
    c.stroke(P.landmarks);
    // the quays' edges, the bridges, the railway
    c.strokeStyle = C.ink;
    c.lineWidth = 1.1 * px;
    c.stroke(P.quays);
    c.fillStyle = C.bridge;
    c.fill(P.bridges);
    c.lineWidth = 1 * px;
    c.stroke(P.bridges);
    c.strokeStyle = C.ink;
    c.lineWidth = 2.2 * px;
    c.stroke(P.rails);
    c.strokeStyle = C.paper;
    c.lineWidth = 1 * px;
    c.setLineDash([4 * px, 4 * px]);
    c.stroke(P.rails);
    c.setLineDash([]);
    c.strokeStyle = "rgba(58, 42, 26, 0.55)";
    c.lineWidth = 0.8 * px;
    c.stroke(P.craneRails);
    if (view.s > 0.8) {
      c.fillStyle = C.tree;
      c.fill(P.trees);
      if (view.s > 2) {
        c.strokeStyle = C.treeInk;
        c.lineWidth = 0.6 * px;
        c.stroke(P.trees);
      }
    }
    if (view.s > 4) {
      c.fillStyle = C.ink;
      c.fill(P.lamps);
    }
    // names
    screenTransform(c);
    if (show.names) drawNames(c);
    // the paper's age at the edges
    const g = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.62);
    g.addColorStop(0, "rgba(120, 90, 50, 0)");
    g.addColorStop(1, "rgba(120, 90, 50, 0.18)");
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
  }

  /** Labels already drawn this frame (screen boxes): a label that would overlap one is left out. */
  let placed = [];
  function roomFor(c, text, sx, sy, font) {
    c.font = font;
    const w = c.measureText(text).width / 2 + 3;
    const hh = 8;
    for (const b of placed) if (sx - w < b[2] && sx + w > b[0] && sy - hh < b[3] && sy + hh > b[1]) return false;
    placed.push([sx - w, sy - hh, sx + w, sy + hh]);
    return true;
  }
  /** A label unless another is already there. */
  function label2(c, text, sx, sy, font, colour) {
    if (roomFor(c, text, sx, sy, font)) label(c, text, sx, sy, font, colour);
  }
  function label(c, text, sx, sy, font, colour, halo = true, spacing = 0) {
    c.font = font;
    c.textAlign = "center";
    c.textBaseline = "middle";
    if ("letterSpacing" in c) c.letterSpacing = `${spacing}px`;
    if (halo) {
      c.strokeStyle = "rgba(239, 227, 198, 0.85)";
      c.lineWidth = 3;
      c.lineJoin = "round";
      c.strokeText(text, sx, sy);
    }
    c.fillStyle = colour;
    c.fillText(text, sx, sy);
    if ("letterSpacing" in c) c.letterSpacing = "0px";
  }
  const labelRaw = (...a) => label(...a);
  const SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif';

  function drawNames(c) {
    const s = view.s;
    placed = [];
    const label = (cc, text, sx, sy, font, colour, halo, spacing) => {
      if (roomFor(cc, text, sx, sy, font)) labelRaw(cc, text, sx, sy, font, colour, halo, spacing);
    };
    for (const l of city.labels) {
      const [sx, sy] = toScreen(l.x, l.z);
      if (sx < -100 || sy < -30 || sx > W + 100 || sy > H + 30) continue;
      if (l.kind === "water") label(c, l.name, sx, sy, `italic ${clamp(11 + s * 2, 12, 20)}px ${SERIF}`, C.shore, true, 1);
      else if (l.kind === "square" || l.kind === "quay") {
        if (s < 0.6) continue;
        label(c, l.name.toUpperCase(), sx, sy, `${clamp(9 + s * 1.5, 10, 16)}px ${SERIF}`, C.ink, true, 2);
      } else if (l.kind === "gate" || l.kind === "rampart") {
        if (s < 0.9) continue;
        label(c, l.name, sx, sy, `italic ${clamp(9 + s, 10, 14)}px ${SERIF}`, C.ink2);
      } else if (l.kind === "building") {
        if (s < 1.6) continue;
        label(c, l.name, sx, sy, `italic ${clamp(9 + s, 10, 14)}px ${SERIF}`, C.ink);
      }
    }
    if (city.rond && s > 1.4) {
      const [sx, sy] = toScreen(city.rond.c[0], city.rond.c[1]);
      label(c, city.rond.label, sx, sy - 14, `italic 11px ${SERIF}`, C.ink2);
    }
  }

  // ------------------------------------------------------------------ the things that move

  /** Where a thing is drawn now: eased from where it was to where the feed says it is. */
  function eased(key, x, z, yaw, now) {
    let t = things.get(key);
    if (!t) {
      t = { fx: x, fz: z, tx: x, tz: z, t0: now, yaw, seen: now };
      things.set(key, t);
    }
    return t;
  }
  function target(key, x, z, yaw, now) {
    const t = things.get(key);
    if (!t) return eased(key, x, z, yaw, now);
    const [cx, cz] = posOf(t, now);
    const jump = Math.hypot(x - cx, z - cz) > 40;
    t.fx = jump ? x : cx;
    t.fz = jump ? z : cz;
    t.tx = x;
    t.tz = z;
    t.t0 = now;
    t.yaw = yaw;
    t.seen = now;
    return t;
  }
  function posOf(t, now) {
    const u = clamp((now - t.t0) / 250, 0, 1);
    return [t.fx + (t.tx - t.fx) * u, t.fz + (t.tz - t.fz) * u];
  }

  /** The moving world's things as a flat list: { key, cat, id, name, x, z, yaw, o }. */
  function movers() {
    const out = [];
    const d = snap && snap.world && snap.world.d;
    if (!d || typeof d !== "object") return out;
    for (const [key, list] of Object.entries(d)) {
      if (!Array.isArray(list)) continue;
      const cat = worldCat(key);
      list.forEach((o, i) => {
        if (!o || typeof o !== "object") return;
        const p = moverPos(o);
        if (!p) return;
        const mid = o.id !== undefined || o.name !== undefined ? String(o.id ?? o.name).slice(0, 40) : String(i);
        const yaw = [o.yaw, o.heading, o.rot, o.ry, o.angle].find((v) => typeof v === "number");
        out.push({ key, cat, id: `${key}:${mid}`, name: typeof o.name === "string" ? o.name : null, x: p.x, z: p.z, yaw, o });
      });
    }
    return out;
  }
  function moverPos(o) {
    if (typeof o.x === "number" && typeof o.z === "number") return { x: o.x, z: o.z };
    for (const k of ["pos", "p"]) {
      const v = o[k];
      if (Array.isArray(v) && v.length === 2) return { x: v[0], z: v[1] };
      if (Array.isArray(v) && v.length === 3) return { x: v[0], z: v[2] };
    }
    return null;
  }

  function onSnap(m) {
    const now = performance.now();
    snap = m;
    snapAt = now;
    if (m.key && m.key !== people.key) loadPeople();
    const sec = Math.floor(Date.now() / 1000);
    const sample = (key, x, z) => {
      let a = trails.get(key);
      if (!a) trails.set(key, (a = []));
      if (!a.length || a[a.length - 1][0] !== sec) a.push([sec, x, z]);
      if (a.length > 120) a.shift();
    };
    for (const p of m.players) {
      target(`player:${p.id}`, p.x, p.z, p.yaw, now);
      sample(`player:${p.id}`, p.x, p.z);
    }
    for (const q of m.people) {
      target(`resident:${q.id}`, q.x, q.z, q.yaw, now);
      if (q.live) sample(`resident:${q.id}`, q.x, q.z);
    }
    for (const w of movers()) {
      target(`world:${w.id}`, w.x, w.z, w.yaw, now);
      sample(`world:${w.id}`, w.x, w.z);
    }
    // forget what the feed no longer names (after a while: a gap in the feed is not a departure)
    for (const [k, t] of things) if (now - t.seen > 5000) things.delete(k);
    for (const [k, a] of trails) if (a.length && sec - a[a.length - 1][0] > 300) trails.delete(k);
    renderClock();
    renderWorldInfo();
    renderLive();
  }

  // ------------------------------------------------------------------ drawing a frame

  function frame() {
    const now = performance.now();
    // follow: the map keeps the pinned thing in the middle
    const fol = pins.find((p) => p.follow);
    if (fol) {
      const at = whereIs(fol.kind, fol.id, now);
      if (at && (Math.abs(at[0] - view.cx) > 0.01 || Math.abs(at[1] - view.cz) > 0.01)) {
        view.cx = at[0];
        view.cz = at[1];
      }
    }
    drawStatic();
    screenTransform(ctx);
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(stat, 0, 0, W, H);
    hits = [];
    placed = [];
    for (const c of CATS) counts[c.id] = 0;
    if (P) {
      drawEvents();
      drawPlaces();
      drawCats();
      if (show.trails) drawTrails();
      drawServerTrail();
      drawBridgesState();
      drawPeople(now);
      drawWorld(now);
      drawPlayers(now);
      drawMarks(now);
    }
    drawCompass();
    drawScale();
    renderCounts();
    requestAnimationFrame(frame);
  }

  const visible = (sx, sy, m = 30) => sx > -m && sy > -m && sx < W + m && sy < H + m;
  function hit(sx, sy, r, ref, prio) {
    hits.push({ sx, sy, r, ref, prio });
  }

  function drawEvents() {
    if (!snap) return;
    for (const e of snap.events || []) {
      counts.events++;
      if (!show.events) continue;
      const [sx, sy] = toScreen(e.x, e.z);
      if (!visible(sx, sy, 200)) continue;
      const r = Math.max(8, e.r * view.s);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = e.status === "running" ? "rgba(142, 47, 29, 0.12)" : "rgba(142, 47, 29, 0.05)";
      ctx.fill();
      ctx.setLineDash(e.status === "running" ? [] : [5, 4]);
      ctx.strokeStyle = C.event;
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.setLineDash([]);
      label2(ctx, e.title, sx, sy - r - 9, `italic 12px ${SERIF}`, C.event);
      hit(sx, sy, Math.min(r, 16), { kind: "event", id: String(e.id), e }, 1);
    }
  }

  function drawPlaces() {
    for (const p of people.places) {
      counts.places++;
      if (!show.places) continue;
      const [sx, sy] = toScreen(p.x, p.z);
      if (!visible(sx, sy)) continue;
      const k = 3.5;
      ctx.beginPath();
      ctx.moveTo(sx, sy - k);
      ctx.lineTo(sx + k, sy);
      ctx.lineTo(sx, sy + k);
      ctx.lineTo(sx - k, sy);
      ctx.closePath();
      ctx.fillStyle = p.kind === "tavern" ? "#7a3b1d" : p.kind === "shop" ? "#8a6a2a" : C.place;
      ctx.fill();
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 1;
      ctx.stroke();
      const minor = /^(the )?(a |an |lanes |back streets|lane |emigrants|night round|pump|sick of)/i.test(p.label);
      if (view.s > (minor ? 7 : p.kind === "place" ? 1.3 : 3)) label2(ctx, p.label.replace(/^the /, ""), sx, sy + 10, `${p.kind === "place" ? "" : "italic "}11px ${SERIF}`, C.ink2);
      hit(sx, sy, 6, { kind: "place", id: p.id, p }, 2);
    }
  }

  function drawCats() {
    counts.cats = people.cats.length;
    if (!show.cats) return;
    ctx.fillStyle = C.cat;
    for (const [x, z] of people.cats) {
      const [sx, sy] = toScreen(x, z);
      if (!visible(sx, sy)) continue;
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
      hit(sx, sy, 4, { kind: "cat", x, z }, 0);
    }
  }

  function drawTrails() {
    const sec = Math.floor(Date.now() / 1000);
    ctx.lineWidth = 1.2;
    for (const [key, a] of trails) {
      if (a.length < 2 || sec - a[a.length - 1][0] > 10) continue;
      const cat = key.startsWith("player:") ? "players" : key.startsWith("resident:") ? "live" : "other";
      if (!show[cat] && cat !== "other") continue;
      ctx.strokeStyle = key.startsWith("player:") ? playerColour(Number(key.slice(7))) : key.startsWith("resident:") ? "rgba(44, 85, 112, 0.5)" : "rgba(85, 107, 47, 0.5)";
      ctx.beginPath();
      a.forEach(([, x, z], i) => {
        const [sx, sy] = toScreen(x, z);
        if (i) ctx.lineTo(sx, sy);
        else ctx.moveTo(sx, sy);
      });
      ctx.stroke();
    }
  }

  function drawServerTrail() {
    const p = pins[active];
    if (!p || !serverTrail || serverTrail.key !== `${p.kind}:${p.id}` || !(show.trails || p.sub === "history")) return;
    const pts = serverTrail.pts;
    if (pts.length < 2) return;
    const t0 = pts[0][0];
    const t1 = pts[pts.length - 1][0];
    ctx.lineWidth = 2.4;
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [toScreen(pts[i - 1][1], pts[i - 1][2]), toScreen(pts[i][1], pts[i][2])];
      const u = t1 > t0 ? (pts[i][0] - t0) / (t1 - t0) : 1;
      ctx.strokeStyle = `rgba(142, 47, 29, ${0.15 + 0.75 * u})`;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
    // a tick each minute
    ctx.fillStyle = C.event;
    let last = -Infinity;
    for (const [t, x, z] of pts) {
      if (t - last < 60000) continue;
      last = t;
      const [sx, sy] = toScreen(x, z);
      ctx.fillRect(sx - 1.5, sy - 1.5, 3, 3);
    }
  }

  /** The bridges of the map, with what the world PC says of them if anything. */
  function drawBridgesState() {
    const d = (snap && snap.world && snap.world.d) || {};
    const state = {};
    for (const [key, v] of Object.entries(d)) {
      if (worldCat(key) !== "bridges") continue;
      if (Array.isArray(v)) {
        v.forEach((o, i) => {
          if (o && typeof o === "object" && !moverPos(o)) state[String(o.id ?? o.name ?? `${key} ${i}`)] = o;
        });
      } else if (v && typeof v === "object") for (const [k, o] of Object.entries(v)) state[k] = o;
      else state[key] = v;
    }
    for (const b of city.bridges) {
      if (b.kind === "gate") continue;
      counts.bridges++;
      if (!show.bridges) continue;
      const [sx, sy] = toScreen(b.cx, b.cz);
      if (!visible(sx, sy)) continue;
      const st = state[b.id];
      const open = openness(st);
      ctx.beginPath();
      ctx.arc(sx, sy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = open > 0.05 ? C.bridgeCat : C.paper;
      ctx.fill();
      ctx.strokeStyle = C.bridgeCat;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      hit(sx, sy, 7, { kind: "bridge", id: b.id, b, st }, 2);
    }
  }
  function openness(st) {
    if (typeof st === "number") return st;
    if (typeof st === "boolean") return st ? 1 : 0;
    if (!st || typeof st !== "object") return 0;
    for (const k of ["open", "lift", "a", "angle", "t", "up"]) if (typeof st[k] === "number") return st[k];
    if (typeof st.open === "boolean") return st.open ? 1 : 0;
    return 0;
  }

  function personStyle(q) {
    if (q.live) {
      if (show.owners && q.o) return { fill: playerColour(q.o), stroke: C.ink, r: 3.6, alpha: 1 };
      return { fill: C.live, stroke: C.paper, r: 3.4, alpha: 1 };
    }
    if (q.in) return { fill: null, stroke: C.indoor, r: 2.4, alpha: 0.55 };
    return { fill: null, stroke: C.planned, r: 3, alpha: 0.75 };
  }

  function drawPeople(now) {
    if (!snap) return;
    const s = view.s;
    for (const q of snap.people) {
      const cat = q.live ? "live" : q.in ? "indoor" : "planned";
      counts[cat]++;
      const info = people.byId.get(q.id);
      const t = things.get(`resident:${q.id}`);
      if (!t) continue;
      const [x, z] = posOf(t, now);
      const [sx, sy] = toScreen(x, z);
      // his dog, a step to his side
      if (info && info.dog) {
        counts.dogs++;
        if (show.dogs && show[cat]) {
          const [dx, dy] = [sx + 5, sy + 4];
          if (visible(dx, dy)) {
            ctx.globalAlpha = q.live ? 1 : 0.6;
            ctx.beginPath();
            ctx.moveTo(dx, dy - 3);
            ctx.lineTo(dx + 3, dy + 2);
            ctx.lineTo(dx - 3, dy + 2);
            ctx.closePath();
            ctx.fillStyle = C.dog;
            ctx.fill();
            ctx.globalAlpha = 1;
            hit(dx, dy, 5, { kind: "dog", id: q.id }, 3);
          }
        }
      }
      if (!show[cat] || !visible(sx, sy)) continue;
      const st = personStyle(q);
      const r = st.r * clamp(s / 2, 0.8, 1.6);
      ctx.globalAlpha = st.alpha;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      if (st.fill) {
        ctx.fillStyle = st.fill;
        ctx.fill();
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.strokeStyle = st.stroke;
        ctx.lineWidth = 1.3;
        if (q.in) ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      // which way a live one faces (yaw = atan2(dx, dz): forward is (sin, cos) in (x, z))
      if (q.live && typeof q.yaw === "number" && s > 1.2) {
        const fx = Math.sin(q.yaw);
        const fz = Math.cos(q.yaw);
        ctx.beginPath();
        ctx.moveTo(sx + fz * r, sy - fx * r);
        ctx.lineTo(sx + fz * (r + 4), sy - fx * (r + 4));
        ctx.strokeStyle = st.fill || C.live;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      if (q.live && info && s > 5) label2(ctx, info.name, sx, sy - r - 7, `11px ${SERIF}`, C.ink);
      hit(sx, sy, Math.max(r + 2, 5), { kind: "resident", id: q.id }, q.live ? 5 : q.in ? 1 : 3);
    }
  }

  function drawWorld(now) {
    for (const w of movers()) {
      counts[w.cat]++;
      if (!show[w.cat]) continue;
      const t = things.get(`world:${w.id}`);
      if (!t) continue;
      const [x, z] = posOf(t, now);
      const [sx, sy] = toScreen(x, z);
      if (!visible(sx, sy, 60)) continue;
      const yaw = typeof w.yaw === "number" ? w.yaw : null;
      ctx.save();
      ctx.translate(sx, sy);
      // (on the screen: east is +x, north is -y; a yaw turns (x, z) forward = (sin, cos))
      if (yaw !== null) ctx.rotate(Math.atan2(-Math.sin(yaw), Math.cos(yaw)));
      // a length in metres (its own, else a guess by kind), never under a few pixels
      const kind = `${w.key} ${w.o.kind || ""} ${w.o.type || ""}`.toLowerCase();
      const len = typeof w.o.length === "number" ? w.o.length : typeof w.o.len === "number" ? w.o.len : /liner|steam/.test(kind) ? 70 : /brig|ship|schooner|bark/.test(kind) ? 30 : w.cat === "boats" ? 12 : w.cat === "buses" ? 6 : w.cat === "carts" ? 4 : /train|goods/.test(kind) ? 40 : 8;
      const k = Math.max((len * view.s) / 10, 1.4);
      ctx.lineWidth = 1;
      ctx.strokeStyle = C.ink;
      if (w.cat === "boats") {
        const L = 5 * k;
        const B = Math.max(1.4 * k * (len > 40 ? 0.7 : 1), 3);
        ctx.beginPath();
        ctx.moveTo(L, 0);
        ctx.quadraticCurveTo(L * 0.3, -B, -L * 0.8, -B * 0.8);
        ctx.lineTo(-L * 0.8, B * 0.8);
        ctx.quadraticCurveTo(L * 0.3, B, L, 0);
        ctx.fillStyle = C.boat;
      } else if (w.cat === "buses") {
        ctx.beginPath();
        ctx.rect(-5 * k, -2.4 * k, 10 * k, 4.8 * k);
        ctx.fillStyle = C.bus;
      } else if (w.cat === "carts") {
        ctx.beginPath();
        ctx.rect(-3.5 * k, -1.8 * k, 7 * k, 3.6 * k);
        ctx.fillStyle = C.cart;
      } else if (w.cat === "trains") {
        const crane = /crane/i.test(w.key);
        ctx.beginPath();
        if (crane) {
          ctx.moveTo(-4 * k, -4 * k);
          ctx.lineTo(4 * k, 4 * k);
          ctx.moveTo(-4 * k, 4 * k);
          ctx.lineTo(4 * k, -4 * k);
          ctx.strokeStyle = C.train;
          ctx.lineWidth = 2.2;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(0, 0, 2 * k, 0, Math.PI * 2);
        } else {
          const hw = Math.max(1.5 * view.s, 2.5); // a wagon is 3 m wide
          ctx.rect(-5 * k, -hw, 10 * k, 2 * hw);
        }
        ctx.fillStyle = C.train;
      } else if (w.cat === "bridges") {
        ctx.beginPath();
        ctx.rect(-3 * k, -3 * k, 6 * k, 6 * k);
        ctx.fillStyle = C.bridgeCat;
      } else {
        ctx.beginPath();
        ctx.moveTo(0, -4 * k);
        ctx.lineTo(4 * k, 0);
        ctx.lineTo(0, 4 * k);
        ctx.lineTo(-4 * k, 0);
        ctx.closePath();
        ctx.fillStyle = C.other;
      }
      ctx.fill();
      ctx.strokeStyle = C.paper;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      if (w.name && view.s > 2) label2(ctx, w.name, sx, sy - 12, `italic 11px ${SERIF}`, C.ink);
      hit(sx, sy, 9, { kind: "world", id: w.id, w }, 4);
    }
  }

  function drawPlayers(now) {
    if (!snap) return;
    for (const p of snap.players) {
      counts.players++;
      if (!show.players) continue;
      const t = things.get(`player:${p.id}`);
      if (!t) continue;
      const [x, z] = posOf(t, now);
      const [sx, sy] = toScreen(x, z);
      if (!visible(sx, sy)) continue;
      const col = playerColour(p.id);
      ctx.globalAlpha = p.online ? 1 : 0.45;
      // the view's cone (a camera's yaw: forward is (-sin, -cos) in (x, z))
      if (typeof p.yaw === "number") {
        const a = Math.atan2(Math.sin(p.yaw), -Math.cos(p.yaw));
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.arc(sx, sy, 22, a - 0.45, a + 0.45);
        ctx.closePath();
        ctx.fillStyle = col + "33";
        ctx.fill();
      }
      ctx.beginPath();
      ctx.arc(sx, sy, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.paper;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(sx, sy, 8.5, 0, Math.PI * 2);
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.globalAlpha = 1;
      label(ctx, `${p.name}${p.away ? " (away)" : ""}${p.online ? "" : " (lost)"}`, sx, sy - 17, `bold 12px ${SERIF}`, col);
      hit(sx, sy, 10, { kind: "player", id: String(p.id) }, 6);
    }
  }

  /** A ring round what is hovered and what is pinned. */
  function drawMarks(now) {
    const mark = (kind, id, colour, r) => {
      const at = whereIs(kind, id, now);
      if (!at) return;
      const [sx, sy] = toScreen(at[0], at[1]);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.strokeStyle = colour;
      ctx.lineWidth = 2;
      ctx.stroke();
    };
    pins.forEach((p, i) => mark(p.kind, p.id, i === active ? C.event : "rgba(142, 47, 29, 0.45)", i === active ? 13 : 11));
    if (hover) mark(hover.kind, hover.id, C.ink, 11);
  }

  /** Where a thing is now, in world metres (null when the feed has none). */
  function whereIs(kind, id, now) {
    const key = kind === "dog" ? `resident:${id}` : `${kind}:${id}`;
    const t = things.get(key);
    if (t) return posOf(t, now);
    if (kind === "place") {
      const p = people.places.find((q) => q.id === id);
      return p ? [p.x, p.z] : null;
    }
    if (kind === "event" && snap) {
      const e = (snap.events || []).find((q) => String(q.id) === id);
      return e ? [e.x, e.z] : null;
    }
    if (kind === "bridge" && city) {
      const b = city.bridges.find((q) => q.id === id);
      return b ? [b.cx, b.cz] : null;
    }
    return null;
  }

  function drawCompass() {
    const x = 34;
    const y = 50;
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = "rgba(239, 227, 198, 0.9)";
    ctx.strokeStyle = C.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, 21, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.stroke();
    // the needle: north dark, south light
    ctx.beginPath();
    ctx.moveTo(0, -15);
    ctx.lineTo(5, 0);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fillStyle = C.ink;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, 15);
    ctx.lineTo(5, 0);
    ctx.lineTo(-5, 0);
    ctx.closePath();
    ctx.fillStyle = C.paper;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    label(ctx, "N", x, y - 30, `bold 13px ${SERIF}`, C.ink);
  }

  function drawScale() {
    const want = 140 / view.s; // metres in about 140 px
    const p10 = Math.pow(10, Math.floor(Math.log10(want)));
    const m = [1, 2, 5, 10].map((k) => k * p10).filter((v) => v <= want).pop() || p10;
    const px = m * view.s;
    const x = 20;
    const y = H - 26;
    ctx.fillStyle = "rgba(239, 227, 198, 0.9)";
    ctx.fillRect(x - 8, y - 20, px + 60, 34);
    ctx.strokeStyle = C.ink2;
    ctx.lineWidth = 1;
    ctx.strokeRect(x - 8, y - 20, px + 60, 34);
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 ? C.paper : C.ink;
      ctx.fillRect(x + (px / 4) * i, y, px / 4, 5);
    }
    ctx.strokeStyle = C.ink;
    ctx.strokeRect(x, y, px, 5);
    ctx.font = `12px ${SERIF}`;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillStyle = C.ink;
    ctx.fillText("0", x - 3, y - 5);
    ctx.fillText(`${m} m`, x + px - 6, y - 5);
    ctx.fillStyle = C.ink3;
    ctx.fillText("metres", x + px + 12, y + 6);
  }

  // ------------------------------------------------------------------ hover and click

  function nearest(sx, sy) {
    let best = null;
    let bestK = Infinity;
    for (const h0 of hits) {
      const d = Math.hypot(h0.sx - sx, h0.sy - sy);
      if (d > h0.r + 3) continue;
      const k = d - h0.prio * 2.5;
      if (k < bestK) {
        bestK = k;
        best = h0;
      }
    }
    return best;
  }

  let drag = null;
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    drag = { x: e.offsetX, y: e.offsetY, cx: view.cx, cz: view.cz, moved: false };
  });
  canvas.addEventListener("pointermove", (e) => {
    if (drag) {
      const dx = e.offsetX - drag.x;
      const dy = e.offsetY - drag.y;
      if (Math.hypot(dx, dy) > 3) drag.moved = true;
      if (drag.moved) {
        canvas.classList.add("drag");
        view.cx = drag.cx + dy / view.s;
        view.cz = drag.cz - dx / view.s;
        const f = pins.find((p) => p.follow);
        if (f) {
          f.follow = false;
          renderPins();
        }
        hideTip();
        return;
      }
    }
    const h0 = nearest(e.offsetX, e.offsetY);
    hover = h0 ? h0.ref : null;
    canvas.classList.toggle("hot", !!h0);
    if (h0) showTip(h0.ref, e.offsetX, e.offsetY);
    else hideTip();
  });
  canvas.addEventListener("pointerup", (e) => {
    const was = drag;
    drag = null;
    canvas.classList.remove("drag");
    if (was && !was.moved) {
      const h0 = nearest(e.offsetX, e.offsetY);
      if (h0 && h0.ref.kind !== "cat") pin(h0.ref.kind, h0.ref.id);
    }
  });
  canvas.addEventListener("pointerleave", () => {
    hover = null;
    hideTip();
  });
  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoomAt(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), e.offsetX, e.offsetY);
    },
    { passive: false },
  );
  $("zin").onclick = () => zoomAt(1.4, W / 2, H / 2);
  $("zout").onclick = () => zoomAt(1 / 1.4, W / 2, H / 2);
  $("zfit").onclick = fit;
  window.addEventListener("keydown", (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if (e.key === "f" || e.key === "F") fit();
    else if (e.key === "Escape" && active >= 0) unpin(active);
    else if (e.key === "+" || e.key === "=") zoomAt(1.3, W / 2, H / 2);
    else if (e.key === "-") zoomAt(1 / 1.3, W / 2, H / 2);
  });
  window.addEventListener("resize", resize);

  const tip = $("tip");
  function hideTip() {
    tip.hidden = true;
  }
  function row(k, v) {
    return h("div", "r", h("span", null, k), h("span", null, v));
  }
  function showTip(ref, sx, sy) {
    const box = tipFor(ref);
    if (!box) return hideTip();
    tip.replaceChildren(...box);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    tip.style.left = `${sx + 16 + tw > W ? sx - tw - 14 : sx + 16}px`;
    tip.style.top = `${clamp(sy - 10, 6, H - th - 6)}px`;
  }

  const ACT = { home: "at home", work: "at work", tavern: "at the tavern", play: "playing", market: "errands at the market", church: "at mass", stroll: "a walk", loiter: "hanging about" };
  function ownerName(o) {
    if (!o) return "nobody";
    const p = snap && snap.players.find((q) => q.id === o);
    return p ? `${p.name}'s PC${p.host ? " (host)" : ""}` : `player ${o}'s PC`;
  }
  const personNow = (q) => q && people.byId.get(q.id);
  function personRows(q) {
    const rows = [];
    if (q.live) {
      rows.push(["Now", `${q.m}${q.sit && q.m !== "sit" ? ", sitting" : ""}${q.s > 0.2 ? `, ${q.s} m/s` : ""}`]);
      if (q.veh) rows.push(["With", `a ${q.veh}`]);
      if (q.a) rows.push(["Plan", `${ACT[q.a] || q.a} ${q.p || ""}`]);
    } else rows.push(["Now", `${ACT[q.a] || q.a || "?"} ${q.p || ""}${q.left ? ` (${q.left} min more)` : ""}`]);
    if (q.act) rows.push(["Acting", q.act]);
    rows.push(["Goes", q.live ? q.p || "?" : q.n || "stays"]);
    if (q.live && q.n) rows.push(["Then", q.n]);
    rows.push(["Walked by", q.live ? ownerName(q.o) : q.o ? `${ownerName(q.o)} (no batch)` : "nobody"]);
    return rows;
  }
  function tipFor(ref) {
    if (ref.kind === "resident") {
      const q = snap && snap.people.find((p) => p.id === ref.id);
      const info = personNow(q) || { name: ref.id, label: "", age: "" };
      if (!q) return null;
      return [
        h("div", "t", info.name),
        h("div", "k", `${info.label}${info.age ? `, ${info.age}` : ""}${info.dog ? `, with ${info.dog}` : ""}`),
        ...personRows(q).map(([k, v]) => row(k, v)),
        q.live ? null : h("div", "note", q.in ? "By the day plan, not seen live (indoors)" : "By the day plan, not seen live"),
      ].filter(Boolean);
    }
    if (ref.kind === "dog") {
      const info = people.byId.get(ref.id);
      const q = snap && snap.people.find((p) => p.id === ref.id);
      if (!info) return null;
      return [h("div", "t", info.dog), h("div", "k", `${info.name}'s dog`), row("Now", q && q.live ? "at his owner's heel, live" : "with his owner, by the day plan")];
    }
    if (ref.kind === "player") {
      const p = snap && snap.players.find((q) => String(q.id) === ref.id);
      if (!p) return null;
      return [
        h("div", "t", p.name),
        h("div", "k", p.host ? "the host" : "a guest"),
        row("Now", `${p.mode}${p.v ? `, ${p.v} m/s` : ""}`),
        row("State", p.online ? (p.away ? "away from the keys" : "playing") : "connection lost"),
        row("Walks", `${p.walks} townspeople`),
      ];
    }
    if (ref.kind === "world") {
      const w = ref.w;
      const o = w.o;
      const rows = Object.entries(o)
        .filter(([k, v]) => !["x", "y", "z", "pos", "p", "yaw", "id", "name"].includes(k) && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
        .slice(0, 6)
        .map(([k, v]) => row(k, typeof v === "number" ? String(Math.round(v * 100) / 100) : String(v)));
      return [h("div", "t", w.name || `${singular(w.key)} ${w.id.split(":").slice(1).join(":")}`), h("div", "k", `${CATS.find((c) => c.id === w.cat).label.toLowerCase()} (${w.key})`), ...rows, h("div", "note", "Sent by the world PC")];
    }
    if (ref.kind === "place") {
      const p = ref.p;
      const here = snap ? snap.people.filter((q) => Math.hypot(q.x - p.x, q.z - p.z) <= p.r + 4 && !q.in).length : 0;
      return [h("div", "t", p.label), h("div", "k", `${p.kind === "place" ? "a place" : `a ${p.kind}`}, ${p.district}`), row("People", `${here} in the street here now`)];
    }
    if (ref.kind === "event") {
      const e = ref.e;
      return [h("div", "t", e.title), h("div", "k", "a town event"), row("State", `${e.status}, stage ${e.stage + 1}`), row("Where", e.place)];
    }
    if (ref.kind === "bridge") {
      const st = ref.st;
      return [
        h("div", "t", prettyId(ref.b.id)),
        h("div", "k", ref.b.kind === "draw" ? "a drawbridge" : ref.b.kind === "pontoon" ? "the ferry pontoon" : "a bridge"),
        row("State", st === undefined ? "nothing sent" : openness(st) > 0.05 ? "open" : "closed"),
      ];
    }
    if (ref.kind === "cat") return [h("div", "t", "A cat's doorstep"), h("div", "k", "where the game puts a cat now and then")];
    return null;
  }
  const prettyId = (id) => id.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

  // ------------------------------------------------------------------ the pinned cards

  function pin(kind, id) {
    const i = pins.findIndex((p) => p.kind === kind && p.id === id);
    if (i >= 0) active = i;
    else {
      pins.push({ kind, id, sub: "now", follow: false, detail: null, hist: null, gotAt: 0, histAt: 0 });
      active = pins.length - 1;
      if (pins.length > 8) {
        pins.shift();
        active--;
      }
    }
    refresh(true);
    renderPins();
  }
  function unpin(i) {
    pins.splice(i, 1);
    active = Math.min(active, pins.length - 1);
    serverTrail = null;
    renderPins();
    if (active >= 0) refresh(true);
  }

  async function getJson(url) {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    return r.json();
  }

  /** The active card's details from the server (every 2 s), its history (every 5 s while open). */
  async function refresh(force = false) {
    const p = pins[active];
    if (!p || !["resident", "player", "world", "place", "event", "dog"].includes(p.kind)) return;
    const now = Date.now();
    const q = `kind=${encodeURIComponent(p.kind)}&id=${encodeURIComponent(p.id)}`;
    try {
      if (force || now - p.gotAt > 2000) {
        p.gotAt = now;
        p.detail = await getJson(`/detail?${q}`);
      }
      if (p.sub === "history" || show.trails) {
        if (force || now - p.histAt > 5000) {
          p.histAt = now;
          p.hist = await getJson(`/history?${q}`);
          serverTrail = p.hist ? { key: `${p.kind}:${p.id}`, pts: p.hist.trail } : null;
        }
      }
    } catch {
      /* the server is restarting: the next round */
    }
    if (pins[active] === p) renderBody();
  }
  setInterval(() => refresh(false), 1000);

  function pinName(p) {
    if (p.kind === "resident") return (people.byId.get(p.id) || {}).name || p.id;
    if (p.kind === "dog") return (people.byId.get(p.id) || {}).dog || "a dog";
    if (p.kind === "player") return ((snap && snap.players.find((q) => String(q.id) === p.id)) || {}).name || `Player ${p.id}`;
    if (p.kind === "place") return ((people.places.find((q) => q.id === p.id) || {}).label || p.id).replace(/^the /, "");
    if (p.kind === "bridge") return prettyId(p.id);
    if (p.detail) return p.detail.title;
    return p.id;
  }
  function pinColour(p) {
    if (p.kind === "player") return playerColour(Number(p.id));
    if (p.kind === "resident") {
      const q = snap && snap.people.find((r) => r.id === p.id);
      return q && q.live ? C.live : C.planned;
    }
    if (p.kind === "dog") return C.dog;
    if (p.kind === "event") return C.event;
    return C.place;
  }

  function renderPins() {
    const box = $("pins");
    box.hidden = pins.length === 0;
    const tabs = $("pintabs");
    tabs.replaceChildren(
      ...pins.map((p, i) => {
        const dot = h("span", "dot");
        dot.style.background = pinColour(p);
        const x = h("span", "x", "×");
        x.title = "Unpin";
        x.onclick = (e) => {
          e.stopPropagation();
          unpin(i);
        };
        const b = h("button", i === active ? "on" : "", dot, h("span", "nm", pinName(p)), x);
        b.type = "button";
        b.onclick = () => {
          active = i;
          serverTrail = null;
          refresh(true);
          renderPins();
        };
        return b;
      }),
    );
    renderBody();
    requestAnimationFrame(() => {
      resize();
    });
  }

  function rowsEl(rows) {
    const g = h("div", "rows");
    for (const [k, v] of rows) g.append(h("div", "l", k), h("div", "v", v));
    return g;
  }
  function sec(title, ...kids) {
    return h("div", "sec", h("h3", null, title), ...kids);
  }

  /** The "Live" block from the feed (four times a second). */
  function liveRows(p) {
    if (!snap) return [];
    if (p.kind === "resident" || p.kind === "dog") {
      const q = snap.people.find((r) => r.id === p.id);
      if (!q) return [["Seen", "not in the feed"]];
      const rows = [["Seen", q.live ? "live" : q.in ? "by the day plan, not seen live (indoors)" : "by the day plan, not seen live"], ...personRows(q)];
      rows.push(["Where", `x ${q.x.toFixed(1)}, z ${q.z.toFixed(1)}`]);
      return rows;
    }
    if (p.kind === "player") {
      const q = snap.players.find((r) => String(r.id) === p.id);
      if (!q) return [["Seen", "not in the town now"]];
      return [
        ["State", q.online ? (q.away ? "away from the keys" : "playing") : "connection lost"],
        ["Doing", `${q.mode}${q.v ? `, ${q.v} m/s` : ""}`],
        ["Walks", `${q.walks} townspeople`],
        ["Where", `x ${q.x.toFixed(1)}, z ${q.z.toFixed(1)}, height ${q.y.toFixed(1)}`],
      ];
    }
    if (p.kind === "world") {
      const w = movers().find((m) => m.id === p.id);
      if (!w) return [["Seen", "no longer sent by the world PC"]];
      return Object.entries(w.o)
        .filter(([, v]) => v !== null && v !== undefined)
        .slice(0, 24)
        .map(([k, v]) => [k, typeof v === "number" ? String(Math.round(v * 100) / 100) : typeof v === "object" ? JSON.stringify(v).slice(0, 80) : String(v)]);
    }
    if (p.kind === "bridge") {
      const b = city.bridges.find((q) => q.id === p.id);
      return b ? [["Kind", b.kind], ["Where", `x ${b.cx.toFixed(0)}, z ${b.cz.toFixed(0)}`]] : [];
    }
    return null;
  }

  function renderBody() {
    const body = $("pinbody");
    const p = pins[active];
    if (!p) return body.replaceChildren();
    const d = p.detail;
    const follow = h("button", p.follow ? "on" : "", p.follow ? "Following" : "Follow");
    follow.type = "button";
    follow.onclick = () => {
      const was = p.follow;
      for (const q of pins) q.follow = false;
      p.follow = !was;
      renderPins();
    };
    const centre = h("button", "", "Centre");
    centre.type = "button";
    centre.onclick = () => {
      const at = whereIs(p.kind, p.id, performance.now());
      if (at) {
        view.cx = at[0];
        view.cz = at[1];
        view.s = Math.max(view.s, 3);
      }
    };
    const close = h("button", "", "Unpin");
    close.type = "button";
    close.onclick = () => unpin(active);
    const subs = h("div", "subtabs");
    for (const [k, t] of [
      ["now", "Now"],
      ["plan", "Day plan"],
      ["history", "History"],
    ]) {
      const b = h("button", p.sub === k ? "on" : "", t);
      b.type = "button";
      b.onclick = () => {
        p.sub = k;
        if (k === "history") p.histAt = 0;
        refresh(k === "history");
        renderBody();
      };
      subs.append(b);
    }
    const kids = [h("div", "ptitle", d ? d.title : pinName(p)), h("div", "psub", d ? d.sub : p.kind), h("div", "pbtns", follow, centre, close), subs];
    const content = h("div", "content");
    content.id = "pincontent";
    kids.push(content);
    body.replaceChildren(...kids);
    renderContent(p, content);
  }

  function renderContent(p, box) {
    const d = p.detail;
    const out = [];
    if (p.sub === "now") {
      const live = liveRows(p);
      if (live) {
        const lb = sec("Live, from the feed", rowsEl(live));
        lb.id = "liveblock";
        out.push(lb);
      }
      if (d) {
        for (const s of d.sections) if (!(live && s.title === "Now")) out.push(sec(s.title, rowsEl(s.rows)));
        if (d.links && d.links.length) {
          const l = h("div", "links");
          for (const k of d.links) {
            const b = h("button", "linkbtn", k.name, k.why ? h("span", "why", k.why) : null);
            b.type = "button";
            b.onclick = () => pin(k.kind, k.id);
            l.append(b);
          }
          out.push(sec(p.kind === "place" ? "Here now" : p.kind === "event" ? "People in it" : "People", l));
        }
      } else if (!live) out.push(h("div", "empty", "Nothing more is known of it."));
    } else if (p.sub === "plan") {
      if (d && d.plan) {
        const ul = h("ul", "plan");
        for (const s of d.plan.segs) ul.append(h("li", s.now ? "now" : "", h("span", "h", `${s.from} - ${s.to}`), h("span", null, `${s.act} ${s.place}`)));
        out.push(sec(`${d.plan.weekday}'s plan`, ul));
        out.push(h("div", "empty", "The engine's schedule for today. Where a PC walks him live, he follows it in the street."));
      } else out.push(h("div", "empty", "Only townspeople have a day plan."));
    } else {
      const hs = p.hist;
      if (!hs) out.push(h("div", "empty", "Loading..."));
      else {
        const span = hs.trail.length > 1 ? Math.round((hs.trail[hs.trail.length - 1][0] - hs.trail[0][0]) / 60000) : 0;
        out.push(sec("Trail", h("div", "small", hs.trail.length ? `${hs.trail.length} points over the last ${span} min, drawn on the map in red (older is paler).` : "No trail kept: not seen moving live in the last 15 minutes.")));
        const ch = h("ul", "hist");
        for (const c of hs.changes) ch.append(h("li", null, h("span", "w", `${ago(Date.now() - c.at)}${c.game ? `, ${c.game}` : ""}`), c.text));
        out.push(sec("Seen by the map", hs.changes.length ? ch : h("div", "empty", "Nothing noted since the server started.")));
        const db = h("ul", "hist");
        for (const e of hs.db) db.append(h("li", null, h("span", "w", e.when), h("span", "kd", e.kind), e.text));
        out.push(sec("In the save", hs.db.length ? db : h("div", "empty", "The save holds nothing about it.")));
      }
    }
    box.replaceChildren(...out);
  }

  /** The Now tab's live block again with each snapshot (the rest waits for the server). */
  function renderLive() {
    const p = pins[active];
    if (!p || p.sub !== "now") return;
    // only the live rows: the rest of the card stays put (a click on a name is never lost)
    const lb = document.getElementById("liveblock");
    const live = liveRows(p);
    if (lb && live) lb.replaceChild(rowsEl(live), lb.lastChild);
    const tabs = $("pintabs").querySelectorAll(".dot");
    pins.forEach((q, i) => tabs[i] && (tabs[i].style.background = pinColour(q)));
  }

  // ------------------------------------------------------------------ the side bar

  function renderCats() {
    const ul = $("cats");
    ul.replaceChildren(
      ...CATS.map((c) => {
        const cb = h("input");
        cb.type = "checkbox";
        cb.checked = show[c.id];
        cb.onchange = () => {
          show[c.id] = cb.checked;
          store.set("cats", show);
          staticKey = "";
          if (c.id === "trails") refresh(true);
        };
        const sw = h("span", `sw ${c.shape === "sq" ? "sq" : c.shape === "ring" ? "ring" : ""}`);
        sw.style.background = c.colour;
        sw.style.borderColor = c.shape === "ring" ? c.colour : "";
        const n = h("span", "n", "");
        n.id = `n-${c.id}`;
        const lab = h("label", null, cb, sw, c.label);
        return h("li", c.sep ? "sep" : "", lab, n);
      }),
    );
  }
  let countsKey = "";
  function renderCounts() {
    const k = CATS.map((c) => counts[c.id]).join(",");
    if (k === countsKey) return;
    countsKey = k;
    for (const c of CATS) {
      const n = document.getElementById(`n-${c.id}`);
      if (n) n.textContent = ["names", "owners", "trails"].includes(c.id) ? "" : String(counts[c.id] || 0);
    }
  }
  function renderClock() {
    const c = snap && snap.clock;
    if (!c) return;
    $("clockTime").textContent = `${pad(c.hour)}:${pad(c.minute)}`;
    $("clockDay").textContent = `${c.weekday || ""}, day ${c.day}${c.weather ? `, ${c.weather}` : ""}`;
  }
  function renderWorldInfo() {
    const box = $("worldinfo");
    const w = snap && snap.world;
    if (!w || !w.d) return;
    const rows = [h("div", null, h("span", null, "Last sent"), h("span", null, w.age < 1500 ? "just now" : ago(w.age)))];
    for (const [k, v] of Object.entries(w.d)) {
      if (Array.isArray(v)) rows.push(h("div", null, h("span", null, k), h("span", null, `${v.length}`)));
      else if (v && typeof v === "object") rows.push(h("div", null, h("span", null, k), h("span", null, `${Object.keys(v).length} entries`)));
      else rows.push(h("div", null, h("span", null, k), h("span", null, String(v).slice(0, 24))));
    }
    box.replaceChildren(...rows);
  }

  // search: people, players and places by name
  const search = $("search");
  const results = $("results");
  function runSearch() {
    const q = search.value.trim().toLowerCase();
    if (q.length < 2) return results.replaceChildren();
    const out = [];
    for (const p of (snap && snap.players) || []) if (p.name.toLowerCase().includes(q)) out.push({ kind: "player", id: String(p.id), name: p.name, what: "player" });
    for (const r of people.residents) {
      if (r.name.toLowerCase().includes(q) || r.label.toLowerCase().includes(q)) out.push({ kind: "resident", id: r.id, name: r.name, what: r.label });
      if (r.dog && r.dog.toLowerCase().includes(q)) out.push({ kind: "dog", id: r.id, name: r.dog, what: `${r.name}'s dog` });
    }
    for (const p of people.places) if (p.label.toLowerCase().includes(q)) out.push({ kind: "place", id: p.id, name: p.label, what: p.kind });
    results.replaceChildren(
      ...out.slice(0, 14).map((o) => {
        const li = h("li", null, h("span", null, o.name), h("span", "what", o.what));
        li.onclick = () => {
          pin(o.kind, o.id);
          const at = whereIs(o.kind, o.id, performance.now());
          if (at) {
            view.cx = at[0];
            view.cz = at[1];
            view.s = Math.max(view.s, 3);
          }
        };
        return li;
      }),
    );
  }
  search.addEventListener("input", runSearch);
  search.addEventListener("keydown", (e) => {
    if (e.key === "Enter") results.firstChild && results.firstChild.click();
    if (e.key === "Escape") {
      search.value = "";
      runSearch();
    }
  });

  // ------------------------------------------------------------------ loading and the feed

  let peopleBusy = false;
  async function loadPeople() {
    if (peopleBusy) return;
    peopleBusy = true;
    try {
      const d = await getJson("/people");
      if (d) {
        people = { key: d.key, byId: new Map(d.residents.map((r) => [r.id, r])), residents: d.residents, places: d.places, cats: d.cats };
        renderPins();
      }
    } catch {
      /* the next snapshot asks again */
    }
    peopleBusy = false;
  }

  const status = $("status");
  let retry = 1000;
  function connect() {
    const ws = new WebSocket(`ws://${location.host}/feed`);
    ws.onopen = () => {
      retry = 1000;
      status.className = "";
      status.textContent = "Live: four updates a second";
    };
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type === "snap") onSnap(m);
      } catch {
        /* a broken frame */
      }
    };
    ws.onclose = () => {
      status.className = "bad";
      status.textContent = "The feed is closed (is the game's server running?). Trying again...";
      setTimeout(connect, retry);
      retry = Math.min(retry * 2, 8000);
    };
  }
  setInterval(() => {
    if (!snap) return;
    const age = performance.now() - snapAt;
    if (age > 3000) {
      status.className = "bad";
      status.textContent = `No update for ${Math.round(age / 1000)} s`;
    }
  }, 1000);

  async function start() {
    resize();
    renderCats();
    try {
      city = await getJson("/city");
      P = build(city);
    } catch (e) {
      status.className = "bad";
      status.textContent = "Could not load the town's shapes.";
      console.error(e);
    }
    const v = store.get("view", null);
    if (v && typeof v.s === "number") Object.assign(view, v);
    else fit();
    setInterval(() => store.set("view", { cx: view.cx, cz: view.cz, s: view.s }), 2000);
    await loadPeople();
    connect();
    requestAnimationFrame(frame);
  }
  start();
})();
