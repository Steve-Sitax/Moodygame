using System;
using Godot;
using Scheldemist.People;

namespace Scheldemist.Town;

public sealed partial class Crowd
{
    private static readonly StandardMaterial3D Wrapping = new() { AlbedoColor = new Color("c8bea4"), Roughness = .95f };
    private static readonly StandardMaterial3D Wicker = new() { AlbedoColor = new Color("7a6038"), Roughness = .95f };

    public void PuppetCarry(Puppet person, string? bought)
    {
        if (person.Bought == bought) return;
        person.BoughtNode?.QueueFree(); person.BoughtNode = null; person.Bought = bought;
        if (bought == null) return;
        Node3D item;
        if (bought == "sack" && Carried.Sack(.18f, .3f, .15f) is { } sack)
        { item = sack; item.Position = new(0, -.3f, 0); }
        else if (bought == "fish")
            item = new MeshInstance3D { Mesh = new CapsuleMesh { Radius = .055f, Height = .32f, RadialSegments = 12, Rings = 4, Material = Wrapping }, Rotation = new(0, 0, MathF.PI / 2), Position = new(0, -.04f, 0) };
        else if (bought == "basket")
        {
            var basket = new Node3D();
            basket.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = .17f, BottomRadius = .13f, Height = .18f, RadialSegments = 16, Material = Wicker }, Position = new(0, -.2f, 0) });
            basket.AddChild(new MeshInstance3D { Mesh = new TorusMesh { InnerRadius = .015f, OuterRadius = .03f, Rings = 12, RingSegments = 8, Material = Wicker }, Scale = new(4.6f, 1, 4.6f), Rotation = new(MathF.PI / 2, 0, 0), Position = new(0, -.1f, 0) });
            item = basket;
        }
        else item = new MeshInstance3D { Mesh = WrappedParcel(), Position = new(0, -.08f, 0) };
        var carried = new Node3D { Name = "purchase_" + bought }; carried.AddChild(item);
        person.Group.AddChild(carried); person.BoughtNode = carried;
    }

    private static ArrayMesh? parcel;
    // Folded paper has a small soft arris; the six faces meet through a 4 mm bevel.
    private static ArrayMesh WrappedParcel()
    {
        if (parcel != null) return parcel;
        const float radius = .004f;
        var half = new Vector3(.1f, .06f, .07f); var inner = half - Vector3.One * radius;
        using var surface = new SurfaceTool(); surface.Begin(Mesh.PrimitiveType.Triangles);
        void Triangle(Vector3 a, Vector3 b, Vector3 c, Vector3 outward)
        {
            if ((b - a).Cross(c - a).Dot(outward) > 0) (b, c) = (c, b);
            foreach (var point in new[] { a, b, c }) {
                var core = point.Clamp(-inner, inner); var normal = (point - core).Normalized();
                surface.SetNormal(normal); surface.AddVertex(core + normal * radius);
            }
        }
        for (int axis = 0; axis < 3; axis++) foreach (int sign in new[] { -1, 1 }) {
            int u = (axis + 1) % 3, v = (axis + 2) % 3;
            float[] us = { -half[u], -inner[u], inner[u], half[u] }, vs = { -half[v], -inner[v], inner[v], half[v] };
            var outward = Vector3.Zero; outward[axis] = sign;
            Vector3 Point(float x, float y) { var p = Vector3.Zero; p[axis] = sign * half[axis]; p[u] = x; p[v] = y; return p; }
            for (int x = 0; x < 3; x++) for (int y = 0; y < 3; y++) {
                var a = Point(us[x], vs[y]); var b = Point(us[x + 1], vs[y]); var c = Point(us[x + 1], vs[y + 1]); var d = Point(us[x], vs[y + 1]);
                Triangle(a, b, c, outward); Triangle(a, c, d, outward);
            }
        }
        surface.SetMaterial(Wrapping); return parcel = surface.Commit();
    }

    private static void PlaceBought(Puppet person)
    {
        if (person.BoughtNode is not { } item) return;
        var hand = person.Human.Hand(true);
        item.Position = hand.HasValue ? person.Group.ToLocal(hand.Value) : new(.24f, .9f, .03f);
    }
}
