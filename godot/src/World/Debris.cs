using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// What the great storm's gale tears loose round Jef (the browser's world/alive/gale.ts createDebris): slates and
/// shingles ripped off the roofs upwind, whirled down the street and smashing on the stones; washing and rags off the
/// lines, flapping high over the street; sheets of newspaper; hats bowling along; bundles of straw. More of it the
/// harder it blows. Boxes of each one's size and colour: one MultiMesh, one draw, the psx matt material made at load.
/// The ground under a piece is found once a metre square and kept.
/// </summary>
[GamePart(46)]
public partial class Debris : Node
{
    public static Debris? I { get; private set; }
    private const int N = 48;

    private enum Kind { Slate, Shingle, Cloth, Paper, Hat, Straw }
    /// <summary>gale.ts DEBRIS_KINDS: size (m), colours, how the air takes it, how heavy, how many of each.</summary>
    private static readonly (Kind kind, Vector3 size, int[] cols, float drag, float g, int n)[] Kinds =
    {
        (Kind.Slate, new(0.32f, 0.018f, 0.22f), new[] { 0x3c434c, 0x4a5058, 0x333a42 }, 0.5f, 1, 10),
        (Kind.Shingle, new(0.7f, 0.03f, 0.13f), new[] { 0x6b5238, 0x5a4530, 0x7a6448 }, 0.8f, 0.85f, 6),
        (Kind.Cloth, new(0.9f, 0.012f, 0.7f), new[] { 0xd8d4c8, 0xb8b2a4, 0x8c2a22, 0x46506a }, 2.4f, 0.25f, 9),
        (Kind.Paper, new(0.45f, 0.006f, 0.32f), new[] { 0xd0c8b0, 0xc4bca4 }, 3, 0.2f, 10),
        (Kind.Hat, new(0.3f, 0.14f, 0.3f), new[] { 0x1c1a18, 0x3a3228 }, 1.4f, 0.7f, 5),
        (Kind.Straw, new(0.45f, 0.12f, 0.12f), new[] { 0xc4a85a, 0xb09448 }, 1.2f, 0.6f, 8),
    };

    private struct Bit { public int K; public Vector3 P, V, Rot, Spin; public bool Live; public float Rest, Ph; }
    private readonly Bit[] bits = new Bit[N];
    private MultiMesh mm = null!;
    private MultiMeshInstance3D node = null!;
    private readonly RandomNumberGenerator rng = new() { Seed = 1873 };
    private readonly Dictionary<long, float> ground = new();
    private int flying, smashed;

    /// <summary>For a check: the pieces in the air now, the slates smashed so far.</summary>
    public (int flying, int smashed) Info => (flying, smashed);

    public override void _Ready()
    {
        I = this;
        ProcessPriority = 60;
        var kind = new Psx.Kind(Unlit: false, Blend: false, Scissor: false, TwoSided: false, DepthWrite: true, Snap: true, Atlas: 0, VertexColor: true, Add: false, Fog: true);
        var mat = BakedWorld.PsxMaterial(new StandardMaterial3D { AlbedoColor = Colors.White, ResourceName = "storm_debris" }, kind, 0, 1);
        mm = new MultiMesh { TransformFormat = MultiMesh.TransformFormatEnum.Transform3D, UseColors = true, Mesh = new BoxMesh { Size = Vector3.One }, InstanceCount = N };
        int i = 0;
        for (int k = 0; k < Kinds.Length; k++)
            for (int j = 0; j < Kinds[k].n && i < N; j++, i++)
            {
                bits[i] = new Bit { K = k, Ph = rng.Randf() * 10 };
                mm.SetInstanceColor(i, Psx.Hex(Kinds[k].cols[j % Kinds[k].cols.Length]));
                mm.SetInstanceTransform(i, new Transform3D(Basis.Identity.Scaled(Vector3.Zero), Vector3.Zero));
            }
        mm.CustomAabb = new Aabb(new Vector3(-3000, -100, -3000), new Vector3(6000, 600, 6000));
        node = new MultiMeshInstance3D { Name = "alive_debris_live", Multimesh = mm, MaterialOverride = mat, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off, Layers = Mirrors.NoMirror, Visible = false };
        Main.I.View.AddChild(node);
        Main.I.World.Unported.Remove("alive_debris");
    }

    /// <summary>The ground at a place (a ray down, kept for its metre square).</summary>
    private float GroundAt(float x, float z, float from)
    {
        long key = ((long)MathF.Floor(x) << 32) ^ (uint)(int)MathF.Floor(z);
        if (ground.TryGetValue(key, out float y)) return y;
        var hit = Main.I.View.FindWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(x, from + 30, z), new Vector3(x, from - 40, z), Solid.Layer));
        y = hit.Count > 0 ? hit["position"].AsVector3().Y : float.NaN;
        ground[key] = y;
        return y;
    }

    /// <summary>Upwind of Jef: off a roof (slates, shingles, washing), or out of a street (the rest).</summary>
    private void Launch(ref Bit b, Vector3 eye, bool anywhere)
    {
        var dir = Air.Base.LengthSquared() > 1e-6f ? Air.Base.Normalized() : new Vector2(1, 0);
        var kind = Kinds[b.K].kind;
        for (int t = 0; t < 5; t++)
        {
            float along = anywhere ? (rng.Randf() * 2 - 1) * 30 : -(18 + rng.Randf() * 16);
            float across = (rng.Randf() * 2 - 1) * 22;
            float x = eye.X + dir.X * along - dir.Y * across, z = eye.Z + dir.Y * along + dir.X * across;
            int fl = Ways.Flags(x, z);
            if ((fl & (Ways.Water | Ways.Outside)) != 0) continue;
            bool roof = kind is Kind.Slate or Kind.Shingle || (kind == Kind.Cloth && rng.Randf() < 0.5f);
            if (roof != ((fl & Ways.Wall) != 0)) continue;
            float y0 = GroundAt(x, z, eye.Y);
            if (float.IsNaN(y0)) continue;
            b.P = new Vector3(x, roof ? y0 + 8 + rng.Randf() * 5 : kind is Kind.Hat or Kind.Straw ? y0 + 0.2f : y0 + 0.5f + rng.Randf() * 4, z);
            var w = Air.WindAt(x, z);
            b.V = new Vector3(w.X * 0.6f, roof ? 2 + rng.Randf() * 3 : 1, w.Y * 0.6f);
            b.Spin = new Vector3((rng.Randf() - 0.5f) * 16, (rng.Randf() - 0.5f) * 16, (rng.Randf() - 0.5f) * 16);
            b.Live = true;
            b.Rest = 0;
            return;
        }
    }

    private void Hide(int i) => mm.SetInstanceTransform(i, new Transform3D(Basis.Identity.Scaled(Vector3.Zero), Vector3.Zero));

    public override void _Process(double delta)
    {
        float fury = Air.Fury;
        int want = (int)MathF.Round(N * Math.Min(1, fury * 1.1f));
        if (want == 0 && flying == 0)
        {
            if (node.Visible) node.Visible = false;
            return;
        }
        float dt = Math.Min((float)delta, 0.05f);
        var eye = Main.I.Cam.GlobalPosition;
        int was = flying;
        flying = 0;
        for (int i = 0; i < N; i++)
        {
            ref var b = ref bits[i];
            var k = Kinds[b.K];
            // (every kind gets its share as it grows: the list's order is mixed by the index)
            if ((i * 29) % N >= want)
            {
                if (b.Live) { b.Live = false; Hide(i); }
                continue;
            }
            if (!b.Live || b.P.DistanceTo(eye) > 48 || b.Rest > 5) Launch(ref b, eye, !b.Live && was < want / 2);
            if (!b.Live)
            {
                Hide(i);
                continue;
            }
            var w = Air.WindAt(b.P.X, b.P.Z);
            float gust = Air.Gusts.At(b.P.X, b.P.Z);
            float gy = GroundAt(b.P.X, b.P.Z, b.P.Y);
            if (float.IsNaN(gy)) gy = b.P.Y - 1;
            float carry = Math.Min(1, 0.35f + 0.25f * gust);
            b.V.X += (Math.Min(26, w.X * carry) - b.V.X) * Math.Min(1, dt * k.drag);
            b.V.Z += (Math.Min(26, w.Y * carry) - b.V.Z) * Math.Min(1, dt * k.drag);
            b.Ph += dt;
            // light things ride the eddies up and down; heavy ones fall
            float lift = (MathF.Sin(b.Ph * 2.1f + i) * 2.5f + MathF.Sin(b.Ph * 4.7f + i * 2) * 1.2f) * (1 - k.g) * (0.6f + 0.3f * gust);
            b.V.Y = Math.Max(b.V.Y + (lift - 9.8f * k.g * 0.6f) * dt, -14);
            float nx = b.P.X + b.V.X * dt, nz = b.P.Z + b.V.Z * dt;
            if ((Ways.Flags(nx, nz) & Ways.Wall) != 0 && b.P.Y < gy + 9)
            {
                // into a house front: it slaps the wall and drops
                b.V.X *= -0.2f;
                b.V.Z *= -0.2f;
                b.V.Y = Math.Min(b.V.Y, 0);
            }
            else
            {
                b.P.X = nx;
                b.P.Z = nz;
            }
            b.P.Y += b.V.Y * dt;
            float floor = gy + k.size.Y * 0.5f;
            if (b.P.Y < floor)
            {
                b.P.Y = floor;
                if (k.kind == Kind.Slate && b.V.Y < -4)
                {
                    // a slate smashes on the stones: gone, with its crash
                    Audio.Soundscape.I?.Placed(new Vector3(b.P.X, gy + 0.2f, b.P.Z), new Audio.PlacedOpts(3, 40, 70, Wet: 0.3), Audio.AliveSounds.SlateCrash(), "slate crash");
                    smashed++;
                    b.Live = false;
                    Hide(i);
                    continue;
                }
                // along the ground: a hat bowls on, the rest skid and lie until a gust takes them again
                b.V.Y = gust > 1 && k.kind != Kind.Slate ? 2 + rng.Randf() * 3 : 0;
                float fr = k.kind == Kind.Hat ? 0.4f : 2.5f;
                b.V.X *= Math.Max(0, 1 - dt * fr);
                b.V.Z *= Math.Max(0, 1 - dt * fr);
                if (new Vector2(b.V.X, b.V.Z).Length() < 0.3f) b.Rest += dt;
                b.Spin *= Math.Max(0, 1 - dt * 3);
            }
            b.Rot += b.Spin * dt;
            // washing and paper flap as they go
            float flap = k.kind is Kind.Cloth or Kind.Paper ? MathF.Sin(b.Ph * 14 + i) * 0.5f : 0;
            var basis = Basis.FromEuler(new Vector3(b.Rot.X + flap, b.Rot.Y, b.Rot.Z + flap * 0.6f)) * Basis.FromScale(k.size);
            mm.SetInstanceTransform(i, new Transform3D(basis, b.P));
            flying++;
        }
        bool show = flying > 0;
        if (node.Visible != show) node.Visible = show;
    }
}
