import { shipName } from "../../../shared/fleet.ts";

/** The demonstration map uses the same hull identities as the playable harbour. */
export function demoBoats(lane: (a: number, b: number, v: number) => number) {
  return [
    { id: "anna_maria", name: shipName("anna_maria"), kind: "brig", x: -42, z: -8, yaw: Math.PI / 2, moored: true },
    { id: "stad_boom", name: shipName("stad_boom"), kind: "lighter_loaded", x: lane(-400, 200, 2), z: -40, yaw: Math.PI / 2, cargo: "coffee" },
    { id: "kempenland", name: shipName("kempenland"), kind: "liner", x: 150 - lane(0, 500, 1), z: -65, yaw: -Math.PI / 2, tide: "high" },
  ];
}
