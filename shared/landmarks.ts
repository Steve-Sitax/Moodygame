// The landmark interiors (M6 landmark interiors): the cathedral, the town hall, the Vleeshuis,
// the Steen and the Oostershuis. The ENGINE's numbers and hours, read by both sides: the
// server decides who is inside and what goes on (server/src/landmarks/), the client builds
// the halls (client/src/world/landmarkRooms.ts) and plays the life in them.
// No imports: both the server (node, .ts) and the client (vite) read this file.

export type LandmarkId = "cathedral" | "townhall" | "vleeshuis" | "steen" | "oostershuis";
export const LANDMARK_IDS: LandmarkId[] = ["cathedral", "townhall", "vleeshuis", "steen", "oostershuis"];

export interface LandmarkDoor {
  id: string;
  landmark: LandmarkId;
  /** "the west door of the cathedral" */
  label: string;
  /** The step outside, on reachable ground (world metres), and out of the building. */
  step: [number, number];
  out: [number, number];
  /** Ground height at the step (the Steen's courtyard is 2.2 m up). */
  y: number;
  /** Which way in: the room's entry of that name. */
  entry: string;
}

/**
 * The doors, from the landmark build (tools/blender/build_landmarks.py prints them) and the
 * walk map (the step is the first reachable ground in front of each door, checked).
 */
export const LANDMARK_DOORS: LandmarkDoor[] = [
  { id: "cathedral_west", landmark: "cathedral", label: "the west door of the cathedral", step: [-262, 144.3], out: [0, -1], y: 0, entry: "main" },
  { id: "townhall_main", landmark: "townhall", label: "the town hall", step: [-257, 63.0], out: [0, 1], y: 0, entry: "main" },
  { id: "vleeshuis_main", landmark: "vleeshuis", label: "the Vleeshuis", step: [-122, 87.5], out: [0, -1], y: 0, entry: "main" },
  { id: "vleeshuis_north", landmark: "vleeshuis", label: "the north door of the Vleeshuis", step: [-115.7, 110.4], out: [0, 1], y: 0, entry: "north" },
  { id: "steen_museum", landmark: "steen", label: "the museum in the Steen", step: [-183.5, -21.6], out: [0, 1], y: 2.2, entry: "main" },
  { id: "oostershuis_gate", landmark: "oostershuis", label: "the Oostershuis", step: [120, 123.0], out: [0, -1], y: 0, entry: "main" },
];

export const LANDMARK_LABEL: Record<LandmarkId, string> = {
  cathedral: "the cathedral",
  townhall: "the town hall",
  vleeshuis: "the Vleeshuis",
  steen: "the museum in the Steen",
  oostershuis: "the Oostershuis",
};

/** Day of the week, 1 Monday .. 7 Sunday (day 1 of the game is a Monday). */
export const weekday = (day: number) => ((day - 1) % 7) + 1;
export const isSunday = (day: number) => weekday(day) === 7;

// ------------------------------------------------------------------ hours

/**
 * When each door is open (hours, fractional). The cathedral from six to seven in the evening;
 * the town hall's offices on weekdays; Peyrot's wine warehouse on weekdays and the theatre
 * society's evenings; the museum from ten to four (the board by its door, steenlife.ts); the
 * State's warehouse in the Oostershuis on weekdays.
 */
export function landmarkOpen(id: LandmarkId, day: number, hour: number): boolean {
  const wd = weekday(day);
  switch (id) {
    case "cathedral":
      return hour >= 6 && hour < 19;
    case "townhall":
      return wd !== 7 && hour >= 9 && hour < 16;
    case "vleeshuis":
      return (wd !== 7 && hour >= 7 && hour < 18) || theatreAt(day, hour) !== null;
    case "steen":
      return hour >= 10 && hour < 16;
    case "oostershuis":
      return wd !== 7 && hour >= 7 && hour < 18;
  }
}

/** What the closed door says. */
export const CLOSED_TEXT: Record<LandmarkId, string> = {
  cathedral: "The west door is shut for the night. The cathedral opens at six in the morning.",
  townhall: "The town hall's door is shut. The offices open at nine on weekdays.",
  vleeshuis: "The Vleeshuis is locked. Peyrot's cellar opens at seven on weekdays.",
  steen: 'A board by the door: "MUSEUM OF ANTIQUITIES. Open from ten till four. Admission free." The door is shut.',
  oostershuis: "The gate of the Oostershuis is barred. The State's warehouse opens at seven on weekdays.",
};

// ------------------------------------------------------------------ the cathedral

/** M7 funeral: "funeral", the requiem of a town funeral (an M4 event gone into the cathedral, landmarks/life.ts). */
export type Service = { kind: "low" | "high" | "vespers" | "wedding" | "funeral"; from: number; to: number; celebrant: "confessor" | "parish"; organ: boolean };

/**
 * Mass at set hours (M7 clock: a game hour is two real minutes, so a low mass is two minutes of play).
 * Weekdays: low masses at seven, nine and eleven, said by the curate. Sundays: an early low
 * mass at seven, the high mass from nine to eleven with the organ (the pious of the town
 * come then: their schedules say "church" from a quarter to nine), vespers at three.
 */
export function massAt(day: number, hour: number): Service | null {
  if (isSunday(day)) {
    if (hour >= 7 && hour < 8) return { kind: "low", from: 7, to: 8, celebrant: "confessor", organ: false };
    if (hour >= 9 && hour < 11) return { kind: "high", from: 9, to: 11, celebrant: "parish", organ: true };
    if (hour >= 15 && hour < 16) return { kind: "vespers", from: 15, to: 16, celebrant: "confessor", organ: true };
    return null;
  }
  for (const h of [7, 9, 11]) if (hour >= h && hour < h + 1) return { kind: "low", from: h, to: h + 1, celebrant: "confessor", organ: false };
  return null;
}

/** The curate hears confession when he is not at the altar: mornings and afternoons, not on Sunday afternoon. */
export function confessionOpen(day: number, hour: number): boolean {
  if (massAt(day, hour)) return false;
  if (isSunday(day)) return hour >= 6.5 && hour < 9;
  return (hour >= 8 && hour < 12) || (hour >= 14.5 && hour < 18.5);
}

/** The organist practises on weekday afternoons. */
export const organPractice = (day: number, hour: number) => !isSunday(day) && hour >= 13.5 && hour < 15;

/** A candle at the Lady altar, an engine price. */
export const CANDLE_C = 2;
/** The chair woman's rent for a chair during mass. */
export const CHAIR_C = 1;

// ------------------------------------------------------------------ the town hall

/** Civil weddings in the wedding hall: Tuesday, Thursday and Saturday at eleven. */
export function civilWeddingAt(day: number, hour: number): { from: number; to: number } | null {
  const wd = weekday(day);
  if ((wd === 2 || wd === 4 || wd === 6) && hour >= 11 && hour < 12) return { from: 11, to: 12 };
  return null;
}
export const civilWeddingDay = (day: number) => [2, 4, 6].includes(weekday(day));

// ------------------------------------------------------------------ the Vleeshuis

/**
 * The theatre hall upstairs: the society rehearses on Tuesday and Friday evenings, and plays
 * to an audience on Sunday evenings.
 */
export function theatreAt(day: number, hour: number): { kind: "rehearsal" | "performance"; from: number; to: number } | null {
  const wd = weekday(day);
  if ((wd === 2 || wd === 5) && hour >= 19 && hour < 22) return { kind: "rehearsal", from: 19, to: 22 };
  if (wd === 7 && hour >= 18 && hour < 21) return { kind: "performance", from: 18, to: 21 };
  return null;
}
