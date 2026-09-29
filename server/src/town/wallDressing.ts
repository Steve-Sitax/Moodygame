import fs from "node:fs";
import path from "node:path";
import { PUBLIC_DIR } from "../config.ts";
import { wallLampList, type WallLamp, type WallLampSpots } from "../../../shared/wallLamps.ts";

// What build_wall.py placed on the town wall, as the game draws it: the node "wall_dressing" of wall.glb (a JSON
// string in its extras; client world/rampart.ts reads the same node from the same file). Read once from the glTF's
// JSON chunk: the geometry is not needed. An empty dressing when the file is missing or not a glb.

export interface WallDressingData extends WallLampSpots {
  benches: Array<{ x: number; z: number; y: number }>;
}

let cache: WallDressingData | null = null;

export function wallDressing(file = path.join(PUBLIC_DIR, "models", "wall.glb")): WallDressingData {
  if (cache) return cache;
  let d: Partial<WallDressingData> = {};
  try {
    const b = fs.readFileSync(file);
    if (b.readUInt32LE(0) === 0x46546c67) {
      const len = b.readUInt32LE(12);
      const gltf = JSON.parse(b.subarray(20, 20 + len).toString("utf8")) as { nodes?: Array<{ name?: string; extras?: { dressing?: string } }> };
      const node = gltf.nodes?.find((n) => n.name === "wall_dressing");
      if (node?.extras?.dressing) d = JSON.parse(node.extras.dressing) as Partial<WallDressingData>;
    }
  } catch {
    d = {};
  }
  cache = {
    benches: (d.benches ?? []).map((q) => ({ x: q.x, z: q.z, y: q.y })),
    lamps: d.lamps ?? [],
    lanterns: d.lanterns ?? [],
  };
  return cache;
}

/** The wall's gas lamps and lanterns with their ids (shared/wallLamps.ts), as the client adds them. */
export function wallLamps(): WallLamp[] {
  return wallLampList(wallDressing());
}
