using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;
public partial class Rowing
{
    private void ClimbInto(Drawn d,bool jump,int e)
    {
        var j=Jef.I;var seat=SeatOf(d);bool wet=j.Swimming;
        Exit? ladder=null;foreach(var boat in Data.Boats)if(boat.Id==d.Key&&boat.Board=="ladder"&&new Vector2(d.X-boat.Home.X,d.Z-boat.Home.Z).Length()<3&&boat.Landing.Length>=2)ladder=QuayExits.Near(boat.Landing[0],boat.Landing[1],3);
        void Finish(){if(e!=epoch||!IsInstanceValid(d.Root))return;Sit(d);Busy=false;if(jump)Scheldemist.Audio.Soundscape.I?.Play("thud_wood",Rower.Seat);}
        void OntoThwart()
        {
            if(e!=epoch||!IsInstanceValid(d.Root))return;
            var inverse=d.Frame().AffineInverse();var local=inverse*SeatOf(d);
            j.ClimbTo(new[]{(local,.45f)},Finish,d.Frame);
        }
        var keys=new List<(Vector3,float)>();
        if(ladder is {Ladder:true} l&&!wet&&!jump)
        {
            float foot=seat.Y+.35f;keys.Add((new(l.Tx,l.Ty,l.Tz),.35f));keys.Add((new(l.Gx,l.Ty-.3f,l.Gz),.5f));keys.Add((new(l.Gx,foot,l.Gz),Math.Max(.4f,(l.Ty-.3f-foot)/1.6f)));
            j.ClimbTo(keys,OntoThwart);return;
        }
        var head=jump?new Vector3(j.X+(seat.X-j.X)*.35f,j.Y+.35f,j.Z+(seat.Z-j.Z)*.35f):wet?seat+Vector3.Up*.35f:new Vector3((j.X+seat.X)*.5f,j.Y-.2f,(j.Z+seat.Z)*.5f);
        var inv=d.Frame().AffineInverse();keys.Add((inv*head,jump?.22f:wet?.6f:.45f));keys.Add((inv*seat,jump?Math.Max(.3f,MathF.Sqrt(2*Math.Max(.3f,j.Y+.35f-seat.Y)/9.81f)):.45f));j.ClimbTo(keys,Finish,d.Frame);
    }
}
