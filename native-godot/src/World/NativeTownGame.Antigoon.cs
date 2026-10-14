using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading;
using System.Text.Json.Nodes;
using Scheldemist.Native.Services;
using Scheldemist.Native.Services.Multiplayer;
using Scheldemist.Town;
using Scheldemist.World;
using P = Scheldemist.Native.Services.AntigoonBrain.Point;

namespace Scheldemist.Native.World;

public partial class NativeTownGame
{
    internal NativeAntigoon? AntigoonService;
    protected override IEnumerable<Node> CreateParts()
    {
        foreach (var part in base.CreateParts()) yield return part;
        if (!DedicatedServer && !Flag("no-antigoon")) yield return new Characters.NativeAntigoonClient { Name = "AntigoonEncounter" };
    }
    private void AttachAntigoon(NativeServiceHost host, NativeMultiplayer multiplayer, WalkMap map, NativeStreetLighting lamps, NativeActions actions, JsonObject city)
    {
        // Capture actual solid triangles once; requests never access scene nodes or physics.
        var geometry=new AntigoonGeometry(World);
        Vector3 At(P p,float height=0)=>new((float)p.X,(float)map.BaseAt(p.X,p.Z)+height,(float)p.Z);
        bool Clear(P p)=>map.PathFree(p.X,p.Z)&&geometry.Clear(At(p),.65f,5.5f);
        bool Sight(P a,P b)=>geometry.Visible(At(a,1.7f),At(b,1.7f));
        P? PlayerAt(int id)
        {
            if(multiplayer.Enabled)return multiplayer.Position(id) is {} p?new P(NativeGoods.Number(p["x"]),NativeGoods.Number(p["z"])):null;
            var p2=Volatile.Read(ref playerPosition);return p2==null?null:new P(p2.X,p2.Z);
        }
        double Light(P p)
        {
            double level=lamps.At(p.X,p.Z);
            foreach(int id in host.OnlinePlayers())if(host.Clock.Where(id)["lantern"]?.GetValue<bool>()==true&&PlayerAt(id) is {} at&&Sight(at,p))
                level=Math.Max(level,.85*Math.Clamp((6-at.Distance(p))/3,0,1));
            return level;
        }
        var alleys = new[]{"lanes","yards"}.SelectMany(key=>(city["alleys"]?[key] as JsonArray??new()).OfType<JsonArray>())
            .Select(r=>r.Select(q=>new P(NativeGoods.Number(q?[0]),NativeGoods.Number(q?[1]))).ToArray()).ToArray();
        bool Alley(P p)
        {
            // Use authored alley/court footprints. Cranes, trees and quay clutter are not back streets.
            foreach(var ring in alleys)
            {
                bool inside=false;
                for(int i=0,j=ring.Length-1;i<ring.Length;j=i++)
                    if((ring[i].Z>p.Z)!=(ring[j].Z>p.Z)&&p.X<(ring[j].X-ring[i].X)*(p.Z-ring[i].Z)/(ring[j].Z-ring[i].Z)+ring[i].X)inside=!inside;
                if(inside)return true;
            }
            return false;
        }
        var encounter=new NativeAntigoon(host) {
            PositionOf=PlayerAt,
            Lighting=lamps,BackAlley=Alley,
            Snap=p=>Ways.NearestOpen(p.X,p.Z,5) is {} q?new P(q.X,q.Y):null,
            HumanClear=p=>map.PathFree(p.X,p.Z),
            HumanPath=(a,b)=>Ways.Path(new Vector2((float)a.X,(float)a.Z),new Vector2((float)b.X,(float)b.Z))?.Select(p=>new P(p.X,p.Y)).ToArray(),
            MayObserve=(player,id)=>(!multiplayer.Enabled||multiplayer.Walker(id)==player)&&actions.Of(id)==null,
            ResidentHome=id=>actions.Resident(id)?["home"] is JsonObject h?new P(NativeGoods.Number(h["sx"]),NativeGoods.Number(h["sz"])):null,
            Clear=Clear, Ground=p=>map.BaseAt(p.X,p.Z), Light=Light, Sight=Sight,
            Path=(a,b)=> {
                var route=Ways.Path(new Vector2((float)a.X,(float)a.Z),new Vector2((float)b.X,(float)b.Z));
                if(route==null)return null;
                var points=route.Select(v=>new P(v.X,v.Y)).ToArray();
                // A human route is accepted only when the giant fits every segment.
                P last=a;
                foreach(var point in points) { int n=Math.Max(1,(int)Math.Ceiling(last.Distance(point)/.4)); for(int i=1;i<=n;i++) if(!Clear(new(last.X+(point.X-last.X)*i/n,last.Z+(point.Z-last.Z)*i/n)))return null;last=point; }
                return points;
            }
        };
        // The dev panel can stage an encounter anywhere in the town, even when Jef is at the quay.
        var lampPositions=((NativeTown)World).LampFacts.Select(l=>new P(NativeGoods.Number(l?["x"]),NativeGoods.Number(l?["z"]))).ToArray();
        encounter.DevelopmentStage=player=>
        {
            foreach(var lamp in lampPositions.OrderBy(p=>p.Distance(player)))for(int i=0;i<16;i++)
            {
                var candidate=encounter.Snap(new(lamp.X+Math.Sin(i*Math.PI/8)*12,lamp.Z+Math.Cos(i*Math.PI/8)*12));
                if(candidate is not {} home||home.Distance(player)<18||!Alley(home)||!Clear(home)||Light(home)>=.25)continue;
                for(int k=0;k<16;k++)
                {
                    var exit=encounter.Snap(new(home.X+Math.Sin(k*Math.PI/8)*10,home.Z+Math.Cos(k*Math.PI/8)*10));
                    if(exit is {} watch&&watch.Distance(home)>7&&Clear(watch)&&Sight(home,watch)&&encounter.Path(home,watch) is {Count:>0})return (home,watch);
                }
            }
            return null;
        };
        host.AddModule(encounter);
        AntigoonService=encounter;
        var priorReservation=actions.Reserved;actions.Reserved=id=>encounter.Controls(id)||priorReservation?.Invoke(id)==true;
    }
}

