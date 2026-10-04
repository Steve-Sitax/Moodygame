using System.Collections.Generic;
using System.Threading.Tasks;

namespace Scheldemist.Net;

public sealed partial class Api
{
    public Task<GangState> GangState() => Get<GangState>("api/night/state");
    public Task<GangState> GangRoll(GangFacts facts, bool force = false) => Post<GangState>(force ? "api/dev/gang" : "api/night/roll",facts);
    public Task<GangReply> GangAnswer(int id, string how, GangFacts facts) => Post<GangReply>($"api/night/gang/{id}",new { how,facts.X,facts.Z,facts.Lit,facts.Quay,facts.Indoors,facts.Carrying,facts.People });
}
public sealed record GangFacts(double X,double Z,bool Lit,bool Quay,bool Indoors,bool Carrying,List<GangPerson> People);
public sealed record GangPerson(string Id,double X,double Z);
public sealed record GangState { public GangView? Gang { get; init; } }
public sealed record GangView
{
    public int Id { get; init; } public int DemandC { get; init; } public int Members { get; init; }
    public double X { get; init; } public double Z { get; init; } public List<string> Lads { get; init; } = new();
}
public sealed record GangOutcome
{
    public string Outcome { get; init; } = ""; public string Text { get; init; } = "";
    public int MoneyC { get; init; } public int HealthLost { get; init; }
    public List<string> Things { get; init; } = new(); public string Hands { get; init; } = "keep";
    public int? JobFailed { get; init; }
}
public sealed record GangReply : JobsPayload { public GangOutcome Result { get; init; } = new(); }
