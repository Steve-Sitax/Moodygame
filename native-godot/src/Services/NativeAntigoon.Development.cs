using System;
using System.Text.Json.Nodes;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.Services;

public sealed partial class NativeAntigoon
{
    public Func<P,(P Home,P Watch)?> DevelopmentStage=_=>null;
    private void RegisterDevelopment(NativeServiceHost service)
    {
        service.Register("POST","/api/dev/antigoon",r=>
        {
            if(r.PlayerId!=1)throw new NativeServiceException("Only the host starts development events.",403);
            if(PositionOf(r.PlayerId) is not {} player)throw new NativeServiceException("Enter the town before starting Antigoon.",409);
            var clock=host.Clock.View();int day=(int)NativeGoods.Number(clock["day"]),hour=(int)NativeGoods.Number(clock["hour"]),minute=(int)NativeGoods.Number(clock["minute"]);
            host.Clock.SetTime(day,22,0);
            var stage=DevelopmentStage(player);
            if(stage is not {} at||!Clear(at.Home)||!BackAlley(at.Home)||Light(at.Home)>=.25||!Clear(at.Watch)||Path(at.Home,at.Watch) is not {Count:>0})
            {
                host.Clock.SetTime(day,hour,minute);
                throw new NativeServiceException("No dark alley with a clear street exit is available for Antigoon.",409);
            }
            observed.Clear();developmentEnabled=true;Create(at.Home);brain!.Patrol.Insert(0,at.Watch);brain.Reveal();last=host.Context.Now;Save();
            host.Clock.ResetLimits();host.PublishState();
            var view=View(r.PlayerId);view["watch_x"]=at.Watch.X;view["watch_y"]=Ground(at.Watch);view["watch_z"]=at.Watch.Z;
            view["world"]=host.Payload(r.PlayerId);return view;
        });
    }
}
