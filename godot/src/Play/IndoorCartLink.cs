using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
namespace Scheldemist.Play;
/// <summary>Furniture owns its pieces; the moving helper owns the cart, its bed and driving.</summary>
[GamePart(924)]
public partial class IndoorCartLink : Node
{
    private readonly Dictionary<int,Node3D> pieces=new();
    private readonly List<int> removed=new();
    private readonly Offers offers=new(){First=new()};
    private readonly Act load=Act.Me(Key.E,"put the furniture on the cart",()=>{}),lift=Act.Me(Key.G,"lift the furniture off the cart",()=>{});
    private Handcarts.Drawn? near;
    private double poll;
    private CartView? seen;
    public int DrawnPieces=>pieces.Count;
    public override void _Ready()
    {
        load.Run=()=>{if(near!=null)_ = HomeFurniture.I.LoadToCart(near.Info.Id);};
        lift.Run=()=>{if(near!=null)for(int i=near.Info.Load.Count-1;i>=0;i--)if(near.Info.Load[i].Piece!=null){_ = HomeFurniture.I.LiftFromCart(near.Info.Id,i);break;}};
        Interact.I.AddProvider(Keys);HomeFurniture.I.CartChanged+=Changed;Handcarts.I.Answered+=CartAnswered;Deeds.I.CartTaken+=Taken;
        Deeds.I.ThingsReturned+=Returned;
    }
    private void Changed(JsonElement state){Handcarts.I.Apply(state.Deserialize<CartView>(Api.Json)!);Sync();}
    private void CartAnswered(string action,CartReply reply){HomeFurniture.I.RefreshAfterCart();Sync();}
    private void Taken(string id,bool again){_ = Handcarts.I.Load();HomeFurniture.I.RefreshAfterCart();}
    private void Returned(){_ = Handcarts.I.Load();HomeFurniture.I.RefreshAfterCart();}
    private Offers? Keys(float x,float z)
    {
        if(Handcarts.I.Held!=null||Handcarts.I.Busy||HomeFurniture.I.CartBusy||Jef.I.Riding||HomeFurniture.I.Moving!=null)return null;
        near=null;float best=2.4f;
        foreach(var d in Handcarts.I.Drawings.Values){float distance=new Vector2(d.X-x,d.Z-z).Length();if(distance<best){best=distance;near=d;}}
        if(near==null)return null;
        offers.First!.Clear();
        if(HomeFurniture.I.CarriedFurniture is {} piece){load.Text="put the "+piece.Name+" on the cart";offers.First.Add(load);}
        else foreach(var item in near.Info.Load)if(item.Piece!=null){offers.First.Add(lift);break;}
        return offers.First.Count>0?offers:null;
    }
    public override void _Process(double dt){if((poll-=dt)<=0){poll=.25;Sync();}}
    private void Sync()
    {
        if(seen!=Handcarts.I.View){seen=Handcarts.I.View;HomeFurniture.I.RefreshAfterCart();}
        removed.Clear();foreach(var id in pieces.Keys)removed.Add(id);
        foreach(var d in Handcarts.I.Drawings.Values)for(int i=0;i<d.Info.Load.Count;i++)if(d.Info.Load[i] is {Piece:{} id} item)
        {
            removed.Remove(id);if(!pieces.TryGetValue(id,out var model)||!IsInstanceValid(model)){model=HomeFurniture.I.CartModel(item.Kind);model.Visible=true;pieces[id]=model;d.Bed.AddChild(model);}
            else if(model.GetParent()!=d.Bed)model.Reparent(d.Bed,false);
            model.Position=new((i%2==0?-.36f:.36f),.2f+(i/4)*.3f,(i/2%2==0?-.38f:.38f));model.Rotation=Vector3.Zero;
        }
        foreach(int id in removed){if(IsInstanceValid(pieces[id]))pieces[id].QueueFree();pieces.Remove(id);}
    }
    public override void _ExitTree(){HomeFurniture.I.CartChanged-=Changed;Handcarts.I.Answered-=CartAnswered;Deeds.I.CartTaken-=Taken;Deeds.I.ThingsReturned-=Returned;}
}
