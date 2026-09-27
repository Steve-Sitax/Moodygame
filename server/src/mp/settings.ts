import fs from "node:fs";
import path from "node:path";
import { DB_FILE } from "../config.ts";
import { newJoinCode } from "./players.ts";

// M8a multiplayer: the host's own settings (not part of a save): whether the town is played together,
// whether the server listens on the home network ("Open to the house"), and the join code on the host's
// screen. Kept in data/mp-config.json next to the save (a test save data/test-<name>.sqlite gets
// data/test-<name>.mp-config.json, deleted by teststack.mjs stop). SCHELDEMIST_MP_CONFIG overrides the path.
// SCHELDEMIST_LAN=1 opens the house at start (npm run host); SCHELDEMIST_MP=1 plays together without the LAN;
// SCHELDEMIST_VPN=1 opens it to the VPN (M8e).

export interface MpSettings {
  /** Played together: no pause, the server moves the clock, guests may join. */
  multiplayer: boolean;
  /** "Open to the house": the server also listens on the home network and serves the built game. */
  lan: boolean;
  /** M8e "Open to my VPN": the server also listens (https only) on the VPN's address (NetBird, Tailscale: 100.64.0.0/10). */
  vpn: boolean;
  /** The join code on the host's screen. */
  code: string;
}

export function mpConfigFileFor(dbFile: string): string {
  if (process.env.SCHELDEMIST_MP_CONFIG) return path.resolve(process.env.SCHELDEMIST_MP_CONFIG);
  const base = path.basename(dbFile);
  if (base === "game.sqlite") return path.join(path.dirname(dbFile), "mp-config.json");
  return path.join(path.dirname(dbFile), base.replace(/\.sqlite$/i, "") + ".mp-config.json");
}

/** Under the tests no file is read or written unless SCHELDEMIST_MP_CONFIG names one. */
const file: string | null = process.env.VITEST && !process.env.SCHELDEMIST_MP_CONFIG ? null : DB_FILE === ":memory:" ? null : mpConfigFileFor(DB_FILE);

let current: MpSettings = read();

function read(): MpSettings {
  const d: MpSettings = { multiplayer: false, lan: false, vpn: false, code: newJoinCode() };
  if (file && fs.existsSync(file)) {
    try {
      const j = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<MpSettings>;
      if (typeof j.multiplayer === "boolean") d.multiplayer = j.multiplayer;
      if (typeof j.lan === "boolean") d.lan = j.lan;
      if (typeof j.vpn === "boolean") d.vpn = j.vpn;
      if (typeof j.code === "string" && /^[A-Z]{4}-[0-9]{2}$/.test(j.code)) d.code = j.code;
    } catch (e) {
      console.warn(`[mp] ${file} could not be read; defaults`, e);
    }
  }
  if (process.env.SCHELDEMIST_LAN === "1") d.lan = true;
  if (process.env.SCHELDEMIST_MP === "1") d.multiplayer = true;
  if (process.env.SCHELDEMIST_VPN === "1") d.vpn = true;
  if (d.lan || d.vpn) d.multiplayer = true;
  return d;
}

function write(): void {
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, ...current }, null, 2));
    fs.renameSync(tmp, file);
  } catch (e) {
    console.warn("[mp] settings not written", e);
  }
}

export const mpSettings = (): Readonly<MpSettings> => current;
/** Played together now? */
export const mpOn = (): boolean => current.multiplayer;

export function setMp(patch: Partial<Pick<MpSettings, "multiplayer" | "lan" | "vpn">>): MpSettings {
  if (typeof patch.multiplayer === "boolean") current.multiplayer = patch.multiplayer;
  if (typeof patch.lan === "boolean") current.lan = patch.lan;
  if (typeof patch.vpn === "boolean") current.vpn = patch.vpn;
  if (current.lan || current.vpn) current.multiplayer = true;
  write();
  return current;
}

export function newCode(): string {
  current.code = newJoinCode();
  write();
  return current.code;
}

/** Test helper: settings without a file. */
export function resetMpSettings(s: Partial<MpSettings> = {}): void {
  current = { multiplayer: false, lan: false, vpn: false, code: newJoinCode(), ...s };
}
