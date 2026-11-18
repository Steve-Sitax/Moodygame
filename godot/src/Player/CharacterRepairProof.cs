using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>Opt-in native gameplay checks for held-object view arms and the quay's seated replacements.</summary>
public static class CharacterRepairProof
{
    public static async Task Run(Main game, string output)
    {
        Directory.CreateDirectory(output);
        var checks = new List<object>(); var pictures = new List<string>(); var poses = new List<object>();
        void Check(string name, bool passed)
        { checks.Add(new { name, passed }); if (!passed) throw new InvalidOperationException(name); GD.Print("character proof: " + name); }
        async Task Frames(int count = 1) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        async Task Until(Func<bool> done, int seconds = 40)
        { var end = DateTime.UtcNow.AddSeconds(seconds); while (!done()) { if (DateTime.UtcNow > end) throw new TimeoutException("Character proof wait"); await Frames(); } }
        async Task Shot(string name)
        {
            await Frames(5); await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var image = game.GetViewport().GetTexture().GetImage();
            if (image.SavePng(Path.Combine(output, name + ".png")) != Error.Ok) throw new IOException(name);
            pictures.Add(name + ".png");
        }
        try
        {
            Check("isolated save", Paths.Database.Contains(".scratch", StringComparison.OrdinalIgnoreCase));
            await Until(() => Goods.I.Loaded && Dev.Kit.I.IsReady);
            var j = Jef.I; var arms = Arms.I!;
            await ServerLink.I!.Api!.Post<OkReply>("api/arrival/ashore");
            j.Place(-153.5f, 67, 0); await Until(() => !j.Riding);
            j.TestInput = true; if (j.Fly) j.ToggleFly();
            j.Place(-153.5f, 67, 0); await Frames(40); j.Frozen = true;
            var menders = game.GetNode<NetMenders>("NetMenders");
            Check("two dressed net-menders", menders.People.Count == 2 && menders.People.All(p => p.Human.IsPeople2 && p.Human.CanSit));
            Check("original anchors and IDs retained", menders.People.All(p => p.Anchor.Transform == p.Authored && !p.Anchor.Visible && p.Anchor.HasMeta("source_node_index")));
            Check("separate stools 1.5 metres apart", Math.Abs(menders.People[0].Human.Root.GlobalPosition.DistanceTo(menders.People[1].Human.Root.GlobalPosition) - 1.5f) < .03f);
            Check("characters add no mesh collision", menders.People.All(p => !BakedWorld.All(p.Human.Root).Any(n => n is CollisionObject3D or CollisionShape3D)));
            var camera = new Camera3D { Current = true, Fov = 52, Near = .025f, CullMask = 0xFFFFF & ~Arms.BodyLayer & ~Mirrors.NoMirror };
            game.View.AddChild(camera); camera.MakeCurrent();
            foreach (var (light, hour, weather) in new[] { ("day", 13d, "clear"), ("rain", 13d, "rain"), ("night", 23d, "clear") })
            {
                await Dev.Kit.I.Light(hour, weather); await Frames(75);
                foreach (var (view, eye, target) in new[]
                {
                    ("pair", new Vector3(-154.3f, 1.6f, 66.3f), new Vector3(-151.9f, .85f, 67.7f)),
                    ("front", new Vector3(-149.2f, 1.1f, 66.6f), new Vector3(-151.9f, .9f, 67)),
                    ("back-low", new Vector3(-153.8f, .3f, 69.4f), new Vector3(-151.9f, .75f, 68.1f)),
                    ("top", new Vector3(-152.3f, 3, 67.8f), new Vector3(-151.9f, .4f, 67.8f))
                })
                {
                    camera.GlobalPosition = eye; camera.LookAt(target);
                    if (view == "pair")
                    {
                        foreach (var p in menders.People) { p.Anchor.Visible = p.WasVisible; p.Human.Root.Visible = false; }
                        await Shot(light + "-menders-before");
                        foreach (var p in menders.People) { p.Anchor.Visible = false; p.Human.Root.Visible = true; }
                    }
                    await Shot(light + "-menders-" + view);
                }
            }
            var bones = menders.People.Select(p => new
            {
                id = p.Anchor.GetMeta("source_node_index").AsInt32(), p.Human.Kind, p.Human.Motion,
                position = p.Human.Root.GlobalPosition.ToString(),
                joints = new[] { "hips", "footL", "footR", "handL", "handR" }.ToDictionary(n => n, n =>
                { var sk = p.Human.Root.GetNode<Skeleton3D>("Skeleton3D"); int b = sk.FindBone(n); return b < 0 ? "absent" : sk.ToGlobal(sk.GetBoneGlobalPose(b).Origin).ToString(); })
            }).ToArray();
            camera.QueueFree(); j.Cam.MakeCurrent(); game.Cam = j.Cam;
            await Dev.Kit.I.Light(13, "clear"); j.Place(-153.5f, 67, -MathF.PI / 2, -.15f); await Frames(30);
            bool Hidden() => !arms.Hands.Root.Visible && arms.HandLift == 0 && arms.ViewSlots == Arms.HandSlots.None;
            foreach (string pose in new[] { "idle", "walk", "run", "take", "give", "knife_ready", "carry", "push", "row", "velo", "sit", "sleep", "climb", "vault", "swim" })
            {
                arms.ProofPose = pose; arms.ProofLantern = false; await Frames(24);
                Check("empty arms hidden: " + pose, Hidden());
                poses.Add(new { pose, lantern = false, visible = arms.Hands.Root.Visible, body = arms.Figure.Root.Visible });
                if (pose is "climb" or "swim") await Shot("player-" + pose);
            }
            foreach (string pose in new[] { "climb", "vault", "swim", "push", "row", "velo" })
            {
                arms.ProofPose = pose; arms.ProofLantern = true; await Frames(24);
                Check("belt lantern keeps view arms hidden: " + pose, Hidden());
                Check("body remains animated: " + pose, arms.Figure.Root.Visible && arms.Slots == Arms.HandSlots.Both);
            }
            arms.ProofPose = null; arms.ProofLantern = true; await Frames(35);
            Check("handheld lantern keeps one hand", arms.Hands.Root.Visible && arms.ViewSlots == Arms.HandSlots.Left);
            await Shot("player-held-lantern");
            arms.ProofLantern = false; arms.Gesture("give"); arms._Process(1d / 60);
            Check("lantern release hides arms immediately", Hidden());
            foreach (string kind in new[] { "crates", "sacks" })
            {
                var prop = Goods.I.MakeGoods(kind); j.Cam.AddChild(prop); prop.Position = new Vector3(0, -.65f, -.76f);
                arms.ProofLoad = prop; arms.Gesture("take"); await Frames(35);
                Check("held " + kind + " uses both hands", arms.Pose == "carry" && arms.ViewSlots == Arms.HandSlots.Both && arms.Hands.Root.Visible && arms.LoadGripError < .04f);
                await Shot("player-held-" + kind);
                arms.ProofLoad = null; prop.QueueFree(); arms.Gesture("give"); arms._Process(1d / 60);
                Check("release " + kind + " hides arms immediately", Hidden());
            }
            // Exercise an authoritative pickup and placement, including its unchanged primitive collision.
            var goods = Goods.I;
            var item = goods.Items.First(i => i.S.Look == "cask" && i.Obj != null && !i.Heavy && !i.CartOnly && i.Y < .1f && !GoodsRules.HasAbove(goods.All.Values.Select(v => v.S), i.Id));
            var origin = new Vector3(item.X, item.Y, item.Z);
            j.Frozen = false; j.Place(item.X, item.Z + 1.1f, 0); await Frames(90);
            GoodsReply? answer = null;
            void Answer(object ask, GoodsReply reply) { if (JsonSerializer.SerializeToElement(ask).TryGetProperty("id", out var id) && id.GetString() == item.Id) answer = reply; }
            goods.Answered += Answer;
            try
            {
                goods.Lift(item); await Until(() => answer != null); await Frames(35);
                Check("real pickup shows held-object hands", answer!.Ok && goods.Carried == item && arms.Pose == "carry" && arms.Hands.Root.Visible);
                Check("carried object keeps primitive collision disabled", item.Shape!.Shape is BoxShape3D && item.Shape.Disabled);
                await Shot("player-real-pickup"); answer = null;
                Check("held object can be put down", goods.PutDown(origin.X, origin.Z) != null);
                await Until(() => answer != null); await Frames(3);
                Check("real release hides hands and restores collision", answer!.Ok && goods.Carried == null && Hidden() && !item.Shape.Disabled);
            }
            finally { goods.Answered -= Answer; }
            // Actual descent, swimming and ascent use the normal player state machine, with a lit lantern.
            arms.ProofPose = null; arms.ProofLantern = true;
            Exit? ladder = null;
            foreach (var exit in QuayExits.Exits.Where(e => e.Ladder && e.Of != null && float.IsFinite(e.Of.TopRung)))
            {
                j.Place(exit.Tx, exit.Tz, MathF.Atan2(exit.Nx, exit.Nz) + MathF.PI, 0, exit.Ty); await Frames(20);
                if (j.LadderFoot(exit) is { Swim: true }) { ladder = exit; break; }
            }
            Check("open-water ladder found", ladder != null);
            int climbFrames = 0; bool climbingHidden = true; float bodyGripError = 0;
            async Task Climb(string direction, Action start)
            {
                start(); Check(direction + " climb starts", j.Climbing);
                for (int frame = 0; j.Climbing && frame < 900; frame++)
                {
                    await Frames(); if (!j.Climbing) break;
                    climbFrames++; climbingHidden &= Hidden();
                    if (arms.OnQuayLadder) bodyGripError = Math.Max(bodyGripError, arms.BodyGripError);
                    if (frame == 40) await Shot("player-real-climb-" + direction);
                }
                Check(direction + " climb completes", !j.Climbing);
            }
            var q = ladder!; float facing = MathF.Atan2(q.Nx, q.Nz);
            j.Place(q.Tx, q.Tz, facing + MathF.PI, 0, q.Ty); await Frames(30);
            await Climb("down", () => j.ClimbDown(q)); await Frames(40);
            Check("actual swimming hides hands", j.Swimming && Hidden()); await Shot("player-real-swimming");
            j.Yaw = facing; j.Pitch = 0;
            await Climb("up", () => j.ClimbUp(q));
            Check("arms stay hidden throughout real climbing", climbFrames > 30 && climbingHidden);
            Check("mirror body retains ladder grip", bodyGripError < .03f);
            arms.ProofLantern = false; j.ClearKeys();
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed = true, checks, pictures, poses, bones, climbFrames, bodyGripError, report = game.World.Report }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print("CHARACTER_REPAIR_PASS: " + checks.Count + " checks"); game.GetTree().Quit();
        }
        catch (Exception e)
        {
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed = false, checks, pictures, error = e.ToString() }, new JsonSerializerOptions { WriteIndented = true }));
            GD.PushError(e.ToString()); game.GetTree().Quit(1);
        }
    }
}
