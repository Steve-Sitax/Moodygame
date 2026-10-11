using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.Native.Authoring;

public sealed record Placement
{
    public string Id { get; init; } = "";
    public string Asset { get; init; } = "";
    public float[] Position { get; init; } = Array.Empty<float>();
    /// <summary>Euler angles in radians, matching Node3D.Rotation.</summary>
    public float[] Rotation { get; init; } = Array.Empty<float>();
    public float[] Scale { get; init; } = Array.Empty<float>();
}

/// <summary>Only asset ids and transforms are writable. Layout files cannot load arbitrary scenes or scripts.</summary>
public sealed record LayoutDocument
{
    public int Version { get; init; } = 1;
    public string District { get; init; } = "";
    public List<Placement> Objects { get; init; } = new();
    private static readonly Regex IdPattern = new("^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,95}$", RegexOptions.CultureInvariant);
    public static bool ValidId(string id) => id != null && IdPattern.IsMatch(id);
    public static float[] Floats(Vector3 v) => new[] { v.X, v.Y, v.Z };
    public static Vector3 Vector(float[] v) => new(v[0], v[1], v[2]);
    private static bool Triple(float[]? v) => v is { Length: 3 } && v.All(float.IsFinite);

    public void Validate(string district, IReadOnlyDictionary<string, AuthorAsset> assets)
    {
        if (Version != 1) throw new InvalidDataException($"This layout version ({Version}) is not supported.");
        if (District != district) throw new InvalidDataException("This layout belongs to another district.");
        if (Objects == null || Objects.Count > 2000) throw new InvalidDataException("A district supports at most 2,000 objects.");
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var p in Objects)
        {
            if (p == null || !ValidId(p.Id) || !ids.Add(p.Id)) throw new InvalidDataException("Object identifiers must be unique.");
            if (!ValidId(p.Asset) || !assets.ContainsKey(p.Asset)) throw new InvalidDataException($"An object uses an unavailable asset: {p.Asset}");
            if (!Triple(p.Position) || p.Position.Any(v => Math.Abs(v) > 100000) || !Triple(p.Rotation)
                || p.Rotation.Any(v => Math.Abs(v) > 100 * MathF.Tau) || !Triple(p.Scale) || p.Scale.Any(v => v < 0.1f || v > 10))
                throw new InvalidDataException($"An object has an invalid transform: {p.Id}");
        }
    }

    private static readonly JsonSerializerOptions Json = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase, WriteIndented = true };
    public string Encode() => JsonSerializer.Serialize(this, Json);
    public static LayoutDocument Decode(string text) => JsonSerializer.Deserialize<LayoutDocument>(text, Json)
        ?? throw new InvalidDataException("The layout is empty.");
    public LayoutDocument Copy() => Decode(Encode());
}
