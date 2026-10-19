using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The Ruien's three shader kinds and their materials, one per family, shared by every area (docs/ruien-native.md):
/// masonry (every solid surface), water (every water surface and wall film), air (beams, mist, flames and glass). The
/// numbers of each family are res://world/ruien/materials.json, its pictures res://world/ruien/textures. A family not
/// in the file is drawn as plain grey masonry, so a new export never draws nothing.
/// </summary>
public static class RuienMaterials
{
    public const string Masonry = "res://shaders/ruien_masonry.gdshader", Water = "res://shaders/ruien_water.gdshader", Air = "res://shaders/ruien_air.gdshader";
    public const string File = "res://world/ruien/materials.json";
    private static readonly Dictionary<string, ShaderMaterial> Made = new();
    private static JsonElement? spec;
    private static Dictionary<string, RuienTextures.Family>? families;
    public static readonly List<ShaderMaterial> Lamps = new();
    private static Shader? masonry, water, air;
    public static Shader MasonryShader => masonry ??= ResourceLoader.Load<Shader>(Masonry);
    public static Shader WaterShader => water ??= ResourceLoader.Load<Shader>(Water);
    public static Shader AirShader => air ??= ResourceLoader.Load<Shader>(Air);

    private static JsonElement Spec => spec ??= JsonDocument.Parse(Godot.FileAccess.GetFileAsString(File)).RootElement;
    private static float F(JsonElement e, string k, float d) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Number ? v.GetSingle() : d;
    private static Color C(JsonElement e, string k, Color d) => e.TryGetProperty(k, out var v) && v.ValueKind == JsonValueKind.Array ? new Color(v[0].GetSingle(), v[1].GetSingle(), v[2].GetSingle()) : d;

    /// <summary>Dev (--ruien-live): read the numbers again and put them on the materials already made.</summary>
    public static void Reload()
    {
        spec = null;
        var old = new Dictionary<string, ShaderMaterial>(Made);
        Made.Clear();
        Lamps.Clear();
        foreach (var (name, m) in old)
        {
            var fresh = Get(name);
            foreach (var u in fresh.Shader.GetShaderUniformList())
            {
                string n = u.AsGodotDictionary()["name"].AsString();
                var v = fresh.GetShaderParameter(n);
                if (v.VariantType != Variant.Type.Nil) m.SetShaderParameter(n, v);
            }
            Made[name] = m;
            if (Lamps.Contains(fresh)) { Lamps.Remove(fresh); Lamps.Add(m); }
        }
    }

    /// <summary>A family the game does not draw (materials.json skip): the town draws its own there.</summary>
    public static bool Skipped(string family)
    {
        string key = family.StartsWith("ruien_") ? family[6..] : family;
        return Spec.TryGetProperty("skip", out var sk) && sk.EnumerateArray().Any(e => e.GetString() == key);
    }

    /// <summary>Which kind a family is drawn with: masonry, water or air.</summary>
    public static string KindOf(string family)
    {
        string key = family.StartsWith("ruien_") ? family[6..] : family;
        string misc = key.StartsWith("misc_") ? key[5..] : key;
        if (Spec.GetProperty("water").TryGetProperty(key, out _) || Spec.GetProperty("water").TryGetProperty(misc, out _)) return "water";
        if (Spec.GetProperty("air").TryGetProperty(misc, out _)) return "air";
        return "masonry";
    }

    /// <summary>The material of a family (the export's material names: ruien_brick_stretcher, ruien_misc_Bone ...).</summary>
    public static ShaderMaterial Get(string family)
    {
        if (Made.TryGetValue(family, out var m)) return m;
        string key = family.StartsWith("ruien_") ? family[6..] : family;
        string misc = key.StartsWith("misc_") ? key[5..] : key;
        families ??= RuienTextures.Families();
        string kind = KindOf(family);
        if (kind == "water")
        {
            var w = Spec.GetProperty("water").TryGetProperty(key, out var wk) ? wk : Spec.GetProperty("water").GetProperty(misc);
            m = new ShaderMaterial { Shader = WaterShader, ResourceName = family, RenderPriority = 1 };
            var murk = C(w, "murk", new Color(0.075f, 0.065f, 0.035f));
            m.SetShaderParameter("murk", murk);
            if (w.TryGetProperty("absorb", out var ab)) m.SetShaderParameter("absorb", new Vector3(ab[0].GetSingle(), ab[1].GetSingle(), ab[2].GetSingle()));
            m.SetShaderParameter("scum", F(w, "scum", 0.6f));
            m.SetShaderParameter("drips", F(w, "drips", 1));
            m.SetShaderParameter("ripple", F(w, "ripple", 1));
            m.SetShaderParameter("film", F(w, "film", 0));
            m.SetShaderParameter("film_alpha", F(w, "alpha", 0.45f));
        }
        else if (kind == "air")
        {
            var a = Spec.GetProperty("air").GetProperty(misc);
            m = Glow(C(a, "color", Colors.White), F(a, "strength", 1));
            m.ResourceName = family;
            if (a.TryGetProperty("lamp", out var lp) && lp.ValueKind == JsonValueKind.True) { m.SetMeta("ruien_base", F(a, "strength", 1)); Lamps.Add(m); }
        }
        else
        {
            m = new ShaderMaterial { Shader = MasonryShader, ResourceName = family };
            JsonElement p = default;
            bool known = Spec.GetProperty("masonry").TryGetProperty(key, out p) || Spec.GetProperty("misc").TryGetProperty(misc, out p);
            string texName = known && p.TryGetProperty("textures", out var tn) ? tn.GetString()! : key;
            if (families.TryGetValue(texName, out var fam))
            {
                m.SetShaderParameter("albedo_tex", RuienTextures.Get(texName, "albedo"));
                m.SetShaderParameter("normal_tex", RuienTextures.Get(texName, "normal"));
                m.SetShaderParameter("hra_tex", RuienTextures.Get(texName, "hra"));
                if (fam.Variants)
                {
                    m.SetShaderParameter("slime_tex", RuienTextures.Get(texName, "slime"));
                    m.SetShaderParameter("lime_tex", RuienTextures.Get(texName, "lime"));
                    m.SetShaderParameter("variants", 1f);
                }
                m.SetShaderParameter("relief_m", fam.Relief);
                m.SetShaderParameter("tile_m", new Vector2(fam.TileU, fam.TileV));
            }
            else
            {
                m.SetShaderParameter("pom", 0f);
                m.SetShaderParameter("tint", known ? C(p, "color", new Color(0.3f, 0.3f, 0.3f)) : new Color(0.3f, 0.3f, 0.3f));
            }
            if (families.ContainsKey("moss"))
            {
                m.SetShaderParameter("moss_albedo", RuienTextures.Get("moss", "albedo"));
                m.SetShaderParameter("moss_normal", RuienTextures.Get("moss", "normal"));
            }
            if (known)
            {
                if (p.TryGetProperty("pom", out _)) m.SetShaderParameter("pom", F(p, "pom", 0.3f));
                m.SetShaderParameter("normal_k", F(p, "normal", 1));
                m.SetShaderParameter("rough_k", F(p, "rough", 1));
                m.SetShaderParameter("metal", F(p, "metal", 0));
                m.SetShaderParameter("wrap", F(p, "wrap", 0));
                m.SetShaderParameter("weather_k", F(p, "weather", 1));
                m.SetShaderParameter("cover", F(p, "cover", 1));
                m.SetShaderParameter("moss_k", F(p, "moss", 1));
                m.SetShaderParameter("halo_k", F(p, "halo", 1));
                if (p.TryGetProperty("uvMetres", out var um)) { m.SetShaderParameter("uv_metres", 1f); m.SetShaderParameter("tile_m", new Vector2(um[0].GetSingle(), um[1].GetSingle())); }
                if (F(p, "cover", 1) < 1) m.SetShaderParameter("depth_bias", 2.5e-4f);
            }
        }
        Made[family] = m;
        return m;
    }

    /// <summary>An air material: a self-lit glow (mode 2).</summary>
    public static ShaderMaterial Glow(Color c, float strength)
    {
        var m = new ShaderMaterial { Shader = AirShader, RenderPriority = 3 };
        m.SetShaderParameter("mode", 2);
        m.SetShaderParameter("colour", c);
        m.SetShaderParameter("strength", strength);
        return m;
    }

    public static ShaderMaterial Beam(Color c, Vector3 from, Vector3 dir, float len, float r)
    {
        var m = new ShaderMaterial { Shader = AirShader, RenderPriority = 2, ResourceName = "ruien_beam" };
        m.SetShaderParameter("mode", 0);
        m.SetShaderParameter("colour", c);
        m.SetShaderParameter("beam_from", from);
        m.SetShaderParameter("beam_dir", dir);
        m.SetShaderParameter("beam_len", len);
        m.SetShaderParameter("beam_r", r);
        m.SetShaderParameter("strength", 0f);
        return m;
    }

    public static ShaderMaterial Mist(Vector3 lo, Vector3 hi, float density)
    {
        var m = new ShaderMaterial { Shader = AirShader, RenderPriority = 2, ResourceName = "ruien_mist" };
        m.SetShaderParameter("mode", 1);
        m.SetShaderParameter("colour", new Color(0.9f, 0.88f, 0.8f));
        m.SetShaderParameter("box_min", lo);
        m.SetShaderParameter("box_max", hi);
        m.SetShaderParameter("density", density);
        return m;
    }
}
