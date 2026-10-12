using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeServiceHost
{
    public Func<bool> MultiplayerEnabled = () => false;
    public readonly List<Action<int, int>> PlayerMidnightHooks = new();
    public readonly List<Func<int, int, JsonArray>> PlayerMidnightLines = new();
    public event Action<int?, string>? RoutedPush;
    private readonly AsyncLocal<int?> requestPlayer = new();
    public int? CurrentPlayer => requestPlayer.Value;
    public T ForPlayer<T>(int? playerId, Func<T> operation)
    {
        int? prior = requestPlayer.Value;
        try { requestPlayer.Value = playerId; return operation(); }
        finally { requestPlayer.Value = prior; }
    }
    public void ForPlayer(int? playerId, Action operation) => ForPlayer(playerId, () => { operation(); return true; });
    public async Task<T> ForPlayerAsync<T>(int? playerId, Func<Task<T>> operation)
    {
        int? prior = requestPlayer.Value;
        try { requestPlayer.Value = playerId; return await operation().ConfigureAwait(false); }
        finally { requestPlayer.Value = prior; }
    }
    /// <summary>Only the authoritative process calls this. Client ticks remain presence/sleep heartbeats.</summary>
    public Task<string> ServerTick(int playerId=1) => WithState(_=>ForPlayer<string>(null,()=>{
        if(!MultiplayerEnabled())return new JsonObject{["advanced"]=false}.ToJsonString();
        var request=new NativeServiceRequest(Context,"POST","/api/tick",playerId,new JsonObject(),new(),new());
        var result=Clock.WorldTick(request);
        if(result["advanced"]?.GetValue<bool>()==true){
            foreach(var hook in TickHooks)hook(request,true);
            foreach(int player in OnlinePlayers().Distinct())ForPlayer(player,()=>{
                var own=new NativeServiceRequest(Context,"POST","/api/tick",player,new JsonObject(),new(),new());
                foreach(var hook in PlayerTickHooks)hook(own,true);
            });
            foreach(var hook in TickAfterHooks)hook(request);
            PublishState(playerId);
        }
        return NativeCoreClock.Join(result,Payload(playerId)).ToJsonString();
    }));
}
