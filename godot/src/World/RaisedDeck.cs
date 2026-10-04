using System;
using Godot;

namespace Scheldemist.World;

/// <summary>A walkable union in a moving frame. Browser raised decks: floor height, bounded galleries and aisles.</summary>
public sealed class RaisedDeck
{
    public readonly record struct Area(float MinX, float MaxX, float MinZ, float MaxZ, float Y);
    public readonly Area[] Areas;
    public Transform3D Frame;
    public RaisedDeck(Area[] areas) => Areas = areas;
    public float Floor(float x, float z)
    {
        float top = float.NegativeInfinity;
        for (int i = 0; i < Areas.Length; i++)
        {
            var a = Areas[i];
            if (x >= a.MinX && x <= a.MaxX && z >= a.MinZ && z <= a.MaxZ) top = Math.Max(top, a.Y);
        }
        return top;
    }
    public bool Stand(float x, float z, float radius = .18f) => float.IsFinite(Floor(x, z)) && float.IsFinite(Floor(x + radius, z)) && float.IsFinite(Floor(x - radius, z)) && float.IsFinite(Floor(x, z + radius)) && float.IsFinite(Floor(x, z - radius));
    public Vector2 Walk(Vector2 from, Vector2 to)
    {
        if (Stand(to.X, to.Y)) return to;
        if (Stand(to.X, from.Y)) return new(to.X, from.Y);
        if (Stand(from.X, to.Y)) return new(from.X, to.Y);
        return from;
    }
    public Vector3 At(Vector2 local) => Frame * new Vector3(local.X, Floor(local.X, local.Y), local.Y);
}
