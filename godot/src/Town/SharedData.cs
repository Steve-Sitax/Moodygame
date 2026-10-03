// Written by tools/godot/shareddata.mjs from shared/mills.ts and shared/shops.ts: do not edit by hand.
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
    public const double CartPace = 1.15, LoadH = 0.3333333333333333, FlourOut = 4.5, GrainOut = 13.5;

    public static readonly Mill[] Mills =
    {
        new Mill
        {
            Id = "mill_mid", Label = "the Kipdorp mill", Cart = "dray", Bakery = "bakery_steen",
            Park = new Pt(-144.2, 334.5), StopBakery = new Pt(-207, 36.3), StopDock = new Pt(-63, 98.5),
            WayBakery = 337, WayGrain = 311,
            RouteBakery = new Pt[] { new(-144.2, 334.5), new(-144.5, 317.5), new(-144.5, 299.5), new(-144.5, 281.5), new(-144.5, 263.5), new(-144.5, 245.5), new(-144.5, 227.5), new(-144.5, 209.5), new(-155.5, 196.5), new(-164.5, 181.5), new(-172.5, 165.5), new(-176.5, 148.5), new(-181.5, 132.5), new(-187.5, 129.5), new(-201.5, 125.5), new(-202.5, 108.5), new(-202.5, 90.5), new(-202.5, 72.5), new(-202.5, 54.5), new(-205.1, 41.8), new(-207, 36.3) },
            RouteDock = new Pt[] { new(-144.2, 334.5), new(-144.5, 317.5), new(-144.5, 299.5), new(-144.5, 281.5), new(-144.5, 263.5), new(-144.5, 245.5), new(-144.5, 227.5), new(-141.5, 211.5), new(-134.5, 209.5), new(-117.5, 208.5), new(-99.5, 208.5), new(-91.5, 203.5), new(-91.5, 185.5), new(-89.5, 168.5), new(-86.5, 153.5), new(-80, 153.5), new(-72, 153.5), new(-65.2, 153.5), new(-65.5, 146.5), new(-67.5, 132.5), new(-67.5, 114.5), new(-63, 98.5) },
        },
        new Mill
        {
            Id = "mill_ne", Label = "the north mill", Cart = "handcart", Bakery = "bakery_rijn",
            Park = new Pt(222, 232), StopBakery = new Pt(-4.5, 72.2), StopDock = new Pt(123.5, 118.8),
            WayBakery = 361, WayGrain = 208,
            RouteBakery = new Pt[] { new(222, 232), new(222.5, 214.5), new(223.5, 197.5), new(223.5, 179.5), new(223.5, 161.5), new(218.5, 153.5), new(206.5, 149.5), new(205.5, 132.5), new(200.5, 124.5), new(183.5, 123.5), new(165.5, 123.5), new(148.5, 121.5), new(130.5, 121.5), new(112.5, 121.5), new(94.5, 121.5), new(76.5, 121.5), new(60.5, 114.5), new(43.5, 111.5), new(26.5, 109.5), new(9.5, 107.5), new(0.5, 102.5), new(-3.5, 85.5), new(-5.3, 77.7), new(-4.5, 72.2) },
            RouteDock = new Pt[] { new(222, 232), new(222.5, 214.5), new(223.5, 197.5), new(223.5, 179.5), new(223.5, 161.5), new(218.5, 153.5), new(206.5, 149.5), new(205.5, 132.5), new(200.5, 124.5), new(183.5, 123.5), new(165.5, 123.5), new(148.5, 121.5), new(130.5, 121.5), new(123.5, 118.8) },
        },
    };

    /// <summary>A shop's trade by its id (shared/shops.ts shopTrade).</summary>
    public static readonly Dictionary<string, string> ShopTrade = new()
    {
        ["bakery_rijn"] = "baker",
        ["bakery_steen"] = "baker",
        ["grocer_canal"] = "grocer",
        ["grocer_werf"] = "grocer",
        ["chandler_werf"] = "chandler",
        ["tobacco_markt"] = "tobacconist",
        ["pawn_vis"] = "pawnbroker",
        ["cobbler_lane"] = "cobbler",
        ["draper_markt"] = "draper",
        ["butcher_vlees"] = "butcher",
        ["colonial_steen"] = "colonial",
        ["apothecary_markt"] = "apothecary",
        ["barber_lane"] = "barber",
        ["hatter_markt"] = "hatter",
        ["roaster_canal"] = "roaster",
        ["printer_jezuiet"] = "printer",
        ["books_kathedraal"] = "bookseller",
        ["clock_markt"] = "clockmaker",
        ["bakery_south"] = "baker",
        ["grocer_south"] = "grocer",
        ["cobbler_east"] = "cobbler",
    };

    /// <summary>How much custom a trade draws, and who calls there ("men", "women", ""): shared/shops.ts SHOP_LOOK.</summary>
    public static readonly Dictionary<string, (double weight, string who)> ShopLook = new()
    {
        ["baker"] = (5, ""),
        ["grocer"] = (4, ""),
        ["chandler"] = (1, ""),
        ["tobacconist"] = (2, "men"),
        ["pawnbroker"] = (1, ""),
        ["cobbler"] = (1, ""),
        ["draper"] = (1, "women"),
        ["butcher"] = (3, ""),
        ["colonial"] = (3, ""),
        ["apothecary"] = (1, ""),
        ["barber"] = (2, "men"),
        ["hatter"] = (1, ""),
        ["roaster"] = (2, ""),
        ["printer"] = (0.5, ""),
        ["bookseller"] = (0.5, ""),
        ["clockmaker"] = (0.3, ""),
    };

    /// <summary>A caller comes from at most this far (m).</summary>
    public const double CallNear = 140;
}
