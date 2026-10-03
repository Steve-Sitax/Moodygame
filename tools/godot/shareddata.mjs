// The Godot port's copy of the game's shared tables that are TypeScript, not JSON: this reads them from shared/
// and writes them as C# (godot/src/Town/SharedData.cs), so the numbers are never typed twice. Run it again when
// shared/mills.ts or shared/shops.ts changes.
//
//   node tools/godot/shareddata.mjs

import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MILLS, CART_PACE, LOAD_H, FLOUR_OUT, GRAIN_OUT } from "../../shared/mills.ts";
import { SHOP_LOOK, NEW_SHOPS, OLD_SHOP_TRADE, CALL_NEAR } from "../../shared/shops.ts";

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const n = (v) => (Number.isInteger(v) ? `${v}` : `${v}`);
const pts = (a) => `new Pt[] { ${a.map((p) => `new(${n(p[0])}, ${n(p[1])})`).join(", ")} }`;
const str = (s) => JSON.stringify(s);

const mills = MILLS.map(
  (m) => `        new Mill
        {
            Id = ${str(m.id)}, Label = ${str(m.label)}, Cart = ${str(m.cart)}, Bakery = ${str(m.bakery)},
            Park = new Pt(${n(m.park[0])}, ${n(m.park[1])}), StopBakery = new Pt(${n(m.stops.bakery[0])}, ${n(m.stops.bakery[1])}), StopDock = new Pt(${n(m.stops.dock[0])}, ${n(m.stops.dock[1])}),
            WayBakery = ${n(m.way.bakery)}, WayGrain = ${n(m.way.grain)},
            RouteBakery = ${pts(m.routes.bakery)},
            RouteDock = ${pts(m.routes.dock)},
        },`,
).join("\n");
const trades = { ...OLD_SHOP_TRADE, ...Object.fromEntries(NEW_SHOPS.map((s) => [s.id, s.trade])) };

const out = `// Written by tools/godot/shareddata.mjs from shared/mills.ts and shared/shops.ts: do not edit by hand.
using System.Collections.Generic;

namespace Scheldemist.Town;

/// <summary>A mill on the wall and its cart's ways (shared/mills.ts MillDef, the part the townspeople need).</summary>
public sealed class Mill
{
    public string Id = "", Label = "", Cart = "", Bakery = "";
    public Pt Park, StopBakery, StopDock;
    public double WayBakery, WayGrain;
    public Pt[] RouteBakery = System.Array.Empty<Pt>(), RouteDock = System.Array.Empty<Pt>();
}

public static class SharedData
{
    /// <summary>The cart's pace (m/s), the time to load or unload (hours), when the flour and the grain runs set out.</summary>
    public const double CartPace = ${n(CART_PACE)}, LoadH = ${n(LOAD_H)}, FlourOut = ${n(FLOUR_OUT)}, GrainOut = ${n(GRAIN_OUT)};

    public static readonly Mill[] Mills =
    {
${mills}
    };

    /// <summary>A shop's trade by its id (shared/shops.ts shopTrade).</summary>
    public static readonly Dictionary<string, string> ShopTrade = new()
    {
${Object.entries(trades).map(([k, v]) => `        [${str(k)}] = ${str(v)},`).join("\n")}
    };

    /// <summary>How much custom a trade draws, and who calls there ("men", "women", ""): shared/shops.ts SHOP_LOOK.</summary>
    public static readonly Dictionary<string, (double weight, string who)> ShopLook = new()
    {
${Object.entries(SHOP_LOOK).map(([k, v]) => `        [${str(k)}] = (${n(v.weight)}, ${str(v.who ?? "")}),`).join("\n")}
    };

    /// <summary>A caller comes from at most this far (m).</summary>
    public const double CallNear = ${n(CALL_NEAR)};
}
`;
writeFileSync(path.join(here, "godot/src/Town/SharedData.cs"), out);
console.log(`godot/src/Town/SharedData.cs: ${MILLS.length} mills, ${Object.keys(trades).length} shops, ${Object.keys(SHOP_LOOK).length} trades`);
