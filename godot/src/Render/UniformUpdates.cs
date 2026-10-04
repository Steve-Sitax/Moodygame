using System.Collections.Generic;
using Godot;

namespace Scheldemist.Render;

/// <summary>Send identical shader values once. Exact comparison keeps every drawn value unchanged.</summary>
public static class UniformUpdates
{
    public static bool Cached { get; set; } = !Main.I.Flag("uncached-updates");
    private static readonly Dictionary<(ShaderMaterial material, string name), Variant> materials = new();
    private static readonly Dictionary<string, Variant> globals = new();
    private static readonly Dictionary<string, StringName> names = new();
    private static StringName Name(string name)
    {
        if (!names.TryGetValue(name, out var n)) names[name] = n = new StringName(name);
        return n;
    }
    // Variant inherits ValueType.Equals(object): it boxes both values and their native fields.
    // Compare the values we send instead; unsupported kinds always go through unchanged.
    private static bool Same(Variant a, Variant b)
    {
        if (a.VariantType != b.VariantType) return false;
        return a.VariantType switch
        {
            Variant.Type.Nil => true,
            Variant.Type.Bool => a.AsBool() == b.AsBool(),
            Variant.Type.Int => a.AsInt64() == b.AsInt64(),
            Variant.Type.Float => a.AsDouble() == b.AsDouble(),
            Variant.Type.Vector2 => a.AsVector2() == b.AsVector2(),
            Variant.Type.Vector3 => a.AsVector3() == b.AsVector3(),
            Variant.Type.Vector4 => a.AsVector4() == b.AsVector4(),
            Variant.Type.Color => a.AsColor() == b.AsColor(),
            Variant.Type.Projection => a.AsProjection() == b.AsProjection(),
            Variant.Type.Rid => a.AsRid() == b.AsRid(),
            Variant.Type.Object => a.AsGodotObject() == b.AsGodotObject(),
            _ => false,
        };
    }
    public static void Material(ShaderMaterial material, string name, Variant value)
    {
        var key = (material, name);
        if (Cached && materials.TryGetValue(key, out var old) && Same(old, value)) return;
        materials[key] = value;
        material.SetShaderParameter(Name(name), value);
    }
    public static void Global(string name, Variant value)
    {
        if (Cached && globals.TryGetValue(name, out var old) && Same(old, value)) return;
        globals[name] = value;
        RenderingServer.GlobalShaderParameterSet(Name(name), value);
    }
    /// <summary>Dev A/B: resend the exact last values, without advancing the scene's clocks.</summary>
    public static void Replay()
    {
        foreach (var p in materials) Material(p.Key.material, p.Key.name, p.Value);
        foreach (var p in globals) Global(p.Key, p.Value);
    }
}
