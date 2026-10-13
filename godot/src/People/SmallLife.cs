using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Net.Mp;
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>Town sparrow flocks, roof jackdaws, rampart crows and eight wall-foot rats. Fixed native haunts,
/// seeded from IDs while loading; bounded straight paths, no route searches or resource creation in an update.
/// These cosmetic populations are local deterministic detail; the multiplayer motion protocol is unchanged.</summary>
[GamePart(208)]
public partial class SmallLife : Node
{
    public static SmallLife? I { get; private set; }
    internal static double AllMs => (I?.LogicMs??0)+(ParkWildlife.I?.LogicMs??0)+(NativeCourtyards.I?.LogicMs??0)+(Gulls.I?.SmallPigeonMs??0);
    internal sealed class Beast
    {
        internal string Id = "", Kind = "", Motion = "idle";
        internal Vector3 Home, At, Ground, FlightFrom, FlightTo;
        internal Vector2 Direction;
        internal float Size, Seed, Yaw, Flight;
        internal double Distance;
        internal bool Rat, Perched;
    }
    internal readonly List<Beast> List = new();
    internal SmallLifeKit.Batch Batch = null!;
    private Townspeople town = null!;
    private bool built;
    public double LogicMs { get; private set; }
    public long AllocatedBytes { get; private set; }
    public int Shown => Batch?.Count ?? 0;
    public override void _Ready()
    {
        I = this; town = Main.I.GetNode<Townspeople>("Townspeople");
        Batch = new(Main.I.View, "small_town_wildlife", 64, "sparrow", "jackdaw", "crow", "rat");
        town.PopulationChanged += Reset;
    }
    private void Reset() { List.Clear(); built = false; }
    private void Add(string kind, int i, Vector3 at, Vector2 direction, bool perched, Vector3? ground = null)
    {
        string id = "smalllife:" + kind + ":" + i;
        float seed = (float)NativeCourtyardRules.H01(id);
        var b = new Beast { Id = id, Kind = kind, Home = at, At = at, Seed = seed, Direction = direction,
            Perched = perched, Rat = kind == "rat", Size = .93f + .14f * seed, Yaw = MathF.Atan2(direction.X, direction.Y) };
        b.Ground = ground ?? new(at.X, (float)town.Walk!.BaseAt(at.X, at.Z), at.Z);
        List.Add(b);
    }
    private void Build()
    {
        if (town.Data == null || town.Walk == null) return;
        // Choose actual resident fronts; take the nearby outer wall feet for rats. A candidate is tested
        // for the whole two-metre run at startup, not found when the player first approaches it.
        var homes = town.Data.Residents.Where(r => r.HomeHouse >= 0).DistinctBy(r => r.HomeHouse)
            .OrderBy(r => NativeCourtyardRules.Dice("smalllife-home", r.HomeHouse)).ToArray();
        int rats = 0, jackdaws = 0, crows = 0, sparrows = 0;
        foreach (var r in homes)
        {
            var outward = new Vector2((float)(r.HomeSx-r.HomeX), (float)(r.HomeSz-r.HomeZ)).Normalized();
            if (outward.LengthSquared() < .5f) continue;
            var along = new Vector2(outward.Y, -outward.X);
            float x = (float)r.HomeSx, z = (float)r.HomeSz;
            var at = new Vector3(x, (float)town.Walk.BaseAt(x,z), z);
            bool Free(float xx,float zz) => town.Walk.Free(xx,zz) && !Water.In(xx,zz);
            if (!Free(x,z)) continue;
            if (sparrows < 18 && NativeCourtyardRules.Dice("sparrow-front",r.HomeHouse) < .12)
                for (int k=0;k<6 && sparrows<18;k++)
                { var p=at+new Vector3(along.X*(k-2.5f)*.18f,0,along.Y*(k-2.5f)*.18f); if(Free(p.X,p.Z))Add("sparrow",sparrows++,p,along,false); }
            if (jackdaws < 26 || crows < 12)
            {
                // A real wall/roof hit above the doorway, never an invented perch floating over the road.
                var wall = new Vector3((float)r.HomeX,0,(float)r.HomeZ);
                var space=Main.I.Cam.GetWorld3D().DirectSpaceState;
                using var ray=PhysicsRayQueryParameters3D.Create(wall+Vector3.Up*28,wall+Vector3.Up*2);
                var hit=space.IntersectRay(ray);
                if(hit.Count>0 && hit["position"].AsVector3() is var roof && roof.Y>3 && roof.Y<26)
                { if(jackdaws<26)Add("jackdaw",jackdaws++,roof,along,true,at);else if(crows<12)Add("crow",crows++,roof,along,true,at); }
            }
            if (rats>=8) continue;
            for(float back=.3f;back<3;back+=.25f)
            {
                float rx=x-outward.X*back,rz=z-outward.Y*back;
                if(!Free(rx,rz)||Free(rx-outward.X*.4f,rz-outward.Y*.4f))continue;
                bool run=true;
                for(float d=-1;d<=1;d+=.25f)if(!Free(rx+along.X*d,rz+along.Y*d)){run=false;break;}
                if(!run)continue;
                Add("rat",rats++,new(rx,(float)town.Walk.BaseAt(rx,rz),rz),along,false);break;
            }
            if(rats==8 && jackdaws==26 && crows==12 && sparrows==18)break;
        }
        built=true;
        GD.Print($"smalllife haunts: {rats} rats, {sparrows} sparrows, {jackdaws} jackdaws, {crows} crows");
    }
    public override void _Process(double delta)
    {
        if(town.Paused || town.Data==null || town.Walk==null)return;
        if(!built)Build();
        ulong start=Time.GetTicksUsec();long bytes=GC.GetAllocatedBytesForCurrentThread();
        float dt=(float)Math.Min(delta,.1);double time=(Together.I?.ServerNow??Time.GetTicksMsec())/1000.0;
        var eye=Main.I.Cam.GlobalPosition;Batch.Begin();
        foreach(var b in List)
        {
            var before=b.At;
            double cycle=time+b.Seed*50;
            double distance=new Vector2(b.At.X-eye.X,b.At.Z-eye.Z).Length();
            bool night=town.Hour<6.5||town.Hour>18.5, shelter=town.Raining()||town.StormLevel>.35;
            if(b.Rat)
            {
                // A 2 m wall run with brief pauses at each end; danger accelerates retreat.
                double t=cycle%(night?5:9),travel=night?1.7:2.7;
                float s=(float)Math.Clamp(t/travel,0,1),f=t<travel?1-2*s:t<travel+1?-1:t<2*travel+1?-1+2*(float)((t-travel-1)/travel):1;
                b.At=b.Home+new Vector3(b.Direction.X*f,0,b.Direction.Y*f);
                b.Motion=b.At.DistanceTo(before)>.0001f?"scurry":"idle";
            }
            else
            {
                bool alarm=distance<2.8 && eye.Y<b.At.Y+2;
                var destination=b.Perched&&!night&&!shelter&&cycle%40<20?b.Ground:b.Home;
                if(alarm)destination=b.Perched?b.Home:b.Home+new Vector3(b.Direction.X*3,0,b.Direction.Y*3);
                if(!b.Perched&&!town.Walk.Free(destination.X,destination.Z))destination=b.Home;
                if(b.Flight<=0 && b.At.DistanceTo(destination)>.9f) {
                    b.Flight=.0001f;b.FlightFrom=b.At;b.FlightTo=destination;
                }
                if(b.Flight>0)
                {
                    b.Flight+=dt;float duration=Math.Max(1.5f,b.FlightFrom.DistanceTo(b.FlightTo)/3.5f);
                    float f=Math.Min(1,b.Flight/duration),u=1-f;
                    // Rise outside the facade before crossing to a roof; both controls clear its height.
                    float crest=Math.Max(b.FlightFrom.Y,b.FlightTo.Y)+2.5f;
                    var from=new Vector3(b.FlightFrom.X,crest,b.FlightFrom.Z);
                    var to=new Vector3(b.FlightTo.X,crest,b.FlightTo.Z);
                    b.At=b.FlightFrom*(u*u*u)+from*(3*u*u*f)+to*(3*u*f*f)+b.FlightTo*(f*f*f);
                    b.Motion=f<.16f?"takeoff":"fly";
                    if(f>=1){b.At=b.FlightTo;b.Flight=0;b.Motion="idle";}
                }
                else if(!night&&!shelter && cycle%18>8)
                {
                    float f=(float)Math.Sin((cycle-8)*.6)*.7f;
                    var goal=destination+new Vector3(b.Direction.X*f,0,b.Direction.Y*f);
                    if((b.Perched&&destination==b.Home) || !town.Walk.Free(goal.X,goal.Z))b.Motion="idle";
                    else {b.At=goal;b.Motion="walk";}
                }
                else { b.Motion=!night&&!shelter&&cycle%7<3?"peck":"idle"; }

            }
            var moved=b.At-before;
            if(moved.LengthSquared()>.0000001f){b.Distance+=new Vector2(moved.X,moved.Z).Length();b.Yaw=MathF.Atan2(moved.X,moved.Z);}
            if(distance>90)continue;
            var clip=SmallLifeKit.Kinds[b.Kind].Clips[b.Motion];
            double phase=clip.Stride>0?b.Distance/(clip.Stride*b.Size):time/clip.Seconds+b.Seed;
            var tr=new Transform3D(Basis.FromEuler(new Vector3(0,b.Yaw,0)).Scaled(Vector3.One*b.Size),b.At);
            Batch.Put(b.Kind,b.Motion,phase,tr);
        }
        Batch.End();AllocatedBytes=GC.GetAllocatedBytesForCurrentThread()-bytes;LogicMs=(Time.GetTicksUsec()-start)/1000.0;
    }
    public override void _ExitTree(){town.PopulationChanged-=Reset;Batch.Root.QueueFree();if(I==this)I=null;}
}
