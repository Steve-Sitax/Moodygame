using System;
using System.Collections.Generic;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
namespace Scheldemist.Play;
public partial class JobTest
{
    private IEnumerable<object?> HomeRemarkStep()
    {
        Step("home-remark","entering one's rented room brings the engine-selected neighbour, once per day");
        var api=ServerLink.I!.Api!;
        var set=api.DevSet(new Dictionary<string,double>{["money_c"]=1000,["hour"]=13,["minute"]=45});
        yield return When(()=>set.IsCompleted,10,"home test clock");
        if(!set.IsCompletedSuccessfully){Fail("home test clock failed");yield break;}GameState.I.Apply(set.Result);
        var take=api.HomeTake(new("alley","day"));yield return When(()=>take.IsCompleted,10,"rent from the engine");
        if(!take.IsCompletedSuccessfully){Fail("home rent failed");yield break;}GameState.I.Apply(take.Result);
        var load=HomeLife.I.Load();yield return When(()=>load.IsCompleted&&HomeLife.I.Info?.Lease?.Home=="alley",15,"leased room loads");
        if(!HomeLife.I.Frames.TryGetValue("alley",out var f)){Fail("no alley home frame");yield break;}
        var local=f.Local(f.Bed.X,f.Bed.Z);var at=f.World(local.X+1.3f,local.Y);
        Stand(at.X,at.Z,f.Bed.X,f.Bed.Z,0,f.Y);
        yield return When(()=>f.Inside,5,"inside the actual home floor");
        int money=GameState.I.Money;double food=GameState.I.Food,warm=GameState.I.Warmth;
        yield return When(()=>HomeRemarks.I?.Last!=null,25,"automatic engine home remark");
        var remark=HomeRemarks.I?.Last;
        Check(remark!=null,"no automatic home remark");
        Check(HomeVisitors.I?.Drawn>0,"the selected visitor did not draw");
        Check(GameState.I.Money==money&&GameState.I.Food==food&&GameState.I.Warmth==warm,"a remark changed gameplay numbers");
        if(remark!=null){Note("visitor",remark.Who);Note("line",remark.Line);Note("source",remark.Source);if(HomeVisitors.I?.PositionOf(remark.Who.Id) is {} pos){LookAt(pos.X,pos.Z,0);yield return .5;Shot("home-neighbour");}}
        int requests=HomeRemarks.I?.Requests??0;
        Stand(-118,36,-118,30);yield return When(()=>!f.Inside&&HomeVisitors.I?.Drawn==0,5,"the home visitor leaves with Jef");
        Check(HomeVisitors.I?.Drawn==0,"home visitor remains after Jef leaves");
        Stand(at.X,at.Z,f.Bed.X,f.Bed.Z,0,f.Y);yield return 1.0;
        Check(HomeRemarks.I?.Requests==requests,"home remark was requested twice on the same day");
        Stand(-118,36,-118,30);
    }
}
