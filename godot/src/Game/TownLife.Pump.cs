using System;
using Godot;
using Scheldemist.Play;
using Scheldemist.Net;
using Scheldemist.Town;

namespace Scheldemist.Game;

public partial class TownLife
{
    public int PumpWheels { get { int n = 0; foreach (var f in fires) n += f.Wheels.Count; return n; } }
    public int PumpBrakes { get { int n = 0; foreach (var f in fires) n += f.Brakes.Count; return n; } }
    public int HoseTriangles { get { int n = 0; foreach (var f in fires) if (f.Hose?.Mesh is { } mesh) n += mesh.GetFaces().Length / 3; return n; } }
    // pumpcart.ts: the same carriage, wheel sizes, handles, hose reel and delivery branch.
    private static Node3D MakePump(FireLive f)
    {
        var r = new Node3D { Name = "fire_pump" };
        void Box(float w, float h, float d, float x, float y, float z, uint colour) => EventProps.Box(r, new Vector3(w, h, d), new Vector3(x, y, z), colour);
        Box(1, .1f, 2.5f, 0, .72f, 0, 0x6a4a2c);
        foreach (var spec in new[] { (-.62f, -.8f, .5f), (.62f, -.8f, .5f), (-.58f, .85f, .38f), (.58f, .85f, .38f) })
        {
            var (x, z, radius) = spec; var wheel = new Node3D { Position = new Vector3(x, radius, z) }; r.AddChild(wheel); f.Wheels.Add((wheel, radius));
            wheel.AddChild(new MeshInstance3D { Mesh = new TorusMesh { InnerRadius = radius - .035f, OuterRadius = radius + .035f, Rings = 14, RingSegments = 4, Material = Goods.I.Plain(0x2c2c2e) }, Rotation = new Vector3(0, 0, MathF.PI / 2) });
            LeadLooks.Cylinder(wheel, .07f, .07f, .16f, 0x6a4a2c, 0, 0, 0).Rotation = new Vector3(0, 0, MathF.PI / 2);
            for (int i = 0; i < 6; i++) EventProps.Box(wheel, new Vector3(.03f, radius * 2, .03f), Vector3.Zero, 0x6a4a2c).Rotation = new Vector3(i * MathF.PI / 6, 0, 0);
        }
        Box(.8f, .62f, 1.05f, 0, 1.08f, -.1f, 0xb03a2c);
        LeadLooks.Cylinder(r, .13f, .13f, .62f, 0xd8aa48, 0, 1.62f, -.1f);
        r.AddChild(new MeshInstance3D { Mesh = new SphereMesh { Radius = .13f, Height = .26f, RadialSegments = 10, Rings = 5, IsHemisphere = true, Material = Goods.I.Plain(0xd8aa48) }, Position = new Vector3(0, 1.93f, -.1f) });
        LeadLooks.Cylinder(r, .04f, .04f, .3f, 0xd8aa48, .45f, 1, -.4f).Rotation = new Vector3(0, 0, MathF.PI / 2);
        foreach (float side in new[] { -1f, 1f })
        {
            var brake = new Node3D { Position = new Vector3(side * .62f, 1.42f, -.1f) }; r.AddChild(brake); f.Brakes.Add(brake);
            EventProps.Box(brake, new Vector3(.06f, .06f, 2.9f), Vector3.Zero, 0x6a4a2c);
            foreach (float z in new[] { -1.4f, 1.4f }) EventProps.Box(brake, new Vector3(.05f, .05f, .05f), new Vector3(0, 0, z), 0x2c2c2e);
        }
        Box(1.3f, .06f, .06f, 0, 1.42f, -.1f, 0x2c2c2e);
        LeadLooks.Cylinder(r, .22f, .22f, .7f, 0x4a3222, 0, 1.02f, -1.15f).Rotation = new Vector3(0, 0, MathF.PI / 2);
        foreach (float x in new[] { -.37f, .37f }) LeadLooks.Cylinder(r, .3f, .3f, .04f, 0x6a4a2c, x, 1.02f, -1.15f).Rotation = new Vector3(0, 0, MathF.PI / 2);
        var pole = EventProps.Box(r, new Vector3(.07f, .07f, new Vector2(.61f, 3.6f).Length()), new Vector3(0, 1.025f, 2.95f), 0x6a4a2c); pole.Rotation = new Vector3(-MathF.Atan2(.61f, 3.6f), 0, 0);
        Box(1.3f, .06f, .06f, 0, .72f, 2, 0x6a4a2c);
        Box(.04f, .9f, .04f, .42f, 1.2f, .55f, 0x2c2c2e);
        Box(.2f, .26f, .2f, .42f, 1.72f, .55f, 0xffc27a);
        Box(.26f, .05f, .26f, .42f, 1.87f, .55f, 0x2c2c2e);
        return r;
    }
    private static MeshInstance3D MakeHose(Node3D pump, FireView v, WalkMap walk)
    {
        var a = pump.ToGlobal(new Vector3(.6f, .9f, -.4f));
        var b = new Vector3((float)(v.Step[0] + v.Out[0] * .4), (float)walk.BaseAt(v.Step[0], v.Step[1]) + .08f, (float)(v.Step[1] + v.Out[1] * .4));
        var points = new[] { a, new Vector3(a.X, pump.Position.Y + .1f, a.Z), new Vector3((a.X + b.X) / 2, b.Y, (a.Z + b.Z) / 2), b };
        // Three.js's default centripetal Catmull-Rom, including extrapolated endpoints.
        Vector3 Curve(float at)
        {
            float u = at * 3; int i = Math.Min(2, (int)u); float t = u - i;
            var p1 = points[i]; var p2 = points[i + 1]; var p0 = i == 0 ? 2 * p1 - p2 : points[i - 1]; var p3 = i == 2 ? 2 * p2 - p1 : points[i + 2];
            float t0 = 0, t1 = MathF.Sqrt(p0.DistanceTo(p1)), t2 = t1 + MathF.Sqrt(p1.DistanceTo(p2)), t3 = t2 + MathF.Sqrt(p2.DistanceTo(p3));
            float q = Mathf.Lerp(t1, t2, t);
            Vector3 Lerp(Vector3 x, Vector3 y, float xT, float yT) => x * ((yT - q) / (yT - xT)) + y * ((q - xT) / (yT - xT));
            var a1 = Lerp(p0, p1, t0, t1); var a2 = Lerp(p1, p2, t1, t2); var a3 = Lerp(p2, p3, t2, t3);
            return Lerp(Lerp(a1, a2, t0, t2), Lerp(a2, a3, t1, t3), t1, t2);
        }
        var mesh = new SurfaceTool(); mesh.Begin(Mesh.PrimitiveType.Triangles); mesh.SetMaterial(Goods.I.Plain(0x4a3222));
        Vector3 Ring(int i, int side)
        {
            float t = i / 16f; var centre = Curve(t); var tangent = (Curve(Math.Min(1, t + .001f)) - Curve(Math.Max(0, t - .001f))).Normalized();
            var across = tangent.Cross(Vector3.Up).Normalized(); if (across.LengthSquared() < .01f) across = Vector3.Right;
            var up = across.Cross(tangent).Normalized(); float angle = side * MathF.Tau / 4;
            return centre + (across * MathF.Cos(angle) + up * MathF.Sin(angle)) * .035f;
        }
        for (int i = 0; i < 16; i++) for (int side = 0; side < 4; side++)
        {
            var p = Ring(i, side); var q = Ring(i + 1, side); var r = Ring(i + 1, side + 1); var s = Ring(i, side + 1);
            mesh.AddVertex(p); mesh.AddVertex(q); mesh.AddVertex(r); mesh.AddVertex(p); mesh.AddVertex(r); mesh.AddVertex(s);
        }
        mesh.GenerateNormals(); var hose = new MeshInstance3D { Name = "pump_hose", Mesh = mesh.Commit() }; Main.I.View.AddChild(hose); return hose;
    }
}
