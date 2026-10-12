using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Town;
using System.Text.Json.Nodes;

namespace Scheldemist.Movers;

public partial class Traffic
{
    public sealed record ResidentYard(string Route,Vector2 At,float Yaw);
    private readonly HashSet<string> residentAway=new();
    private readonly Dictionary<string,Func<bool>> residentWorking=new();
    public IEnumerable<ResidentYard> ResidentYards()=>vehicles.Where(v=>v.Kind=="dray").Select(v=>new ResidentYard(v.Route,At(v,v.Stop.S),v.Path.Yaw(v.Stop.S)));
    public void ResidentOwners(IEnumerable<(string Route,string Kind,Func<bool> Working)> owners)
    {foreach(var owner in owners){var v=vehicles.FirstOrDefault(v=>v.Route==owner.Route&&v.Kind=="dray");if(v==null)continue;residentWorking[v.Route]=owner.Working;v.Man?.Dispose();v.Man=Carters.Make(v.Frame,owner.Kind);}}
    public void ResidentAway(string route,bool on)
    {
        if(NetRemote)NetAsk?.Invoke("traffic_away",new JsonArray(route,on));
        bool changed=on?residentAway.Add(route):residentAway.Remove(route);if(!changed)return;var v=vehicles.FirstOrDefault(v=>v.Route==route&&v.Kind=="dray");if(v==null)return;
        if(!on){v.S=v.Stop.S;v.V=0;v.State="stand";v.Timer=8;v.LastStop=0;}
        Place(v,0,0,false);
    }
    private bool ResidentGone(Vehicle v)=>v.Kind=="dray"&&(residentAway.Contains(v.Route)||residentWorking.TryGetValue(v.Route,out var works)&&!works());
}
