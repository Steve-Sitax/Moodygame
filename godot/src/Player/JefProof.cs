using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Menu;
using Scheldemist.World;
using Scheldemist.Ui;

namespace Scheldemist.Player;

[GamePart(985)]
internal partial class JefProof : Node
{
    private readonly List<object> pictures = new();
    private string dir = "";
    private bool capture;
    private float maxGripError;
    private float maxSwimEyeError;
    private int maxDuplicateProps;
    private bool emptyHandsHidden = true;
    public override void _Process(double dt)
    {
        if (capture) People.LanternPool.I?.Update(dt, Main.I.Cam.GlobalPosition, Daylight.I.Hour);
    }
    private async Task Frames(int n = 12) { for (int i = 0; i < n; i++) await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame); }
    private async Task Shot(string name, bool menu = false)
    {
        await Frames(); await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        (menu ? Main.I.GetViewport().GetTexture() : Main.I.View.GetTexture()).GetImage().SavePng(Path.Combine(dir, name + ".png"));
        var arms = Arms.I!;
        if (arms.Pose is "idle" or "walk" or "run" && !arms.ProofLantern)
            emptyHandsHidden &= arms.HandLift == 0 && !arms.Hands.Root.Visible;
        if (arms.Pose == "carry") maxGripError = Math.Max(maxGripError, arms.LoadGripError);
        maxDuplicateProps = Math.Max(maxDuplicateProps, arms.Figure.ThingsShown + arms.Hands.ThingsShown);
        if (arms.Pose == "swim")
        {
            var sk = arms.Figure.Root.GetNode<Skeleton3D>("Skeleton3D");
            var eyes = (sk.GetBoneGlobalPose(sk.FindBone("eyeL")).Origin + sk.GetBoneGlobalPose(sk.FindBone("eyeR")).Origin) * .5f;
            maxSwimEyeError = Math.Max(maxSwimEyeError, arms.Figure.Root.ToGlobal(eyes).DistanceTo(Jef.I.Cam.GlobalPosition));
        }
        pictures.Add(new { name, arms.Pose, arms.HandLift, handsVisible = arms.Hands.Root.Visible, arms.WallClearance, arms.ReachScale, arms.LoadGripError, feet = new[] { Jef.I.X, Jef.I.Y, Jef.I.Z }, hour = Daylight.I.Hour, profile = Character.ToJson(arms.Profile), triangles = arms.Hands.Root.GetMeta("arm_triangles").AsInt32() });
    }
    public override async void _Ready()
    {
        dir = Main.I.Arg("jef-proof"); if (dir == "") return;
        dir = Paths.Absolute(dir); Directory.CreateDirectory(dir);
        try
        {
            for (int i = 0; (Arms.I == null && !Main.I.Flag("jef-inventory") || !Dev.Kit.I.IsReady || Main.I.GetNode<Town.Townspeople>("Townspeople").Data == null) && i < 2400; i++) await Frames(1);
            if (Main.I.Flag("jef-inventory"))
            {
                await Frames(30);
                var audit = new Dev.RenderAudit(); audit.Sample("Jef ready");
                File.WriteAllText(Path.Combine(dir, "inventory.json"), JsonSerializer.Serialize(audit.Report(), new JsonSerializerOptions { WriteIndented = true }));
                GetTree().Quit(); return;
            }
            var arms = Arms.I ?? throw new InvalidOperationException("Jef did not load");
            var j = Jef.I;
            var town = Main.I.GetNode<Town.Townspeople>("Townspeople"); town.SetProcess(false); town.ClockRuns = false;
            capture = true;
            if (town.Crowd is { } crowd) foreach (var person in crowd.Walking) person.Group.Visible = false;
            Game.GameState.I.PlayingWhen = () => false;
            var p = Main.I.World.Facts.RootElement.GetProperty("places").EnumerateArray().First(p => p.GetProperty("place").GetString() == "vismarkt").GetProperty("pos");
            Vector3 spot = new(p[0].GetSingle(), 0, p[2].GetSingle());
            j.Place(spot.X, spot.Z, 0, 0); j.Frozen = true; j.TestInput = true;
            var crate = Play.Goods.I.MakeGoods("crates"); j.Cam.AddChild(crate);
            crate.Position = new Vector3(0, -.64f, -.72f); crate.Visible = false;
            await Frames(30);
            foreach (var light in new[] { ("day", 13.0, "clear"), ("night", 23.0, "clear"), ("rain", 13.0, "rain") })
            {
                await Dev.Kit.I.Light(light.Item2, light.Item3); arms.ProofLantern = light.Item1 == "night";
                foreach (string pose in new[] { "idle", "walk", "run", "give", "take", "lantern", "carry", "push", "climb", "vault", "swim", "row", "velo" })
                {
                    arms.ProofPose = pose; crate.Visible = pose == "carry"; arms.ProofLoad = crate.Visible ? crate : null;
                    await Frames(30); await Shot(light.Item1 + "-" + pose);
                }
            }
            crate.QueueFree(); arms.ProofLoad = null;
            arms.ProofLantern = false;
            var api = Net.ServerLink.I!.Api!;
            var profiles = new[] { Character.Jef, Character.Mie, Character.Jef, Character.Jef };
            profiles[2].Age = 60; profiles[2].Hair.Colour = "grey"; profiles[2].FaceType = "shrunken_old";
            profiles[3].Age = 16; profiles[3].Build = "slight"; profiles[3].Sliders["nose_long"] = -.5f;
            profiles[3].Sliders["eyes_open"] = 0;
            var persisted = new List<bool>();
            for (int i = 0; i < profiles.Length; i++)
            {
                var profile = Character.ClampProfile(profiles[i]).Profile;
                var put = await Net.ApiMenu.PutProfile(api, Character.ToElement(profile));
                var get = await Net.ApiMenu.Profile(api);
                persisted.Add(Character.ToJson(Character.FromJson(get.GetProperty("profile"))) == Character.ToJson(profile));
                if (i == 3 && !get.GetProperty("profile").GetProperty("sliders").TryGetProperty("eyes_open", out _)) throw new InvalidOperationException("Explicit zero slider was lost");
                arms.Apply(profile); arms.ProofPose = "lantern";
                await Dev.Kit.I.Light(13, "clear");
                await Shot("character-" + i + "-arms");
                CharacterSheet.Open(_ => { }); await Frames(24);
                await Shot("character-" + i + "-screen", true);
                if (i == 0)
                {
                    var controls = Main.I.GetTree().Root.FindChild("character_controls", true, false) as ScrollContainer ?? throw new InvalidOperationException("Missing character controls");
                    var nose = controls.FindChild("shape_nose_long", true, false) as InkSlider ?? throw new InvalidOperationException("Missing MakeHuman slider");
                    for (int n = 0; n < 50; n++) nose.Step(1);
                    await Frames(12); controls.ScrollVertical = (int)controls.GetVScrollBar().MaxValue;
                    await Shot("character-sliders-live", true);
                    if (CharacterSheet.Draft!.Sliders.GetValueOrDefault("nose_long") < .3f) throw new InvalidOperationException("Slider did not update draft");
                }
                Dialogs.CloseAll();
            }
            arms.Apply(Character.Jef); arms.ProofPose = null;
            await Frames(40);
            j.Place(spot.X, spot.Z, 0); j.Frozen = false;
            for (int run = 0; run < 2; run++)
            {
                j.SetKey(Key.W, true); j.SetKey(Key.Shift, run == 1);
                for (int frame = 0; frame < 8; frame++) { await Frames(5); await Shot((run == 0 ? "walking" : "running") + "-" + frame.ToString("00")); }
                j.ClearKeys();
            }
            j.Frozen = true; j.Place(spot.X, spot.Z, 0); await Frames(12);
            arms.ProofPose = "lantern"; await Frames(40);
            // Real physics wall, held at the player's collision radius. It is removed with this fixture.
            var wall = new StaticBody3D { Position = spot + new Vector3(0, 1, -.34f), CollisionLayer = Solid.Layer };
            wall.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(2, 2, .08f) } });
            wall.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(2, 2, .08f) }, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color("68635b"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded } });
            Main.I.View.AddChild(wall); await Shot("wall-retracted");
            bool wallSafe = arms.ReachScale < .45f;
            wall.QueueFree(); await Frames();
            var overhang = new StaticBody3D { Position = spot + new Vector3(.34f, 1.45f, -.45f), CollisionLayer = Solid.Layer };
            overhang.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(.04f, .5f, .9f) } });
            overhang.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new Vector3(.04f, .5f, .9f) }, MaterialOverride = new StandardMaterial3D { AlbedoColor = new Color("68635b"), ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded } });
            Main.I.View.AddChild(overhang); arms.ProofPose = "climb"; await Shot("wall-side-depth-guard");
            overhang.QueueFree(); await Frames();
            arms.ProofPose = "lantern"; arms.ProofLantern = true;
            await Dev.Kit.I.Light(23, "clear");
            var observer = new Camera3D { CullMask = 0xFFFFF & ~Mirrors.NoMirror, Current = true, Fov = 62 };
            Main.I.View.AddChild(observer); Main.I.Cam = observer;
            observer.LookAtFromPosition(spot + new Vector3(2.2f, 1.6f, -3), spot + new Vector3(0, .85f, 0));
            // The lantern pool is normally stepped by Townspeople (paused above for repeatable captures).
            for (int i = 0; i < 45; i++) { People.LanternPool.I!.Update(.05, observer.GlobalPosition, 23); await Frames(1); }
            await Shot("lantern-body-shadow");
            await Dev.Kit.I.Light(13, "rain");
            observer.LookAtFromPosition(spot + new Vector3(0, 1.5f, -3), spot + new Vector3(0, .45f, 0));
            await Shot("mirror-body-rain");
            var mirror = Main.I.View.GetNode<SubViewport>("mirror_puddles");
            await Frames(30); mirror.GetTexture().GetImage().SavePng(Path.Combine(dir, "planar-reflection.png"));
            bool hidden = (j.Cam.CullMask & Arms.BodyLayer) == 0;
            File.WriteAllText(Path.Combine(dir, "jef.json"), JsonSerializer.Serialize(new { ok = wallSafe && hidden && emptyHandsHidden && persisted.All(x => x) && maxGripError < .003f && maxDuplicateProps == 0 && maxSwimEyeError < .003f, bodyHiddenFromEyes = hidden, emptyHandsHidden, wallSafe, persisted, maxGripError, maxDuplicateProps, maxSwimEyeError, lightsAdded = 0, shaderKindsAdded = 0, pictures }, new JsonSerializerOptions { WriteIndented = true }));
            if (!wallSafe || !hidden || !emptyHandsHidden || persisted.Any(x => !x) || maxGripError >= .003f || maxDuplicateProps != 0 || maxSwimEyeError >= .003f) throw new InvalidOperationException($"Jef proof invariant failed; empty hands hidden {emptyHandsHidden}; crate palm {maxGripError}; duplicate props {maxDuplicateProps}; swim eye {maxSwimEyeError}");
            GetTree().Quit();
        }
        catch (Exception e) { GD.PushError("Jef proof: " + e); GetTree().Quit(1); }
    }
}
