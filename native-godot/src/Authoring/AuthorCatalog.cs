using System;
using System.Collections.Generic;
using Godot;

namespace Scheldemist.Native.Authoring;

[GlobalClass]
[Tool]
public partial class AuthorCatalog : Resource
{
    [Export] public Godot.Collections.Array<AuthorAsset> Assets { get; set; } = new();

    public Dictionary<string, AuthorAsset> Index()
    {
        var index = new Dictionary<string, AuthorAsset>(StringComparer.Ordinal);
        foreach (var asset in Assets)
        {
            if (asset == null || !LayoutDocument.ValidId(asset.Id) || asset.Scene == null || !asset.Scene.CanInstantiate()
                || !asset.Footprint.IsFinite() || !asset.FootprintOffset.IsFinite()
                || asset.Footprint.X <= 0 || asset.Footprint.Y <= 0 || asset.Footprint.Z <= 0)
                throw new InvalidOperationException("The object library contains an incomplete asset.");
            if (!index.TryAdd(asset.Id, asset)) throw new InvalidOperationException($"Duplicate asset id: {asset.Id}");
        }
        return index;
    }
}
