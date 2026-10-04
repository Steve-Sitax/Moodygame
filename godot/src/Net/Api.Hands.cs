using System.Collections.Generic;
using System.Threading.Tasks;

namespace Scheldemist.Net;

public sealed partial class Api
{
    public Task<TreatList> Treats() => Get<TreatList>("api/treat");
    public Task<TreatEnterReply> TreatEnter(string place) => Post<TreatEnterReply>("api/treat/enter", new { place });
    public Task<OkReply> TreatLeave() => Post<OkReply>("api/treat/leave");
    public Task<TreatRoundReply> TreatRound(string place, string kind) => Post<TreatRoundReply>("api/treat/round", new { place, kind });
    public Task<RoutineList> Routines() => Get<RoutineList>("api/routines");
    public Task<RoutineStepReply> RoutineStep(int id, int i, bool ok, string why, double x, double z, int n = 0) => Post<RoutineStepReply>($"api/routine/{id}/step", new { i, ok, why, x, z, n });
}
public sealed record TreatList { public List<TreatInfo> Treats { get; init; } = new(); }
public sealed record TreatInfo
{
    public int Id { get; init; } public string Npc { get; init; } = ""; public string Name { get; init; } = "";
    public string First { get; init; } = ""; public string? Step { get; init; } public string? Place { get; init; }
    public string? Inside { get; init; } public int Rounds { get; init; } public int Tipsy { get; init; }
}
public sealed record TreatEnterReply { public List<TreatGuest> Guests { get; init; } = new(); }
public sealed record TreatGuest { public string Id { get; init; } = ""; public string Name { get; init; } = ""; }
public sealed record TreatRoundReply : JobsPayload
{
    public string Line { get; init; } = ""; public string Note { get; init; } = ""; public int PaidC { get; init; } public int Rounds { get; init; }
}
public sealed record RoutineList { public List<RoutineInfo> Routines { get; init; } = new(); }
public sealed record RoutineInfo
{
    public int Id { get; init; } public string Npc { get; init; } = ""; public string Name { get; init; } = "";
    public string Purpose { get; init; } = ""; public int I { get; init; } public int N { get; init; }
    public RoutineStepInfo? Step { get; init; } public int Holding { get; init; } public bool Strong { get; init; }
    public string? Cart { get; init; } public int MinutesLeft { get; init; } public int Player { get; init; } = 1;
}
public sealed record RoutineStepInfo
{
    public string Kind { get; init; } = ""; public double? X { get; init; } public double? Z { get; init; }
    public string? Label { get; init; } public string? Place { get; init; } public int? Job { get; init; }
    public string? Item { get; init; } public int Count { get; init; } = 1; public string? Who { get; init; }
    public bool Off { get; init; } public string? Inside { get; init; } public string? Gid { get; init; }
}
public sealed record RoutineStepReply : JobsPayload { public bool Ok { get; init; } public RoutineInfo? Routine { get; init; } }
