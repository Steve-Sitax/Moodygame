using System;
using System.Linq;
namespace Scheldemist.Play;
public partial class FerryArrival
{
    internal int Nags=>nag;
    internal bool Guided=>guide;
    internal object RiderTestPassengers()
    {
        if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("ferry fixture requires ridetest");
        return people.Select(p=>new{x=p.P.X,z=p.P.Y,p.Step,p.Wait,p.Push,p.Off,visible=p.Human?.Root.Visible}).ToArray();
    }
    internal void RiderTestTime(float seconds)
    {if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("ferry fixture requires ridetest");Time=Math.Max(Time,seconds);_Process(0);}
}
