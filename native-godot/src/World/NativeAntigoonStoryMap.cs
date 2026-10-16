using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.Native.Services;
using Dialogs = Scheldemist.Ui.Dialogs;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.World;

/// <summary>
/// Proof aid for choosing the story's sighting: a map of Antigoon's walkable streets with the night's lamp pools, the
/// lamp rounds, chapter 1's lamps, and numbered dark, quiet junctions where the staged crossing really works from a
/// spot 30 to 40 m away. Each candidate also gets a night picture from that spot with the giant standing in the junction.
/// Runs only in a disposable proof save.
/// </summary>
public static class NativeAntigoonStoryMap
{
    private sealed record Candidate(int N,P Junction,P Eye,IReadOnlyList<P> Cross,IReadOnlyList<P> Tail,double Dark,double Back,double ToLamp,bool Alley,string Why);
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int count){for(int i=0;i<count;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        try
        {
            if(!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!game.Flag("no-ai"))throw new Exception("Story map requires its own database and --no-ai.");
            var deadline=DateTime.UtcNow.AddSeconds(600);
            while(!game.Loaded||Loading.Busy||ServerLink.I?.Up!=true||!GameState.I.Live||game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not >500)
            {if(DateTime.UtcNow>deadline)throw new TimeoutException("Native town not ready");await Frames(1);}
            MainMenu.I!.Start();Jef.I.TestInput=true;Pause.Clear();Dialogs.CloseAll();var api=ServerLink.I!.Api!;
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=23,minute=0,weather="clear"}));
            await Frames(10);
            var encounter=game.AntigoonService!;var host=game.ServiceHost!;var map=game.World.NativeWalk!;
            var reach=await Task.Run(()=>encounter.ReachMap!());
            var town=game.GetNode<Townspeople>("Townspeople");
            var found=await host.WithState(c=>
            {
                var lamps=encounter.Lighting!.Targets().Select(l=>l.At).ToArray();
                var rounds=c.World("townlife_lamps")?["rounds"]?.DeepClone() as JsonArray??new();
                var places=c.World("town")?["places"] as JsonObject??new();
                var taverns=places.Where(p=>p.Key.StartsWith("tavern:",StringComparison.Ordinal)&&p.Value?["door"] is JsonArray {Count:>=2})
                    .Select(p=>new P(NativeGoods.Number(p.Value!["door"]![0]),NativeGoods.Number(p.Value["door"]![1]))).ToArray();
                var story=host.Payload(1)["story"]?.DeepClone() as JsonObject;
                var last=story?["lamps"]?[1] is {} l?new P(NativeGoods.Number(l["x"]),NativeGoods.Number(l["z"])):new P(0,0);
                double Light(P p)=>encounter.Light(p);
                bool Arm(P from,double angle){for(double r=.5;r<=11;r+=.5)if(!reach.Reachable(new(from.X+Math.Sin(angle)*r,from.Z+Math.Cos(angle)*r)))return false;return true;}
                bool Water(P p,double r){for(int i=0;i<12;i++)if(Scheldemist.World.Water.In((float)(p.X+Math.Sin(i*Math.PI/6)*r),(float)(p.Z+Math.Cos(i*Math.PI/6)*r)))return true;return false;}
                // Junctions: three to five open arms of his streets, not an open square, dark tonight, off the quays
                // and away from the taverns.
                var raw=new List<(P At,double Dark,bool Alley,double Score)>();
                for(double z=map.Z0+2;z<map.Z0+map.D-2;z+=2)for(double x=map.X0+2;x<map.X0+map.W-2;x+=2)
                {
                    var p=new P(x,z);if(!reach.Reachable(p))continue;
                    int arms=0;for(int a=0;a<8;a++)if(Arm(p,a*Math.PI/4))arms++;
                    if(arms<3||arms>5)continue;
                    int fill=reach.Within(p,4).Count();if(fill>.72*Math.PI*64)continue;
                    if(Light(p)>=.08||Water(p,20)||taverns.Any(t=>t.Distance(p)<60))continue;
                    double dark=0;int n=0;foreach(var q in reach.Within(p,14).Where((_,i)=>i%9==0)){dark+=Light(q);n++;}dark=n==0?0:dark/n;
                    bool alley=Enumerable.Range(0,8).Any(i=>encounter.BackAlley(new(p.X+Math.Sin(i*Math.PI/4)*10,p.Z+Math.Cos(i*Math.PI/4)*10)));
                    raw.Add((p,dark,alley,(1-Math.Min(1,dark*6))+(alley?.4:0)-p.Distance(last)/900));
                }
                var picked=new List<Candidate>();int tried=0;
                foreach(var r in raw.OrderByDescending(r=>r.Score))
                {
                    if(picked.Count>=10||++tried>260)break;
                    if(picked.Any(c=>c.Junction.Distance(r.At)<55)||encounter.Roofed(r.At))continue;
                    // A silhouette needs something lit behind it: the best viewing spot has a lamp pool or a lit facade
                    // beyond the junction, while the junction itself stays dark.
                    Candidate? best=null;
                    foreach(double range in new[]{30.0,34,38})for(int a=0;a<16;a++)
                    {
                        var eye=new P(r.At.X+Math.Sin(a*Math.PI/8)*range,r.At.Z+Math.Cos(a*Math.PI/8)*range);
                        if(!map.PathFree(eye.X,eye.Z)||encounter.Roofed(eye)||!encounter.BodyVisible(eye,r.At))continue;
                        double ux=(r.At.X-eye.X)/range,uz=(r.At.Z-eye.Z)/range,back=0;
                        for(double t=6;t<=40;t+=2){var q=new P(r.At.X+ux*t,r.At.Z+uz*t);if(!encounter.BodyVisible(eye,q))break;back=Math.Max(back,Light(q));}
                        if(back<.2||best!=null&&back<=best.Back)continue;
                        if(encounter.StageAt(r.At,eye,last) is not {} stage)continue;
                        best=new(picked.Count+1,r.At,eye,stage.Cross,stage.Tail,r.Dark,back,r.At.Distance(last),r.Alley,
                            $"{(r.Alley?"back lane or court beside it":"side street")}; dark at the junction, lamp light {back:0.00} behind it; {r.At.Distance(last):0} m from the round's last lamp");
                    }
                    if(best!=null)picked.Add(best);
                }
                return (lamps,rounds,story,picked,raw.Count);
            });
            var (litLamps,rounds,storyView,candidates,junctions)=found;
            GD.Print($"STORY_MAP: {junctions} dark quiet junctions on his map, {candidates.Count} with a working crossing");
            Draw(map,reach,litLamps,rounds,storyView,candidates,town,encounter,output);
            var report=new JsonObject{["junctions"]=junctions,["candidates"]=new JsonArray(candidates.Select(c=>(JsonNode)new JsonObject{
                ["n"]=c.N,["x"]=Math.Round(c.Junction.X,1),["z"]=Math.Round(c.Junction.Z,1),["eye_x"]=Math.Round(c.Eye.X,1),["eye_z"]=Math.Round(c.Eye.Z,1),
                ["cross_m"]=Math.Round(Walked(c.Cross),1),["tail_m"]=Math.Round(Walked(c.Tail),1),["to_last_lamp_m"]=Math.Round(c.ToLamp),["why"]=c.Why}).ToArray()),["story"]=storyView?.DeepClone()};
            File.WriteAllText(Path.Combine(output,"story-map.json"),report.ToJsonString(new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));
            // A night look from each spot with the giant standing in the junction, and the same by day to show where he stands.
            var giant=new Characters.AntigoonActor{Name="StoryMapAntigoon",TownLighting=true};Main.I.View.AddChild(giant);await Frames(4);
            foreach(var (hour,label) in new[]{(23,"night"),(14,"day")})
            {
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour,minute=0,weather="clear"}));await Frames(20);
                foreach(var c in candidates)
                {
                    var along=c.Cross[^1];
                    float yaw=MathF.Atan2(-(float)(c.Junction.X-c.Eye.X),-(float)(c.Junction.Z-c.Eye.Z));
                    Jef.I.Place((float)c.Eye.X,(float)c.Eye.Z,yaw,.08f);
                    giant.Snapshot(new Vector3((float)c.Junction.X,(float)map.BaseAt(c.Junction.X,c.Junction.Z),(float)c.Junction.Z),(float)Math.Atan2(along.X-c.Junction.X,along.Z-c.Junction.Z),"walk",.4,0,true);
                    await Frames(60);
                    await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,$"candidate-{c.N}-{label}.png"));
                }
            }
            giant.QueueFree();
            File.WriteAllText(Path.Combine(output,"done.txt"),"ok");
            GD.Print("STORY_MAP_DONE: "+output);
            game.GetTree().Quit();
        }
        catch(Exception error){File.WriteAllText(Path.Combine(output,"failure.txt"),error.ToString());GD.PrintErr(error);game.GetTree().Quit(1);}
    }
    private static double Walked(IReadOnlyList<P> path){double sum=0;for(int i=1;i<path.Count;i++)sum+=path[i].Distance(path[i-1]);return sum;}

    // ------------------------------------------------------------------ the picture

    private const int Scale=2;
    private static readonly string[] Digits={"01110100011001110101110011000101110","00100011000010000100001000010001110","01110100010000100010001000100011111","11111000100010000010000011000101110","00010001100101010010111110001000010","11111100001111000001000011000101110","00110010001000011110100011000101110","11111000010001000100010000100001000","01110100011000101110100011000101110","01110100011000101111000010001001100"};
    private static void Draw(WalkMap map,Services.AntigoonReach reach,P[] lamps,JsonArray rounds,JsonObject? story,List<Candidate> candidates,Townspeople town,Services.NativeAntigoon encounter,string output)
    {
        int w=map.W*Scale,h=map.D*Scale;var image=Image.CreateEmpty(w,h,false,Image.Format.Rgb8);
        var light=new float[w*h];
        foreach(var l in lamps)
        {
            int cx=(int)((l.X-map.X0)*Scale),cz=(int)((l.Z-map.Z0)*Scale),r=13*Scale;
            for(int z=Math.Max(0,cz-r);z<Math.Min(h,cz+r);z++)for(int x=Math.Max(0,cx-r);x<Math.Min(w,cx+r);x++)
            {double d=Math.Sqrt((x-cx)*(x-cx)+(z-cz)*(z-cz))/Scale;float v=(float)Services.NativeStreetLighting.LampLight(d);if(v>light[z*w+x])light[z*w+x]=v;}
        }
        var blocked=new Color("2c2824");var open=new Color("b8ad93");var water=new Color("2f4655");var giant=new Color("a3332a");var glow=new Color("ffd77a");
        for(int z=0;z<h;z++)for(int x=0;x<w;x++)
        {
            double wx=map.X0+(x+.5)/Scale,wz=map.Z0+(z+.5)/Scale;
            Color c=Scheldemist.World.Water.In((float)wx,(float)wz)?water:map.PathFree(wx,wz)?open:blocked;
            if(reach.Reachable(new(wx,wz)))c=c.Lerp(giant,.55f);
            float v=light[z*w+x];if(v>0)c=c.Lerp(glow,v*.7f);
            image.SetPixel(x,z,c);
        }
        Vector2I Px(P p)=>new((int)((p.X-map.X0)*Scale),(int)((p.Z-map.Z0)*Scale));
        void Dot(P p,int r,Color c,bool ring=false){var q=Px(p);for(int z=-r;z<=r;z++)for(int x=-r;x<=r;x++){int d=x*x+z*z;if(d>r*r||ring&&d<(r-2)*(r-2))continue;int px=q.X+x,pz=q.Y+z;if(px>=0&&pz>=0&&px<w&&pz<h)image.SetPixel(px,pz,c);}}
        void Line(P a,P b,Color c,int dash=0){double d=a.Distance(b);int n=Math.Max(1,(int)(d*Scale));for(int i=0;i<=n;i++){if(dash>0&&i/dash%2==1)continue;var q=Px(a.Toward(b,d*i/n));if(q.X>=0&&q.Y>=0&&q.X<w&&q.Y<h)image.SetPixel(q.X,q.Y,c);}}
        void Route(IReadOnlyList<P> path,Color c,int dash=0){for(int i=1;i<path.Count;i++)Line(path[i-1],path[i],c,dash);}
        void Number(P at,int value,Color ink){string s=value.ToString();var q=Px(at);int cell=3,width=s.Length*6*cell;int left=q.X-width/2,top=q.Y-30;
            for(int k=0;k<s.Length;k++){var bits=Digits[s[k]-'0'];for(int row=0;row<7;row++)for(int col=0;col<5;col++)if(bits[row*5+col]=='1')
                for(int dz=-1;dz<=cell;dz++)for(int dx=-1;dx<=cell;dx++){int px=left+k*6*cell+col*cell+dx,pz=top+row*cell+dz;if(px<0||pz<0||px>=w||pz>=h)continue;
                    bool inside=dx>=0&&dz>=0&&dx<cell&&dz<cell;if(inside)image.SetPixel(px,pz,ink);else if(image.GetPixel(px,pz)!=ink)image.SetPixel(px,pz,Colors.Black);}}}
        foreach(var round in rounds)
        {
            var path=(round?["path"] as JsonArray??new()).Select(q=>new P(NativeGoods.Number(q?[0]),NativeGoods.Number(q?[1]))).ToArray();
            bool west=NativeGoods.S(round,"id")==NativeGoods.S(story,"round");
            Route(path,west?new Color("f08a24"):new Color("6f5f45"),west?0:3);
            foreach(var l in round?["lamps"] as JsonArray??new())Dot(new(NativeGoods.Number(l?["x"]),NativeGoods.Number(l?["z"])),2,new Color("1a1a1a"));
        }
        foreach(var l in lamps)Dot(l,2,new Color("ffe9a6"));
        foreach(var l in story?["lamps"] as JsonArray??new())Dot(new(NativeGoods.Number(l?["x"]),NativeGoods.Number(l?["z"])),8,new Color("f08a24"),true);
        if(story?["door"] is JsonObject door)Dot(new(NativeGoods.Number(door["x"]),NativeGoods.Number(door["z"])),6,new Color("3d7bd9"));
        foreach(var c in candidates)
        {
            Line(c.Eye,c.Junction,new Color("63d5e8"),4);Dot(c.Eye,4,new Color("63d5e8"));
            Route(c.Cross,Colors.White);Route(c.Tail,new Color("dcdcdc"),3);
            Dot(c.Junction,10,Colors.White,true);Number(c.Junction,c.N,Colors.White);
        }
        image.SavePng(System.IO.Path.Combine(output,"story-map.png"));
        // Close-ups of each candidate: 140 m square, enlarged.
        foreach(var c in candidates)
        {
            var q=Px(c.Junction);int half=70*Scale;var rect=new Rect2I(Math.Clamp(q.X-half,0,Math.Max(0,w-2*half)),Math.Clamp(q.Y-half,0,Math.Max(0,h-2*half)),Math.Min(w,2*half),Math.Min(h,2*half));
            var crop=image.GetRegion(rect);crop.Resize(crop.GetWidth()*2,crop.GetHeight()*2,Image.Interpolation.Nearest);crop.SavePng(System.IO.Path.Combine(output,$"candidate-{c.N}-map.png"));
        }
    }
}
