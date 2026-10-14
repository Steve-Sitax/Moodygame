using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Menu;
using Scheldemist.People;
using Scheldemist.World;

namespace Scheldemist.Player;

internal static class PlayerPalette
{
    private static readonly Dictionary<string, ShaderMaterial> materials = new();
    internal static Color Of(IReadOnlyList<Swatch> list, string id) =>
        new((uint)(((list.First(x => x.Id == id).Hex) << 8) | 0xff));
    internal static void Forget() { foreach (var material in materials.Values) material.Dispose(); materials.Clear(); }
    internal static void Apply(Node3D root, Profile p)
    {
        string kind = root.GetMeta("people2_mesh_kind").AsString();
        using var rig = JsonDocument.Parse(File.ReadAllText(Paths.Shared("peopleRig.json")));
        var defaults = rig.RootElement.GetProperty("player").GetProperty("kinds").GetProperty(kind).GetProperty("defaultPalette");
        var chosen = new[] { new Color(), new Color(), new Color(), Of(Character.Cloth, p.Clothes.Head.Colour),
            Of(Character.Cloth, p.Clothes.Coat.Colour), Of(Character.Cloth, p.Clothes.Shirt.Colour), Of(Character.Cloth, p.Clothes.Vest.Colour),
            Of(Character.Cloth, p.Clothes.Lower.Colour), Of(Character.Cloth, p.Clothes.Apron.Colour), Of(Character.SwatchesFor("feet", p.Clothes.Feet.Kind), p.Clothes.Feet.Colour) };
        foreach (var mi in BakedWorld.All(root).OfType<MeshInstance3D>())
        {
            string name = mi.Name.ToString();
            bool accessory = name.StartsWith("jef_hat_") || name.StartsWith("jef_boots_") || name.StartsWith("jef_clogs_");
            string picture = accessory ? "held_jef" : kind;
            string key = picture + ":" + p.Sex + ":" + string.Join(",", chosen.Select(c => c.ToHtml())) + ":" + p.Clothes.Coat.Kind + ":" + p.Clothes.Head.Kind;
            if (!materials.TryGetValue(key, out var material))
            {
                var source = mi.GetActiveMaterial(0) as ShaderMaterial ?? throw new InvalidDataException("Player material missing");
                material = (ShaderMaterial)source.Duplicate();
                using var colour = ResourceLoader.Load<Texture2D>("res://assets/people2-pictures/" + picture + "_colour.png").GetImage();
                if (colour.IsCompressed()) colour.Decompress(); colour.ClearMipmaps(); colour.Convert(Image.Format.Rgba8);
                using var tint = ResourceLoader.Load<Texture2D>("res://assets/people2-pictures/jef-tint/" + picture + "_tint.png").GetImage();
                if (tint.IsCompressed()) tint.Decompress(); tint.Convert(Image.Format.Rgba8);
                byte[] pixels = colour.GetData(), mask = tint.GetData();
                var names = new[] { "", "", "", "hat", "coat", "shirt", "vest", "lower", "apron", "boots" };
                for (int i = 0; i < pixels.Length; i += 4)
                {
                    int slot = (int)MathF.Round(mask[i + 1] / 16f);
                    if (slot < 3 || slot > 9) continue;
                    Color original = new(defaults.GetProperty(names[slot]).GetString()!);
                    // The held layer was composed with one palette for each sex, including every hat.
                    if (accessory) original = new Color(slot == 9 ? p.Sex == "woman" ? "2a2420" : "5a4632" : p.Sex == "woman" ? "e2ded2" : "38383a");
                    float gain = mask[i] / 255f * 2;
                    for (int c = 0; c < 3; c++)
                    {
                        float value = pixels[i + c] / 255f;
                        if (slot == 4 && p.Clothes.Coat.Kind == "shawl") value /= 1 - .5f * mask[i + 2] / 255f;
                        pixels[i + c] = (byte)Math.Clamp((int)MathF.Round((value + gain * (chosen[slot][c] - original[c])) * 255), 0, 255);
                    }
                }
                colour.SetData(colour.GetWidth(), colour.GetHeight(), false, Image.Format.Rgba8, pixels);
                using var texture = ImageTexture.CreateFromImage(colour);
                material.SetShaderParameter("player_cloth", People2Material.PlayerMipmapped(texture));
                material.SetShaderParameter("player_tint", true);
                // Existing meshes retain their own resource references; slider drags cannot grow this cache forever.
                if (materials.Count >= 16) materials.Remove(materials.Keys.First());
                materials[key] = material;
            }
            mi.MaterialOverride = material;
            mi.SetInstanceShaderParameter("player_skin", Of(Character.Skin, p.Skin));
            mi.SetInstanceShaderParameter("player_hair", Of(Character.HairColours, p.Hair.Colour));
        }
    }
}
