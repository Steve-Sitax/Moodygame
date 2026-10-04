using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;
using Scheldemist.Town;

namespace Scheldemist.Movers;

public static class StreetPeople
{
    private static Townspeople? town;
    public static IEnumerable<Puppet> Walking()
    {
        town??=Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        return town?.Crowd?.Walking??Array.Empty<Puppet>();
    }
}

public partial class Omnibus
{
    private sealed record Post(string Id,Vector2 At,Vector3? Bench);
    private static readonly Post[] Posts={
        new("werf",new(-270,10.4f),new(-271.9f,10.85f,MathF.PI)),new("steenplein",new(-180,10.4f),new(-181.9f,10.85f,MathF.PI)),
        new("vismarkt",new(-112,10.4f),new(-110.1f,10.85f,MathF.PI)),new("rijnkaai",new(30,10.4f),new(28.1f,10.85f,MathF.PI)),
        new("bassin",new(78.3f,31),new(78.5f,29.1f,-MathF.PI/2)),new("rijnkaai_back",new(0,39.3f),new(1.9f,39.75f,MathF.PI)),
        new("vismarkt",new(-98.3f,31),new(-98.75f,29.1f,MathF.PI/2)),new("vleeshuis",new(-118,111.6f),new(-119.9f,111.15f,0)),
        new("grote_markt",new(-252,67.6f),new(-249.69f,67.41f,-1.123f)),new("sint_jorispoort",new(-335.9f,152.3f),new(-334,152.75f,MathF.PI)),
        new("stadspark",new(-307.4f,228),new(-307.85f,229.9f,MathF.PI/2)),new("cathedral",new(-248,132.3f),new(-249.9f,132.75f,MathF.PI)),
        new("meir",new(-141.6f,198),new(-141.15f,196.1f,-MathF.PI/2)),new("brouwersvliet",new(-87,176),new(-87.24f,177.52f,.559f)),
        new("sint_jacob",new(-147.3f,293.1f),new(-147.5f,291.2f,MathF.PI/2)),new("kipdorppoort",new(-147.3f,326.1f),new(-147.75f,324.2f,MathF.PI/2)),
        new("ramparts",new(-90.2f,349.7f),new(-92.12f,350.05f,3.098f)),new("keizerspoort",new(64.3f,329.9f),new(64.84f,331.78f,-1.527f)),
        new("sint_paulus",new(49.9f,261.9f),null),new("keizerstraat",new(-42.1f,178.4f),null),new("conscienceplein",new(-123.2f,158.6f),new(-121.26f,158.82f,-3.012f))
    };
    private sealed class Waiter
    {
        public Post Post=null!;
        public Human Human=null!;
        public Node3D Root=null!;
        public Bus? Bus;
        public float T;
        public int Id;
    }
    private readonly List<Waiter> waiters=new();
    private static readonly string[] WaitKinds={"clerk","old_man","gentleman","wife_a","wife_b","old_woman","maid","shopwife","docker_b","priest","tourist","girl_b"};
    private float waitersT;
    private int nextWaiter;
    private Node3D waiterGroup=null!;
    private void WaitersReady(Node3D group)
    {
        foreach(var n in group.GetChildren().OfType<Node3D>())
            if(n.GetChildren().Count==1 && n.GetChild(0) is Node3D child && Humans.IsKind(child.Name)) n.Visible=false;
        waiterGroup=new Node3D {Name="live_waiters"}; group.AddChild(waiterGroup);
        if(MoversTest.On)
        {
            Waiter? person=null; var bus=buses[0];
            MoversTest.Add(new MoversTest.Probe {Name="omnibus_waiter",Hour=13,Gap=3,MaxWait=5,
                Start=()=> {var post=Posts.First(p=>p.Id=="rijnkaai");AddWaiter(post,1);person=waiters[^1];var st=bus.StopAt.First(s=>s.Stop.Id=="rijnkaai");bus.S=st.S;bus.At=st.Stop;bus.V=0;bus.DwellT=7;Place(bus,0);CallWaiters(bus);},
                Ready=()=>person?.Bus!=null,
                Where=()=> {var w=person!;var p=Passengers(bus).FirstOrDefault(p=>p.Id=="waiter:"+w.Id);return(p?.Root.GlobalPosition??w.Root.GlobalPosition,w.T,p!=null?"the waiter is aboard":"the waiter walks to the step");},
                View=()=> {var at=bus.Frame.GlobalTransform*new Vector3(0,1,-1.5f);return(at+new Vector3(-4,2,5),at);}});
        }
    }
    private static OmnibusLines.Stop Bay(Post post)=>OmnibusLines.Stops.Where(s=>s.Id==post.Id).MinBy(s=>new Vector2(s.X-post.At.X,s.Z-post.At.Y).LengthSquared())!;
    private int WantAt(Post post)
    {
        double hour=MoverClock.HourF,now=NowMin;
        if(hour<6.5 || hour>=21.5 || !OmnibusLines.Lines.Where(l=>OmnibusLines.Stops.Any(s=>s.Line==l.Id && s.Id==post.Id)).Any(l=>OmnibusLines.Due(l,post.Id,now)-now<150)) return 0;
        int h=unchecked((int)Math.Floor(hour)*73856093 ^ MoverClock.Day*19349663);
        foreach(char c in post.Id) h=unchecked(h*31+c);
        return (int)(Math.Abs((long)h)%4)-(hour<8 || hour>19?1:0);
    }
    private void AddWaiter(Post post,int slot)
    {
        var h=Humans.Make(WaitKinds[passengerDice.Next(WaitKinds.Length)]); if(h==null) return;
        var bay=Bay(post); var lane=(new Vector2(bay.X,bay.Z)-post.At).Normalized();
        var root=new Node3D(); waiterGroup.AddChild(root); root.AddChild(h.Root); h.Start();
        if(slot==0 && post.Bench is {} b && h.CanSit)
        {root.Position=new(b.X-MathF.Sin(b.Z)*.1f+MathF.Cos(b.Z)*.35f,.46f+h.SitDrop(0),b.Y-MathF.Cos(b.Z)*.1f-MathF.Sin(b.Z)*.35f); root.Rotation=new(0,b.Z,0); h.Play("sit",0);}
        else
        {if(slot==0 && post.Bench!=null) slot++; float along=(slot%2!=0?1:-1)*(.7f+.5f*(slot/2)); var at=post.At-lane*.4f+new Vector2(lane.Y,-lane.X)*along;root.Position=new(at.X,0,at.Y);root.Rotation=new(0,MathF.Atan2(lane.X,lane.Y),0);h.Play("idle",0);}
        waiters.Add(new Waiter {Post=post,Human=h,Root=root,Id=nextWaiter++});
    }
    private void Drop(Waiter w) {w.Human.Dispose();w.Root.QueueFree();waiters.Remove(w);}
    private void CallWaiters(Bus bus)
    {
        if(bus.At==null) return;
        var post=Posts.Where(p=>p.Id==bus.At.Id).MinBy(p=>p.At.DistanceSquaredTo(new Vector2(bus.At.X,bus.At.Z)));
        int room=12-Passengers(bus).Count(p=>p.Seat>=0),n=0;
        foreach(var w in waiters)
            if(w.Post==post && w.Bus==null && n<room)
            {if(OmnibusLines.Lines.Count(l=>OmnibusLines.Stops.Any(s=>s.Id==post!.Id && s.Line==l.Id))>1 && passengerDice.NextDouble()<.4)continue;w.Bus=bus;w.T=0;w.Root.Position=new(w.Root.Position.X,0,w.Root.Position.Z);n++;}
    }
    private void WaitersStep(float dt)
    {
        var eye=Main.I.Cam.GlobalPosition;
        if((waitersT-=dt)<=0)
        {
            waitersT=2;
            foreach(var p in Posts)
            {
                float d=p.At.DistanceTo(new(eye.X,eye.Z));
                if(d>60) {for(int i=waiters.Count-1;i>=0;i--) if(waiters[i].Post==p)Drop(waiters[i]);continue;}
                int n=waiters.Count(w=>w.Post==p && w.Bus==null);
                if(n<Math.Max(0,WantAt(p)) && d>18 && waiters.Count<8) AddWaiter(p,n);
            }
        }
        for(int i=waiters.Count-1;i>=0;i--)
        {
            var w=waiters[i];
            if(w.Bus is {} bus)
            {
                var foot=bus.Frame.GlobalTransform*new Vector3(.15f,0,-2.35f); var step=new Vector2(foot.X-w.Root.Position.X,foot.Z-w.Root.Position.Z); float length=step.Length();w.T+=dt;
                if(length<.35f || w.T>20 || bus.At==null)
                {if(bus.At!=null) BoardResident(bus,"waiter:"+w.Id,w.Human.Kind,"");Drop(w);continue;}
                step*=Math.Min(length,1.2f*dt)/length;w.Root.Position+=new Vector3(step.X,0,step.Y);w.Root.Rotation=new(0,MathF.Atan2(step.X,step.Y),0);w.Human.Play("walk",.2f);w.Human.SetPace(1.1f);
            }
            if(w.Root.Position.DistanceTo(eye)<70)w.Human.Update(dt);
        }
    }
}
