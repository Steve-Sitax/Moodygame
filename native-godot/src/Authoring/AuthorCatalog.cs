using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Authoring;

[GlobalClass]
[Tool]
public partial class AuthorCatalog : Resource
{
    private static AuthorCatalog? sharedFurniture;
    [Export] public Godot.Collections.Array<AuthorAsset> Assets { get; set; } = new();

    public Dictionary<string, AuthorAsset> Index()
    {
        var index = new Dictionary<string, AuthorAsset>(StringComparer.Ordinal);
        const string furniture = "res://assets/library/furniture-catalog.tres";
        var entries = Assets.AsEnumerable();
        if (ResourcePath != furniture && ResourceLoader.Exists(furniture))
        {
            // Retain the typed C# resource, rather than just a lazy enumeration of its native Array.
            // Godot's weak resource cache must not outlive its managed script wrapper during world sharing.
            if(sharedFurniture==null || !IsInstanceValid(sharedFurniture))
                sharedFurniture=ResourceLoader.Load<AuthorCatalog>(furniture,cacheMode:ResourceLoader.CacheMode.Ignore)
                    ?? throw new InvalidOperationException("The furniture catalog could not be loaded.");
            entries = entries.Concat(sharedFurniture.Assets.Where(a=>a!=null && !Assets.Any(existing=>existing!=null && existing.Id==a.Id)));
        }
        foreach (var asset in entries)
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
