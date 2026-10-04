using System.Collections.Generic;
using System.Text.Json;

namespace Scheldemist.Town;

public partial class Townspeople
{
    // A family walking to its lighter belongs to that scene until it boards or the scene resets.
    // Keep the simulation in the shared registry; its owned hold bypasses the schedule.
    private readonly Dictionary<string, Sim> placesClaimed = new();
    public object LighterOwner => placesClaimed;
    public Sim? ClaimForLighter(string id)
    {
        if (!byId.TryGetValue(id, out var s)) return null;
        if (!ActionHold(s, placesClaimed)) return null;
        placesClaimed[id] = s; return s;
    }
    public void HideForLighter(string id)
    {
        if (placesClaimed.TryGetValue(id,out var s) && ReferenceEquals(s.ActionOwner, placesClaimed) && s.P != null) { Crowd?.RemovePuppet(s.P); s.P=null; }
    }
    public void ReleaseFromLighter(string id, bool boarded)
    {
        if (!placesClaimed.Remove(id, out var s)) return;
        if (!ReferenceEquals(s.ActionOwner, placesClaimed)) return;
        ActionRelease(s, placesClaimed);
        if (s.P != null) { Crowd?.RemovePuppet(s.P); s.P = null; }
        if (boarded) { sims.Remove(s); byId.Remove(id); peopleInfo.Remove(id); Data?.Residents.Remove(s.R); }
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
