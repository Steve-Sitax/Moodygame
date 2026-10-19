using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Play;
using Scheldemist.Player;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The ways between the street and the Ruien (docs/ruien-native.md): E at a grate in the street lifts it and climbs
/// down its shaft's ladder onto the ledge; E at the ladder's foot climbs up and out beside the grate. The same climb as
/// the quay ladders (hand over hand, Jef.ClimbTo). A grate is walked over (a thin solid lid on it); a hatch over a stair
/// stands open, its stair is walked. Not with goods in hand. Every area's ways come from its markers.
/// </summary>
[GamePart(923)]
public partial class RuienWays : Node
{
    private readonly List<(RuienData.Way w, Vector2 off, Vector3 stand)> ladders = new();
    private readonly List<RuienData.Way> rungs = new();

    public override void _Ready()
    {
        if (Ruien.I == null) return;
        foreach (var a in Ruien.I.Data.Areas)
            foreach (var w in a.Ways)
            {
                if (w.Kind == "rungs") rungs.Add(w);
                if(w.Kind=="grate")
                {
                    var lid=new StaticBody3D{Name="ruien_grate_"+w.Id,CollisionLayer=Solid.Layer,CollisionMask=0,Position=w.Top-Vector3.Up*.02f};
                    lid.AddChild(new CollisionShape3D{Shape=new BoxShape3D{Size=new Vector3(w.Hole.Size.X+.06f,.06f,w.Hole.Size.Y+.06f)}});
                    Main.I.View.AddChild(lid);
                }
                if (w.Kind != "ladder") continue;
                // where he steps out on the street: beside the grate, on the side away from the ladder's foot
                var side = new Vector2(w.Top.X - w.Bottom.X, w.Top.Z - w.Bottom.Z);
                side = side.LengthSquared() > 1e-4f ? side.Normalized() : new Vector2(1, 0);
                // where he stands at its foot: half a metre out from the rungs, toward the gallery's middle (the ladder's
                // own solid box stands round the rungs)
                var mid = a.Zones.Where(z => z.Kind == "line").SelectMany(z => z.Path).OrderBy(q => q.DistanceSquaredTo(new Vector2(w.Bottom.X, w.Bottom.Z))).FirstOrDefault();
                var toMid = (mid - new Vector2(w.Bottom.X, w.Bottom.Z));
                toMid = toMid.LengthSquared() > 1e-4f ? toMid.Normalized() : new Vector2(-1, 0);
                var stand = w.Bottom + new Vector3(toMid.X, 0, toMid.Y) * 0.55f;
                ladders.Add((w, side * (w.Hole.Size.X / 2 + 0.55f), stand));
                // the grate's lid: solid to walk over
                var body = new StaticBody3D { Name = "ruien_grate_" + w.Id, CollisionLayer = Solid.Layer, CollisionMask = 0, Position = new Vector3(w.Top.X, w.Top.Y - 0.03f, w.Top.Z) };
                body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(w.Hole.Size.X + 0.04f, 0.06f, w.Hole.Size.Y + 0.04f) } });
                Main.I.View.AddChild(body);
            }
        Interact.I.AddProvider(Keys);
    }

    private Offers? Keys(float x, float z)
    {
        var j = Jef.I;
        if (j == null || (!j.Grounded && !j.Swimming) || j.Climbing || j.Riding || j.Fly || j.Laden || j.Frozen) return null;
        foreach (var w in rungs)
        {
            var at = new Vector2(x, z);
            if ((j.Swimming || MathF.Abs(j.Y - w.Bottom.Y) < 0.5f) && j.Y < w.Top.Y && at.DistanceTo(new Vector2(w.Bottom.X, w.Bottom.Z)) < 1.0f)
                return new Offers { Options = new() { (0.5f, Act.At(Key.E, w.Irons ? "climb onto the ledge" : "climb up onto the sill", new Vector3(w.Wall.X, w.Bottom.Y + 1.4f, w.Wall.Y), () => RungsUp(w))) } };
            if (MathF.Abs(j.Y - w.Top.Y) < 0.35f && at.DistanceTo(new Vector2(w.Top.X, w.Top.Z)) < 0.9f)
                return new Offers { Options = new() { (0.5f, Act.At(Key.E, w.Irons ? "climb down into the channel" : "climb down into the channel", new Vector3(w.Wall.X, w.Top.Y + 0.4f, w.Wall.Y), () => RungsDown(w))) } };
        }
        if (j.Swimming) return null;
        foreach (var (w, off, stand) in ladders)
        {
            var top = new Vector2(w.Top.X, w.Top.Z);
            var foot = new Vector2(stand.X, stand.Z);
            var at = new Vector2(x, z);
            if (MathF.Abs(j.Y - w.Top.Y) < 0.35f && at.DistanceTo(top) < 1.1f)
                return new Offers { Options = new() { (at.DistanceTo(top), Act.At(Key.E, "lift the grate and climb down", w.Top + Vector3.Up * 0.4f, () => Down(w, stand))) } };
            if (MathF.Abs(j.Y - w.Bottom.Y) < 0.35f && at.DistanceTo(foot) < 1.0f)
                return new Offers { Options = new() { (at.DistanceTo(foot), Act.At(Key.E, "climb up to the street", w.Bottom + Vector3.Up * 1.4f, () => Up(w, off, stand))) } };
        }
        return null;
    }

    private const float Rise = 0.75f; // m a second up or down the rungs

    // up the step irons out of the channel, over the coping onto the ledge; and back down
    public static void RungsUp(RuienData.Way w)
    {
        var o = new Vector3(w.Out.X, 0, w.Out.Y);
        float start = Math.Max(w.Bottom.Y, Jef.I.Y);
        var foot = new Vector3(w.Wall.X, start, w.Wall.Y) + o * 0.42f;
        var keys = new List<(Vector3, float)>
        {
            (foot + Vector3.Up * 0.2f, 0.4f),
            (new Vector3(foot.X, w.Top.Y - 0.45f, foot.Z), Math.Max(0.2f, (w.Top.Y - start - 0.65f) / Rise)),
            (new Vector3(w.Wall.X, w.Top.Y + 0.2f, w.Wall.Y) - o * 0.25f, 0.6f),
            (w.Top, 0.5f),
        };
        Jef.I.ClimbTo(keys, null, null, Vector3.Zero, default, 1);
    }

    public static void RungsDown(RuienData.Way w)
    {
        var o = new Vector3(w.Out.X, 0, w.Out.Y);
        float bottom = Math.Max(w.Bottom.Y, Water.Level(w.Bottom.X, w.Bottom.Z) - Jef.SwimFeet);
        var foot = new Vector3(w.Wall.X, bottom, w.Wall.Y) + o * 0.42f;
        var keys = new List<(Vector3, float)>
        {
            (new Vector3(w.Wall.X, w.Top.Y + 0.2f, w.Wall.Y) - o * 0.25f, 0.5f),
            (new Vector3(foot.X, w.Top.Y - 0.45f, foot.Z), 0.6f),
            (foot + Vector3.Up * 0.2f, Math.Max(0.2f, (w.Top.Y - bottom - 0.65f) / Rise)),
            (new Vector3(w.Bottom.X, bottom, w.Bottom.Z), 0.4f),
        };
        Jef.I.ClimbTo(keys, null, null, Vector3.Zero, default, 1);
    }

    private static void Down(RuienData.Way w, Vector3 stand)
    {
        var j = Jef.I;
        var keys = new List<(Vector3, float)>
        {
            (new Vector3(w.Top.X, w.Top.Y + 0.05f, w.Top.Z), 0.5f),
            (new Vector3(w.Top.X, w.Top.Y - 0.8f, w.Top.Z), 0.7f),
            (new Vector3(w.Bottom.X, w.Bottom.Y + 0.25f, w.Bottom.Z), (w.Top.Y - w.Bottom.Y) / Rise),
            (stand, 0.5f),
        };
        j.ClimbTo(keys, null, null, Vector3.Zero, default, 1);
    }

    private static void Up(RuienData.Way w, Vector2 off, Vector3 stand)
    {
        var j = Jef.I;
        var outAt = new Vector3(w.Top.X + off.X, w.Top.Y, w.Top.Z + off.Y);
        var keys = new List<(Vector3, float)>
        {
            (new Vector3(w.Bottom.X, w.Bottom.Y + 0.2f, w.Bottom.Z), 0.4f),
            (new Vector3(w.Top.X, w.Top.Y - 0.9f, w.Top.Z), (w.Top.Y - 0.9f - w.Bottom.Y) / Rise),
            (new Vector3(w.Top.X, w.Top.Y + 0.25f, w.Top.Z), 0.8f),
            (outAt, 0.5f),
        };
        j.ClimbTo(keys, null, null, Vector3.Zero, default, 1);
    }
}
