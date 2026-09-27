import type { DB } from "../db.ts";
import { GameError, log, player } from "../game.ts";
import { remember } from "../npcs.ts";
import { atWork, ITEMS, POCKET_SLOTS } from "../trade.ts";
import { resident } from "../town/store.ts";
import { writeEvent } from "../director/eventlog.ts";
import { pressTown, setMedal, BERG_LABEL, type PressTown } from "./town.ts";
import { asPlayer, pid } from "../player/current.ts";

// The Berg van Barmhartigheid (M6): the town's pawn office, the Antwerp
// Mont-de-Piete (founded 1620 by Wenceslas Cobergher; in the real town in the
// Venusstraat, here the counter by the Vleeshuis). The ENGINE owns every number:
//
// - What it takes: durable goods only, at a set worth (never food, papers or a job's parcel).
// - The loan: four fifths of the worth on silver, two thirds on other goods, rounded
//   down to 5 centimes (the Belgian monts lent 2/3 to 4/5 of the appraised value).
// - The ticket: a printed card in your pocket, in the pledge's place.
// - Interest: 5 in the hundred of the loan for each day begun, at least 1 centime a day.
//   (The real Berg asked about 12 in the hundred a YEAR; the game's week is its year.)
// - The term: redeem by the end of the third day after the day you pawned (and by the
//   end of the week). A pledge not redeemed goes to the Berg's sale that night: it is gone.
//
// The clerk's remark is the model's (with a fallback); it changes nothing.

/** What the Berg lends on, and what it is worth to them (centimes). */
export const PAWN_WORTH: Record<string, number> = { medal: 90, lantern: 40 };
/** Silver and gold: four fifths. */
const PRECIOUS = new Set(["medal"]);
export const INTEREST_PER_DAY = 0.05;
export const TERM_DAYS = 3;
export const WEEK_END = 7;

export interface PawnRow {
  id: number;
  item_kind: string;
  item_name: string;
  worth_c: number;
  loan_c: number;
  rate_c: number;
  day: number;
  hour: number;
  due_day: number;
  status: "held" | "redeemed" | "forfeit";
  paid_c: number | null;
  closed_day: number | null;
}

/** The loan on a thing: 4/5 on silver, 2/3 on the rest, down to 5 centimes. */
export function loanFor(kind: string): number {
  const worth = PAWN_WORTH[kind];
  if (!worth) return 0;
  const share = PRECIOUS.has(kind) ? 4 / 5 : 2 / 3;
  return Math.floor((worth * share) / 5) * 5;
}

/** Interest a day: 5 in the hundred of the loan, at least 1 centime. */
export function rateFor(loan: number): number {
  return Math.max(1, Math.ceil(loan * INTEREST_PER_DAY));
}

/** To redeem on `day`: the loan and the interest for each day begun (the day of pawning counts). */
export function redeemCost(p: Pick<PawnRow, "loan_c" | "rate_c" | "day">, day: number): number {
  const days = Math.max(1, day - p.day + 1);
  return p.loan_c + p.rate_c * days;
}

export function dueDay(day: number): number {
  return Math.min(WEEK_END, day + TERM_DAYS);
}

export function bergClerk(db: DB): string | null {
  return pressTown(db)?.berg?.clerk ?? null;
}

function today(db: DB): { day: number; hour: number } {
  return db.prepare("SELECT day, hour FROM player WHERE id = 1").get() as { day: number; hour: number };
}

function openNow(db: DB): void {
  const clerk = bergClerk(db);
  if (!clerk) throw new GameError("there is no pawn office in this town", 404);
  if (!atWork(db, clerk)) throw new GameError("the Berg's counter is shut; it opens in the morning", 409);
}

/** The player's own pledges (M8c: pawn.player_id). */
export function pawns(db: DB, status?: PawnRow["status"]): PawnRow[] {
  return (status
    ? db.prepare("SELECT * FROM pawn WHERE status = ? AND player_id = ? ORDER BY id").all(status, pid())
    : db.prepare("SELECT * FROM pawn WHERE player_id = ? ORDER BY id").all(pid())) as PawnRow[];
}

/** Jef's mother's medal is the host's (sewn in Jef's coat); a guest has none. */
export function medalOf(db: DB): PressTown["medal"] | "none" {
  return pid() === 1 ? (pressTown(db)?.medal ?? "owned") : "none";
}

function pocketsUsed(db: DB): number {
  return (db.prepare("SELECT COUNT(*) AS n FROM item WHERE player_id = ?").get(pid()) as { n: number }).n;
}

/** What the counter can show: what Jef could pawn, and his tickets with today's price. */
export function bergView(db: DB) {
  const { day } = today(db);
  const clerk = bergClerk(db);
  const items = db.prepare("SELECT id, kind FROM item WHERE job_id IS NULL AND player_id = ? ORDER BY id").all(pid()) as Array<{ id: number; kind: string }>;
  const offers = items.filter((i) => PAWN_WORTH[i.kind]).map((i) => ({ item: i.id, kind: i.kind, name: ITEMS[i.kind]?.name ?? i.kind, loan_c: loanFor(i.kind) }));
  if (medalOf(db) === "owned") offers.unshift({ item: 0, kind: "medal", name: ITEMS.medal.name, loan_c: loanFor("medal") });
  const tickets = pawns(db, "held").map((p) => ({ id: p.id, name: p.item_name, loan_c: p.loan_c, rate_c: p.rate_c, due_day: p.due_day, redeem_c: redeemCost(p, day) }));
  return {
    label: BERG_LABEL,
    clerk,
    clerk_name: clerk ? (resident(db, clerk)?.name ?? null) : null,
    open: clerk ? atWork(db, clerk) : false,
    day,
    offers,
    tickets,
    terms: `Loans at two thirds of the worth, four fifths on silver. Interest ${Math.round(INTEREST_PER_DAY * 100)} in the hundred a day begun. Redeem within ${TERM_DAYS} days; pledges not redeemed are sold.`,
  };
}

/**
 * Pawn a thing: `item` is a pocket row id, or 0 for the medal sewn in Jef's coat.
 * The thing goes, the loan is paid out, a ticket takes its place in the pocket.
 */
export function pawn(db: DB, item: number): { text: string; pawn: PawnRow } {
  openNow(db);
  const { day, hour } = today(db);
  let kind: string;
  if (item === 0) {
    if (medalOf(db) !== "owned") throw new GameError("you have no medal to pawn", 409);
    kind = "medal";
    if (pocketsUsed(db) >= POCKET_SLOTS) throw new GameError("your pockets are full; there is no room for the ticket", 409);
  } else {
    const row = db.prepare("SELECT id, kind, job_id FROM item WHERE id = ? AND player_id = ?").get(item, pid()) as { id: number; kind: string; job_id: number | null } | undefined;
    if (!row) throw new GameError("not in your pockets", 404);
    if (row.job_id !== null) throw new GameError("that is not yours to pawn", 409);
    kind = row.kind;
  }
  const loan = loanFor(kind);
  if (!loan) throw new GameError(`the Berg lends on goods that keep, not on ${ITEMS[kind]?.name ?? kind}`, 409);
  const rate = rateFor(loan);
  const due = dueDay(day);
  const name = ITEMS[kind]?.name ?? kind;
  let id = 0;
  db.transaction(() => {
    if (item === 0) setMedal(db, "pawned");
    else db.prepare("DELETE FROM item WHERE id = ? AND player_id = ?").run(item, pid());
    id = Number(
      db
        .prepare("INSERT INTO pawn (item_kind, item_name, worth_c, loan_c, rate_c, day, hour, due_day, status, player_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'held', ?)")
        .run(kind, name, PAWN_WORTH[kind], loan, rate, day, hour, due, pid()).lastInsertRowid,
    );
    db.prepare("INSERT INTO item (kind, job_id, ref, player_id) VALUES ('pawn_ticket', NULL, ?, ?)").run(id, pid());
    db.prepare("UPDATE player SET money_c = money_c + ? WHERE id = ?").run(loan, pid());
    log(db, "pawned", kind, `Jef pawned ${name} at the Berg van Barmhartigheid for ${loan} centimes.`);
  })();
  const clerk = bergClerk(db);
  if (clerk) remember(db, clerk, `Jef pawned ${name.replace(/^your /, "his ")} with me for ${loan} centimes.`, 3);
  const p = db.prepare("SELECT * FROM pawn WHERE id = ?").get(id) as PawnRow;
  return { text: `The clerk writes a ticket, No. ${1000 + id}, and counts out ${loan} centimes. Redeem by ${dayName(due)}.`, pawn: p };
}

/** Redeem a ticket: the loan and the interest, and the thing comes back. */
export function redeem(db: DB, pawnId: number): { text: string; paid_c: number } {
  openNow(db);
  const { day } = today(db);
  const p = db.prepare("SELECT * FROM pawn WHERE id = ? AND player_id = ?").get(pawnId, pid()) as PawnRow | undefined;
  if (!p || p.status !== "held") throw new GameError("no such pledge at the Berg", 404);
  const ticket = db.prepare("SELECT id FROM item WHERE kind = 'pawn_ticket' AND ref = ? AND player_id = ?").get(pawnId, pid()) as { id: number } | undefined;
  if (!ticket) throw new GameError("no ticket, no pledge", 409);
  const cost = redeemCost(p, day);
  if (player(db).money_c < cost) throw new GameError(`not enough money: ${cost} c to redeem it`, 409);
  db.transaction(() => {
    db.prepare("UPDATE player SET money_c = money_c - ? WHERE id = ?").run(cost, pid());
    db.prepare("DELETE FROM item WHERE id = ?").run(ticket.id);
    if (p.item_kind === "medal") setMedal(db, "owned");
    else db.prepare("INSERT INTO item (kind, job_id, player_id) VALUES (?, NULL, ?)").run(p.item_kind, pid());
    db.prepare("UPDATE pawn SET status = 'redeemed', paid_c = ?, closed_day = ? WHERE id = ?").run(cost, day, p.id);
    log(db, "redeemed", p.item_kind, `Jef redeemed ${p.item_name} at the Berg van Barmhartigheid for ${cost} centimes.`);
  })();
  return { text: `You hand over the ticket and ${cost} centimes. ${p.item_kind === "medal" ? "The medal comes back in a twist of paper; you sew it into your coat again." : `The clerk fetches ${p.item_name} from the back.`}`, paid_c: cost };
}

/**
 * The night (and the start of a day): pledges past their day are sold at the Berg's sale.
 * The ticket goes from the pocket. Returns what was sold.
 * M8c: every player's pledges at once (the Berg's sale is the world's); each line is its owner's (asPlayer).
 */
export function forfeitPawns(db: DB): Array<PawnRow & { player_id: number }> {
  const { day } = today(db);
  const late = db.prepare("SELECT * FROM pawn WHERE status = 'held' AND due_day < ?").all(day) as Array<PawnRow & { player_id: number }>;
  if (!late.length) return [];
  db.transaction(() => {
    for (const p of late) {
      asPlayer(p.player_id, () => {
        db.prepare("UPDATE pawn SET status = 'forfeit', closed_day = ? WHERE id = ?").run(day, p.id);
        db.prepare("DELETE FROM item WHERE kind = 'pawn_ticket' AND ref = ? AND player_id = ?").run(p.id, p.player_id);
        if (p.item_kind === "medal") setMedal(db, "sold");
        log(db, "pawn_sold", p.item_kind, `The Berg van Barmhartigheid sold ${p.item_name.replace(/^your /, "Jef's ")} at its sale; the ticket had run out.`);
        writeEvent(db, { kind: "log", verb: "pawn_sold", text: `A pledge of Jef's (${p.item_name.replace(/^your /, "his ")}) went to the Berg's sale.`, weight: 3 });
      });
    }
  })();
  return late;
}

function dayName(d: number): string {
  return ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"][(d - 1) % 7] + " night";
}

/** A ticket, to read in the pockets. */
export function ticketView(db: DB, pawnId: number) {
  const has = db.prepare("SELECT 1 FROM item WHERE kind = 'pawn_ticket' AND ref = ? AND player_id = ?").get(pawnId, pid());
  if (!has) throw new GameError("not in your pockets", 404);
  const p = db.prepare("SELECT * FROM pawn WHERE id = ?").get(pawnId) as PawnRow;
  const { day } = today(db);
  return { no: 1000 + p.id, name: p.item_name, loan_c: p.loan_c, rate_c: p.rate_c, day: p.day, due: dayName(p.due_day), redeem_c: redeemCost(p, day), status: p.status };
}
