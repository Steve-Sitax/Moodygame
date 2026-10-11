import { GAS_LAMP_DECAY } from "../retro/psx";

// The light of the town's lamps and lanterns, one table (2026-10-11, Steve: "make sure other lamp designs are all up
// to snuff and the light they give is all in a similar way"). Every lamp and lantern is one of these kinds, built from
// one design (tools/blender/lantern_kit.py) and lit from this table: its strength, reach and fall-off, its flame's
// colour and the size of its halo. Gas burns the gas lamps' warm (0xffa048) and falls off with GAS_LAMP_DECAY, so its
// light stops under the lantern's roof (retro/psx.ts psxLampCap); oil is a little warmer and dimmer, and falls off
// softer, as a carried lantern's always did (world/lanternLights.ts). Strength goes with the size of the flame: the
// street lamp's big burner, a post's smaller one, a wall lantern's, a ship's or a pier's oil lamp, a hand lantern.
//
// Who uses which:
// - street:  the street gas lamps (props.glb gas_lamp: the city, the quays, the wall's walk) (world/gaslamps.ts)
// - post:    the smaller gas lamp posts: the park's, the quay steps', the wall's bridges (world/gaslamps.ts, spill.ts)
// - bracket: gas lanterns on wall arms: by doors and passages (world/ambient.ts), the wall's guard houses and gates
//            (world/rampart.ts), the prison's (world/prison.ts), the doss house's (world/rijnkaai.ts)
// - oil:     oil lanterns that hang or stand: the landing stage and the ferry, the boats, the Madonnas' corners
// - hand:    a lantern carried in the hand (world/lanternLights.ts: the townspeople's, the police's, Jef's)
//
// Lit and unlit by the same rules everywhere: the gas lamps by the lamplighter, else by the clock (rijnkaai.ts
// DAYLIGHT lampsLit), and in the day's thick fog (gaslamps.ts FOG_DAY_GLOW); lanterns by the dark (lanternDarkAt).
// Unlit glass takes the air's colour, lit glass the flame's (gaslamps.ts glassColor).

export type LampKind = "street" | "post" | "bracket" | "oil" | "hand";

export interface LampLight {
  /** Point-light intensity at full flame (three.js, physically correct lights off: the street lamp's is 26). */
  power: number;
  /** How far it reaches, metres. */
  range: number;
  decay: number;
  /** The flame's colour (sRGB hex, as a THREE.Color takes it). */
  color: number;
  /** Its halo across, metres (gaslamps.ts halos, rijnkaai.ts quay halos). */
  halo: number;
}

export const GAS_FLAME = 0xffa048;
export const OIL_FLAME = 0xff9640;
/** The softer fall-off of a flame that hangs low and has no roof to stop it (lanternLights.ts). */
export const OIL_DECAY = 1.25;

export const LAMP_LIGHT: Record<LampKind, LampLight> = {
  street: { power: 26, range: 18, decay: GAS_LAMP_DECAY, color: GAS_FLAME, halo: 1.1 },
  post: { power: 17, range: 16, decay: GAS_LAMP_DECAY, color: GAS_FLAME, halo: 0.9 },
  bracket: { power: 9, range: 13, decay: GAS_LAMP_DECAY, color: GAS_FLAME, halo: 0.7 },
  oil: { power: 5, range: 10, decay: OIL_DECAY, color: OIL_FLAME, halo: 0.6 },
  hand: { power: 3.6, range: 10, decay: OIL_DECAY, color: OIL_FLAME, halo: 0.45 },
};

/** A lantern's strength as world/lanternLights.ts addLantern takes it (1 = a hand lantern). */
export function lanternPower(kind: LampKind): number {
  return LAMP_LIGHT[kind].power / LAMP_LIGHT.hand.power;
}
