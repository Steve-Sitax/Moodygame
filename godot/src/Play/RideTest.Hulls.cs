using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
namespace Scheldemist.Play;
public partial class RideTest
{
    private async Task HullsCheck(Api api)
    {
        MoverClock.Hold(13.75,1);GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=45,weather="clear",money_c=2000,health=10}));
        var row=Rowing.I;await row.Load();Require(await Until(()=>row.Data.Landings.Count>0,10),"rowing landings ready");var landing=row.Data.Landings.First(l=>l.Id=="vismarkt");
        float ly=Jef.I.GroundAt(landing.Landing[0],landing.Landing[1],0);Jef.I.Place(landing.Landing[0],landing.Landing[1],MathF.Atan2(landing.Landing[0]-landing.X,landing.Landing[1]-landing.Z),-.45f,ly);await Frames(15);
        Require(Interact.I.Press(Key.E),"E hires rowing boat");Require(await Until(()=>row.Boat!=null&&!row.Busy,10),"server confirms hire");var hired=row.Boat!;
        var rows=new List<object>();
        foreach(string kind in Rowing.HullKinds)
        {
            var hull=RowPhysics.Hull.Of(kind);Vector2? spot=null;float yaw=row.Rower.Heading;
            for(int ring=6;ring<=30&&spot==null;ring+=3)for(int k=0;k<16&&spot==null;k++){float a=k*MathF.PI/8,x=row.Rower.X+MathF.Cos(a)*ring,z=row.Rower.Z+MathF.Sin(a)*ring;
                var probe=new RowPhysics();probe.Start(x,z,yaw,hull);bool clear=!probe.Blocked(row,x,z,yaw);float ax=x+MathF.Sin(yaw)*4,az=z+MathF.Cos(yaw)*4;if(clear&&!probe.Blocked(row,ax,az,yaw))spot=new(x,z);}
            Require(spot!=null,$"{kind}: open water beside the hired boat");if(spot==null)continue;
            var d=row.TestHull(kind,spot.Value.X,spot.Value.Y,yaw);row.TestSit(d);await Frames(5);
            float seatErr=new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z).DistanceTo(row.Rower.Seat);var from=new Vector2(row.Rower.X,row.Rower.Z);
            Jef.I.SetKey(Key.W,true);bool moved=await Until(()=>new Vector2(row.Rower.X,row.Rower.Z).DistanceTo(from)>.8f,8);Jef.I.ClearKeys();
            if(kind=="gig"||kind=="eelboat")await Shot("hull-"+kind);
            bool finite=float.IsFinite(row.Rower.X)&&float.IsFinite(row.Rower.Y)&&float.IsFinite(row.Rower.Heading);
            Require(moved&&finite&&seatErr<.6f&&d.Oars.Visible,$"{kind}: Jef sits on its thwart and rows it");
            rows.Add(new{kind,seatErr=Math.Round(seatErr,3),moved=Math.Round(new Vector2(row.Rower.X,row.Rower.Z).DistanceTo(from),2)});
            row.TestForget(d,hired);await Frames(5);
        }
        Require(row.Boat==hired,"Jef is back in his hired boat");replies.Add(new{hulls=rows});
    }
}
