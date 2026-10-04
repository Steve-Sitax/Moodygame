using System;
using System.Collections.Generic;
using System.Text.Json;

namespace Scheldemist.Game;

public partial class Actors
{
    private readonly Dictionary<string, int> npcOwners = new();
    /// <summary>The people's replication adapter can supply the street's ownership here.</summary>
    public Func<string, bool>? OwnsNpc { get; set; }
    public bool NpcOwned(string id)
    {
        if (OwnsNpc != null) return OwnsNpc(id);
        var together = Scheldemist.Net.Mp.Together.I;
        if (together?.On != true) return true;
        return npcOwners.TryGetValue(id, out int owner) && owner == together.PlayerId;
    }
    public void OwnershipText(string type, JsonElement message)
    {
        if (type != "owners" || !message.TryGetProperty("list", out var list)) return;
        if (message.TryGetProperty("full", out var full) && full.GetBoolean()) npcOwners.Clear();
        foreach (var row in list.EnumerateArray())
        {
            string id = row[1].GetString() ?? ""; int owner = row[2].GetInt32();
            if (owner == 0) npcOwners.Remove(id); else npcOwners[id] = owner;
        }
    }
}
