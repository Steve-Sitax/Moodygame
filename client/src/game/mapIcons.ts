// The map's icons (Steve 2026-09-29: "map is not very clear, text is over each other. Use icons for poi's and
// hover over icon says what it is. Also categories click on and off."). Each place on the paper map is a small
// ink picture in a round badge; the badge's rim is the colour of its kind, and the key beside the map turns
// each kind on and off. The pictures are drawn in a box from -10 to 10, y down, in the ink colour.

type G = CanvasRenderingContext2D;
type Draw = (g: G) => void;

export type MapCat = "job" | "work" | "event" | "food" | "tavern" | "shop" | "service" | "bed" | "sight" | "pump" | "names";

/** The kinds, in the key's order: the key's line, the badge's rim, and whether the map shows it before any click. */
export const MAP_CATS: Array<{ id: MapCat; label: string; ink: string; on: boolean }> = [
  { id: "job", label: "your job: go here", ink: "#8a1a10", on: true },
  { id: "work", label: "work offered", ink: "#1a3a6a", on: true },
  { id: "event", label: "going on in town", ink: "#4a2a5a", on: true },
  { id: "food", label: "food, drink, markets", ink: "#6a4a10", on: true },
  { id: "tavern", label: "taverns", ink: "#7a2a1a", on: true },
  { id: "shop", label: "other shops", ink: "#3a4a2a", on: true },
  { id: "service", label: "boards, post, police, boats", ink: "#2a3a4a", on: true },
  { id: "bed", label: "a bed for the night", ink: "#4a3a2a", on: true },
  { id: "sight", label: "churches and sights", ink: "#5a3a1a", on: true },
  { id: "pump", label: "water pumps", ink: "#2a5a6a", on: false },
  { id: "names", label: "street and square names", ink: "#2a2420", on: true },
];
export const CAT_INK: Record<MapCat, string> = Object.fromEntries(MAP_CATS.map((c) => [c.id, c.ink])) as Record<MapCat, string>;

const path = (g: G, pts: Array<[number, number]>, close = false, fill = false) => {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  if (close) g.closePath();
  if (fill) g.fill();
  else g.stroke();
};
const circle = (g: G, x: number, y: number, r: number, fill = false) => {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  if (fill) g.fill();
  else g.stroke();
};
const text = (g: G, t: string) => {
  g.font = "bold 15px 'Scheldemist Print', Georgia, serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(t, 0, 1);
  g.textBaseline = "alphabetic";
};

/** Each icon: its picture and its kind. */
export const MAP_ICONS: Record<string, { cat: MapCat; draw: Draw }> = {
  goal: {
    cat: "job",
    draw: (g) => {
      g.lineWidth = 2.6;
      path(g, [[-5, -5], [5, 5]]);
      path(g, [[5, -5], [-5, 5]]);
    },
  },
  work: { cat: "work", draw: (g) => text(g, "!") },
  event: { cat: "event", draw: (g) => text(g, "?") },
  bread: {
    cat: "food",
    draw: (g) => {
      g.beginPath();
      g.moveTo(-8, 4);
      g.bezierCurveTo(-9, -6, 9, -6, 8, 4);
      g.closePath();
      g.stroke();
      for (const x of [-3, 1, 5]) path(g, [[x - 1.5, 0], [x + 0.5, -3]]);
    },
  },
  veg: {
    cat: "food",
    draw: (g) => {
      path(g, [[-2, -3], [3, -3], [0.5, 8]], true);
      path(g, [[0.5, -3], [-2, -8]]);
      path(g, [[0.5, -3], [0.5, -8.5]]);
      path(g, [[0.5, -3], [3.5, -7.5]]);
    },
  },
  meat: {
    cat: "food",
    draw: (g) => {
      g.beginPath();
      g.ellipse(-1.5, 1, 6, 5, -0.6, 0, Math.PI * 2);
      g.stroke();
      circle(g, -2, 1.5, 1.5, true);
      path(g, [[3, -3], [7, -7]]);
      circle(g, 7.5, -7.5, 1.4);
    },
  },
  fish: {
    cat: "food",
    draw: (g) => {
      g.beginPath();
      g.ellipse(-2, 0, 6.5, 3.5, 0, 0, Math.PI * 2);
      g.stroke();
      path(g, [[4.5, 0], [8.5, -4], [8.5, 4]], true);
      circle(g, -5.5, -0.8, 0.9, true);
    },
  },
  cup: {
    cat: "food",
    draw: (g) => {
      path(g, [[-6, -2], [-5, 6], [3, 6], [4, -2]], true);
      g.beginPath();
      g.arc(5.5, 1.5, 2.6, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      path(g, [[-3, -4], [-2, -8]]);
      path(g, [[0.5, -4], [1.5, -8]]);
    },
  },
  bottle: {
    cat: "food",
    draw: (g) => {
      path(g, [[-1.5, -8.5], [1.5, -8.5], [1.5, -4], [4, -1], [4, 8], [-4, 8], [-4, -1], [-1.5, -4]], true);
      path(g, [[-4, 2], [4, 2]]);
    },
  },
  crate: {
    cat: "food",
    draw: (g) => {
      g.strokeRect(-7, -6, 14, 13);
      path(g, [[-7, -6], [7, 7]]);
      path(g, [[7, -6], [-7, 7]]);
    },
  },
  market: {
    cat: "food",
    draw: (g) => {
      path(g, [[-8, -2], [-6, -7], [6, -7], [8, -2]], true);
      for (const x of [-8, -4, 0, 4]) {
        g.beginPath();
        g.arc(x + 2, -2, 2, 0, Math.PI);
        g.stroke();
      }
      path(g, [[-7, 0], [-7, 7]]);
      path(g, [[7, 0], [7, 7]]);
      path(g, [[-7, 4], [7, 4]]);
    },
  },
  tankard: {
    cat: "tavern",
    draw: (g) => {
      g.strokeRect(-6, -4, 9, 11);
      g.beginPath();
      g.arc(3, 1.5, 3.5, -Math.PI / 2, Math.PI / 2);
      g.stroke();
      g.beginPath();
      g.arc(-4, -5, 2.2, Math.PI, 0);
      g.arc(0, -5.5, 2.4, Math.PI, 0);
      g.stroke();
    },
  },
  anchor: {
    cat: "shop",
    draw: (g) => {
      circle(g, 0, -6.5, 2);
      path(g, [[0, -4.5], [0, 7]]);
      path(g, [[-4, -2], [4, -2]]);
      g.beginPath();
      g.arc(0, 1, 6.5, Math.PI * 0.15, Math.PI * 0.85);
      g.stroke();
    },
  },
  pipe: {
    cat: "shop",
    draw: (g) => {
      path(g, [[-8, -3], [0, 1]]);
      path(g, [[0, 1], [0, 7], [6, 7], [6, -1], [0, -1]]);
      path(g, [[2, -3], [3, -6]]);
      path(g, [[4.5, -3], [6, -7]]);
    },
  },
  pawn: {
    cat: "shop",
    draw: (g) => {
      circle(g, 0, -4.5, 3, true);
      circle(g, -4.5, 3, 3, true);
      circle(g, 4.5, 3, 3, true);
    },
  },
  shoe: {
    cat: "shop",
    draw: (g) => {
      path(g, [[-5, -8], [0, -8], [0, 1], [7, 3], [7, 7], [-5, 7]], true);
      path(g, [[-5, 4], [7, 4]]);
    },
  },
  scissors: {
    cat: "shop",
    draw: (g) => {
      circle(g, -4.5, 5, 2.6);
      circle(g, 4.5, 5, 2.6);
      path(g, [[-3, 3], [5, -8]]);
      path(g, [[3, 3], [-5, -8]]);
    },
  },
  mortar: {
    cat: "shop",
    draw: (g) => {
      g.beginPath();
      g.moveTo(-7, -1);
      g.lineTo(7, -1);
      g.quadraticCurveTo(6, 7, 0, 7);
      g.quadraticCurveTo(-6, 7, -7, -1);
      g.stroke();
      path(g, [[1, -1], [6, -8]]);
    },
  },
  razor: {
    cat: "shop",
    draw: (g) => {
      g.strokeRect(-2.5, -8, 5, 16);
      for (const y of [-6, -2, 2, 6]) path(g, [[-2.5, y], [2.5, y - 2.5]]);
    },
  },
  hat: {
    cat: "shop",
    draw: (g) => {
      g.strokeRect(-4.5, -8, 9, 12);
      path(g, [[-8.5, 4], [8.5, 4]]);
      path(g, [[-4.5, 1], [4.5, 1]]);
    },
  },
  page: {
    cat: "shop",
    draw: (g) => {
      path(g, [[-6, -8], [3, -8], [6, -5], [6, 8], [-6, 8]], true);
      for (const y of [-3, 0, 3, 6]) path(g, [[-3.5, y], [3.5, y]]);
    },
  },
  book: {
    cat: "shop",
    draw: (g) => {
      g.strokeRect(-6, -8, 12, 16);
      g.fillRect(-6, -8, 2.5, 16);
      path(g, [[-1, -3], [4, -3]]);
      path(g, [[-1, 0], [4, 0]]);
    },
  },
  clock: {
    cat: "shop",
    draw: (g) => {
      circle(g, 0, 0, 7.5);
      path(g, [[0, -5], [0, 0], [3.5, 2]]);
    },
  },
  wheel: {
    cat: "shop",
    draw: (g) => {
      circle(g, 0, 0, 7.5);
      circle(g, 0, 0, 1.5, true);
      for (let i = 0; i < 6; i++) path(g, [[0, 0], [Math.cos((i * Math.PI) / 3) * 7.5, Math.sin((i * Math.PI) / 3) * 7.5]]);
    },
  },
  velocipede: {
    cat: "shop",
    draw: (g) => {
      circle(g, -2.5, 2, 6);
      circle(g, 6.5, 5, 3);
      path(g, [[-2.5, -4], [6.5, 5]]);
      path(g, [[-2.5, -4], [-5, -7]]);
    },
  },
  vase: {
    cat: "shop",
    draw: (g) => {
      g.beginPath();
      g.moveTo(-2.5, -8);
      g.lineTo(2.5, -8);
      g.quadraticCurveTo(0.5, -4, 5, 0);
      g.quadraticCurveTo(7, 7, 0, 8);
      g.quadraticCurveTo(-7, 7, -5, 0);
      g.quadraticCurveTo(-0.5, -4, -2.5, -8);
      g.stroke();
    },
  },
  board: {
    cat: "service",
    draw: (g) => {
      g.strokeRect(-7.5, -8, 15, 10);
      path(g, [[-5, 2], [-5, 8]]);
      path(g, [[5, 2], [5, 8]]);
      g.fillRect(-5, -6, 4, 5);
      g.fillRect(1, -6, 4, 3);
    },
  },
  box: {
    cat: "service",
    draw: (g) => {
      g.strokeRect(-6, -5, 12, 12);
      g.fillRect(-3.5, -2.5, 7, 1.8);
      path(g, [[-6, -5], [0, -8.5], [6, -5]]);
    },
  },
  letter: {
    cat: "service",
    draw: (g) => {
      g.strokeRect(-8, -5, 16, 11);
      path(g, [[-8, -5], [0, 1.5], [8, -5]]);
    },
  },
  boat: {
    cat: "service",
    draw: (g) => {
      path(g, [[-8.5, 1], [8.5, 1], [5, 6], [-5, 6]], true);
      path(g, [[-4, -1], [5, -7]]);
      path(g, [[4, -1], [-5, -7]]);
    },
  },
  police: {
    cat: "service",
    draw: (g) => {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 12; i++) {
        const r = i % 2 ? 3.6 : 8;
        const a = (i * Math.PI) / 6 - Math.PI / 2;
        pts.push([Math.cos(a) * r, Math.sin(a) * r]);
      }
      path(g, pts, true);
      circle(g, 0, 0, 1.5, true);
    },
  },
  bed: {
    cat: "bed",
    draw: (g) => {
      path(g, [[-8, -5], [-8, 6]]);
      path(g, [[8, 0], [8, 6]]);
      path(g, [[-8, 2], [8, 2]]);
      g.strokeRect(-8, -1.5, 16, 3.5);
      g.beginPath();
      g.ellipse(-4.5, -3, 2.6, 1.6, 0, 0, Math.PI * 2);
      g.fill();
    },
  },
  church: {
    cat: "sight",
    draw: (g) => {
      path(g, [[0, -9], [0, -4]]);
      path(g, [[-2, -7], [2, -7]]);
      path(g, [[-6, 0], [0, -4], [6, 0]]);
      g.strokeRect(-6, 0, 12, 8);
      path(g, [[0, 8], [0, 4]]);
    },
  },
  hall: {
    cat: "sight",
    draw: (g) => {
      path(g, [[-8.5, -3], [0, -8], [8.5, -3]], true);
      for (const x of [-6, -2, 2, 6]) path(g, [[x, -2], [x, 6]]);
      path(g, [[-8.5, 7], [8.5, 7]]);
    },
  },
  castle: {
    cat: "sight",
    draw: (g) => {
      path(g, [[-7, 8], [-7, -7], [-4.5, -7], [-4.5, -4], [-1.5, -4], [-1.5, -7], [1.5, -7], [1.5, -4], [4.5, -4], [4.5, -7], [7, -7], [7, 8]], true);
      g.beginPath();
      g.arc(0, 8, 2.5, Math.PI, 0);
      g.stroke();
    },
  },
  mill: {
    cat: "sight",
    draw: (g) => {
      path(g, [[-3, 8], [-2, -1], [2, -1], [3, 8]], true);
      path(g, [[-7, -9], [7, 5]]);
      path(g, [[7, -9], [-7, 5]]);
    },
  },
  pump: {
    cat: "pump",
    draw: (g) => {
      g.beginPath();
      g.moveTo(0, -8);
      g.bezierCurveTo(6, -1, 6, 7, 0, 7);
      g.bezierCurveTo(-6, 7, -6, -1, 0, -8);
      g.stroke();
    },
  },
};

/** The icon a place gets from its words when the game did not name one (the shops' labels). */
export function iconFor(label: string): string {
  const l = label.toLowerCase();
  const rules: Array<[RegExp, string]> = [
    [/bakery|bread/, "bread"],
    [/grocer|veg/, "veg"],
    [/butcher/, "meat"],
    [/fish/, "fish"],
    [/coffee|roaster/, "cup"],
    [/jenever|gin|liquor/, "bottle"],
    [/colonial/, "crate"],
    [/chandl/, "anchor"],
    [/tobacco/, "pipe"],
    [/berg van barm|pawn/, "pawn"],
    [/cobbler|shoe/, "shoe"],
    [/draper|tailor|cloth/, "scissors"],
    [/apothecar/, "mortar"],
    [/barber/, "razor"],
    [/hatter/, "hat"],
    [/printer/, "page"],
    [/book/, "book"],
    [/clock|watch/, "clock"],
    [/velocipede/, "velocipede"],
    [/wheelwright|cart/, "wheel"],
    [/second-hand|dealer/, "vase"],
    [/boats? for hire/, "boat"],
  ];
  for (const [re, icon] of rules) if (re.test(l)) return icon;
  return "vase";
}

/** One badge: a paper disc, its kind's rim, the picture in ink. `s` scales it (1 = 11 px round). */
export function drawBadge(g: G, icon: string, u: number, v: number, s: number): void {
  const ic = MAP_ICONS[icon] ?? MAP_ICONS.vase;
  const ink = CAT_INK[ic.cat];
  g.save();
  g.translate(u, v);
  g.scale(s, s);
  g.fillStyle = "#f3ead2";
  g.strokeStyle = ink;
  g.lineWidth = 2.2;
  circle(g, 0, 0, 11, true);
  circle(g, 0, 0, 11);
  g.scale(0.78, 0.78);
  g.lineWidth = 1.7;
  g.lineJoin = "round";
  g.lineCap = "round";
  g.strokeStyle = g.fillStyle = "#2a2420";
  if (ic.cat === "job" || ic.cat === "work" || ic.cat === "event") g.strokeStyle = g.fillStyle = ink;
  ic.draw(g);
  g.restore();
}
