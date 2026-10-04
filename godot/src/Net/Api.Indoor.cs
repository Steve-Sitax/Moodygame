using System.Threading.Tasks;
using System.Collections.Generic;
using System.Text.Json;
namespace Scheldemist.Net;
public sealed record HushReply : JobsPayload
{
    public bool Counted { get; init; }
    public int Strike { get; init; }
    public string Line { get; init; } = "";
    public string Speaker { get; init; } = "";
    public bool Leave { get; init; }
    public string Text { get; init; } = "";
}
public sealed record IndoorLine(string Who,string Name,string Text);
public sealed record IndoorTalk(List<IndoorLine> Lines,string Source,List<string> Facts);
public sealed record IndoorCartReply : JobsPayload { public JsonElement Carts { get; init; } }
public sealed partial class Api
{
    public Task<IndoorCartReply> IndoorCartLoad(string cart,int piece,string kind,float x,float z) => Post<IndoorCartReply>($"api/cart/{Esc(cart.StartsWith("cart:") ? cart[5..] : cart)}/load",new { x,z,item=new { piece,kind } });
    public Task<IndoorCartReply> IndoorCartUnload(string cart,float x,float z,int? index=null) => Post<IndoorCartReply>($"api/cart/{Esc(cart.StartsWith("cart:") ? cart[5..] : cart)}/unload",new { x,z,index });
    public Task<IndoorTalk> IndoorTalk(string place,string a,string b,bool gossip) => Post<IndoorTalk>(gossip?"api/interior/gossip":"api/interior/chat",new { place,a,b },25000);
    public Task<HushReply> CathedralRan(int witnesses) => Post<HushReply>("api/landmark/ran", new { witnesses });
}
