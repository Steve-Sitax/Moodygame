using System;
using System.Linq;
using Godot;
using Scheldemist.Menu;
using Scheldemist.People;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>Jef's local appearance and camera rig. No puppet motions or network fields are added.</summary>
[GamePart(960)]
public partial class Arms : Node
{
    public const uint BodyLayer = 1u << 18;
    public const uint ArmLayer = Mirrors.NoMirror;
    public static Arms? I { get; private set; }
    public Profile Profile { get; private set; } = Character.Jef;
    public Human Figure { get; private set; } = null!;
    public Human Hands { get; private set; } = null!;
    public string Pose { get; private set; } = "idle";
    public float WallClearance { get; private set; } = 1;
    public float ReachScale { get; private set; } = 1;
    internal string? ProofPose;
    internal bool ProofLantern;
    internal Node3D? ProofLoad;
    private HumanLayers handIK = null!, bodyIK = null!;
    private float clock, gesture;
    private string? gestureKind;
    private Vector3 lastAt;
    private float speed, lastYaw, lag;
    internal float HandLift { get; private set; }
    private bool ready;
    private Node3D bodyLantern = null!;
    private readonly Vector3[] handTargets = new Vector3[2], bodyTargets = new Vector3[2];
    private Node3D? loadObject;
    private Aabb loadBounds;
    internal float LoadGripError { get; private set; }

    public override void _Ready()
    {
        if (!People2.Enabled) { SetProcess(false); return; }
        I = this; ProcessPriority = 75;
        CharacterSheet.MakePreview = CharacterPreview.Make;
        Jef.I.Cam.CullMask &= ~BodyLayer;
        Apply(Character.Jef);
        ServerLinkReady();
        if (MainMenu.I is { } menu) menu.WorldReplaced += Replaced;
        ready = true; lastAt = Jef.I.Body.Position;
    }
    private void ServerLinkReady() => Net.ServerLink.I?.WhenUp(Refresh);
    private void Refresh()
    {
        var api = Net.ServerLink.I?.Api;
        if (api != null) api.Run(Net.ApiMenu.Profile(api), r =>
        {
            if (GodotObject.IsInstanceValid(this) && IsInsideTree() && r.TryGetProperty("profile", out var p)) Apply(Character.FromJson(p));
        }, e => GD.Print("Jef profile: " + e.Message));
    }
    private void Replaced(string how, Net.ClientState? state) => Refresh();

    // The clothing lane can add these names without touching player code. Until then use its shared plain work cuts.
    internal static string Kind(Profile p)
    {
        string cut = p.Sex == "woman" ? p.Clothes.Coat.Kind == "no_shawl" ? "blouse" : "shawl" : p.Clothes.Coat.Kind == "none" ? "shirt" : p.Clothes.Coat.Kind;
        string requested = "p2:jef_" + cut;
        if (People2.Has(requested, true)) return requested;
        return "p2:" + (p.Age >= 58 ? p.Sex == "woman" ? "old_woman_dressed" : "old_man_dressed" : p.Sex == "woman" ? "wife_a" : "docker_a");
    }
    internal static Human Make(Profile p, bool arms = false)
    {
        var h = People2.Make(Kind(p), true) ?? throw new InvalidOperationException("Jef needs the native people2 kit.");
        var effective = p.Clone();
        if (!effective.Sliders.ContainsKey("weight")) effective.Sliders["weight"] = p.Build == "slight" ? -.35f : p.Build == "stout" ? .4f : 0;
        h.PlayerAppearance(effective, arms); h.Start();
        PlayerPalette.Apply(h.Root, p);
        h.UseExternalVehicle(true);
        return h;
    }
    public void Apply(Profile profile)
    {
        Profile = Character.ClampProfile(profile).Profile;
        if (Figure != null) Figure.Dispose();
        if (Hands != null) Hands.Dispose();
        Figure = Make(Profile); Hands = Make(Profile, true);
        Figure.Root.Name = "jef_mirror_body"; Hands.Root.Name = "jef_viewmodel";
        Main.I.View.AddChild(Figure.Root); Jef.I.Cam.AddChild(Hands.Root);
        bodyLantern = Carried.Lantern(); bodyLantern.Name = "jef_body_lantern";
        bodyLantern.Scale = Vector3.One * .8f; Figure.Root.AddChild(bodyLantern);
        handIK = new HumanLayers(Hands.Root, Hands.Root.GetNode<Skeleton3D>("Skeleton3D"));
        bodyIK = new HumanLayers(Figure.Root, Figure.Root.GetNode<Skeleton3D>("Skeleton3D"));
        foreach (var mi in BakedWorld.All(Figure.Root).OfType<MeshInstance3D>())
        { mi.Layers = BodyLayer; mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.On; }
        foreach (var mi in BakedWorld.All(Hands.Root).OfType<MeshInstance3D>())
        { mi.Layers = ArmLayer; mi.CastShadow = GeometryInstance3D.ShadowCastingSetting.Off; mi.SetInstanceShaderParameter("viewmodel_depth_pull", 1f); }
        Hands.Root.Rotation = new Vector3(0, MathF.PI, 0);
        // Youth keeps adult proportions: the game's minimum age is 16, never a child body.
    }
    public void Gesture(string pose) { gestureKind = pose; gesture = .65f; }

    public override void _Process(double delta)
    {
        if (!ready) return;
        using var cost = Dev.FrameCost.Track("Player.Arms");
        if (Jef.I.Fly && ProofPose == null)
        {
            Hands.Root.Visible = Figure.Root.Visible = bodyLantern.Visible = false;
            lastAt = new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z); speed = 0;
            return;
        }
        float dt = (float)Math.Min(delta, .05); clock += dt;
        var j = Jef.I;
        var at = new Vector3(j.X, j.Y, j.Z);
        float measured = dt > 0 ? new Vector2(at.X - lastAt.X, at.Z - lastAt.Z).Length() / dt : 0;
        speed = Mathf.Lerp(speed, Math.Min(measured, Jef.Hurry), Math.Min(1, dt * 12)); lastAt = at;
        if (gesture > 0) gesture -= dt;
        Pose = ProofPose ?? (Day.I?.Asleep == true ? "sleep" : j.Climbing ? j.Vaulting ? "vault" : "climb" : j.Swimming ? "swim" : Rowing.I?.Boat != null ? "row" : Handcarts.I?.Held != null ? "push" : Velocipedes.I?.Ridden != null ? "velo" : j.Riding || Main.I.GetNodeOrNull<TavernSeats>("TavernSeats")?.Sitting != null || Main.I.GetNodeOrNull<CathedralComfort>("CathedralComfort")?.Sitting != null ? "sit" : gesture > 0 ? gestureKind! : Goods.I?.Carried != null ? "carry" : Deeds.I?.Lit == true || ProofLantern ? "lantern" : speed > 2 ? "run" : speed > .1 ? "walk" : "idle");
        Figure.Root.Position = at; Figure.Root.Rotation = new Vector3(0, j.Yaw + MathF.PI, 0);
        Figure.Root.Visible = !j.Fly || ProofPose != null;
        bool activeHands = Pose is not ("idle" or "walk" or "run" or "sleep" or "sit") || Deeds.I?.Lit == true || ProofLantern;
        HandLift = Mathf.MoveToward(HandLift, activeHands ? 1 : 0, dt * 4);
        Hands.Root.Visible = !j.Fly && HandLift > 0;
        string motion = Pose switch { "walk" or "run" => "walk", "carry" => "carry", "push" => "push", "row" => "row", "sit" or "velo" => "sit", _ => j.Crouching ? "crouch" : "idle" };
        foreach (var h in new[] { Figure, Hands })
        {
            h.SetPace(Pose == "run" ? Jef.Hurry : speed);
            h.CarryLoad(Pose == "carry" ? "crate" : null);
            h.Play(motion);
            if (Pose is "climb" or "vault") h.WorkClipNow("man_stairs_up", clock % 1, true);
            if (Pose == "row" && Rowing.I?.Boat != null) h.SetPhase("row", Rowing.I.Rower.Phase);
            h.Update(dt);
        }
        if (Pose == "sleep") { Figure.Root.Rotation = new Vector3(MathF.PI * .5f, j.Yaw + MathF.PI, 0); Figure.Root.Position += Vector3.Up * .2f; }
        else if (Pose == "swim")
        {
            Figure.Root.Rotation = new Vector3(MathF.PI * .45f, j.Yaw + MathF.PI, 0);
        }
        else if (Pose == "row" && Rowing.I?.Boat is { } boat)
            Figure.Root.GlobalTransform = new Transform3D(boat.Root.GlobalBasis, boat.Root.ToGlobal(new Vector3(0, boat.Hull.SeatY + Figure.SitDrop(0) + .02f, boat.Hull.SeatZ)));
        else if (Pose == "velo" && Velocipedes.I?.Ridden is { } velo)
            Figure.Root.GlobalTransform = new Transform3D(velo.Root.GlobalBasis, velo.Root.ToGlobal(new Vector3(0, Figure.SitDrop(.97f), -.02f)));
        else if (Pose == "sit" && TavernSeats.I?.Sitting is { } tavern)
        { Figure.Root.Position = tavern.At + Vector3.Up * Figure.SitDrop(tavern.Height); Figure.Root.Rotation = new Vector3(0, tavern.Yaw, 0); }
        else if (Pose == "sit" && CathedralComfort.I?.Sitting is { } chair)
        { Figure.Root.Position = chair.At + Vector3.Up * Figure.SitDrop(chair.Height); Figure.Root.Rotation = new Vector3(0, chair.Yaw, 0); }
        if (Pose != "sleep")
        {
            var skeleton = Figure.Root.GetNode<Skeleton3D>("Skeleton3D");
            int head = skeleton.FindBone("head"), parent = skeleton.GetBoneParent(head);
            var desired = j.Cam.GlobalBasis * new Basis(Vector3.Up, MathF.PI) * skeleton.GetBoneGlobalRest(head).Basis;
            var frame = Figure.Root.GlobalBasis * skeleton.GetBoneGlobalPose(parent).Basis;
            skeleton.SetBonePoseRotation(head, (frame.Inverse() * desired).Orthonormalized().GetRotationQuaternion());
            if (Pose == "swim")
            {
                var eyes = (skeleton.GetBoneGlobalPose(skeleton.FindBone("eyeL")).Origin + skeleton.GetBoneGlobalPose(skeleton.FindBone("eyeR")).Origin) * .5f;
                Figure.Root.GlobalPosition += j.Cam.GlobalPosition - Figure.Root.ToGlobal(eyes);
            }
        }
        float turn = Mathf.AngleDifference(lastYaw, j.Yaw); lastYaw = j.Yaw;
        lag = Mathf.Lerp(lag, Math.Clamp(turn * -.08f, -.018f, .018f), Math.Min(1, dt * 10));
        WallClearance = Clearance();
        // A conservative immediate contraction also protects the first frame of a teleport against a wall.
        ReachScale = Math.Clamp((WallClearance - .08f) / .65f, .22f, 1);
        // Keep the shoulder cut behind the near plane; the forearms emerge from below the camera.
        float viewScale = ReachScale * 1.25f;
        Hands.Root.Scale = Vector3.One * viewScale;
        Hands.Root.Position = new Vector3(lag, -1.47f * viewScale, .14f * ReachScale);
        float poseTime = Pose == "row" && Rowing.I?.Boat != null ? Rowing.I.Rower.Phase * MathF.Tau / 2.5f : clock;
        PoseHands(Hands, handIK, poseTime, Pose, dt, handTargets);
        if (Pose is "lantern" or "give" or "take" or "climb" or "vault" or "swim") PoseHands(Figure, bodyIK, clock, Pose, dt, bodyTargets, true);
        if (Pose == "carry" && (ProofLoad ?? Goods.I?.Carried?.Obj) is { } obj) ContactLoad(obj);
        if (Pose == "push" && Handcarts.I?.PlayerGrip(0) is { } cartLeft && Handcarts.I.PlayerGrip(1) is { } cartRight) ContactPoints(cartLeft, cartRight);
        if (Pose == "row" && Rowing.I?.PlayerGrip(0) is { } oarLeft && Rowing.I.PlayerGrip(1) is { } oarRight) ContactPoints(oarLeft, oarRight);
        if (Pose == "velo" && Velocipedes.I?.PlayerGrip(0) is { } barLeft && Velocipedes.I.PlayerGrip(1) is { } barRight) ContactPoints(barLeft, barRight);
        // Lower the complete rig out of frame before hiding it; reverse the same eased lift on use.
        Hands.Root.Position += Vector3.Down * (.9f * (1 - Mathf.SmoothStep(0, 1, HandLift)));
        bodyLantern.Visible = Deeds.I?.Lit == true || ProofLantern || Pose == "lantern";
        if (Figure.Socket("gripR") is { } grip) bodyLantern.GlobalPosition = grip - Vector3.Up * .054f;
    }
    private float Clearance()
    {
        float distance = 1;
        var cam = Jef.I.Cam;
        var space = Jef.I.Body.GetWorld3D().DirectSpaceState;
        foreach (float x in new[] { -.24f, 0f, .24f })
        foreach (float y in new[] { -.5f, -.2f, .15f })
        {
            Vector3 from = cam.GlobalTransform * new Vector3(x, y, 0);
            var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(from, from - cam.GlobalBasis.Z, Solid.Layer));
            if (hit.Count > 0) distance = Math.Min(distance, from.DistanceTo(hit["position"].AsVector3()));
        }
        return distance;
    }
    private static void PoseHands(Human h, HumanLayers ik, float t, string pose, float dt, Vector3[] previous, bool body = false)
    {
        var sk = h.Root.GetNode<Skeleton3D>("Skeleton3D");
        string? fingers = pose switch { "lantern" or "push" or "velo" or "climb" => "cart_push_hold", "carry" => "crate_hold", "row" => "row", "give" => "sack_pass_give", "take" => "sack_pass_take", _ => null };
        if (fingers != null && People2.Clips.TryGetValue(fingers, out var clip))
            for (int b = 0; b < People2.BoneNames.Length; b++)
            {
                string name = People2.BoneNames[b];
                if (!(name.StartsWith("thumb") || name.StartsWith("index") || name.StartsWith("middle") || name.StartsWith("ring")) || pose == "lantern" && name.EndsWith("L")) continue;
                int track = clip.RotationTracks[b], bone = sk.FindBone(name);
                if (track >= 0 && bone >= 0) sk.SetBonePoseRotation(bone, clip.Rotations.At(track, Math.Min(.4f, clip.Length * .5f)));
            }
        float wave = MathF.Sin(t * (pose == "run" ? 10 : pose == "walk" ? 7 : 1.6f));
        for (int side = 0; side < 2; side++)
        {
            float sign = side == 0 ? 1 : -1;
            Vector3 target = new(sign * .22f, 1.27f + wave * .007f, .48f);
            switch (pose)
            {
                case "walk": target.Y += wave * sign * .018f; target.Z += wave * sign * .025f; break;
                case "run": target.Y += .10f + wave * sign * .07f; target.Z += wave * sign * .07f; break;
                case "give": case "take": target = new(sign * .13f, 1.30f, .49f + .03f * wave); break;
                case "lantern": if (side == 1) target = new(-.28f, 1.35f, .46f); break;
                case "carry": target = new(sign * .24f, 1.27f, .48f); break;
                case "push": case "velo": target = new(sign * .28f, 1.28f, .48f); break;
                case "climb": target = new(sign * .20f, 1.50f + MathF.Sin(t * 3 + side * MathF.PI) * .12f, .52f); break;
                case "vault": target = new(sign * .25f, 1.30f, .50f); break;
                case "swim": target = body
                    ? new Vector3(sign * .22f, 1.48f + .25f * MathF.Sin(t * 3 + side * MathF.PI), .13f + .15f * MathF.Cos(t * 3 + side * MathF.PI))
                    : new Vector3(sign * (.22f + .10f * MathF.Sin(t * 3)), 1.30f + .10f * MathF.Cos(t * 3 + side * MathF.PI), .49f + .07f * MathF.Sin(t * 3 + side * MathF.PI)); break;
                case "row": target = new(sign * .27f, 1.30f, .50f + .06f * MathF.Sin(t * 2.5f)); break;
            }
            if (previous[side] != Vector3.Zero) target = previous[side].Lerp(target, 1 - MathF.Exp(-dt * 18));
            previous[side] = target;
            string hand = side == 0 ? "handL" : "handR";
            Quaternion rotation = new Quaternion(Vector3.Right, pose == "climb" ? -2.5f : -1.15f) * sk.GetBoneGlobalRest(sk.FindBone(hand)).Basis.GetRotationQuaternion();
            ik.Arm(side, target, rotation);
        }
        People2Shoulders.Apply(h.Root.GetNode<Skeleton3D>("Skeleton3D"));
    }
    private void ContactLoad(Node3D obj)
    {
        if (obj != loadObject)
        {
            loadObject = obj; bool first = true;
            foreach (var mi in BakedWorld.All(obj).OfType<MeshInstance3D>())
            {
                var box = obj.GlobalTransform.AffineInverse() * mi.GlobalTransform * mi.GetAabb();
                loadBounds = first ? box : loadBounds.Merge(box); first = false;
            }
        }
        var left = obj.ToGlobal(new Vector3(loadBounds.Position.X, loadBounds.GetCenter().Y, loadBounds.End.Z - .015f));
        var right = obj.ToGlobal(new Vector3(loadBounds.End.X, loadBounds.GetCenter().Y, loadBounds.End.Z - .015f));
        LoadGripError = ContactPoints(left, right);
    }
    private float ContactPoints(Vector3 left, Vector3 right)
    {
        float error = 0;
        var bodySkeleton = Figure.Root.GetNode<Skeleton3D>("Skeleton3D");
        for (int side = 0; side < 2; side++)
        {
            var target = side == 0 ? left : right;
            string handName = side == 0 ? "handL" : "handR", gripName = side == 0 ? "gripL" : "gripR";
            var worldRotation = Figure.Root.GlobalBasis.Orthonormalized().GetRotationQuaternion() * bodySkeleton.GetBoneGlobalPose(bodySkeleton.FindBone(handName)).Basis.GetRotationQuaternion();
            foreach (var (h, ik) in new[] { (Figure, bodyIK), (Hands, handIK) })
            {
                var sk = h.Root.GetNode<Skeleton3D>("Skeleton3D");
                int hand = sk.FindBone(handName), grip = sk.FindBone(gripName);
                var rotation = h.Root.GlobalBasis.Orthonormalized().GetRotationQuaternion().Inverse() * worldRotation;
                var offset = sk.GetBoneGlobalPose(hand).AffineInverse() * sk.GetBoneGlobalPose(grip).Origin;
                ik.Arm(side, h.Root.ToLocal(target) - rotation * offset, rotation);
                error = Math.Max(error, h.Root.ToGlobal(sk.GetBoneGlobalPose(grip).Origin).DistanceTo(target));
            }
        }
        return error;
    }
    internal Vector3? LanternGrip => Hands?.Socket("gripR");
    public override void _ExitTree()
    {
        if (MainMenu.I is { } menu) menu.WorldReplaced -= Replaced;
        Figure?.Dispose(); Hands?.Dispose();
        CharacterSheet.MakePreview = null; I = null;
    }
}
