using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Town;

/// <summary>
/// Who calls at which shop this game hour (shared/shops.ts shopCallers, client game/shopCalls.ts): the engine's roll,
/// the same on the server (who is inside a shop) and in the game (who walks to its door). Each open shop draws a few
/// callers from those near it whose hour is free for it: the women at the market, the strollers, the idle men.
/// </summary>
public sealed class ShopCalls
{
    private static readonly HashSet<string> Roamers = new() { "sailor", "retired" };
    private static readonly HashSet<string> StrollShops = new() { "tobacconist", "bookseller", "hatter", "clockmaker", "roaster", "apothecary", "draper", "colonial" };
    private static readonly HashSet<string> IdleShops = new() { "tobacconist", "barber", "roaster", "butcher", "cobbler", "chandler", "pawnbroker", "hatter", "printer", "bookseller" };

    private (int day, int hour, int residents, int shops) key;
    private Dictionary<string, string> map = new();
    private Dictionary<string, Pt> doors = new();

    private static int CallersWanted(string shop, string trade, int day, int hr)
    {
        double w = SharedData.ShopLook[trade].weight;
        double busy = (hr >= 8 && hr < 11) || (hr >= 16 && hr < 18) ? 1.5 : 1;
        double roll = Whereabouts.HashId($"{shop}:{day}:{hr}:n") % 1000 / 1000.0;
        return (int)Math.Floor(Math.Min(2.6, (0.45 + 0.3 * w) * busy) + roll);
    }

    private static bool Eligible(Resident p, string act, string trade)
    {
        if (p.Age < 12) return false;
        if (SharedData.ShopLook[trade].who == "men" && p.Sex != "m") return false;
        if (act == "market") return true;
        if (act == "stroll") return StrollShops.Contains(trade);
        bool idleMan = p.Sex == "m" && (act == "loiter" || (act == "work" && Roamers.Contains(p.Trade)));
        return idleMan && IdleShops.Contains(trade);
    }

    /// <summary>The door step of the shop this person calls at this game hour (they go in), or null.</summary>
    public Pt? CallOf(TownData d, Resident r, int day, double hour)
    {
        int hr = (int)Math.Floor(hour);
        var k = (day, hr, d.Residents.Count, d.Shops.Count);
        if (k != key)
        {
            key = k;
            map = Callers(d, day, hr);
            doors = d.Shops.ToDictionary(s => s.Id, s => s.Door);
        }
        return map.TryGetValue(r.Id, out var shop) && doors.TryGetValue(shop, out var door) ? door : null;
    }

    private static Dictionary<string, string> Callers(TownData d, int day, int hr)
    {
        // (asked at the hour's start: whoever is free for the whole hour)
        var people = new List<(Resident r, string act, double left, double x, double z)>();
        foreach (var r in d.Residents)
        {
            var now = Whereabouts.ActivityAt(r.Sched, day, hr);
            if (now.Left < 1 - 1e-6) continue;
            d.Places.TryGetValue(now.Act == "work" ? r.Work.Place : now.Place, out var pl);
            people.Add((r, now.Act, now.Left, pl?.X ?? r.HomeSx, pl?.Z ?? r.HomeSz));
        }
        var byId = d.Residents.ToDictionary(r => r.Id);
        var o = new Dictionary<string, string>();
        foreach (var s in d.Shops.OrderBy(s => s.Id, StringComparer.Ordinal))
        {
            bool open = byId.TryGetValue(s.Keeper, out var keeper) && Whereabouts.ActivityAt(keeper.Sched, day, hr).Act == "work";
            if (!open || !SharedData.ShopTrade.TryGetValue(s.Id, out var t)) continue;
            int want = CallersWanted(s.Id, t, day, hr);
            if (want <= 0) continue;
            // nearest first, shaken a little by the hour so the same neighbour does not call every time
            var cands = people.Where(p => !o.ContainsKey(p.r.Id) && Eligible(p.r, p.act, t))
                .Select(p => (p.r, k: Whereabouts.Hypot(p.x - s.Door.X, p.z - s.Door.Z)))
                .Where(c => c.k < SharedData.CallNear)
                .Select(c => (c.r, k: c.k + Whereabouts.HashId($"{c.r.Id}:{s.Id}:{day}:{hr}") % 60))
                .OrderBy(c => c.k);
            foreach (var c in cands)
            {
                if (want-- <= 0) break;
                o[c.r.Id] = s.Id;
            }
        }
        return o;
    }
}
