using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.Play;

internal partial class MarketProof
{
    /// <summary>`cartclear` (#196, `--market-place`, the Grote Markt by default): the pitches' parked carts against where
    /// people stand at that market.</summary>
    private async Task CartClear()
    {
        string place = Main.I.Arg("market-place") is { Length: > 0 } mp ? mp : "grote_markt";
        string prefix = place == "vismarkt" ? People.NativeMarket.SellerPrefix : "gm_seller_";
        await Dev.Kit.I.Light(9, "clear", day: 1);
        town.Refill();
        for (int i = 0; i < 600 && (People.NativeMarket.I?.ItemsAt(place).Count ?? 0) == 0; i++) await Frame();
        var transport = await Net.ServerLink.I!.Api!.TownTransport();
        CartClearance(place, prefix, transport);
        // the streets round the market at half a metre: '#' no floor, '.' floor without room for a cart (WalkMap.WideOpen),
        // 'o' room for one; C a cart's place at its pitch, H its place by the seller's door
        var carts = transport.Vehicles.Where(v => v.Kind == "handcart" && v.Owner.StartsWith(prefix, StringComparison.Ordinal)).ToList();
        var marks = carts.SelectMany(v => v.Parks.Where(p => p.Key.StartsWith("work", StringComparison.Ordinal)).Select(p => ('C', p.Value[0], p.Value[1])).Append(('H', v.Home[0], v.Home[1]))).ToList();
        double x0 = marks.Min(m => m.Item2) - 12, x1 = marks.Max(m => m.Item2) + 12, z0 = marks.Min(m => m.Item3) - 12, z1 = marks.Max(m => m.Item3) + 12;
        var map = town.Walk!;
        var text = new System.Text.StringBuilder($"x from {x0:0.0} to {x1:0.0}, z from {z0:0.0} (first row) to {z1:0.0}, 0.5 m\n");
        for (double z = z0; z <= z1; z += .5)
        {
            text.Append($"{z,6:0.0} ");
            for (double x = x0; x <= x1; x += .5)
                text.Append(marks.FirstOrDefault(m => Math.Abs(m.Item2 - x) < .25 && Math.Abs(m.Item3 - z) < .25).Item1 is char c and not '\0' ? c : !map.NativeCellFree((int)Math.Floor((x - map.X0) * 4), (int)Math.Floor((z - map.Z0) * 4)) ? '#' : map.WideOpen(x, z) ? 'o' : '.');
            text.Append('\n');
        }
        System.IO.File.WriteAllText(System.IO.Path.Combine(dir, "cart-map.txt"), text.ToString());
    }

    /// <summary>Each pitch's parked cart (its axle on the cart place, its body and shafts turned toward the grips, as
    /// DrawParked draws it) keeps 0.75 m from every place someone stands at that market: each seller's place, each stall's
    /// front where its buyers stand, and the townspeople's own spots on the square (#196: pitch 17's stood 0.34 m from one,
    /// just outside a pushed cart's 0.32 m).</summary>
    private void CartClearance(string place, string prefix, Net.ResidentTransport transport)
    {
        var items = People.NativeMarket.I?.ItemsAt(place) ?? new List<People.NativeMarketItem>();
        var spots = items.SelectMany(it => new[] { ("seller " + it.Pitch, it.Seller.X, it.Seller.Z), ("front " + it.Pitch, it.Front.X, it.Front.Z) }).ToList();
        foreach (var (who, points) in town.Data!.Anchors)
            foreach (var (key, at) in points)
                if (key.Place == place) spots.Add(($"{who} {key.Act}", at.X, at.Z));
        var close = new List<object>();
        var rows = new List<object>();
        foreach (var cart in transport.Vehicles.Where(v => v.Kind == "handcart" && v.Owner.StartsWith(prefix, StringComparison.Ordinal)))
            foreach (var park in cart.Parks.Where(p => p.Key.StartsWith("work", StringComparison.Ordinal) && p.Value.Length >= 3))
            {
                double x = park.Value[0], z = park.Value[1], ry = park.Value[2] + Math.PI, c = Math.Cos(ry), s = Math.Sin(ry);
                var foot = new List<Vector2>();
                foreach (var (x0, x1, z0, z1) in new[] { (-.72, .72, -.9, 1.0), (-.42, .42, .98, 2.18) })
                    for (int i = 0; i <= 12; i++)
                        for (int j = 0; j <= 12; j++) { double lx = x0 + (x1 - x0) * i / 12, lz = z0 + (z1 - z0) * j / 12; foot.Add(new((float)(x + lx * c + lz * s), (float)(z - lx * s + lz * c))); }
                var (name, sx, sz) = spots.MinBy(q => foot.Min(f => f.DistanceTo(new((float)q.Item2, (float)q.Item3))));
                double d = foot.Min(f => f.DistanceTo(new((float)sx, (float)sz)));
                rows.Add(new { cart.Owner, near = name, metres = Math.Round(d, 2) });
                if (d < .75) close.Add(new { cart.Owner, park = park.Value, near = name, at = new[] { Math.Round(sx, 2), Math.Round(sz, 2) }, metres = Math.Round(d, 2) });
            }
        facts["cartClearance"] = rows;
        Check($"every {place} cart parked at its pitch keeps 0.75 m from where anyone stands there (sellers, buyers at the stalls' fronts, the townspeople's spots)", close.Count == 0 && rows.Count > 0, close);
    }
}
