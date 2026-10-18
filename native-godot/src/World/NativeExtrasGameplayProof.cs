using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Net.Mp;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Rendered market, animal and museum checks. Run only with a disposable proof database and no AI.</summary>
public static class NativeExtrasGameplayProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        var checks=new List<object>();var observations=new List<object>();var pictures=new List<string>();
        string error="";double originalScale=Engine.TimeScale;Townspeople? town=null;
        void Check(string name,bool passed){checks.Add(new{name,passed});if(!passed)throw new InvalidOperationException(name);}
        async Task Frames(int n){for(int i=0;i<n;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task<bool> Until(Func<bool> ready,double seconds){var deadline=DateTime.UtcNow.AddSeconds(seconds);while(DateTime.UtcNow<deadline){if(ready())return true;await Frames(3);}return ready();}
        static string S(JsonNode? n,string key)=>n?[key]?.GetValue<string>()??"";
        static double N(JsonNode? n,string key)
        {
            if(n?[key] is not JsonValue v)return 0;
            if(v.TryGetValue<double>(out var d))return d;
            if(v.TryGetValue<int>(out var i))return i;
            if(v.TryGetValue<long>(out var l))return l;
            return 0;
        }
        void View(Vector3 target){if(!Jef.I.Fly)Jef.I.ToggleFly();var eye=target+new Vector3(7,4,9);game.Cam.GlobalPosition=eye;if(game.Cam is FlyCam fly)fly.Face(new Transform3D(Basis.Identity,eye).LookingAt(target+Vector3.Up).Basis.GetRotationQuaternion());game.Cam.MakeCurrent();town?.Refill();}
        async Task Shot(string name){await Frames(3);string path=Path.Combine(output,name+".png");game.GetViewport().GetTexture().GetImage().SavePng(path);pictures.Add(name+".png");}
        try
        {
            Check("extras proof uses its own disposable database",Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)&&Main.I.Flag("no-ai"));
            Check("native town and services become ready",await Until(()=>game.Loaded&&!Loading.Busy&&ServerLink.I?.Up==true&&GameState.I.Live&&game.GetNodeOrNull<Townspeople>("Townspeople")?.Data!=null,300));
            Check("clock-driving fixture runs on its own single-player host",Together.I?.On!=true);
            town=game.GetNode<Townspeople>("Townspeople");var api=ServerLink.I!.Api!;
            MainMenu.I!.Start();Jef.I.TestInput=true;Pause.Clear();await Frames(3);
            Check("scripted menu enters unpaused gameplay",MainMenu.I.InPlay&&!game.GetTree().Paused);
            async Task Clock(int day,int hour,int minute=0){GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day,hour,minute,weather="clear",food=100,warmth=100,health=100,sleep=100,money_c=1000}));await Frames(12);}
            JsonObject Market(string place)=>NativeMarket.I!.Inspect().OfType<JsonObject>().First(r=>S(r,"place")==place);
            Node3D Group(string place)=>game.View.GetNode<Node3D>("market_"+place);
            StaticBody3D[] Bodies(string place)=>BakedWorld.All(Group(place)).OfType<StaticBody3D>().ToArray();
            int Drawn(string place)=>BakedWorld.All(Group(place)).OfType<MultiMeshInstance3D>().Where(m=>m.IsVisibleInTree()).Sum(m=>m.Multimesh is{} mesh?(mesh.VisibleInstanceCount<0?mesh.InstanceCount:mesh.VisibleInstanceCount):0);
            object Renderers(string place)=>new{place,groupVisible=Group(place).IsVisibleInTree(),camera=game.Cam.GlobalPosition.ToString(),activeCamera=game.View.GetCamera3D()?.GlobalPosition.ToString(),scenePaused=game.GetTree().Paused,townPaused=town.Paused,meshes=BakedWorld.All(Group(place)).OfType<MultiMeshInstance3D>().Select(m=>new{name=m.Name.ToString(),visible=m.IsVisibleInTree(),instances=m.Multimesh?.InstanceCount,drawCount=m.Multimesh?.VisibleInstanceCount,surfaces=m.Multimesh?.Mesh?.GetSurfaceCount()}).ToArray()};
            bool InPhysics(StaticBody3D body)
            {
                using var shape=new SphereShape3D{Radius=.03f};
                using var query=new PhysicsShapeQueryParameters3D{Shape=shape,Transform=new(Basis.Identity,body.GlobalPosition),CollisionMask=Solid.Layer,CollideWithBodies=true,CollideWithAreas=false};
                return game.World.GetWorld3D().DirectSpaceState.IntersectShape(query,64).Any(hit=>hit.TryGetValue("collider",out var v)&&v.AsGodotObject()==body);
            }
            await Clock(3,9);View(new(-117,0,29));await Frames(180);
            Check("proof observer is the actual viewport camera",game.View.GetCamera3D()==game.Cam&&!game.GetTree().Paused&&!town.Paused);
            Check("native dynamic layout supplies both market squares",await Until(()=>NativeMarket.I?.Inspect().Count==2&&NativeMarket.I.Items>15,30));
            var market=NativeMarket.I!;
            // (#150: the Vismarkt's stalls stand once their own sellers have walked to them after the jump in time)
            Check("both market days display their full ranked layouts",await Until(()=>market.Inspect().All(r=>N(r,"up")==N(r,"items")&&N(r,"items")>5),150));
            var mask=BakedWorld.All(game).OfType<NativeMarketIntakeMask>().Single();
            var replaced=BakedWorld.All(game.World).Where(n=>n.HasMeta("native_market_replaced")).ToArray();
            Check("frozen intake markets and yard animals are found",mask.MaskedGroups>=2&&replaced.Length>0);
            Check("frozen intake pictures remain hidden and have no active physics",replaced.OfType<Node3D>().All(n=>!n.Visible)&&replaced.OfType<CollisionObject3D>().All(b=>b.CollisionLayer==0&&b.CollisionMask==0));
            observations.Add(new{phase="fish-renderers",state=Market("vismarkt").DeepClone(),renderers=Renderers("vismarkt"),models=new[]{"stalls","trades"}.Select(name=>{var model=Scheldemist.Models.ModelLibrary.Get(name);return new{name,roots=model?.Roots.Keys.ToArray(),geometry=model==null?Array.Empty<string>():Scheldemist.Models.ModelLibrary.Describe(model.Scene).Take(150).ToArray()};}).ToArray()});
            Check("actual native fish market meshes are visible",Drawn("vismarkt")>10);
            View(new(-259,0,98));await Frames(12);Check("actual native Grote Markt meshes are visible",Drawn("grote_markt")>10);
            View(new(-117,0,29));await Frames(12);
            var bodies=Bodies("vismarkt").Where(b=>b.CollisionLayer!=0).ToArray();
            Check("raised market tables use actual physics bodies",bodies.Length>=4&&bodies.Any(InPhysics));
            var blocked=bodies.Where(b=>!town.Walk!.Free(b.GlobalPosition.X,b.GlobalPosition.Z)).Select(b=>new Vector2(b.GlobalPosition.X,b.GlobalPosition.Z)).ToArray();
            Check("crowd navigation samples live market bodies",blocked.Length>0);
            observations.Add(new{phase="open",layout=market.Inspect().DeepClone(),drawn=Drawn("vismarkt"),mask.MaskedGroups,mask.MaskedNodes});
            Check("anonymous shoppers are spawned from hidden street entrances",await Until(()=>N(Market("vismarkt"),"shoppers")>0,30));
            var before=Market("vismarkt")["people"]!.AsArray().OfType<JsonObject>().ToDictionary(p=>S(p,"id"),p=>new Vector2((float)N(p,"x"),(float)N(p,"z")));
            Check("anonymous shoppers actually move through the market",await Until(()=>Market("vismarkt")["people"]!.AsArray().Any(p=>before.TryGetValue(S(p,"id"),out var at)&&at.DistanceTo(new((float)N(p,"x"),(float)N(p,"z")))>.4),30));
            Check("market shoppers reach a stall and browse or bargain",await Until(()=>Market("vismarkt")["people"]!.AsArray().Any(p=>S(p,"phase")is"look"or"haggle"),45));
            Check("the Vismarkt's stalls are kept by people of the town, none by nameless sellers (#150)",Market("vismarkt")["pitched"]?.GetValue<bool>()==true&&N(Market("vismarkt"),"sellers")==0&&market.PitchState().Count==(int)N(Market("vismarkt"),"items")&&market.PitchState().All(p=>p!["level"]!.GetValue<int>()>=0));
            await Shot("market-open");
            View(new(-259,0,98));await Frames(45);Check("Grote Markt has its own visible layouts and sellers",N(Market("grote_markt"),"up")>5&&N(Market("grote_markt"),"sellers")>0);await Shot("grote-markt-open");
            await Clock(3,6);
            Check("morning setup shows the Vismarkt's stalls part-built, no goods out yet (#150)",await Until(()=>Market("vismarkt")["levels"]!.AsArray().Any(l=>l!.GetValue<int>() is 0 or 1)&&N(Market("vismarkt"),"up")==0&&N(Market("grote_markt"),"up")==0,20));
            await Clock(3,9);View(new(-117,0,29));
            var stock=await api.Post<JsonElement>("api/dev/trade",new{post="vismarkt",stock=0});
            Check("native ledger accepts an actual empty fish shelf",stock.GetProperty("posts").EnumerateArray().Any(p=>p.GetProperty("id").GetString()=="vismarkt"&&p.GetProperty("stock").GetDouble()<=p.GetProperty("floor").GetDouble()));
            // Polling is the production path (15 seconds), not a test-only empty-shelf switch.
            Check("production market poll observes the empty native shelf",await Until(()=>Market("vismarkt")["soldOutAt"]!=null,22));await Clock(3,10,15);
            // (#150: a seller who sells out stays at her stall until packing time, and says so)
            string soldOut="";try{await api.Post<JsonElement>("api/buy",new{npc=Scheldemist.People.NativeMarket.SellerPrefix+"0",kind="herring"});}catch(ApiException e){soldOut=e.Message;}
            Check("a fish seller sells nothing when the fish market is sold out",soldOut.Contains("Sold out"));
            Check("sold-out packing keeps the other square's full market",N(Market("grote_markt"),"up")==N(Market("grote_markt"),"items"));
            observations.Add(new{phase="sold-out",layout=market.Inspect().DeepClone()});await Shot("market-sold-out");
            await Clock(3,18);
            // (#150: the Vismarkt's stalls come down as their sellers leave, a moment after the jump in time)
            Check("closed market removes ranked meshes and physical blockers",await Until(()=>market.Inspect().All(r=>N(r,"up")==0&&N(r,"colliders")==0)&&Bodies("vismarkt").All(b=>b.CollisionLayer==0),30));
            Check("crowd navigation releases former market footprints",blocked.Any(p=>town.Walk!.Free(p.X,p.Y)));
            Check("closed market sellers leave rather than remain frozen",await Until(()=>market.Sellers==0,20));await Shot("market-closed");
            await Clock(7,9);Check("Sunday has no dynamic market setup",market.Inspect().All(r=>N(r,"up")==0));
            await Clock(1,9);Check("Grote Markt obeys its Wednesday/Saturday schedule",await Until(()=>N(Market("vismarkt"),"up")>0,150)&&N(Market("grote_markt"),"up")==0);
            // Visitor motion, doorway staging and hidden-inside state use the actual crowd/doorway.
            await Clock(3,10);View(new(-183.5f,0,-20));Engine.TimeScale=3;
            var visitors=NativeSteenVisitors.I!;var states=new HashSet<string>();var seen=new List<object>();
            bool ObserveVisitors(){foreach(var v in visitors.Inspect()){string s=S(v,"state");if(states.Add(s))seen.Add(new{state=s,visitor=v!.DeepClone()});}return states.Contains("inside");}
            async Task<bool> VisitorUntil(Func<bool> ready,double seconds){var deadline=DateTime.UtcNow.AddSeconds(seconds);while(DateTime.UtcNow<deadline){ObserveVisitors();if(ready())return true;await Frames(1);}ObserveVisitors();return ready();}
            Check("Steen spawns actual visitors during museum hours",await VisitorUntil(()=>visitors.Count>0,35));
            bool entered=await VisitorUntil(()=>states.Contains("inside"),130);
            observations.Add(new{phase="museum-transition-check",entered,hour=town.Hour,states=seen.ToArray(),visitors=visitors.Inspect().DeepClone()});
            Check("Steen visitors walk, look, enter and disappear inside",entered&&states.Contains("coming")&&states.Contains("looking")&&states.Contains("entering")&&states.Contains("stepIn"));
            Check("inside museum visitors have no duplicate street puppet",visitors.Inspect().Any(v=>S(v,"state")=="inside"&&v!["x"]==null&&v["z"]==null));
            observations.Add(new{phase="museum-open",states=seen.ToArray(),visitors=visitors.Inspect().DeepClone()});await Shot("steen-visitors");
            await Clock(3,16);
            Check("museum closing brings its occupants back through the door",await Until(()=>visitors.Inspect().Any(v=>S(v,"state")=="stepOut"&&v!["x"]!=null),15));
            Check("museum visitors actually walk away after closing",await Until(()=>visitors.Inspect().Any(v=>S(v,"state")=="leaving"),15));
            Check("closed museum does not retain visitors indefinitely",await Until(()=>visitors.Count==0,55));await Shot("steen-closed");
            var courts=BakedWorld.All(game).OfType<NativeCourtyards>().Single();
            Check("native courtyards create source-sized hen/goat groups",courts.Hens>0&&courts.Hens<=18&&courts.Hens%3==0&&courts.Goats<=2);
            var animal=courts.List.First();View(new((float)animal.X,0,(float)animal.Z));await Frames(12);var atAnimal=animal.Body.GlobalPosition;
            Check("courtyard animal uses native visible geometry",animal.Body.IsVisibleInTree()&&BakedWorld.All(animal.Body).OfType<MeshInstance3D>().Any(m=>m.Mesh!=null));
            Check("courtyard animal wanders on its own native ground",await Until(()=>GodotObject.IsInstanceValid(animal.Body)&&animal.Body.GlobalPosition.DistanceTo(atAnimal)>.15,25));
            observations.Add(new{phase="courtyard",courts.Hens,courts.Goats,animal.Id,animal.Kind,position=animal.Body.GlobalPosition.ToString()});await Shot("courtyard-animals");
        }
        catch(Exception ex)
        {
            error=ex.ToString();GD.PushError("native extras proof: "+error);
            try{game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"failed.png"));pictures.Add("failed.png");}catch(Exception capture){GD.PrintErr("native extras failure screenshot: "+capture.Message);}
        }
        finally
        {
            Engine.TimeScale=originalScale;if(Jef.I is{} jef)jef.TestInput=false;
            File.WriteAllText(Path.Combine(output,"native-extras.json"),JsonSerializer.Serialize(new{ok=error=="",error,checks,observations,pictures},new JsonSerializerOptions(Api.Json){WriteIndented=true}));
        }
        if(error!="")throw new InvalidOperationException(error);
    }
}
