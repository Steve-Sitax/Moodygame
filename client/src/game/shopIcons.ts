// M7 shops (docs/milestones/M7-shops.md): pocket icons for what the new shops sell, drawn in ink like the others
// (game/pockets.ts ICON; 32 x 32, the ink colour and a 1.5 px line already set).

type Draw = (g: CanvasRenderingContext2D) => void;

const line = (g: CanvasRenderingContext2D, pts: Array<[number, number]>, close = false) => {
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (const [x, y] of pts.slice(1)) g.lineTo(x, y);
  if (close) g.closePath();
  g.stroke();
};
const ellipse = (g: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, fill = false) => {
  g.beginPath();
  g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  if (fill) g.fill();
  else g.stroke();
};
const book = (g: CanvasRenderingContext2D, cross: boolean) => {
  g.strokeRect(8, 6, 16, 21);
  g.fillRect(8, 6, 2.5, 21);
  if (cross) {
    g.fillRect(15, 10, 1.5, 9);
    g.fillRect(12, 13, 7.5, 1.5);
  } else for (const y of [11, 14]) g.fillRect(13, y, 8, 1);
};

export const SHOP_ICONS: Record<string, Draw> = {
  peperkoek: (g) => {
    g.strokeRect(6, 12, 20, 10);
    for (const x of [10, 16, 22]) g.fillRect(x, 16, 1.5, 1.5);
  },
  sausage: (g) => {
    g.lineWidth = 5;
    g.beginPath();
    g.arc(16, 28, 14, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    g.lineWidth = 1.5;
  },
  bacon: (g) => {
    g.strokeRect(5, 11, 22, 11);
    for (const y of [14, 17, 20]) line(g, [[6, y], [26, y + 0.5]]);
  },
  brawn: (g) => {
    g.strokeRect(8, 10, 16, 13);
    for (const [x, y] of [[11, 14], [18, 13], [14, 19], [20, 19]]) ellipse(g, x, y, 1.5, 1.2, true);
  },
  cheese: (g) => line(g, [[5, 23], [27, 23], [27, 14], [5, 23]], true),
  candy: (g) => {
    ellipse(g, 16, 16, 6, 5);
    line(g, [[10, 16], [4, 12], [4, 20], [10, 16]], true);
    line(g, [[22, 16], [28, 12], [28, 20], [22, 16]], true);
  },
  figs: (g) => {
    for (const [x, y] of [[11, 18], [21, 18], [16, 12]]) {
      ellipse(g, x, y, 4.5, 5);
      g.fillRect(x - 0.5, y - 6.5, 1, 2);
    }
  },
  chocolate: (g) => {
    g.strokeRect(6, 9, 20, 14);
    line(g, [[13, 9], [13, 23]]);
    line(g, [[19, 9], [19, 23]]);
    line(g, [[6, 16], [26, 16]]);
  },
  tea: (g) => {
    g.strokeRect(8, 10, 16, 15);
    line(g, [[8, 10], [16, 5], [24, 10]]);
    ellipse(g, 16, 17, 3, 3);
  },
  pipe: (g) => {
    line(g, [[4, 12], [20, 16]]);
    g.strokeRect(19, 14, 7, 10);
  },
  cigar: (g) => {
    g.lineWidth = 4;
    line(g, [[5, 20], [25, 12]]);
    g.lineWidth = 1.5;
    g.fillRect(9, 15, 3, 5);
  },
  matches: (g) => {
    g.strokeRect(6, 12, 20, 11);
    for (const x of [10, 14, 18]) {
      line(g, [[x, 12], [x + 3, 5]]);
      g.fillRect(x + 2, 4, 2.5, 2.5);
    }
  },
  syrup: (g) => {
    g.strokeRect(11, 12, 10, 15);
    g.strokeRect(14, 7, 4, 5);
    g.fillRect(12, 17, 8, 4);
  },
  powder: (g) => {
    line(g, [[6, 10], [26, 10], [26, 22], [6, 22]], true);
    line(g, [[6, 10], [16, 16], [26, 10]]);
  },
  liquorice: (g) => {
    g.lineWidth = 3;
    line(g, [[8, 26], [24, 6]]);
    g.lineWidth = 1.5;
  },
  wool_vest: (g) => {
    line(g, [[9, 6], [13, 10], [16, 16], [19, 10], [23, 6], [25, 27], [7, 27]], true);
    for (const y of [19, 22, 25]) g.fillRect(15.5, y, 1.5, 1.5);
  },
  shawl: (g) => {
    line(g, [[4, 9], [28, 9], [16, 27]], true);
    line(g, [[16, 27], [14, 30]]);
    line(g, [[16, 27], [18, 30]]);
  },
  flat_cap: (g) => {
    g.beginPath();
    g.ellipse(15, 19, 11, 6, 0, Math.PI, 0);
    g.stroke();
    line(g, [[4, 19], [28, 20], [26, 23], [6, 21]], true);
  },
  felt_hat: (g) => {
    g.beginPath();
    g.arc(16, 19, 7, Math.PI, 0);
    g.stroke();
    line(g, [[4, 20], [28, 20]]);
  },
  laces: (g) => {
    g.beginPath();
    for (let x = 4; x <= 28; x += 1) g.lineTo(x, 16 + Math.sin(x / 2.5) * 5);
    g.stroke();
  },
  coffee_beans: (g) => {
    for (const [x, y] of [[11, 13], [20, 12], [15, 21], [23, 21]]) {
      ellipse(g, x, y, 4, 5);
      line(g, [[x, y - 4], [x, y + 4]]);
    }
  },
  almanac: (g) => {
    g.strokeRect(8, 6, 16, 21);
    g.font = "bold 7px Georgia, serif";
    g.fillText("1874", 9, 17);
  },
  paper_env: (g) => {
    g.strokeRect(5, 10, 22, 14);
    line(g, [[5, 10], [16, 18], [27, 10]]);
  },
  penny_book: (g) => book(g, false),
  prayer_book: (g) => book(g, true),
  watch: (g) => {
    ellipse(g, 16, 18, 9, 9);
    g.strokeRect(14, 5, 4, 4);
    line(g, [[16, 18], [16, 12]]);
    line(g, [[16, 18], [20, 20]]);
  },
  watch_key: (g) => {
    ellipse(g, 16, 10, 5, 5);
    line(g, [[16, 15], [16, 27]]);
    line(g, [[16, 24], [20, 24]]);
  },
};
