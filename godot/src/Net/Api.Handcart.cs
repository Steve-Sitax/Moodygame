using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using Scheldemist.Play;

namespace Scheldemist.Net;

public sealed record CartLoad
{
    public string Kind { get; init; } = "";
    public int? Job { get; init; }
    public string? Owner { get; init; }
    public bool Broken { get; init; }
    public bool Heavy { get; init; }
    [System.Text.Json.Serialization.JsonIgnore(Condition=System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull)] public int? Piece { get; init; }
    public string? Gid { get; init; }
}
public sealed record HandcartInfo
{
    public string Id { get; init; } = "";
    public string Kind { get; init; } = "";
    public string Label { get; init; } = "";
    public string? Owner { get; init; }
    public int? Job { get; init; }
    public string? Lender { get; init; }
    public double[]? Home { get; init; }
    public bool Placed { get; init; }
    public bool Held { get; init; }
    public float X { get; init; }
    public float Z { get; init; }
    public float Yaw { get; init; }
    public float Kg { get; init; }
    public float Size { get; init; }
    public int? MinutesLeft { get; init; }
    public List<CartLoad> Load { get; init; } = new();
}
public sealed record CartShop
{
    public string Id { get; init; } = "";
    public string Label { get; init; } = "";
    public float[] Step { get; init; } = Array.Empty<float>();
    public float[] At { get; init; } = Array.Empty<float>();
    public List<float[]> Show { get; init; } = new();
}
public sealed record CartNotice { public int N { get; init; } public string Text { get; init; } = ""; }
public sealed record CartLimits { public float Size { get; init; } public float Kg { get; init; } }
public sealed record CartView
{
    public List<HandcartInfo> List { get; init; } = new();
    public CartShop? Shop { get; init; }
    public CartNotice? Notice { get; init; }
    public CartLimits Limit { get; init; } = new();
}
public sealed record CartReply : JobsPayload
{
    public CartView Carts { get; init; } = new();
    public CartLoad? Item { get; init; }
    public List<CartLoad>? Items { get; init; }
    // Unloading one returns an object; unloading a job returns an array.
    public JsonElement? Goods { get; init; }
}
public sealed partial class Api
{
    public Task<CartView> Carts() => Get<CartView>("api/cart");
    private static string CartPath(string id, string action) => $"api/cart/{Esc(id.StartsWith("cart:", StringComparison.Ordinal) ? id[5..] : id)}/{action}";
    public Task<CartReply> CartHold(string id,float x,float z) => Post<CartReply>(CartPath(id,"hold"),new {x,z});
    public Task<CartReply> CartRelease(string id,float x,float z,float yaw) => Post<CartReply>(CartPath(id,"at"),new {x,z,yaw,held=false});
    public Task<OkReply> CartAt(string id,float x,float z,float yaw) => Post<OkReply>(CartPath(id,"at"),new {x,z,yaw,held=true});
    public Task<CartReply> CartPlace(string id,float x,float z,float yaw) => Post<CartReply>(CartPath(id,"place"),new {x,z,yaw});
    public Task<CartReply> CartLoad(string id,CartLoad item,float x,float z) => Post<CartReply>(CartPath(id,"load"),new {item,x,z});
    public Task<CartReply> CartUnload(string id,float x,float z,int? job=null) => Post<CartReply>(CartPath(id,"unload"),new {x,z,job});
    public Task<OkReply> CartSeen(float x,float z) => Post<OkReply>("api/cart/seen",new {x,z});
}
