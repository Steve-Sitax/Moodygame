using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
namespace Scheldemist.Play;
public partial class ShipWalk
{
    private async Task RestoreDeck()
    {if(ServerLink.I?.Api is not {} api)return;int e=epoch;try{var saved=await RideSaves.ReadRide(api);if(e==epoch&&!Player.Jef.I.Riding)RestoreDeck(saved);}catch(ApiException){}}
    private void RestoreDeck(RideSaved? saved)
    {
        if(saved is not {Kind:"ship"})return;int separator=saved.Id.IndexOf(':');if(separator<1||!int.TryParse(saved.Id[..separator],out int index)||index<0||index>=Decks.Count)return;
        var d=Decks[index];if(d.Kind!=saved.Id[(separator+1)..]||!d.Visible()||!d.Mesh.Stand(saved.X,saved.Z,.12f))return;Attach(d,new Vector2(saved.X,saved.Z));
    }
}
