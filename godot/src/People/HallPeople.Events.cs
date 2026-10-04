using System.Text.Json;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.People;

public partial class HallPeople
{
    // landmarks.ts FUNERAL_MARKS. The ordinary hall plans stay the source of seats and walls.
    private static readonly JsonDocument funeralMarks = JsonDocument.Parse("""
    {"requiemPriest":{"x":0,"z":35.5,"yaw":3.141592653589793},"bearer0":{"x":-0.42,"z":31.85,"yaw":0},"bearer1":{"x":0.42,"z":31.85,"yaw":0},"bearer2":{"x":-0.42,"z":30.7,"yaw":0},"bearer3":{"x":0.42,"z":30.7,"yaw":0}}
    """);
    private Node3D? bier;
    private static bool EventMark(Hall h, string name, out JsonElement mark) => h.Plan.GetProperty("marks").TryGetProperty(name, out mark) || h.Id == "cathedral" && funeralMarks.RootElement.TryGetProperty(name, out mark);
    private static string? EventRole(string role) => role switch { "groom" => "groom", "bride" => "bride", "wedding_priest" or "requiem_priest" => "priest", "widow" => "widow", "bearer0" or "bearer1" or "bearer2" or "bearer3" => "bearers", _ => null };
    private static void EventDress(Figure f)
    {
        string? role = EventRole(f.Role); if (role == null) return;
        f.EventWear = LeadLooks.Make(role); f.Group.AddChild(f.EventWear); ((LeadWear)f.EventWear).Bind(f.Human);
    }
    private void EventRoster(Hall h, JsonElement reply)
    {
        if (h.Id != "cathedral") return;
        bool funeral = reply.TryGetProperty("funeral", out var f) && f.ValueKind == JsonValueKind.Object;
        if (!funeral) { bier?.QueueFree(); bier = null; return; }
        if (bier != null) return;
        bier = new Node3D { Name = "requiem_bier", Position = h.Origin + new Vector3(0, 0, 33.6f) }; Main.I.View.AddChild(bier);
        EventProps.Box(bier, new Vector3(0.85f, 0.12f, 2.3f), new Vector3(0, 0.76f, 0), 0x141214);
        foreach (float x in new[] { -0.34f, 0.34f }) foreach (float z in new[] { -0.85f, 0.85f }) EventProps.Box(bier, new Vector3(0.09f, 0.7f, 0.09f), new Vector3(x, 0.35f, z), 0x211914);
        var coffin = LeadLooks.Coffin(); coffin.Position = new Vector3(0, 0.83f, 0); bier.AddChild(coffin);
    }
}
