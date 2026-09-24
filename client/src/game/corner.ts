// The top-left corner of the screen (fixes 2026-09-24, Steve: "event cards are under the time card"):
// the clock and the task card (a job, an event's work, a watch) both stood at 18 px, 14-16 px from the
// top, so the task card lay under the clock. Both now go into one column here, the clock first, so
// the task card always sits below it however tall the clock grows (the rent line).

let col: HTMLDivElement | null = null;

/** The top-left column; made the first time it is asked for. */
export function topLeft(): HTMLDivElement {
  if (!col) {
    col = document.createElement("div");
    col.className = "top-left";
    document.body.appendChild(col);
  }
  return col;
}
