using Godot;
using System;
using System.Collections.Concurrent;
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
        // He steps over crates, benches and low walls a man must climb; anything taller below his crown stops him.
        const float Step=1.1f,Radius=.65f,Crown=5.5f,Leap=2.3f;
        int Quarter(double v,double origin)=>(int)Math.Floor((v-origin)*4);
        // Street level beside a crate or bench: the walk map's own footing within 1.25 m, never the top of the thing.
        (double X,double Z)? Footing(P p)
        {
            int ix=Quarter(p.X,map.X0),iz=Quarter(p.Z,map.Z0);
            if(map.NativeCellFree(ix,iz))return (p.X,p.Z);
            for(int r=1;r<=5;r++)for(int dz=-r;dz<=r;dz++)for(int dx=-r;dx<=r;dx++)
                if(Math.Max(Math.Abs(dx),Math.Abs(dz))==r&&dx*dx+dz*dz<=25&&map.NativeCellFree(ix+dx,iz+dz))return (map.X0+(ix+dx+.5)/4,map.Z0+(iz+dz+.5)/4);
            return null;
        }
        double Floor(P p)=>Footing(p) is {} f?map.BaseAt(f.X,f.Z):map.BaseAt(p.X,p.Z);
        Vector3 At(P p,float height=0)=>new((float)p.X,(float)Floor(p)+height,(float)p.Z);
        bool Fits(P p)=>!Water.In((float)p.X,(float)p.Z)&&Footing(p) is {} f&&geometry.Clear(new((float)p.X,(float)map.BaseAt(f.X,f.Z),(float)p.Z),Radius,Crown,Step);
        // Too tall to step over but low enough to leap: nothing between 2.3 m and his crown.
        bool Leaps(P p)=>!Water.In((float)p.X,(float)p.Z)&&Footing(p) is {} f&&geometry.Clear(new((float)p.X,(float)map.BaseAt(f.X,f.Z),(float)p.Z),Radius,Crown,Leap);
        var lampPositions=((NativeTown)World).LampFacts.Select(l=>new P(NativeGoods.Number(l?["x"]),NativeGoods.Number(l?["z"]))).ToArray();
        // His reachability map: built once per world on a worker thread, then kept in the data folder.
        AntigoonReach? reach=null;
        string key=fingerprint+$"|step {Step} radius {Radius} crown {Crown} leap {Leap}";
        string file=System.IO.Path.Combine(Paths.Data,"antigoon-cache","reach.bin");
        Water.In(0,0);// load the water outline here, not on the worker
        var drawing=System.Threading.Tasks.Task.Run(()=>
        {
            var clock=System.Diagnostics.Stopwatch.StartNew();
            var loaded=AntigoonReach.Load(file,key);bool built=loaded==null;
            if(loaded==null)
            {
                loaded=AntigoonReach.Build(Fits,Leaps,lampPositions,map.X0,map.Z0,map.X0+map.W,map.Z0+map.D);
                try{loaded.Save(file,key);}catch(Exception e) when (e is System.IO.IOException or UnauthorizedAccessException){GD.PushWarning("Antigoon reach map not saved: "+e.Message);}
            }
            Volatile.Write(ref reach,loaded);
            GD.Print($"ANTIGOON_REACH_MAP {(built?"built":"loaded")}: {loaded.Count*AntigoonReach.Cell*AntigoonReach.Cell:0} m2 of streets in {loaded.Areas} areas, {loaded.Hops*AntigoonReach.Cell*AntigoonReach.Cell:0} m2 to jump, {clock.ElapsedMilliseconds} ms");
        });
        AntigoonReach Reach()
        {
            var r=Volatile.Read(ref reach);if(r!=null)return r;
            drawing.Wait(TimeSpan.FromSeconds(90));
            return Volatile.Read(ref reach)??throw new NativeServiceException("Antigoon's street map is still being drawn. Try again in a moment.",409);
        }
        // Routes run over the map's own spots; a step between two of them may round a third of a metre off.
        bool OnMap(P p)=>Reach().Reachable(p);
        bool Clear(P p)=>Reach().NearAny(p,.36);
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
        NativeAntigoon? live=null;
        // Lamp light per half-metre spot, refreshed every few seconds (lamps are lit, put out, broken by his stones).
        var glow=new ConcurrentDictionary<(int,int),float>();long glowAt=0;
        float Glow(int i,int k)
        {
            long now=System.Environment.TickCount64;if(now-Interlocked.Read(ref glowAt)>4000){glow.Clear();Interlocked.Exchange(ref glowAt,now);}
            return glow.GetOrAdd((i,k),c=>(float)lamps.At(c.Item1*.5,c.Item2*.5));
        }
        // His route over his map: a lit spot costs up to seven times a dark one, so he goes round through the dark
        // whenever there is a way, and crosses light (eyes shielded) only where there is none.
        P[]? GiantPath(P a,P b)
        {
            var map=Reach();const double cell=.5,pad=16;const int most=200000;
            double x0=Math.Min(a.X,b.X)-pad,z0=Math.Min(a.Z,b.Z)-pad;
            int nx=(int)Math.Ceiling((Math.Max(a.X,b.X)+pad-x0)/cell),nz=(int)Math.Ceiling((Math.Max(a.Z,b.Z)+pad-z0)/cell);
            if(nx<=0||nz<=0||(long)nx*nz>most)return null;
            P At(int i,int k)=>new(x0+(i+.5)*cell,z0+(k+.5)*cell);
            var open=new sbyte[nx*nz];
            bool leaps=live?.LeapsAllowed!=false;
            bool Free(int i,int k){if(i<0||k<0||i>=nx||k>=nz)return false;int n=k*nx+i;if(open[n]==0){var p=At(i,k);open[n]=(sbyte)(map.Reachable(p)?1:leaps&&map.Jumpable(p)?2:-1);}return open[n]>0;}
            // A leap is a last resort too: an obstacle costs as much as four metres of walking round it.
            float Cost(int i,int k){var p=At(i,k);float lit=Glow((int)Math.Round(p.X*2),(int)Math.Round(p.Z*2));return (1+6*Math.Clamp((lit-.2f)/.4f,0,1))*(open[k*nx+i]==2?4:1);}
            int? Near(P p){int ci=(int)((p.X-x0)/cell),ck=(int)((p.Z-z0)/cell);int? best=null;int bd=int.MaxValue;for(int dk=-4;dk<=4;dk++)for(int di=-4;di<=4;di++){if(!Free(ci+di,ck+dk))continue;int d=di*di+dk*dk;if(d<bd){bd=d;best=(ck+dk)*nx+ci+di;}}return best;}
            if(Near(a) is not int start||Near(b) is not int goal)return null;
            var g=new float[nx*nz];Array.Fill(g,float.PositiveInfinity);var from=new int[nx*nz];Array.Fill(from,-1);
            var queue=new PriorityQueue<int,float>();g[start]=0;queue.Enqueue(start,0);int gi=goal%nx,gk=goal/nx;bool found=false;
            while(queue.TryDequeue(out int n,out float f))
            {
                if(n==goal){found=true;break;}
                int i=n%nx,k=n/nx;if(f>g[n]+(float)Math.Sqrt((i-gi)*(i-gi)+(k-gk)*(k-gk))+1e-3f)continue;
                for(int dk=-1;dk<=1;dk++)for(int di=-1;di<=1;di++)
                {
                    if(di==0&&dk==0)continue;int ni=i+di,nk=k+dk;
                    if(!Free(ni,nk)||di!=0&&dk!=0&&(!Free(i+di,k)||!Free(i,k+dk)))continue;
                    int m=nk*nx+ni;float step=(di!=0&&dk!=0?1.4142f:1)*Cost(ni,nk),ng=g[n]+step;
                    if(ng<g[m]){g[m]=ng;from[m]=n;queue.Enqueue(m,ng+(float)Math.Sqrt((ni-gi)*(ni-gi)+(nk-gk)*(nk-gk)));}
                }
            }
            if(!found)return null;
            var cells=new List<int>();for(int n=goal;n>=0;n=from[n]){cells.Add(n);if(n==start)break;}cells.Reverse();
            // Straighten the grid steps where the straight line stays on his map and no brighter than its ends.
            bool Line(int p,int q)
            {
                var u=At(p%nx,p/nx);var v=At(q%nx,q/nx);int count=(int)Math.Ceiling(u.Distance(v)/(cell*.5));
                float limit=Math.Max(Cost(p%nx,p/nx),Cost(q%nx,q/nx))+.2f;
                for(int t=1;t<count;t++){var w=new P(u.X+(v.X-u.X)*t/count,u.Z+(v.Z-u.Z)*t/count);int wi=(int)((w.X-x0)/cell),wk=(int)((w.Z-z0)/cell);if(!Free(wi,wk)||Cost(wi,wk)>limit)return false;}
                return true;
            }
            var route=new List<P>{At(cells[0]%nx,cells[0]/nx)};int at=0;
            while(at<cells.Count-1){int far=cells.Count-1;while(far>at+1&&!Line(cells[at],cells[far]))far--;route.Add(At(cells[far]%nx,cells[far]/nx));at=far;}
            return route.ToArray();
        }
        var encounter=new NativeAntigoon(host) {
            PositionOf=PlayerAt,
            Lighting=lamps,BackAlley=Alley,
            Snap=p=>Ways.NearestOpen(p.X,p.Z,5) is {} q?new P(q.X,q.Y):null,
            HumanClear=p=>map.PathFree(p.X,p.Z),
            HumanPath=(a,b)=>Ways.Path(new Vector2((float)a.X,(float)a.Z),new Vector2((float)b.X,(float)b.Z))?.Select(p=>new P(p.X,p.Y)).ToArray(),
            MayObserve=(player,id)=>(!multiplayer.Enabled||multiplayer.Walker(id)==player)&&actions.Of(id)==null,
            ResidentHome=id=>actions.Resident(id)?["home"] is JsonObject h?new P(NativeGoods.Number(h["sx"]),NativeGoods.Number(h["sz"])):null,
            Clear=Clear, Ground=Floor, Light=Light, Sight=Sight,
            // Anyone further than a kick from his map is safe: a doorway, a narrow lane, a back yard behind a gate.
            Reach=(giant,p)=>Reach() is var m&&m.Near(p,AntigoonBrain.AttackRange-.2,m.Area(giant)),
            StandNear=(home,p,radius)=>Reach() is var m&&m.Within(p,radius,m.Area(home)).OrderBy(q=>q.Distance(p)).Take(1).ToArray() is {Length:1} found?found[0]:null,
            MoreFood=()=>Scheldemist.People.Animals.Scraps.Select((s,i)=>("scraps:"+i,"fish",new P(s.X,s.Y))),
            // His own grid route over his map: human footpaths hug walls, lamp posts and steps where a giant does not fit.
            Jumpable=p=>Reach().Jumpable(p),
            Path=GiantPath,
            Roamable=(home,radius)=>
            {
                // Sample his streets around home, one dark spot per direction and distance band.
                var picks=new Dictionary<(int,int),(P At,double Score)>();var random=new Random();
                foreach(var p in Reach().Within(home,radius,Reach().Area(home)))
                {
                    double d=p.Distance(home);if(d<10||Light(p)>=AntigoonBrain.SafeLight)continue;
                    var bin=((int)Math.Floor((Math.Atan2(p.X-home.X,p.Z-home.Z)+Math.PI)/(Math.PI/6)),(int)(d/12));
                    double score=random.NextDouble();
                    if(!picks.TryGetValue(bin,out var best)||score>best.Score)picks[bin]=(p,score);
                }
                return picks.Values.Select(v=>v.At).ToArray();
            }
        };
        encounter.DevelopmentStage=player=>
        {
            // Always somewhere on his map, out of the player's sight: a dark alley he can walk out of if there is one,
            // otherwise any dark corner of his streets. A different spot each time.
            var random=new Random();int lit=0,seen=0,tight=0,noWatch=0;
            // The nearest part of his map, however far that is: the player may stand somewhere he can never come.
            var spots=Reach().All().Where(p=>p.Distance(player)>=25).OrderBy(p=>p.Distance(player)).Take(4000).OrderBy(_=>random.Next()).Take(1500).ToArray();
            foreach(bool alleysOnly in new[]{true,false})
                foreach(var home in spots)
                {
                    if(alleysOnly&&!Alley(home))continue;
                    if(Light(home)>=.25){lit++;continue;}
                    if(Sight(home,player)){seen++;continue;}
                    if(Reach().Within(home,1.5,Reach().Area(home)).Count()<24){tight++;continue;}
                    var watch=Reach().Within(home,12,Reach().Area(home)).Where(q=>q.Distance(home)>7).OrderBy(_=>random.Next()).Take(40)
                        .FirstOrDefault(q=>Sight(home,q)&&encounter.Path(home,q) is {Count:>0});
                    if(watch.Distance(home)>7)return (home,watch);
                    noWatch++;
                }
            GD.Print($"Antigoon stage: {spots.Length} spots on his map; lit {lit}, in sight {seen}, too tight {tight}, no exit {noWatch}");
            return null;
        };
        encounter.BlockReason=p=>Water.In((float)p.X,(float)p.Z)?"water":Footing(p)==null?"no footing":geometry.Blocker(At(p),Radius,Crown,Step);
        encounter.Fits=Fits;encounter.ReachMap=Reach;
        live=encounter;
        host.AddModule(encounter);
        AntigoonService=encounter;
        var priorReservation=actions.Reserved;actions.Reserved=id=>encounter.Controls(id)||priorReservation?.Invoke(id)==true;
    }
}
