using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    public static bool AnnouncementFits(string template, int day, double hour) => template switch {
        "fish_auction" => day % 7 != 0 && hour >= 6 && hour < 9,
        "musicians" => hour >= 11 && hour < 19,
        "emigrant_ship" => day >= 2 && day % 2 == 0 && day % 7 != 0 && hour >= 8 && hour < 16,
        "wedding" => day % 7 != 0 && hour >= 9 && hour < 13,
        "funeral" => day % 7 != 0 && hour >= 8 && hour < 12,
        _ => false
    };

    // The paper announces an event only after the authoritative scheduler accepts it.
    // Its normal spacing, capacity and opening-hour rules still apply.
    public void AnnounceComing(JsonArray templates, Func<JsonObject, bool> plan, Func<double>? random = null)
    {
        random ??= C.Options.Random ?? System.Random.Shared.NextDouble;
        if (random() > .55) return;
        int delay = 150 + (int)Math.Floor(random() * 30);
        double at = Hour + delay / 60.0;
        var candidates = new[] { "fish_auction", "musicians", "emigrant_ship", "wedding", "funeral" }.ToList();
        SortShort(candidates, random);
        foreach (string id in candidates)
        {
            if (!AnnouncementFits(id, Day, at)) continue;
            var template = templates.FirstOrDefault(t => S(t, "id") == id);
            if (template == null) continue;
            var proposed = template.DeepClone().AsObject();
            proposed["template"] = id; proposed["source"] = "engine";
            proposed["start_in_min"] = delay; proposed["why"] = "announced in the morning paper";
            if (plan(proposed)) return;
        }
    }
}
