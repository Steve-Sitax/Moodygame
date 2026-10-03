using System;
using System.Collections.Generic;

namespace Scheldemist.Town;

/// <summary>
/// The dockers' hauls (shared/hauls.ts): a load comes off a real pile and goes in at a door, onto a pile, or to the
/// back of a fish bank. The server's town gives each docker the two ends; this table says what he carries there,
/// which way he faces the pile, and where the load goes.
/// </summary>
public sealed class HaulRoute
{
    public string Id = "", Place = "", Carry = "sack", Into = "door";
    public Pt A, B;
    public double AYaw;
    public Pt? Door, Drop;
    public Pt[][] Was = Array.Empty<Pt[]>();

    private static HaulRoute R(string id, string place, double[] was, double ax, double az, double aYaw, string carry, string into, double bx, double bz, double[]? door = null, double[]? drop = null)
    {
        var w = new List<Pt[]>();
        for (int i = 0; i + 3 < was.Length; i += 4) w.Add(new[] { new Pt(was[i], was[i + 1]), new Pt(was[i + 2], was[i + 3]) });
        return new HaulRoute { Id = id, Place = place, Was = w.ToArray(), A = new Pt(ax, az), AYaw = aYaw, Carry = carry, Into = into, B = new Pt(bx, bz), Door = door != null ? new Pt(door[0], door[1]) : null, Drop = drop != null ? new Pt(drop[0], drop[1]) : null };
    }

    /// <summary>shared/hauls.ts HAUL_ROUTES (`was` and `also`: the ends an older town has).</summary>
    public static readonly HaulRoute[] All =
    {
        R("rk-w", "rijnkaai", new double[] { -40, 5, -44, 40 }, -39.06, 17.11, 3.03, "crate", "door", -42.1, 45.1, new[] { -42.1, 46.0 }),
        R("rk-m", "rijnkaai", new double[] { -12, 4, -10, 40 }, -9.44, 15.03, 3.12, "sack", "door", -10.2, 45.1, new[] { -10.2, 46.0 }),
        R("rk-e1", "rijnkaai", new double[] { 26, 5, 40, 42 }, 26.68, 13.46, -2.7, "sack", "door", 21.5, 45.1, new[] { 21.5, 46.0 }),
        R("rk-e2", "rijnkaai", new double[] { 45, 5, 56, 40 }, 54.63, 15.94, -3.08, "sack", "pile", 51.03, 39.78, null, new[] { 50.88, 40.77 }),
        R("hn-1", "hessenatie", new double[] { 12, 5, 11.2, 43.5 }, 18.37, 13.19, 2.91, "sack", "door", 12, 45.1, new[] { 12, 46.0 }),
        R("hn-2", "hessenatie", new double[] { 2, 5, 11.2, 43.5 }, 2.46, 15.48, -2.84, "sack", "door", 12, 45.1, new[] { 12, 46.0 }),
        R("en-1", "entrepot", new double[] { 173, 55, 173, 83 }, 168.6, 45.3, 3.14, "sack", "door", 175.1, 83, new[] { 176, 83.0 }),
        R("en-2", "entrepot", new double[] { 173, 108, 173, 88 }, 174.31, 112.5, 0.76, "sack", "door", 175.1, 83, new[] { 176, 83.0 }),
        R("en-3", "entrepot", new double[] { 160, 40, 173, 78 }, 153.34, 35.14, -1.93, "sack", "door", 175.1, 83, new[] { 176, 83.0 }),
        R("ba-1", "bassin", new double[] { 90, 44, 96, 8, 130, 44, 150, 10, 66, 60, 70, 20 }, 89.02, 32.65, -1.83, "crate", "pile", 94.91, 10.18, null, new[] { 95.29, 8.71 }),
        R("bs-1", "bassin_south", new double[] { 140, 113, 150, 122, 90, 113, 100, 122 }, 143.97, 113.22, -1.91, "sack", "door", 178, 125.1, new[] { 178, 126.0 }),
        R("wf-1", "werf", new double[] { -300, 3, -306, 12 }, -301.41, 12.38, 1.49, "sack", "door", -311.9, 13.1, new[] { -311.9, 14.0 }),
        R("wf-2", "werf", new double[] { -262, 3, -270, 12 }, -269.27, 11.91, 1.69, "sack", "door", -261.1, 13.1, new[] { -261.1, 14.0 }),
        R("wf-3", "werf", new double[] { -230, 3, -226, 26 }, -226.33, 13.15, -3.12, "sack", "door", -238.2, 13.1, new[] { -238.2, 14.0 }),
        R("vm-1", "vismarkt", new double[] { -139, 22, -123.2, 22.4 }, -138.15, 21.27, -1.65, "crate", "stall", -123.2, 22.4),
        R("vm-2", "vismarkt", new double[] { -139, 34, -123.6, 33.2 }, -138.2, 33.17, -1.57, "crate", "stall", -123.6, 33.2),
        R("ca-1", "canal", new double[] { -65, 90, -65, 108 }, -65, 85.85, 3.14, "sack", "door", -60.9, 105.5, new[] { -60, 105.5 }),
        R("ca-2", "canal", new double[] { -87, 120, -87, 84 }, -87.68, 117.93, -0.02, "sack", "door", -90.8, 78.7, new[] { -92, 78.7 }),
    };

    /// <summary>The route of a docker's two ends (haulRouteOf), or null.</summary>
    public static HaulRoute? Of(Pt? a, Pt? b, double near = 3)
    {
        if (a == null || b == null) return null;
        bool Same(Pt p, Pt q) => Whereabouts.Hypot(p.X - q.X, p.Z - q.Z) < near;
        foreach (var r in All)
        {
            if (Same(a.Value, r.A) && Same(b.Value, r.B)) return r;
            foreach (var w in r.Was)
                if (Same(a.Value, w[0]) && Same(b.Value, w[1])) return r;
        }
        return null;
    }

    /// <summary>What a docker carries in his arms on this route: the Vismarkt's routes carry boxes of fish.</summary>
    public string CarryKind => Place == "vismarkt" ? "fishbox" : Carry;
}
