using System;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;

namespace Scheldemist.People;

/// <summary>A local colony uses the actual collector bend, ledge and channel of its drain head.</summary>
internal sealed class DrainRatColony
{
    internal const int Count = 36;
    private sealed class Track
    {
        internal Vector3 Deep, Bend, Mouth, Bank, Nest, Edge, Splash, Swim;
        internal float Progress;
    }
    private readonly Track[] tracks = Array.ConvertAll(new int[Count], _ => new Track());
    private readonly Node3D world;
    private (RuienDrainNetwork.Head Head,Vector3 At)[]? haunts;
    private RuienDrainNetwork.Head? head;
    private Vector3 centre;
    private double check, cooldown;
    private float age, escape;
    private string previous = "";
    internal DrainRatColony(Node3D world) => this.world = world;
    internal Vector3? Centre => head == null ? null : centre;
    internal void Hide() { head = null; }

    private bool Seen(Camera3D camera, Vector3 at)
    {
        if (!camera.IsPositionInFrustum(at)) return false;
        using var ray = PhysicsRayQueryParameters3D.Create(camera.GlobalPosition, at, Solid.Layer);
        return world.GetWorld3D().DirectSpaceState.IntersectRay(ray).Count == 0;
    }

    private void Find(Camera3D camera, Vector3 eye, double now)
    {
        if (RuienDrainNetwork.Active is not {} drains) return;
        RuienDrainNetwork.Head? best = null;
        float cost = float.MaxValue;
        if (haunts == null)
        {
            var sites = new System.Collections.Generic.List<(RuienDrainNetwork.Head,Vector3)>();
            foreach (var h in drains.Heads)
            {
                if (!h.Crossing || h.U<4 || h.U>h.Host.Zone.Length-4) continue;
                sites.Add((h,h.Map(new Vector3(0,h.Template.Walk,-(h.Template.HalfWidth-.4f)))));
            }
            haunts = sites.ToArray();
        }
        foreach (var (h,c) in haunts)
        {
            if (h.Id == previous && now < cooldown) continue;
            var zone = h.Host.Zone;
            float distance = eye.DistanceSquaredTo(c);
            if (distance > 25*25 || distance < 5*5) continue;
            // Broad galleries with foul collector outflows get priority.
            float score = distance / zone.S.Width;
            if (score >= cost || Seen(camera,c+Vector3.Up*.1f)) continue;
            best=h; centre=c; cost=score;
        }
        if(best == null) return;
        head=best; age=0; escape=-1;
        for(int i=0;i<Count;i++)
        {
            var r=tracks[i];
            var t=best.Template;
            float run=(i%12-5.5f)*.49f;
            float across=.28f+(i/12+.2f*(i%2))*(best.Host.Zone.S.Ledge*.22f);
            Vector3 Map(float x,float y,float radial) => best.Map(new Vector3(x,y,-radial));
            float lane=(i%3-1)*.09f;
            r.Deep=best.Map(t.Seam+t.Tangent*.5f+Vector3.Up*.035f);
            r.Bend=Map(.31f+lane,best.Invert+.03f,t.HalfWidth+1.60f);
            r.Mouth=Map(lane,best.Invert+.03f,t.HalfWidth);
            r.Bank=Map(.4f*Mathf.Sign(run),t.Walk,t.HalfWidth-across);
            r.Nest=Map(run,t.Walk,t.HalfWidth-across);
            float edge=best.Host.Zone.S.Edge(best.Side);
            r.Edge=Map(run,t.Walk,edge+.08f);
            r.Splash=Map(run,t.Walk,edge-.28f);
            r.Swim=Map(run+(i%2==0?1:-1)*1.1f,t.Walk,Math.Max(.05f,edge-.95f));
            r.Progress=0;
        }
    }

    internal void Draw(SmallLifeKit.Batch batch, Camera3D camera, Vector3 eye,float dt,double now)
    {
        if(head==null)
        {
            if(now<check) return;
            check=now+.85;
            Find(camera,eye,now);
            if(head==null) return;
        }
        if(eye.DistanceSquaredTo(centre)>32*32){head=null;return;}
        age+=dt;
        if(age>=10.5f && escape<0 && now>=check)
        {
            check=now+.18;
            if(eye.DistanceSquaredTo(centre)<7*7)
                for(int i=0;i<Count;i+=5)
                    if(Seen(camera,tracks[i].Nest+Vector3.Up*.1f)){escape=age;break;}
        }
        float water=Ruien.I!.WaterAt(tracks[0].Splash.X,tracks[0].Splash.Z) ?? head.Host.Zone.S.Water;
        bool drowned=water>centre.Y+.04f;
        if(drowned && escape<0) escape=age;
        int alive=0;
        for(int i=0;i<Count;i++)
        {
            var r=tracks[i];
            float emerge=Mathf.Clamp((age-i*.075f)*.52f,0,4);

            float flee=escape<0?0:Math.Max(0,age-escape-(i%7)*.065f);
            bool swim=i%3!=0 || drowned;
            float phase=swim?flee*1.06f:flee*1.28f;
            if(phase>=4) continue;
            alive++;
            Vector3 a,b; float f; bool idle=false;
            if(phase==0 && emerge<4)
            {
                int segment=(int)emerge; f=emerge-segment;
                (a,b)=segment switch {0=>(r.Deep,r.Bend),1=>(r.Bend,r.Mouth),2=>(r.Mouth,r.Bank),_=>(r.Bank,r.Nest)};
            }
            else if(phase==0)
            {
                a=r.Nest; b=r.Nest+(r.Edge-r.Nest).Normalized()*.06f;
                f=.5f+.5f*Mathf.Sin(age*.85f+i);idle=true;
            }
            else
            {
                int segment=(int)phase;f=phase-segment;
                var surface=r.Splash with {Y=water-.045f};
                var end=r.Swim with {Y=water-.045f};
                (a,b)=swim?segment switch {0=>(r.Nest,r.Edge),1=>(r.Edge,surface),2=>(surface,end),_=>(end,end+(end-surface)*.45f+Vector3.Down*.65f)}
                    :segment switch {0=>(r.Nest,r.Bank),1=>(r.Bank,r.Mouth),2=>(r.Mouth,r.Bend),_=>(r.Bend,r.Deep)};
            }
            var pos=a.Lerp(b,f);
            if(drowned && phase<3) pos.Y=Math.Max(pos.Y,water-.045f);
            var dir=b-a;
            float yaw=Mathf.Atan2(dir.X,dir.Z);
            float pitch=swim && phase>=3?.43f:0;
            float scale=.87f+.028f*(i%9);
            r.Progress+=dt*(idle?.7f:3.5f);
            batch.Put("rat",idle?"idle":"scurry",r.Progress+i*.128f,new Transform3D(Basis.FromEuler(new Vector3(pitch,yaw,0)).Scaled(Vector3.One*scale),pos));
        }
        if(alive==0){previous=head.Id;cooldown=now+95;head=null;}
    }
}
