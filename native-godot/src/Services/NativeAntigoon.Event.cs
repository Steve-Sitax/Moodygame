using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.Services;

public sealed partial class NativeAntigoon
{
    private AntigoonNightEvent? street;
    private readonly Dictionary<string,(AntigoonNightEvent.Witness Person,long At)> observed=new();
    public NativeStreetLighting? Lighting;
    public Func<P,P,IReadOnlyList<P>?> HumanPath=(_,_)=>null;
    public Func<P,bool> HumanClear=_=>false;
    public Func<int,string,bool> MayObserve=(_,_)=>false;
    public Func<string,P?> ResidentHome=_=>null;
    public bool Controls(string id)=>street?.Owns(id)==true;
    private void RegisterEvent(NativeServiceHost service)
    {
        service.Register("POST","/api/antigoon/observe",r=>
        {
            if(!developmentEnabled||host.Saves.Paused)return View(r.PlayerId);
            if(PositionOf(r.PlayerId) is {} eye)foreach(var node in (r.Body["people"] as JsonArray??new()).Take(60))
            {
                string id=NativeGoods.S(node,"id");var p=new P(NativeGoods.Number(node?["x"]),NativeGoods.Number(node?["z"]));
                if(!double.IsFinite(p.X)||!double.IsFinite(p.Z)||p.Distance(eye)>80||!MayObserve(r.PlayerId,id)||!HumanClear(p)||ResidentHome(id) is not {} home)continue;
                if(!Controls(id))observed[id]=(new(id,p,home),host.Context.Now);
            }
            foreach(var id in observed.Where(p=>host.Context.Now-p.Value.At>1500).Select(p=>p.Key).ToArray())observed.Remove(id);
            Advance();return View(r.PlayerId);
        });
    }
    private void EventView(JsonObject v)
    {
        v["extinguished"]=new JsonArray((Lighting?.Disabled()??new()).Select(id=>(JsonNode)JsonValue.Create(id)!).ToArray());
        v["event_time"]=street?.Now??0;
        v["residents"]=new JsonArray((street?.Residents.Values??Enumerable.Empty<AntigoonNightEvent.Resident>()).Select(p=>(JsonNode)new JsonObject{
            ["id"]=p.Id,["x"]=p.At.X,["z"]=p.At.Z,["yaw"]=p.Yaw,["phase"]=p.Phase,["time"]=p.Time,["scream"]=p.Scream}).ToArray());
        v["rocks"]=new JsonArray((street?.Rocks??Enumerable.Empty<AntigoonNightEvent.Rock>()).Select(r=>(JsonNode)new JsonObject{
            ["serial"]=r.Serial,["lamp"]=r.Lamp,["x"]=r.From.X,["z"]=r.From.Z,["y"]=Ground(r.From)+4.1,["tx"]=r.To.X,["tz"]=r.To.Z,["ty"]=r.Height,
            ["started"]=r.Started,["release"]=r.Release,["impact"]=r.Impact}).ToArray());
    }
}
