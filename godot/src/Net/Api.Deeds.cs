using System.Collections.Generic;
using System.Threading.Tasks;
namespace Scheldemist.Net;

public sealed partial class Api
{
    public Task<DeedsWorld> DeedsWorld() => Get<DeedsWorld>("api/deeds/world");
    public Task<PoliceView> Police() => Get<PoliceView>("api/police");
    public Task<DeedReply> TakeDeed(DeedAsk ask) => Post<DeedReply>("api/deed", ask);
    public Task<DeedReply> PickPocket(PickAsk ask) => Post<DeedReply>("api/pickpocket", ask);
    public Task<DeedReply> DiscoverPocket(int deed, DiscoverAsk ask) => Post<DeedReply>($"api/pocket/{deed}/discover", ask);
    public Task<DeedReply> ReturnDeed(int deed, string how) => Post<DeedReply>($"api/deed/{deed}/return", new { how });
    public Task<PoliceView> PoliceArrived(string agent) => Post<PoliceView>("api/police/arrived", new { agent });
    public Task<PoliceView> PoliceFled() => Post<PoliceView>("api/police/fled");
    public Task<PoliceSeizeReply> PoliceSeize() => Post<PoliceSeizeReply>("api/police/seize");
    public Task<CellReply> PoliceCell() => Post<CellReply>("api/police/cell");
    public Task<OkReply> PoliceCellDone() => Post<OkReply>("api/police/cell/done");
    public Task<DeedReply> RobbedBy(string id) => Post<DeedReply>($"api/resident/{System.Uri.EscapeDataString(id)}/pick");
    public Task<DeedReply> CatchPocketThief(string id) => Post<DeedReply>($"api/resident/{System.Uri.EscapeDataString(id)}/catch");
}
public sealed record Witness(string Id, double D, bool Los, double Facing);
public sealed record DeedAsk(string Ref, double X, double Z, List<Witness> Witnesses, bool Crouch, bool Lantern);
public sealed record PickAsk(string Id, double X, double Z, double D, double Facing, List<Witness> Witnesses, bool Crouch, bool Lantern, bool Hurry, int Crowd, bool Busy);
public sealed record DiscoverAsk(double D, bool Los, double X, double Z);
public sealed record WorkLamp { public string Id { get; init; } = ""; public string Owner { get; init; } = ""; public float X { get; init; } public float Z { get; init; } public float Y { get; init; } }
public sealed record DeedFood { public string Id { get; init; } = ""; public string Keeper { get; init; } = ""; public float X { get; init; } public float Z { get; init; } public string Name { get; init; } = ""; }
public sealed record DeedsWorld { public List<WorkLamp> Lamps { get; init; } = new(); public List<DeedFood> Food { get; init; } = new(); }
public sealed record DeedReaction { public string Who { get; init; } = ""; public string Name { get; init; } = ""; public string Kind { get; init; } = ""; public string Line { get; init; } = ""; }
public sealed record Suspect { public string Id { get; init; } = ""; public string Name { get; init; } = ""; }
public sealed record DeedReply : JobsPayload
{
    public int? Deed { get; init; } public string Text { get; init; } = ""; public bool Hit { get; init; } public bool Felt { get; init; } public bool Again { get; init; }
    public int TookC { get; init; } public double? DiscoverS { get; init; } public DeedReaction? Reaction { get; init; }
    public List<DeedReaction> Reactions { get; init; } = new(); public List<Suspect> Suspects { get; init; } = new();
}
public sealed record PoliceVisit { public int Id { get; init; } public string Agent { get; init; } = ""; public string Name { get; init; } = ""; public string State { get; init; } = ""; }
public sealed record PoliceVerdict { public int Visit { get; init; } public string Verdict { get; init; } = ""; public int PaidC { get; init; } public string Text { get; init; } = ""; }
public sealed record PolicePoint { public float X { get; init; } public float Z { get; init; } public float Yaw { get; init; } public string Label { get; init; } = ""; }
public sealed record ConfrontView { public string Npc { get; init; } = ""; public int Deed { get; init; } }
public sealed record PoliceSeen { public int N { get; init; } public string Text { get; init; } = ""; }
public sealed record PoliceView
{
    public PoliceVisit? Visit { get; init; } public PoliceVerdict? Last { get; init; } public bool Cell { get; init; } public bool Held { get; init; }
    public PolicePoint? Post { get; init; } public PolicePoint? Prison { get; init; } public string Name { get; init; } = "";
    public List<ConfrontView> Confronts { get; init; } = new(); public List<string> Watchers { get; init; } = new(); public List<PoliceSeen> Seen { get; init; } = new();
}
public sealed record CellNight { public List<string> Summary { get; init; } = new(); public PolicePoint Post { get; init; } = new(); }
public sealed record CellReply : JobsPayload { public CellNight Night { get; init; } = new(); }
public sealed record PoliceSeizeReply : JobsPayload { public string Text { get; init; } = ""; public bool Cell { get; init; } public bool Held { get; init; } public PoliceVerdict? Verdict { get; init; } }
