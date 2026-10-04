using System;
namespace Scheldemist.Play;
public partial class FerryArrival
{
    internal int Nags=>nag;
    internal bool Guided=>guide;
    internal void RiderTestTime(float seconds)
    {if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("ferry fixture requires ridetest");Time=Math.Max(Time,seconds);_Process(0);}
}
