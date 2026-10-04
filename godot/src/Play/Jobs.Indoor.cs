using System.Collections.Generic;
using System.Text.Json;
using Scheldemist.Net;
namespace Scheldemist.Play;
public partial class Jobs
{
    private readonly Dictionary<int, MillWork.State> millProgress = new();
    private void KeepIndoor() { if (active != null && run is MillWork mill) millProgress[active.Id] = mill.Snapshot(); }
    public JsonElement IndoorSnapshot() { KeepIndoor(); return JsonSerializer.SerializeToElement(new { followed = active?.Id, mills = millProgress }, Api.Json); }
    private void RestoreIndoor(ClientState? saved)
    {
        millProgress.Clear();
        if (saved?.More == null || !saved.More.TryGetValue("indoor_work", out var state)) return;
        try
        {
            if (state.TryGetProperty("mills", out var mills)) foreach (var pair in mills.EnumerateObject())
                if (int.TryParse(pair.Name, out int id) && pair.Value.Deserialize<MillWork.State>(Api.Json) is {} progress) millProgress[id] = progress;
            if (state.TryGetProperty("followed", out var followed) && followed.TryGetInt32(out int job)) followId = job;
        }
        catch (JsonException) { millProgress.Clear(); }
    }
}
