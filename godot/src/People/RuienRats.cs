using System;
using Godot;

namespace Scheldemist.People;

/// <summary>One rat per surveyed dry ledge. Both ordinary patrols and startled runs follow the same floor.</summary>
internal sealed class RuienRats
{
    private sealed class Rat
    {
        internal readonly RuienRatSites.Site Site;
        internal readonly float Length, Seed, Size, Speed;
        internal float Travel, Goal, Rest, Yaw;
        internal float StrideDistance;
        internal bool Startled;

        internal Rat(RuienRatSites.Site site)
        {
            Site = site;
            Length = site.A.DistanceTo(site.B);
            Seed = (float)NativeCourtyardRules.H01(site.Id);
            Size = .91f + .15f * Seed;
            Speed = .38f + .24f * Seed;
            Travel = Length * (.2f + .6f * Seed);
            Goal = Seed < .5f ? 0 : Length;
            Yaw = Heading();
        }

        internal Vector3 Feet => Site.A.Lerp(Site.B, Travel / Length);

        private float Heading()
        {
            var dir = Goal == 0 ? Site.A - Site.B : Site.B - Site.A;
            return Mathf.Atan2(dir.X, dir.Z);
        }

        internal void Draw(SmallLifeKit.Batch batch, Vector3 eye, float dt, double time)
        {
            if (eye.DistanceSquaredTo(Feet) > 27f * 27f) return;
            var offset = eye - Feet;
            float planar = offset.X * offset.X + offset.Z * offset.Z;
            bool near = MathF.Abs(offset.Y) < 2.2f && planar < (Startled ? 3.2f * 3.2f : 2.4f * 2.4f);
            if (near)
            {
                float a = eye.DistanceTo(Site.A), b = eye.DistanceTo(Site.B);
                if (!Startled || MathF.Abs(a - b) > .55f) Goal = a > b ? 0 : Length;
                Rest = 0;
            }
            else if (Travel == Goal)
            {
                if (Rest <= 0) Rest = .65f + 1.2f * Seed + (Goal == 0 ? .6f : 0);
                Rest -= dt;
                if (Rest <= 0) Goal = Goal == 0 ? Length : 0;
            }
            Startled = near;
            float heading = Heading();
            Yaw = Mathf.RotateToward(Yaw, heading, dt * (near ? 14f : 9f));
            float before = Travel;
            if (MathF.Abs(Mathf.AngleDifference(Yaw, heading)) < .25f)
                Travel = Mathf.MoveToward(Travel, Goal, (near ? 1.15f : Speed) * dt);
            float step = MathF.Abs(Travel - before);
            StrideDistance += step;
            string motion = step > 0 ? "scurry" : "idle";
            double phase = step > 0
                ? StrideDistance / (batch.Stride("rat", motion) * Size)
                : time / batch.Seconds("rat", motion) + Seed;
            var basis = Basis.FromEuler(new Vector3(0, Yaw, 0)).Scaled(Vector3.One * Size);
            batch.Put("rat", motion, phase, new Transform3D(basis, Feet));
        }
    }

    private readonly SmallLifeKit.Batch batch;
    private readonly Rat[] rats = Array.ConvertAll(RuienRatSites.All, site => new Rat(site));

    internal Vector3? ColonyCentre => colony.Centre;
    private readonly DrainRatColony colony;
    internal RuienRats(Node parent)
    {
        batch = SmallLifeKit.Batch.RuienRats(parent, rats.Length + DrainRatColony.Count);
        colony = new DrainRatColony(batch.Root);
    }

    internal void Draw(Vector3 eye, float dt, double time)
    {
        batch.Begin();
        if (batch.Root.GetViewport().GetCamera3D() is {} camera) colony.Draw(batch,camera,eye,dt,Time.GetTicksMsec()/1000.0);
        foreach (var rat in rats) rat.Draw(batch, eye, dt, time);
        batch.End();
    }

    internal void Hide()
    {
        colony.Hide();
        if (batch.Count == 0) return;
        batch.Begin();
        batch.End();
    }

    internal void Free() => batch.Root.QueueFree();
}
