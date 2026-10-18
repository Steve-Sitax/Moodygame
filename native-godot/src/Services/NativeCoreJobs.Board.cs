using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>
/// The hiring board's eight places (#153). Each of today's open jobs on the board (not the night's whispered work, not
/// an emigrant family's errand) holds a place, the first posted first; while all eight are held, a newer job waits
/// off the board, and it goes up in the place a taken (or expired) job leaves. A note keeps its place while it hangs.
/// The places are kept with the world, the same for every player.
/// </summary>
public sealed partial class NativeCoreJobs
{
    public const int BoardSlots = 8;

    /// <summary>{ "job id": place 0..7 } for the jobs on the board now; the waiting ones are not in it.</summary>
    public JsonObject Slots()
    {
        int day = N(host.Clock.View(), "day");
        var open = C.Rows("SELECT id FROM job WHERE status='offered' AND day=$p0 AND source NOT IN ('night','emigrant') ORDER BY id", day)
            .Select(r => N(r!.AsObject(), "id")).ToList();
        var held = C.World("board_slots") as JsonObject ?? new JsonObject();
        var slots = new JsonObject();
        var used = new HashSet<int>();
        bool changed = false;
        foreach (var pair in held)
        {
            if (int.TryParse(pair.Key, out int id) && open.Contains(id) && pair.Value is JsonValue v && v.TryGetValue<int>(out int place) && place is >= 0 and < BoardSlots && used.Add(place))
                slots[pair.Key] = place;
            else changed = true;
        }
        foreach (int id in open)
        {
            if (slots.ContainsKey(id.ToString())) continue;
            int free = Enumerable.Range(0, BoardSlots).Where(s => !used.Contains(s)).DefaultIfEmpty(-1).First();
            if (free < 0) break;
            used.Add(free);
            slots[id.ToString()] = free;
            changed = true;
        }
        if (changed) C.SetWorld("board_slots", slots.DeepClone());
        return slots;
    }
}
