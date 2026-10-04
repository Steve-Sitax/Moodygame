using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.People;

namespace Scheldemist.Movers;

public partial class Omnibus
{
    public sealed class Passenger
    {
        public string Id="",Alight="",State="in";
        public Human Human=null!;
        public Node3D Root=null!;
        public int Seat;
        public Vector2[] Path=Array.Empty<Vector2>();
        public float Walked;
    }
    private readonly Dictionary<Bus,List<Passenger>> passengers=new();
    private readonly Random passengerDice=new(1873); // browser uses Math.random for unnamed people only
    private static readonly string[] PassengerKinds={"gentleman","clerk","old_man","priest","sailor_b","docker_a","porter","docker_b"};
    public event Action<Bus,string,Vector3>? ResidentOff;
    public IReadOnlyList<Passenger> Passengers(Bus bus)=>passengers.GetValueOrDefault(bus)??(IReadOnlyList<Passenger>)Array.Empty<Passenger>();
    private static (Vector3 At,float Yaw) SeatAt(int i)=> (new(i<6?-.6f:.6f,1.26f,-.63f+(i%6)*.64f),i<6?MathF.PI/2:-MathF.PI/2);
    private static Vector2[] SeatPath(int i)
    {
        var seat=SeatAt(i).At;
        return new[] {new Vector2(.15f,-2.35f),new Vector2(0,-1.5f),new Vector2(0,-.75f),new Vector2(0,seat.Z),new Vector2(seat.X*.75f,seat.Z)};
    }
    /// <summary>The town's trip owner boards its Human here; the same id chooses the same free bench as the browser.</summary>
    public bool BoardResident(Bus bus,string id,string kind,string alight)
    {
        if (!passengers.TryGetValue(bus,out var list)) passengers[bus]=list=new();
        if (list.Any(p=>p.Id==id)) return true;
        var human=Humans.Make(kind); if (human==null) return false;
        int seat;
        if (human.CanSit)
        {
            var free=Enumerable.Range(0,12).Where(i=>!PlayerSeat(bus,i) && list.All(p=>p.Seat!=i)).ToArray();
            if (free.Length==0) {human.Dispose(); return false;}
            uint hash=0x811c9dc5; foreach (char c in id) hash=unchecked((hash^c)*0x01000193);
            seat=free[hash%(uint)free.Length];
        }
        else
        {
            int standing=list.Count(p=>p.Seat<0);
            if (standing>=2) {human.Dispose(); return false;}
            seat=-1-standing;
        }
        var root=new Node3D {Name="passenger",Position=new(.15f,0,-2.35f)}; bus.Frame.AddChild(root); root.AddChild(human.Root); human.Start();
        if (kind=="carter") Carters.HideBakedCart(human);
        list.Add(new Passenger {Id=id,Alight=alight,Human=human,Root=root,Seat=seat,Path=seat>=0?SeatPath(seat):new[]{new Vector2(.15f,-2.35f),new Vector2(seat==-1?.3f:-.35f,-1.6f)}});
        return true;
    }
    private void Arrive(Bus bus)
    {
        if (!passengers.TryGetValue(bus,out var list)) passengers[bus]=list=new();
        foreach (var p in list)
            if (p.State=="seated" && (p.Alight==bus.At?.Id || p.Alight=="" && passengerDice.NextDouble()<.4))
            {p.State="out"; p.Path=p.Seat>=0?SeatPath(p.Seat).Reverse().ToArray():new[]{new Vector2(p.Root.Position.X,p.Root.Position.Z),new Vector2(.15f,-2.35f)}; p.Walked=0;}
        int want=1+passengerDice.Next(4),aboard=list.Count(p=>p.State!="out");
        for (int i=0;i<Math.Min(2,want-aboard);i++) BoardResident(bus,"anonymous:"+passengerDice.NextInt64(),PassengerKinds[passengerDice.Next(PassengerKinds.Length)],"");
    }
    private void PeopleStep(Bus bus,float dt)
    {
        if (!passengers.TryGetValue(bus,out var list)) return;
        for (int i=list.Count-1;i>=0;i--)
        {
            var p=list[i];
            if (p.State!="seated")
            {
                p.Walked+=dt*1.1f; float d=p.Walked; Vector2 at=p.Path[^1];
                for (int k=0;k+1<p.Path.Length;k++)
                {
                    var step=p.Path[k+1]-p.Path[k]; float len=step.Length();
                    if (len>0 && d<=len) {at=p.Path[k]+step*(d/len); p.Root.Rotation=new(0,MathF.Atan2(step.X,step.Y),0); d=-1; break;}
                    d-=len;
                }
                p.Root.Position=new(at.X,at.Y < -1.15f ? Math.Abs(at.X)<.8f && at.Y>-1.85f?.74f:0 : .83f,at.Y);
                p.Human.Play("walk",.2f); p.Human.SetPace(1.1f);
                if (d>=0)
                {
                    if (p.State=="out")
                    {
                        var foot=bus.Frame.GlobalTransform*new Vector3(.15f,0,-2.35f);
                        p.Human.Dispose(); p.Root.QueueFree(); list.RemoveAt(i); if(p.Alight!="") ResidentOff?.Invoke(bus,p.Id,foot); continue;
                    }
                    p.State="seated";
                    if (p.Seat>=0) {var s=SeatAt(p.Seat); p.Root.Position=s.At+Vector3.Up*(p.Human.SitDrop(0)+.02f); p.Root.Rotation=new(0,s.Yaw,0); p.Human.Play("sit",.3f);}
                    else {p.Root.Rotation=new(0,MathF.PI/2,0); p.Human.Play("idle",.3f);}
                }
            }
            if(bus.Near) p.Human.Update(dt);
        }
    }
    private void PeopleProbe()
    {
        var bus=buses[0];
        MoversTest.Add(new MoversTest.Probe {Name="omnibus_passengers",Hour=13,Gap=3,MaxWait=15,
            Start=()=> {int s=Enumerable.Range(0,bus.Loop.X.Length).MinBy(i=>new Vector2(bus.Loop.X[i]-10,bus.Loop.Z[i]-8.3f).LengthSquared()); bus.S=s*OmnibusLines.LoopStep; bus.At=null; bus.V=2; FindNext(bus); BoardResident(bus,"test:clerk","clerk","never"); BoardResident(bus,"test:wife","wife_a","never");},
            Ready=()=>Passengers(bus).Any(p=>p.Id=="test:clerk" && p.State=="seated"),
            Where=()=> {var p=Passengers(bus).First(p=>p.Id=="test:clerk");return(p.Root.GlobalPosition,bus.S,$"Human clerk {p.State} in seat {p.Seat}; {Passengers(bus).Count} live passengers");},
            View=()=> {var at=bus.Frame.GlobalTransform*new Vector3(0,1.65f,1); return(at+new Vector3(0,1,-5),at);},
            Check=()=>Passengers(bus).Any(p=>p.Id=="test:clerk" && p.State=="seated" && p.Human.Motion=="sit")?"":"the clerk did not take his seat"
        });
    }
}
