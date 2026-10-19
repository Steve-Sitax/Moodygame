using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Public maintenance hatches use the world's SQLite state and normal save/load snapshots.</summary>
public sealed class NativeRuienAccess : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly HashSet<string> ids;
    public sealed record Point(double X,double Y,double Z);
    public readonly Dictionary<string,Point[]> WorkRoutes=new();
    private readonly Dictionary<string,double> holds=new();
    private long last;
    public NativeRuienAccess(NativeServiceHost host,IEnumerable<string> ids){this.host=host;this.ids=new(ids,StringComparer.Ordinal);}
    private JsonObject View(string id)
    {
        if(!ids.Contains(id))throw new NativeServiceException("No such maintenance hatch.",404);
        bool held=holds.TryGetValue(id,out var until)&&host.Context.Now<until;
        return new JsonObject{["id"]=id,["open"]=held||(host.Context.World("ruien_hatch:"+id)?["open"]?.GetValue<bool>()??false),["workman_passing"]=held};
    }
    private JsonArray Crew()
    {
        long now=host.Context.Now;double dt=last==0?0:Math.Clamp((now-last)/1000.0,0,2);last=now;
        var result=new JsonArray();
        foreach(var(id,sharedRoute) in WorkRoutes)for(int worker=0;worker<2;worker++)
        {
            // Separate working positions on the same ledge; both use the same stair and turning landings.
            var route=sharedRoute;
            if(worker==1){route=(Point[])sharedRoute.Clone();route[^1]=route[^1] with{Z=route[^1].Z+.65};}
            string key=$"ruien_crew:{id}:{worker}";
            var state=host.Context.World(key) as JsonObject??new JsonObject{["segment"]=0,["fraction"]=0.0,["direction"]=1,["wait"]=worker*25.0};
            int segment=state["segment"]!.GetValue<int>(),direction=state["direction"]!.GetValue<int>();
            double fraction=state["fraction"]!.GetValue<double>(),wait=state["wait"]!.GetValue<double>();
            var a=route[segment];var b=route[Math.Clamp(segment+direction,0,route.Length-1)];
            bool crossing=segment<15&&wait<=0;
            if(crossing)
            {
                bool opened=View(id)["open"]!.GetValue<bool>();holds[id]=now+4000;
                if(!opened)wait=2.5; // wait for the heavy leaves to finish swinging
            }
            bool moving=wait<=0;
            if(wait>0)wait=Math.Max(0,wait-dt);
            else
            {
                double distance=Math.Sqrt(Math.Pow(a.X-b.X,2)+Math.Pow(a.Y-b.Y,2)+Math.Pow(a.Z-b.Z,2));
                fraction+=dt*.65/Math.Max(.01,distance);
                if(fraction>=1)
                {
                    segment+=direction;fraction=0;
                    if(segment==0||segment==route.Length-1){direction=-direction;wait=segment==0?60:95;}
                    a=route[segment];b=route[Math.Clamp(segment+direction,0,route.Length-1)];
                }
            }
            state["segment"]=segment;state["fraction"]=fraction;state["direction"]=direction;state["wait"]=wait;
            host.Context.SetWorld(key,state);
            result.Add(new JsonObject{["id"]=$"{id}_workman_{worker}",["hatch"]=id,["x"]=a.X+(b.X-a.X)*fraction,
                ["y"]=a.Y+(b.Y-a.Y)*fraction,["z"]=a.Z+(b.Z-a.Z)*fraction,["moving"]=moving,["working"]=segment==route.Length-1&&wait>0});
        }
        return result;
    }
    public void Register(NativeServiceHost service)
    {
        service.Loaded+=()=>{last=0;holds.Clear();};service.NewGame+=()=>{last=0;holds.Clear();};
        service.Register("GET","/api/ruien/crew",_=>Crew());
        service.Register("GET","/api/ruien/hatches/:id",r=>View(r.Parameters["id"]));
        service.Register("POST","/api/ruien/hatches/:id",r=>{
            string id=r.Parameters["id"];var state=View(id);
            if(r.Body["open"] is not JsonValue v||!v.TryGetValue<bool>(out var open))throw new NativeServiceException("The hatch needs an open or closed state.");
            host.Context.SetWorld("ruien_hatch:"+id,new JsonObject{["open"]=open});return View(id);
        });
    }
}
