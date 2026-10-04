using System.Threading.Tasks;
using System.Text.Json;
namespace Scheldemist.Net;

public sealed record LifePerson(string Id, string Name, string First, string Kind, string Sex, int Age);
public sealed record HomeRemark(LifePerson Who, string Line, string Source);
public sealed record HomeRemarkReply(HomeRemark? Remark);
public sealed record WalkupAnswer(bool Ok, string? Npc, string? Name, int? Action, bool Urgent, bool Wait, bool None, string? Why);
public sealed record WalkupAsk(string Role, string Why, string Ref, double X, double Z);
public sealed partial class Api
{
    public Task<HomeRemarkReply> HomeRemark() => Post<HomeRemarkReply>("api/homes/remark", new { }, TalkTimeoutMs);
    public Task<WalkupAnswer> WalkupCall(WalkupAsk ask) => Post<WalkupAnswer>("api/walkup/call", ask);
    public Task<WalkupAnswer> WalkupTrouble(int id, double x, double z) => Post<WalkupAnswer>($"api/walkup/trouble/{id}", new { x, z });
    public Task<OkReply> WalkupDone(int id, string outcome = "done") => Post<OkReply>($"api/walkup/{id}/done", new { outcome });
    public Task<JsonElement> LifeJobFixture(string type,string twist,string? from=null,string? to=null) => Post<JsonElement>("api/dev/job",new{type,twist,goods="crates",items=1,employer="sooi",from,to});
}
