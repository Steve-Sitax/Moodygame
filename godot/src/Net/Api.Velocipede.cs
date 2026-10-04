using System.Collections.Generic;
using System.Threading.Tasks;
using Scheldemist.Play;

namespace Scheldemist.Net;

public sealed record VeloInfo
{
    public string Id {get;init;}="";
    public string Owner {get;init;}="";
    public string OwnerName {get;init;}="";
    public float X {get;init;} public float Z {get;init;} public float Yaw {get;init;}
    public bool Ridden {get;init;} public bool Mine {get;init;} public bool Own {get;init;} public bool Down {get;init;}
}
public sealed record VeloWorld {public List<VeloInfo> Velos {get;init;}=new();}
public sealed record VeloHire {public string Id {get;init;}="";public string Kind {get;init;}="";public int? MinutesLeft {get;init;}}
public sealed record VeloJef {public CartShop? Shop {get;init;} public CartNotice? Notice {get;init;} public List<VeloHire> List {get;init;}=new();}
public sealed record VeloTransport {public VeloJef? Jef {get;init;}}
public sealed record VeloMountReply:JobsPayload {public string Text {get;init;}="";public bool Again {get;init;}}
public partial class Api
{
    public Task<VeloWorld> Velos()=>Get<VeloWorld>("api/deeds/world");
    public Task<VeloTransport> VeloTransport()=>Get<VeloTransport>("api/transport");
    // Only machines the authoritative world says are already Jef's come through this call.
    public Task<VeloMountReply> VeloMount(VeloInfo v,float x,float z)=>Post<VeloMountReply>("api/deed",new { @ref=v.Id,x,z,witnesses=System.Array.Empty<object>(),crouch=false,lantern=false });
    public Task<VeloInfo> VeloLeave(string id,float x,float z,float yaw,bool down)=>Post<VeloInfo>("api/velo/"+id[5..]+"/leave",new {x,z,yaw,down});
    public Task<OkReply> VeloSeen(float x,float z)=>Post<OkReply>("api/transport/seen",new{x,z});
}
