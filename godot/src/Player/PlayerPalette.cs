using System.Linq;
using Godot;
using Scheldemist.Menu;
using Scheldemist.World;

namespace Scheldemist.Player;

internal static class PlayerPalette
{
    private static Color Of(System.Collections.Generic.IReadOnlyList<Swatch> list, string id) =>
        new((uint)(((list.FirstOrDefault(x => x.Id == id)?.Hex ?? 0x808080) << 8) | 0xff));
    internal static void Apply(Node3D root, Profile p)
    {
        foreach (var mi in BakedWorld.All(root).OfType<MeshInstance3D>())
        {
            mi.SetInstanceShaderParameter("player_skin", Of(Character.Skin, p.Skin));
            mi.SetInstanceShaderParameter("player_hair", Of(Character.HairColours, p.Hair.Colour));
            mi.SetInstanceShaderParameter("player_shirt", Of(Character.Cloth, p.Clothes.Shirt.Colour));
            mi.SetInstanceShaderParameter("player_coat", Of(Character.Cloth, p.Clothes.Coat.Kind == "none" ? p.Clothes.Shirt.Colour : p.Clothes.Coat.Colour));
            mi.SetInstanceShaderParameter("player_lower", Of(Character.Cloth, p.Clothes.Lower.Colour));
            mi.SetInstanceShaderParameter("player_feet", Of(Character.SwatchesFor("feet", p.Clothes.Feet.Kind), p.Clothes.Feet.Colour));
            mi.SetInstanceShaderParameter("player_vest", Of(Character.Cloth, p.Clothes.Vest.Colour));
            mi.SetInstanceShaderParameter("player_apron", Of(Character.Cloth, p.Clothes.Apron.Colour));
            mi.SetInstanceShaderParameter("player_head", Of(Character.Cloth, p.Clothes.Head.Colour));
        }
    }
}
