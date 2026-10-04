using System;
using Godot;
namespace Scheldemist.Play;

/// <summary>Ride test only: sit Jef in each small-boat hull kind beside his real hired boat, then put him back.</summary>
public partial class Rowing
{
    public static readonly string[] HullKinds={"rowboat","punt","workboat","dinghy","shipsboat","gig","bumboat","eelboat","oldboat"};
    public Drawn TestHull(string kind,float x,float z,float yaw)
    {if(Main.I.Arg("ridetest")=="")throw new InvalidOperationException("hull fixture outside ridetest");if(Drawings.ContainsKey("test:"+kind))TestForget(Drawings["test:"+kind]);var d=Make("test:"+kind,kind,x,z,yaw);d.Root.Visible=true;return d;}
    public void TestSit(Drawn d)=>Sit(d);
    public void TestForget(Drawn d,Drawn? back=null){if(Boat==d)Clear();Drawings.Remove(d.Key);d.Root.QueueFree();if(back!=null)Sit(back);}
}
