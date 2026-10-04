using System.Collections.Generic;
using System.Text.Json;

namespace Scheldemist.Town;

public partial class Townspeople
{
    // A family walking to its lighter belongs to that scene until it boards or the scene resets.
    // Keep its id lookup; remove it from the schedule loop so two owners never walk the same body.
    private readonly Dictionary<string, Sim> placesClaimed = new();
    public Sim? ClaimForLighter(string id)
    {
        if (placesClaimed.TryGetValue(id, out var held)) return held;
        if (!byId.TryGetValue(id, out var s)) return null;
        sims.Remove(s); placesClaimed[id] = s; return s;
    }
    public void HideForLighter(string id)
    {
        if (placesClaimed.TryGetValue(id,out var s) && s.P != null) { Crowd?.RemovePuppet(s.P); s.P=null; }
    }
    public void ReleaseFromLighter(string id, bool boarded)
    {
        if (!placesClaimed.Remove(id, out var s)) return;
        if (s.P != null) { Crowd?.RemovePuppet(s.P); s.P = null; }
        if (boarded) { byId.Remove(id); peopleInfo.Remove(id); Data?.Residents.Remove(s.R); }
        else { s.Key = "lighter-released"; if (!sims.Contains(s)) sims.Add(s); }
    }
    public void ReadEmigrantArrivals(JsonElement raw, HashSet<string> familyIds)
    {
        if (Data == null) return;
        var next = TownData.Parse(raw.GetRawText());
        foreach (var p in next.Places) if (!Data.Places.ContainsKey(p.Key)) Data.Places.Add(p.Key, p.Value);
        foreach (var r in next.Residents)
        {
            if (!familyIds.Contains(r.Id) || Data.Residents.Exists(p => p.Id == r.Id)) continue;
            Data.Residents.Add(r); peopleInfo[r.Id] = r;
            var s = new Sim { R=r, Kind=r.Kind, X=r.HomeSx, Z=r.HomeSz, Inside=true, Door=new(r.HomeSx,r.HomeSz), Goal=new Goal { Mode="home",X=r.HomeSx,Z=r.HomeSz }, H=Hash01(r.Id) };
            sims.Add(s); byId.Add(r.Id,s);
        }
    }
}
