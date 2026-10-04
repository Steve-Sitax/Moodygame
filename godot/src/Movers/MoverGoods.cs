using System;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Play;

namespace Scheldemist.Movers;

/// <summary>goods.ts cartFrame: hang the server's own items on the live beds, in the run's fixed order.</summary>
[GamePart(65)]
public partial class MoverGoods : Node
{
    private static readonly Vector2[] Slots={new(-.26f,-.42f),new(.26f,-.42f),new(-.26f,.3f),new(.26f,.3f)};
    public override void _Ready()
    {
        if(Goods.I!=null) Goods.I.ShowHeld=Show;
        if(MoversTest.On) Probes();
    }

    private static bool Show(Item it)
    {
        var by=it.S.By;
        if(by==null || by.Value.ValueKind!=JsonValueKind.Object || !by.Value.TryGetProperty("cart",out var value)) return false;
        string? cart=value.GetString();
        if(cart==null || GoodsDrays.I?.BedOf(cart) is not { } bed) return false;
        bool dray=cart=="dray:hessenatie";
        string prefix=dray?"pile:e:":"sack:0:";
        int n=it.Id.StartsWith(prefix,StringComparison.Ordinal) && int.TryParse(it.Id[prefix.Length..],out int number)?Math.Max(0,number):0;
        it.Obj??=Goods.I.MakeGoods(it.Kind);
        if(it.Obj.GetParent()==null) bed.AddChild(it.Obj);
        else if(it.Obj.GetParent()!=bed) it.Obj.Reparent(bed,false);
        it.Obj.Visible=true;
        it.Obj.Scale=Vector3.One*(dray?1:.6f);
        if(dray) {it.Obj.Position=new Vector3(0,1.06f,.3f+Math.Min(n,2)*.9f); it.Obj.Rotation=new Vector3(0,Math.Min(n,2)*1.7f,0);}
        else
        {
            // Each slot grows by the heights of the earlier items in that slot, as goods.ts does.
            float y=.2f;
            foreach(var other in Goods.I.All.Values)
                if(other.Id.StartsWith(prefix,StringComparison.Ordinal) && int.TryParse(other.Id[prefix.Length..],out int k) && k<n && k%4==n%4 && other.S.By?.GetRawText()==by.Value.GetRawText())
                    y+=(float)(other.S.H??GoodsRules.Of(other.Kind).H)*.6f;
            var p=Slots[n%4];
            it.Obj.Position=new Vector3(p.X,y,p.Y); it.Obj.Rotation=new Vector3(0,(n*.37f)%.3f-.15f,0);
        }
        return true;
    }

    private void Probes()
    {
        foreach(var rig in GoodsDrays.I?.Rigs??Array.Empty<GoodsDrays.Rig>())
        {
            Item? item=null;
            MoversTest.Add(new MoversTest.Probe {
                Name="cart_load_"+rig.Id,Hour=rig.Id=="casks"?8+8.5/60:10+9.0/60,Gap=3,
                Start=()=>{item=new Item {S=new GoodsItem {Id=rig.Id=="casks"?"pile:e:0":"sack:0:0",Kind=rig.Id=="casks"?"barrels":"sacks",By=JsonSerializer.SerializeToElement(new {cart=rig.CartId})},Obj=Goods.I.MakeGoods(rig.Id=="casks"?"barrels":"sacks")}; Show(item);},
                Ready=()=>rig.Moving,
                Where=()=> (item!.Obj!.GlobalPosition,item.Obj.GlobalRotation.Y,"goods attached to "+rig.CartId),
                View=()=>{var p=item!.Obj!.GlobalPosition; return (p+new Vector3(4,3,-5),p);},
                Check=()=>item!.Obj!.GetParent()==rig.Bed?"":"the load left its live bed",
                End=()=>item?.Obj?.QueueFree()
            });
        }
    }
}
