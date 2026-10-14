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
    [Export] public string EditorScenePath {get;set;}="";
    [Export] public AuthorCatalog Catalog { get; set; } = null!;
    [Export] public Rect2 Bounds { get; set; } = new(-19.8f, -15.8f, 39.6f, 31.6f);
    [Export] public Vector3 WalkSpawn { get; set; } = new(0, 0.02f, 8);
    [Export] public Vector3 FlySpawn { get; set; } = new(4, 5, 10);
    [Export] public float FlyYaw { get; set; }
    [Export] public float FlyPitch { get; set; } = -0.35f;
    [Export] public string RoomId { get; set; } = "";
    [Export] public Transform3D RoomFrame { get; set; } = Transform3D.Identity;
    [Export] public Rect2 RoomBounds { get; set; }
    [Export] public float RoomHeight { get; set; } = 3;
    [Export] public Vector3[] EntryPoints { get; set; } = System.Array.Empty<Vector3>();
    [Export] public int[] ReplacedMeshes { get; set; } = System.Array.Empty<int>();
    [Export] public PackedScene? RetainedStructure { get; set; }

    public void Validate()
    {
        if (!LayoutDocument.ValidId(Id) || Scene == null || !Scene.CanInstantiate() || Catalog == null
            || !Bounds.Position.IsFinite() || !Bounds.Size.IsFinite() || Bounds.Size.X <= 0 || Bounds.Size.Y <= 0
            || !WalkSpawn.IsFinite() || !FlySpawn.IsFinite() || !float.IsFinite(FlyYaw) || !float.IsFinite(FlyPitch))
            throw new InvalidOperationException("The district has incomplete scene or placement settings.");
        Catalog.Index();
        if(RoomId!="" && (!LayoutDocument.ValidId(RoomId) || !RoomFrame.Origin.IsFinite()
            || !RoomFrame.Basis.X.IsFinite() || !RoomFrame.Basis.Y.IsFinite() || !RoomFrame.Basis.Z.IsFinite()
            || Math.Abs(RoomFrame.Basis.Determinant())<.01f || !RoomBounds.Position.IsFinite() || !RoomBounds.Size.IsFinite()
            || RoomBounds.Size.X<=0 || RoomBounds.Size.Y<=0 || !float.IsFinite(RoomHeight) || RoomHeight<=0
            || RetainedStructure==null || !RetainedStructure.CanInstantiate() || System.Array.Exists(EntryPoints,p=>!p.IsFinite())
            || System.Array.Exists(ReplacedMeshes,i=>i<0)))
            throw new InvalidOperationException("The interior has invalid room, floor or source replacement settings.");
    }
}
