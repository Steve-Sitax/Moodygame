using System;
using Godot;

namespace Scheldemist.Native.Authoring;

/// <summary>A native scene, its placement boundary and its own library. No exported town facts at runtime.</summary>
[Tool]
[GlobalClass]
public partial class AuthorDistrict : Resource
{
    [Export] public string Id { get; set; } = "quay-pilot";
    [Export] public string Title { get; set; } = "Pilot quay";
    [Export] public PackedScene Scene { get; set; } = null!;
    [Export] public AuthorCatalog Catalog { get; set; } = null!;
    [Export] public Rect2 Bounds { get; set; } = new(-19.8f, -15.8f, 39.6f, 31.6f);
    [Export] public Vector3 WalkSpawn { get; set; } = new(0, 0.02f, 8);
    [Export] public Vector3 FlySpawn { get; set; } = new(4, 5, 10);
    [Export] public float FlyYaw { get; set; }
    [Export] public float FlyPitch { get; set; } = -0.35f;

    public void Validate()
    {
        if (!LayoutDocument.ValidId(Id) || Scene == null || !Scene.CanInstantiate() || Catalog == null
            || !Bounds.Position.IsFinite() || !Bounds.Size.IsFinite() || Bounds.Size.X <= 0 || Bounds.Size.Y <= 0
            || !WalkSpawn.IsFinite() || !FlySpawn.IsFinite() || !float.IsFinite(FlyYaw) || !float.IsFinite(FlyPitch))
            throw new InvalidOperationException("The district has incomplete scene or placement settings.");
        Catalog.Index();
    }
}
