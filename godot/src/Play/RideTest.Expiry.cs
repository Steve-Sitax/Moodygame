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
    private async Task HireExpiryCheck(Api api)
    {
        GameState.I.Apply(await api.NewGame());GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=9,minute=0,money_c=3000,health=10}));
        MoverClock.Hold(13.75,1);await Handcarts.I.Load();await Velocipedes.I.Load();
        var shop=Handcarts.I.View.Shop!;GameState.I.Apply(await api.Buy(shop.Id,"handcart_hire"));await Handcarts.I.Load();var cart=Handcarts.I.Drawings.Values.First(c=>c.Info.Kind=="hire");
        await CartFixture(api,cart.Info,-118,36,0);Jef.I.Place(-118,33.3f,Mathf.Pi);await Handcarts.I.Grip(cart);
        Require(Handcarts.I.Held==cart.Info.Id,"expiry fixture holds hired cart");GameState.I.Apply(await api.DevAdvance(841));await Handcarts.I.Load();
        Require(Handcarts.I.Held==cart.Info.Id&&cart.Info.MinutesLeft==0,"expired cart remains under Jef until he lets go");await Handcarts.I.Release(true);GameState.I.Apply(await api.DevAdvance(60));GameState.I.Apply(await api.Tick());await Handcarts.I.Load();Require(await Until(()=>Handcarts.I.Held==null&&!Jef.I.Laden&&!Handcarts.I.Drawings.ContainsKey(cart.Info.Id),12),"server collects expired cart after release and frees hands");
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=2,hour=9,minute=0,money_c=3000,health=10}));
        var bikeShop=Velocipedes.I.Ownership!.Shop!;GameState.I.Apply(await api.Buy(bikeShop.Id,"velocipede_hire"));await Velocipedes.I.Load();var id=Velocipedes.I.Ownership!.List.First(m=>m.Kind=="hire").Id;var bike=Velocipedes.I.Machines[id];
        await VeloFixture(api,bike,-118,36,0);Jef.I.Place(-118.8f,36,-Mathf.Pi/2);await Velocipedes.I.Mount(bike);Require(Velocipedes.I.Ridden==bike,"expiry fixture rides hired velocipede");
        GameState.I.Apply(await api.DevAdvance(841));await Velocipedes.I.Load();Require(Velocipedes.I.Ridden==bike&&Velocipedes.I.Ownership!.List.Single(v=>v.Id==bike.Info.Id).MinutesLeft==0,"expired velocipede remains under Jef until he gets off");await Velocipedes.I.Leave();GameState.I.Apply(await api.DevAdvance(60));GameState.I.Apply(await api.Tick());await Velocipedes.I.Load();Require(await Until(()=>Velocipedes.I.Ridden==null&&!Jef.I.Riding&&!Velocipedes.I.Ownership!.List.Any(v=>v.Id==bike.Info.Id),12),"server collects expired velocipede after dismount and restores walking");
    }
}
