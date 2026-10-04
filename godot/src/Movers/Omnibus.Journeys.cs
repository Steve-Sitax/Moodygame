using Godot;
namespace Scheldemist.Movers;
public partial class Omnibus
{
    public void JourneyTestStop(Bus bus,string id)
    {foreach(var st in bus.StopAt)if(st.Stop.Id==id){bus.S=st.S;bus.At=st.Stop;bus.V=0;bus.DwellT=100;bus.NextI=bus.StopAt.IndexOf(st);Place(bus,0);Arrive(bus);return;}}
    public static Vector2 WaitingAt(OmnibusLines.Stop stop)
    {
        Post? nearest=null;float distance=float.PositiveInfinity;
        foreach(var p in Posts)if(p.Id==stop.Id){float d=p.At.DistanceSquaredTo(new(stop.X,stop.Z));if(d<distance){distance=d;nearest=p;}}
        if(nearest==null)return new(stop.X,stop.Z);
        return nearest.At+(nearest.At-new Vector2(stop.X,stop.Z)).Normalized()*.8f;
    }
}
