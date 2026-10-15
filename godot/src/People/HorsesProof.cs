using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.Models;
using Scheldemist.Movers;

namespace Scheldemist.People;

/// <summary>
/// Pictures of the horse of horse.scn in the native town (--horses-captures dir, inside the animals' captures run):
/// a standing test horse (the same parts and code as every horse) at 1 m and 3 m from the front, the side, behind and
/// low in front of the chest, in each coat, at 13:00 clear, 13:00 rain and 19:30 under the lamps; a dray pulled at the
/// walk and at the trot down the street (a strip each, the camera beside it); a real omnibus followed at the walk and
/// the trot; the Rijnkaai's waiting dray horse and the farrier's horse where they stand.
/// </summary>
internal sealed class HorsesProof
{
    private readonly AnimalsProof proof;
    private readonly string dir;
    private readonly List<object> pictures;

    public HorsesProof(AnimalsProof proof, string dir, List<object> pictures)
    {
        this.proof = proof;
        this.dir = dir;
        this.pictures = pictures;
    }

    /// <summary>A horse standing on its own (a node rig of the model's parts), posed each time it is shown.</summary>
    private sealed class TestHorse
    {
        public readonly Node3D Root = new() { Name = "test_horse" };
        private readonly MeshInstance3D body = new() { Name = "horse_body" };
        private readonly MeshInstance3D[] legs = new MeshInstance3D[8];
        private readonly HorseNodes? parts;
        private readonly HorseGait.Pose pose = new();

        public TestHorse(Node parent, string coat)
        {
            parent.AddChild(Root);
            Root.AddChild(body);
            for (int k = 0; k < 8; k++) { legs[k] = new MeshInstance3D { Name = "horse_leg" + k }; Root.AddChild(legs[k]); }
            parts = HorseNodes.Make(body, legs, coat, false, 500);
        }

        public bool Ok => parts != null;

        public void Pose(float gait, float amp, bool trot, double t)
        {
            HorseGait.PoseAt(pose, gait, amp, trot ? 1 : 0);
            HorseGait.Life(pose, gait, amp, trot ? 1 : 0, t, 500);
            body.Transform = new Transform3D(Basis.Identity, new Vector3(0, pose.Bob, 0));
            for (int k = 0; k < 4; k++)
            {
                var l = pose.Legs[k];
                legs[k * 2].Transform = new Transform3D(new Basis(Vector3.Right, l.Up), new Vector3(l.X, l.Uy, l.Uz));
                legs[k * 2 + 1].Transform = new Transform3D(new Basis(Vector3.Right, l.Lp), new Vector3(l.X, l.Ly, l.Lz));
            }
            parts?.Set(pose);
        }
    }

    /// <summary>A dray of the props' parts drawn by a DrayHorse (the goods drays' and led drays' code), moved by the proof.</summary>
    private sealed class TestDray
    {
        public readonly Node3D Root = new() { Name = "test_dray" };
        private readonly Node3D? bed, fore, rear, front, load;
        public readonly DrayHorse? Horse;
        private float rollR, rollF;

        public TestDray(Node parent)
        {
            parent.AddChild(Root);
            var props = ModelLibrary.Get("props", new ModelLibrary.Look(TwoSided: true));
            Node3D? Part(string n) { var p = props?.Copy(n); if (p != null) Root.AddChild(p); return p; }
            bed = Part("tr_dray_bed"); fore = Part("tr_dray_fore"); rear = Part("tr_wheels_rear"); front = Part("tr_wheels_front"); load = Part("tr_load_sacks");
            var body = Part("tr_horse_body");
            var legs = new List<Node3D>();
            foreach (string n in new[] { "tr_leg_front", "tr_leg_front", "tr_leg_hind", "tr_leg_hind" }) { var up = Part(n); var lo = Part(n + "_lo"); if (up != null && lo != null) { legs.Add(up); legs.Add(lo); } }
            if (body != null && legs.Count == 8) Horse = new DrayHorse(body, legs.ToArray(), "bay");
        }

        /// <summary>The horse's middle at `head`, the dray behind it along -dir; `gone` metres covered (for the wheels and the gait).</summary>
        public void Place(Vector3 head, Vector3 dir, float gone, float amp, bool trot, float y)
        {
            float yaw = MathF.Atan2(dir.X, dir.Z);
            var h = new Vector2(head.X, head.Z);
            var d = new Vector2(dir.X, dir.Z);
            var b = h - d * 2.05f;
            var a = h - d * 4.45f;
            Root.Position = new Vector3(0, y, 0);
            rollR = gone / 0.52f; rollF = gone / 0.42f;
            void Put(Node3D? n, Vector2 at, float yy, float pitch = 0) { if (n != null) DrayHorse.Put(n, at, yy, yaw, pitch); }
            Put(bed, a, 0); Put(load, a, 0); Put(fore, b, 0); Put(rear, a, 0.52f, rollR); Put(front, b, 0.42f, rollF);
            float gait = trot ? gone / HorseGait.TrotStride % 1 : gone / 1.35f % 1;
            Horse?.Set(h, yaw, gait, amp, trot);
        }
    }

    private async System.Threading.Tasks.Task Frame() => await proof.ToSignal(proof.GetTree(), SceneTree.SignalName.ProcessFrame);

    private async System.Threading.Tasks.Task Shoot(string name, Vector3 from, Vector3 at, double hour, string weather, int settle = 8)
    {
        Main.I.Cam.LookAtFromPosition(from, at);
        if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
        for (int i = 0; i < settle; i++) await Frame();
        Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
        var daylight = World.Daylight.I;
        pictures.Add(new { name = name + ".png", hour = daylight.Hour, weather = daylight.Weather, daylight.Night });
    }

    public async System.Threading.Tasks.Task<object> Run(Town.Townspeople town, (Vector3 spot, Vector3 face) byDay, (Vector3 spot, Vector3 face) byLamp, Vector3 streetFrom, Vector3 streetDir)
    {
        var report = new Dictionary<string, object>();
        if (!HorseModel.Ready) { report["ready"] = false; return report; }
        report["ready"] = true;
        report["pictureMB"] = Math.Round(HorseModel.PictureBytes / 1048576.0, 1);
        var view = Main.I.View;
        foreach (var (label, hour, weather) in new[] { ("day", 13.0, "clear"), ("rain", 13.0, "rain"), ("lamps", 19.5, "clear") })
        {
            await Dev.Kit.I.Light(hour, weather);
            for (int i = 0; i < 40; i++) await Frame();
            var (spot, face) = label == "lamps" ? byLamp : byDay;
            // the horse stands along the house front, two metres out in the street
            var side = new Vector3(face.Z, 0, -face.X);
            var at = spot + face * 2.2f;
            at.Y = (float)town.Walk!.BaseAt(at.X, at.Z);
            foreach (string coat in label == "day" ? new[] { "bay", "roan", "chestnut", "black", "brown", "grey" } : new[] { "bay", "roan", "grey" })
            {
                var h = new TestHorse(view, coat);
                if (!h.Ok) { h.Root.QueueFree(); report["error"] = "no horse parts"; return report; }
                h.Root.Position = at;
                h.Root.Rotation = new Vector3(0, MathF.Atan2(side.X, side.Z), 0);
                h.Pose(0, 0, false, 3.0);
                var fwd = side;
                var mid = at + Vector3.Up * 1.25f;
                string n = $"horse-{label}-{coat}";
                await Shoot(n + "-3m-side", at + face * 3.2f + Vector3.Up * 1.5f, mid, hour, weather);
                if (coat is "bay" or "roan" or "grey")
                {
                    await Shoot(n + "-3m-front", at + fwd * 3.4f + face * 0.6f + Vector3.Up * 1.7f, mid + fwd * 0.5f, hour, weather);
                    await Shoot(n + "-3m-back", at - fwd * 3.6f + face * 0.4f + Vector3.Up * 1.6f, mid, hour, weather);
                    await Shoot(n + "-1m-head", at + fwd * 2.3f + face * 0.7f + Vector3.Up * 2.0f, at + fwd * 1.3f + Vector3.Up * 1.85f, hour, weather);
                    await Shoot(n + "-1m-side", at + face * 1.4f + fwd * 0.3f + Vector3.Up * 1.45f, at + fwd * 0.3f + Vector3.Up * 1.35f, hour, weather);
                    // low in front: the chest between the forelegs (the old two lobes)
                    await Shoot(n + "-1m-chest-low", at + fwd * 2.2f + face * 0.15f + Vector3.Up * 0.45f, at + fwd * 0.9f + Vector3.Up * 1.15f, hour, weather);
                    if (label == "day")
                    {
                        await Shoot(n + "-1m-legs", at + fwd * 1.0f + face * 1.1f + Vector3.Up * 0.5f, at + fwd * 0.5f + Vector3.Up * 0.3f, hour, weather);
                        await Shoot(n + "-1m-harness", at + face * 1.2f + fwd * 0.9f + Vector3.Up * 2.1f, at + fwd * 0.7f + Vector3.Up * 1.6f, hour, weather);
                        await Shoot(n + "-1m-tail", at - fwd * 2.0f + face * 0.9f + Vector3.Up * 1.4f, at - fwd * 1.0f + Vector3.Up * 1.1f, hour, weather);
                    }
                }
                h.Root.QueueFree();
                await Frame();
            }
        }
        await Dev.Kit.I.Light(13, "clear");
        for (int i = 0; i < 30; i++) await Frame();
        report["dray"] = await DrayStrips(town, streetFrom, streetDir);
        report["omnibus"] = await OmnibusStrips(town);
        report["standing"] = await StandingShots(town);
        return report;
    }

    private async System.Threading.Tasks.Task<object> DrayStrips(Town.Townspeople town, Vector3 from, Vector3 dir)
    {
        var shots = new List<string>();
        var side = new Vector3(dir.Z, 0, -dir.X);
        foreach (bool trot in new[] { false, true })
        {
            var d = new TestDray(Main.I.View);
            if (d.Horse == null) { d.Root.QueueFree(); return new { error = "no dray horse" }; }
            float v = trot ? 2.8f : 1.05f, gone = 0;
            const float dt = 1 / 60f;
            float y = from.Y;
            // start the horse 4.5 m in, run up one stride, then six frames a sixth of a stride apart
            float stride = trot ? HorseGait.TrotStride : 1.35f;
            int shot = 0;
            while (shot < 6 && gone < 9)
            {
                gone += v * dt;
                var head = from + dir * (4.5f + gone);
                d.Place(head, dir, gone, 1, trot, y);
                var mid = head - dir * 0.6f + Vector3.Up * 1.1f;
                Main.I.Cam.LookAtFromPosition(mid + side * 4.6f + Vector3.Up * 0.4f, mid);
                if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
                await Frame();
                if (gone > stride && gone >= stride * (1 + shot / 6f))
                {
                    string name = $"horse-dray-{(trot ? "trot" : "walk")}-{shot}";
                    Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir_, name + ".png"));
                    pictures.Add(new { name = name + ".png", gone, trot });
                    shots.Add(name);
                    shot++;
                }
            }
            // the traces close up, from the near side
            if (!trot)
            {
                var head = from + dir * (4.5f + gone);
                await Shoot("horse-dray-traces-1m", head + side * 1.6f - dir * 0.2f + Vector3.Up * 1.6f, head - dir * 0.1f + Vector3.Up * 1.25f, 13, "clear", 3);
                await Shoot("horse-dray-front-3m", head + dir * 3.6f + side * 1.2f + Vector3.Up * 1.7f, head + Vector3.Up * 1.3f, 13, "clear", 3);
            }
            d.Root.QueueFree();
            await Frame();
        }
        return shots;
    }

    private string dir_ => dir;

    private async System.Threading.Tasks.Task<object> OmnibusStrips(Town.Townspeople town)
    {
        if (Omnibus.I is not { } om || om.Buses.Count == 0) return new { found = false };
        var shots = new List<object>();
        int walk = 0, trot = 0;
        // follow the bus nearest to moving, up to 90 s: frames at the walk and at the trot (over 1.9 m/s)
        var bus = om.Buses.OrderByDescending(b => b.V).First();
        double until = Time.GetTicksMsec() / 1000.0 + 90, next = 0;
        while (Time.GetTicksMsec() / 1000.0 < until && (walk < 6 || trot < 6))
        {
            var c = new Vector3(bus.Pc.X, 0, bus.Pc.Y);
            c.Y = (float)(town.Walk?.BaseAt(c.X, c.Z) ?? 0);
            var fwd = new Vector3(MathF.Sin(bus.HorseYaw), 0, MathF.Cos(bus.HorseYaw));
            var side = new Vector3(fwd.Z, 0, -fwd.X);
            var mid = c + Vector3.Up * 1.2f;
            Main.I.Cam.LookAtFromPosition(mid + side * 5.0f + fwd * 1.0f + Vector3.Up * 0.5f, mid);
            if (Main.I.Cam is Player.FlyCam fly) fly.Face(Main.I.Cam.GlobalBasis.GetRotationQuaternion());
            await Frame();
            double now = Time.GetTicksMsec() / 1000.0;
            if (now < next || bus.V < 0.4f) continue;
            bool trotting = bus.V > 1.9f;
            if (trotting && trot >= 6 || !trotting && walk >= 6) continue;
            string name = $"horse-omnibus-{(trotting ? "trot" : "walk")}-{(trotting ? trot : walk)}";
            Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name + ".png"));
            shots.Add(new { name = name + ".png", v = bus.V, gait = bus.Gait });
            if (trotting) trot++; else walk++;
            next = now + (trotting ? 0.09 : 0.18);
        }
        return new { found = true, line = bus.Line.Name, walk, trot, shots };
    }

    private async System.Threading.Tasks.Task<object> StandingShots(Town.Townspeople town)
    {
        var found = new List<string>();
        foreach (var n in World.BakedWorld.All(Mv.Town).OfType<Node3D>().Where(n => n.Name == "standing_horse").ToList())
        {
            var xf = n.GlobalTransform;
            var fwd = xf.Basis.Z.Normalized();
            var side = xf.Basis.X.Normalized();
            var mid = xf.Origin + Vector3.Up * 1.2f;
            string name = $"horse-standing-{found.Count}";
            await Shoot(name + "-3m", mid + side * 3.4f + fwd * 1.2f + Vector3.Up * 0.5f, mid, 13, "clear");
            await Shoot(name + "-6m", mid + side * 5.5f + fwd * 3.5f + Vector3.Up * 1.0f, mid, 13, "clear");
            found.Add(name + " " + n.GetParent()?.Name);
        }
        return found;
    }
}
