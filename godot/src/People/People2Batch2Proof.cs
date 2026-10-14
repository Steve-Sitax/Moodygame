using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

// Optional in-town batch receipt; every figure uses the ordinary default route and identity bake.
[GamePart(898)]
internal partial class People2Batch2Proof : Node
{
    internal static readonly string[] NewKinds = {
        "docker_b","docker_c","docker_sack","porter","carter","coalman","sweep","sweep_boy","grinder","ragman","baker_boy","beggar",
        "soldier","soldier_b","sentry","customs","priest","gentleman","clerk","tourist","shopkeeper","publican","baker",
        "peeters","tuur","fientje","sailor","sailor_b","stranger","thief","foreman","recipient","boy","urchin","old_man"
    };
    private readonly List<Human> active = new();
    public override void _Process(double delta) { foreach (var h in active) h.Update((float)delta); }
    private async Task Frames(int n) { for(int i=0;i<n;i++) await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame); }
    public override async void _Ready()
    {
        string output = Main.I.Arg("people2-batch2-captures");
        if(output == "") { SetProcess(false); return; }
        try
        {
            Directory.CreateDirectory(output);
            DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled); Engine.MaxFps=0;
            var town=Main.I.GetNode<Townspeople>("Townspeople");
            for(int f=0;(!Main.I.Loaded || town.Data==null || !Dev.Kit.I.IsReady) && f<3600;f++) await Frames(1);
            if(!Main.I.Loaded || town.Data==null || !Dev.Kit.I.IsReady) throw new InvalidOperationException("Town not ready.");
            town.ClockRuns=false; town.SetProcess(false);
            if(town.Crowd!=null) foreach(var resident in town.Crowd.Walking) resident.Group.Visible=false;
            Game.GameState.I.PlayingWhen=()=>false;
            if(Player.Jef.I is {Fly:false} jef) jef.ToggleFly();
            Player.Jef.I.TestInput=true; Main.I.Cam.SetProcess(false);
            var records=new List<object>();
            string[] requested=Main.I.Arg("people2-batch2-kinds") is {Length:>0} subset ? subset.Split(',') : NewKinds;
            foreach(string kind in requested)
            {
                string place = kind is "soldier" or "soldier_b" or "sentry" ? "barracks"
                    : kind is "customs" or "docker_b" or "docker_c" or "docker_sack" or "porter" or "carter" or "coalman" or "foreman" or "sailor" or "sailor_b" ? "rijnkaai"
                    : kind=="priest" ? "cathedral"
                    : kind is "peeters" or "fientje" or "shopkeeper" or "publican" or "baker" or "baker_boy" or "grinder" or "ragman" ? "vismarkt" : "handschoenmarkt";
                var p=town.Data.Places[place];
                var at=place=="vismarkt" ? new Vector3(-117,0,39)
                    : place=="rijnkaai" ? new Vector3(0,0,18)
                    : place=="barracks" ? new Vector3((float)(p.X+(p.Out?.X ?? 0)*3),0,(float)(p.Z+(p.Out?.Z ?? -1)*3))
                    : new Vector3(-250,0,135);
                float ground=Lights.I?.GroundAt(at.X,at.Z)??0; if(float.IsFinite(ground)) at.Y=ground;
                var h=Humans.Make(kind) ?? throw new InvalidOperationException("Missing kind: "+kind);
                string expected=kind=="old_man" ? "old_man_dressed" : kind;
                if(h.Root.Name.ToString()!=expected || h.Root.GetNode<Skeleton3D>("Skeleton3D").GetBoneCount()!=64)
                    throw new InvalidOperationException("Legacy fallback: "+kind);
                h.SetIdentity("batch2-proof:"+kind); h.Root.Position=at; h.Root.Rotation=new(0,MathF.PI,0);
                Main.I.View.AddChild(h.Root); h.Start(); active.Add(h);
                await Frames(90);
                foreach(var (label,hour,weather) in new[]{("day",13.0,"clear"),("rain",13.0,"rain"),("lamps",19.5,"clear")})
                {
                    await Dev.Kit.I.Light(hour,weather); await Frames(30);
                    foreach(var (distance,angle) in new[]{(3f,"front"),(8f,"front"),(1f,"side"),(1f,"back-low"),(1f,"top"),(1f,"feet-low")})
                    {
                        if(Main.I.Flag("people2-batch2-front-only") && angle!="front") continue;
                        var offset=angle=="front" ? new Vector3(0,1.3f,-distance)
                            : angle=="side" ? new Vector3(1.1f,1.5f,0)
                            : angle=="top" ? new Vector3(.7f,2.2f,-.6f)
                            : angle=="feet-low" ? new Vector3(.7f,.15f,-.7f) : new Vector3(.8f,.35f,.8f);
                        if (angle=="front" && (kind=="carter" || place is "handschoenmarkt" or "cathedral")) offset=new Vector3(distance*.8f,1.3f,-distance*.6f);
                        var target=at+Vector3.Up*(angle=="side"?1.45f:angle=="feet-low"?.22f:.85f);
                        var rotation=h.Root.Rotation;
                        Vector3 from=at+offset;
                        if(angle=="front")
                        {
                            from=ClearFront(town,at,from,target,distance);
                            h.ReleaseFeet();
                            // The cart extends beyond a straight 3 m front camera; keep its three-quarter view.
                            if(kind!="carter") h.Root.Rotation=new Vector3(0,MathF.Atan2(from.X-at.X,from.Z-at.Z),0);
                        }
                        Aim(from,target); await Frames(8);
                        string file=$"{label}-{kind}-{distance:0}m-{angle}.png"; Shot(output,file);
                        if(Math.Abs(Daylight.I.Hour-hour)>.02 || Daylight.I.Weather!=weather) throw new InvalidOperationException("Wrong light: "+file);
                        if(kind=="porter" && (!h.Root.HasNode("people2_sack_truck") || h.Root.GetMeta("vehicle_grip_error").AsSingle()>.001f))
                            throw new InvalidOperationException("Sack truck grip lost.");
                        if(kind=="carter" && !h.Root.HasNode("pushcart")) throw new InvalidOperationException("Handcart missing.");
                        records.Add(new{file,kind,body=h.Root.Name.ToString(),place,x=at.X,y=at.Y,z=at.Z,distance,angle,hour=Daylight.I.Hour,weather=Daylight.I.Weather,clip=h.AnimationState.Clip});
                        if(angle=="front") { h.Root.Rotation=rotation; h.ReleaseFeet(); }
                    }
                }
                active.Remove(h); h.Dispose(); await Frames(2);
            }
            foreach(string square in requested.Length==NewKinds.Length || Main.I.Flag("people2-batch2-retake-crowds") ? new[]{"vismarkt","grote_markt"} : Array.Empty<string>())
            {
                var p=town.Data.Places[square];
                var centre=new Vector3((float)p.X,0,(float)p.Z);
                for(int i=0;i<16;i++)
                {
                    string kind=i%4==0 ? new[]{"fishwife_a","wife_a","girl","police"}[i/4] : NewKinds[(i*7)%NewKinds.Length];
                    var h=Humans.Make(kind)!; h.SetIdentity("batch2-mix:"+square+":"+i);
                    var at=centre+new Vector3((i%4-1.5f)*1.1f,0,(i/4)*1.15f);
                    at.Y=Lights.I?.GroundAt(at.X,at.Z)??0;
                    h.Root.Position=at; h.Root.Rotation=new(0,MathF.PI,0); Main.I.View.AddChild(h.Root); h.Start(); active.Add(h);
                }
                await Frames(180);
                foreach(var (label,hour,weather) in new[]{("day",13.0,"clear"),("rain",13.0,"rain"),("lamps",19.5,"clear")})
                {
                    await Dev.Kit.I.Light(hour,weather); await Frames(30);
                    Aim(centre+new Vector3(0,1.6f,-8),centre+Vector3.Up); await Frames(8);
                    string file=$"crowd-{square}-{label}.png"; Shot(output,file);
                    records.Add(new{file,square,hour,weather,kinds=active.Select(h=>h.Kind).ToArray()});
                }
                foreach(var h in active) h.Dispose(); active.Clear(); await Frames(2);
            }
            File.WriteAllText(Path.Combine(output,"captures.json"),JsonSerializer.Serialize(new{ok=true,kinds=requested,pictures=records,fingerprint=Main.I.WorldFingerprint},new JsonSerializerOptions{WriteIndented=true}));
            GetTree().Quit();
        }
        catch(Exception error) { GD.PrintErr(error); GetTree().Quit(1); }
    }
    private static void Aim(Vector3 from,Vector3 to)
    {
        Main.I.Cam.LookAtFromPosition(from,to);
        if(Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
    }
    private static void Shot(string output,string file) => Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(output,file));
    private static Vector3 ClearFront(Townspeople town,Vector3 at,Vector3 preferred,Vector3 target,float distance)
    {
        var space=Main.I.Cam.GetWorld3D().DirectSpaceState;
        bool Clear(Vector3 from) => town.Walk!=null && town.Walk.Open(from.X,from.Z) && town.Walk.Free(from.X,from.Z)
            && space.IntersectRay(PhysicsRayQueryParameters3D.Create(from,target)).Count==0
            && space.IntersectRay(PhysicsRayQueryParameters3D.Create(from,at+Vector3.Up*1.4f)).Count==0;
        if(Clear(preferred)) return preferred;
        foreach(float angle in new[]{0f,.6435f,-.6435f,MathF.PI/4,-MathF.PI/4,MathF.PI/2,-MathF.PI/2,MathF.PI})
        {
            Vector3 from=at+new Vector3(MathF.Sin(angle)*distance,1.3f,-MathF.Cos(angle)*distance);
            if(Clear(from)) return from;
        }
        throw new InvalidOperationException("No clear camera at "+distance+" m for "+at);
    }
}
