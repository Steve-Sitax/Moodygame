using System;
using System.Text.Json;

namespace Scheldemist.Play;

public partial class Goods
{
    public void RefreshCartGoods() => Load();
    public Item? CartGoods(GoodsItem s) => Apply(s,true,"");
    public void MoveOntoCart(Item it,string cart)
    {
        Apply(it.S with { By=JsonSerializer.SerializeToElement(new {cart}) },true,"");
    }
}
