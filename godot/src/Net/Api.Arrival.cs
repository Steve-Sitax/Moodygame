using System.Threading.Tasks;
namespace Scheldemist.Net;
public sealed record ArrivalReply {public string Stage {get;init;}="ashore";public bool Creator {get;init;}}
public partial class Api
{
    public Task<ArrivalReply> Arrival()=>Get<ArrivalReply>("api/arrival");
    public Task<ArrivalReply> ArrivalAshore()=>Post<ArrivalReply>("api/arrival/ashore");
    public Task<ArrivalReply> ArrivalMade()=>Post<ArrivalReply>("api/arrival/made");
}
