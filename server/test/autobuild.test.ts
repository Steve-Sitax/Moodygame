import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AutoBuild, buildingPage } from "../src/mp/autobuild.ts";

// The built game for the house kept up to date by the server (Steve, 2026-09-27: no more "run npm" on the laptop).

function tree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "autobuild-"));
  fs.mkdirSync(path.join(root, "client", "src"), { recursive: true });
  fs.mkdirSync(path.join(root, "client", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "shared"), { recursive: true });
  const src = path.join(root, "client", "src", "main.ts");
  fs.writeFileSync(src, "x");
  return { root, dist: path.join(root, "client", "dist"), src };
}
const touch = (f: string, ms: number) => fs.utimesSync(f, ms / 1000, ms / 1000);

describe("the build for the house", () => {
  it("no manifest: stale; a manifest newer than the code: fresh; code changed after it: stale again", () => {
    const t = tree();
    const b = new AutoBuild(t.root, t.dist, true);
    expect(b.stale(1)).toBe(true);
    const man = path.join(t.dist, "manifest.json");
    fs.writeFileSync(man, "{}");
    const now = Date.now();
    touch(t.src, now - 60_000);
    touch(man, now - 30_000);
    expect(b.stale(now)).toBe(false);
    const changed = path.join(t.root, "shared", "x.ts");
    fs.writeFileSync(changed, "y");
    touch(changed, now - 1000);
    // (the code's time is looked at again only every few seconds)
    expect(b.stale(now + 1)).toBe(false);
    expect(b.stale(now + 6000)).toBe(true);
  });

  it("off (another dist, or the tests): it never builds and says whether a build is there", async () => {
    const t = tree();
    const b = new AutoBuild(t.root, t.dist, false);
    expect(b.status.state).toBe("off");
    expect(await b.ensure()).toBe(false);
    fs.writeFileSync(path.join(t.dist, "manifest.json"), "{}");
    expect(await b.ensure()).toBe(true);
    expect(b.building).toBe(false);
  });

  it("the waiting page reloads itself while it builds; a failed build says why and does not loop", () => {
    const busy = buildingPage({ state: "building", step: "building the game", startedAt: Date.now() - 5000, error: null });
    expect(busy).toMatch(/http-equiv="refresh"/);
    expect(busy).toMatch(/building the game, 5 s so far/);
    const bad = buildingPage({ state: "failed", step: "", startedAt: 0, error: "vite <boom>" });
    expect(bad).not.toMatch(/refresh/);
    expect(bad).toMatch(/vite &lt;boom&gt;/);
  });
});
