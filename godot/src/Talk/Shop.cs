using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;

namespace Scheldemist.Talks;

/// <summary>GET /api/shops (server/src/shops/routes.ts): where the shops are, which are open, who keeps them.</summary>
public sealed record ShopKeeper
{
    public string Id { get; init; } = "";
    public string Name { get; init; } = "";
    public string First { get; init; } = "";
    public string Kind { get; init; } = "";
    public string Sex { get; init; } = "";
}

public sealed record ShopInfo
{
    public string Place { get; init; } = "";
    public string Label { get; init; } = "";
    public string Trade { get; init; } = "";
    public double[] Door { get; init; } = Array.Empty<double>();
    public double[] Wall { get; init; } = Array.Empty<double>();
    public double[] Out { get; init; } = Array.Empty<double>();
    public string? Goods { get; init; }
    public bool Open { get; init; }
    public ShopKeeper? Keeper { get; init; }
}

public sealed record ShopsReply
{
    public List<ShopInfo> Shops { get; init; } = new();
}

/// <summary>
/// The shop list (M7 shops): buying goes through the keeper's wares, the talk window opened straight on its list
/// (talk.ts open(npc, true): number keys pay, H argues a price, B goes to the talk). A shop is found by its place.
///
///   Shop.I.Open("bakery_rijn")       the list of that shop's keeper (a line in the middle when it is shut)
///   Shop.I.OpenAt(npcId, name)       the list of anyone who sells (F next to a seller)
///   await Shop.I.List()              the town's shops as the server has them now
/// </summary>
[GamePart(305)]
public partial class Shop : Node
{
    public static Shop? I { get; private set; }

    public Shop()
    {
        I = this;
    }

    public override void _ExitTree()
    {
        if (I == this) I = null;
    }

    /// <summary>The town's shops now: open or shut, the keeper.</summary>
    public async Task<List<ShopInfo>> List()
    {
        if (ServerLink.I?.Api is not { } api) return new();
        return (await api.Get<ShopsReply>("api/shops")).Shops;
    }

    /// <summary>The wares list of this shop's keeper. False (and a line in the middle) when there is no such shop or it is shut.</summary>
    public async Task<bool> Open(string shopId)
    {
        try
        {
            var shop = (await List()).FirstOrDefault(s => s.Place == shopId);
            if (shop?.Keeper == null)
            {
                GameState.I.Say("Nobody keeps a shop there.");
                return false;
            }
            if (!shop.Open)
            {
                GameState.I.Say("The shop is shut; come back in working hours.");
                return false;
            }
            OpenAt(shop.Keeper.Id, shop.Keeper.Name, shop.Trade);
            return true;
        }
        catch (ApiException e)
        {
            GameState.I.Say(e.Message);
            return false;
        }
    }

    /// <summary>Straight to what this person sells, without a conversation.</summary>
    public void OpenAt(string npcId, string name = "", string? title = null) => Talk.I?.Open(npcId, name, title, shopOnly: true);
}
