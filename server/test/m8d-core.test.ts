import { afterEach, describe, expect, it } from "vitest";
import { asPlayer, setOnlineIds, setPositionSource } from "../src/player/current.ts";
import { jefAt, playersAt, resetSync, syncFromClient } from "../src/director/actions.ts";

// M8d: every player has his own place for the director and the events.

afterEach(() => {
  resetSync();
  setOnlineIds(null);
  setPositionSource(null);
});

describe("M8d each player's place", () => {
  it("a guest's sync does not move the host", () => {
    const now = 1_000_000;
    asPlayer(1, () => syncFromClient({ x: 10, z: 20 }, now));
    asPlayer(2, () => syncFromClient({ x: -30, z: 40 }, now));
    expect(asPlayer(1, () => jefAt(now))).toEqual({ x: 10, z: 20 });
    expect(asPlayer(2, () => jefAt(now))).toEqual({ x: -30, z: 40 });
    expect(jefAt(now, 2)).toEqual({ x: -30, z: 40 });
    expect(jefAt(now)).toEqual({ x: 10, z: 20 }); // outside a player: the host
    expect(jefAt(now, 3)).toBeNull();
  });

  it("the movement socket's place comes first; playersAt lists everyone known", () => {
    const now = 1_000_000;
    asPlayer(1, () => syncFromClient({ x: 1, z: 1 }, now));
    setOnlineIds(() => [1, 2, 3]);
    setPositionSource((id) => (id === 2 ? { x: 5, z: 6 } : null));
    expect(playersAt(now)).toEqual([
      { id: 1, x: 1, z: 1 },
      { id: 2, x: 5, z: 6 },
    ]);
  });

  it("an old word is forgotten", () => {
    asPlayer(2, () => syncFromClient({ x: 3, z: 4 }, 0));
    expect(jefAt(10 * 60_000, 2)).toBeNull();
  });
});
