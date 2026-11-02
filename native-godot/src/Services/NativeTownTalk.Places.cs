using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>The places a talk prompt names (fix 5, 2026-11-02): not all 523 places in town, only the person's own work,
/// shop and current place, the nearest places around them and any place named in the words, memories or recent facts.
/// The model uses them only to name a target; the engine still refuses unknown targets and checks every route.</summary>
public sealed partial class NativeTownTalk
{
    public const int NearPlaces = 15;
    public JsonObject TalkPlaces(JsonObject person, IEnumerable<string> texts)
    {
        var all = C.World("town")?["places"] as JsonObject; var picked = new JsonObject();
        if (all == null) return picked;
        void Add(string id) { if (id != "" && !picked.ContainsKey(id) && all[id] is JsonObject place) picked[id] = S(place, "label", id); }
        string own = S(person["work"], "place"), shop = S(person["work"], "shop"), now = "";
        try { now = town.Activity(S(person, "id")).Place ?? ""; } catch (NativeServiceException) { }
        Add(own); Add(shop); Add(now);
        var anchor = all[now] as JsonObject ?? all[own] as JsonObject ?? all[shop] as JsonObject;
        if (anchor != null)
        {
            double x = N(anchor["x"]), z = N(anchor["z"]);
            foreach (var pair in all.Where(p => p.Value is JsonObject).OrderBy(p => Math.Pow(N(p.Value!["x"]) - x, 2) + Math.Pow(N(p.Value!["z"]) - z, 2)).Take(NearPlaces)) Add(pair.Key);
        }
        string said = string.Join(" ", texts).ToLowerInvariant();
        if (said.Length > 0)
            foreach (var pair in all)
            {
                string label = S(pair.Value, "label").ToLowerInvariant();
                if (label.StartsWith("the ", StringComparison.Ordinal)) label = label[4..];
                if (picked.Count < 40 && label.Length >= 5 && said.Contains(label, StringComparison.Ordinal)) Add(pair.Key);
            }
        return picked;
    }
}
