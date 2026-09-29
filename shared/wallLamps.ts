// The town wall's gas lamps (issue #14, 2026-09-29). ONE rule for what the client and the server both need: which
// lamp of the wall gets which id. The spots themselves have one source, the node "wall_dressing" in wall.glb
// (tools/blender/build_wall.py writes it): the client reads it with the model (world/rampart.ts wallLamps), the server
// from the same file's JSON chunk (server/src/town/wallDressing.ts), and both number the lamps here, so a lamp moved
// or added in Blender moves on both sides at once. No imports: node and vite both read this file.

/** The wall's lamps are the town's gas lamps "d1000", "d1001" ... (the city's own are d0.. from city.json decor.lamps). */
export const WALL_LAMP_ID0 = 1000;

/** What wall.glb's dressing says of the lamps: the gas lamps on the walk (x, z, the walk's height) and the lanterns' glass (x, y, z). */
export interface WallLampSpots {
  lamps: Array<[number, number, number]>;
  lanterns: Array<[number, number, number]>;
}

export interface WallLamp {
  /** The number gaslamps.ts addDecor takes; the id is `d${n}`. */
  n: number;
  id: string;
  kind: "lamp" | "lantern";
  x: number;
  z: number;
  /** A lamp on the walk: the walk's height at its foot (the post stands there). A lantern: its glass. */
  y: number;
}

/** Every lamp of the wall with its id, in the order the client adds them: the walk's lamps, then the lanterns. */
export function wallLampList(d: WallLampSpots | null | undefined): WallLamp[] {
  const out: WallLamp[] = [];
  let n = WALL_LAMP_ID0;
  for (const [x, z, y] of d?.lamps ?? []) out.push({ n, id: `d${n++}`, kind: "lamp", x, z, y });
  for (const [x, y, z] of d?.lanterns ?? []) out.push({ n, id: `d${n++}`, kind: "lantern", x, z, y });
  return out;
}

/** Is this one of the wall's lamps (by its id)? */
export const isWallLamp = (id: string) => /^d\d+$/.test(id) && Number(id.slice(1)) >= WALL_LAMP_ID0;
