using System;
using System.Linq;
using System.IO;
using System.Text.Json;
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
    private bool animateWhileFlying;
    private string? timingPose;
    private Node3D bodyLantern = null!;
    private Vector3 lanternAt, bodyLanternAt;
    private bool lanternPlaced;
    private float beltBlend;
    private JsonElement grips;
    private readonly System.Collections.Generic.Dictionary<(string, int), (int Bone, Quaternion Rotation)[]> gripPoses = new();
    private readonly Vector3[] handTargets = new Vector3[2], bodyTargets = new Vector3[2];
    private Node3D? loadObject;
    private Aabb loadBounds;
    internal float LoadGripError { get; private set; }
    internal float BodyGripError { get; private set; }
    internal float ViewGripError { get; private set; }

    public override void _Ready()
    {
        if (!People2.Enabled) { SetProcess(false); return; }
        I = this; ProcessPriority = 75;
        animateWhileFlying = Main.I.Flag("people2-player-timing");
        if (animateWhileFlying) timingPose = Main.I.Arg("people2-player-pose", "idle");
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

    [Flags] internal enum HandSlots { None = 0, Left = 1, Right = 2, Both = Left | Right }
    internal HandSlots Slots { get; private set; }
    internal bool TwoHandedUse => Pose is not ("idle" or "walk" or "run" or "sleep" or "sit" or "lantern" or "knife_ready");
    internal bool LanternOnBelt => (Deeds.I?.Lit == true || ProofLantern) && TwoHandedUse;
    internal static string Kind(Profile p)
    {
        bool woman = p.Sex == "woman", apron = p.Clothes.Apron.Kind != "none";
        string cut = p.Clothes.Coat.Kind;
        cut = cut is "none" or "no_shawl" ? woman ? "plain" : "shirt" : cut == "check_shawl" ? "shawl" : cut;
        if (apron && cut is "plain" or "shirt") cut = "apron";
        else if (apron && cut is "jacket" or "shawl") cut += "_apron";
        return "p2:jef_" + (woman ? "w_" : "m_") + cut;
    }
    internal static Human Make(Profile p, bool arms = false)
    {
        var h = People2.Make(Kind(p), true) ?? throw new InvalidOperationException("Jef needs the native people2 kit.");
        var effective = p.Clone();
        h.PlayerAppearance(effective, arms); h.Start();
        if (!arms) People2.PlayerAccessories(h.Root, effective);
        PlayerPalette.Apply(h.Root, p);
        h.UseExternalVehicle(true);
        return h;
    }
    public void Apply(Profile profile)
    {
        Profile = Character.ClampProfile(profile).Profile;
        using (var rig = JsonDocument.Parse(File.ReadAllText(Paths.Shared("peopleRig.json")))) grips = rig.RootElement.GetProperty("grips").GetProperty("sizes").Clone();
        if (Figure != null) Figure.Dispose();
        if (Hands != null) Hands.Dispose();
        Figure = Make(Profile); Hands = Make(Profile, true);
        gripPoses.Clear();
        foreach (string size in new[] { "rope", "handle" }) for (int side = 0; side < 2; side++) gripPoses[(size, side)] = BuildGrip(Figure.Root.GetNode<Skeleton3D>("Skeleton3D"), side, size);
        Figure.Root.Name = "jef_mirror_body"; Hands.Root.Name = "jef_viewmodel";
        Main.I.View.AddChild(Figure.Root); Jef.I.Cam.AddChild(Hands.Root);
        bodyLantern = Carried.Lantern(); bodyLantern.Name = "jef_body_lantern";
        lanternPlaced = false;
        beltBlend = 0;
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
        using var playerCost = Dev.PeopleTiming.Player();
        if (Jef.I.Fly && ProofPose == null && !animateWhileFlying)
        {
            Hands.Root.Visible = Figure.Root.Visible = bodyLantern.Visible = false;
            lastAt = new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z); speed = 0;
            return;
        }
        float dt = (float)Math.Min(delta, .05); clock += dt;
        var j = Jef.I;
        var at = new Vector3(j.X, j.Y, j.Z);
        if (animateWhileFlying && j.Fly) at = Main.I.Cam.GlobalPosition - Vector3.Up * Jef.Eye;
        float measured = dt > 0 ? new Vector2(at.X - lastAt.X, at.Z - lastAt.Z).Length() / dt : 0;
        speed = Mathf.Lerp(speed, Math.Min(measured, Jef.Hurry), Math.Min(1, dt * 12)); lastAt = at;
        if (gesture > 0) gesture -= dt;
        Pose = ProofPose ?? timingPose ?? (Day.I?.Asleep == true ? "sleep" : j.Climbing ? j.Vaulting ? "vault" : "climb" : CraneClimb.I?.OnLadder == true ? "climb" : j.Swimming ? "swim" : Rowing.I?.Boat != null ? "row" : Handcarts.I?.Held != null ? "push" : Velocipedes.I?.Ridden != null ? "velo" : j.Riding || Main.I.GetNodeOrNull<TavernSeats>("TavernSeats")?.Sitting != null || Main.I.GetNodeOrNull<CathedralComfort>("CathedralComfort")?.Sitting != null ? "sit" : gesture > 0 ? gestureKind! : Goods.I?.Carried != null ? "carry" : Deeds.I?.Lit == true || ProofLantern ? "lantern" : speed > 2 ? "run" : speed > .1 ? "walk" : "idle");
        Figure.Root.Position = at; Figure.Root.Rotation = new Vector3(0, j.Yaw + MathF.PI, 0);
        Figure.Root.Visible = !j.Fly || ProofPose != null;
        Slots = Pose switch { "idle" or "walk" or "run" or "sleep" or "sit" => HandSlots.None, "lantern" => HandSlots.Left, "knife_ready" => HandSlots.Right, _ => HandSlots.Both };
        if ((Deeds.I?.Lit == true || ProofLantern) && Slots != HandSlots.Both) Slots |= HandSlots.Left;
        beltBlend = Mathf.MoveToward(beltBlend, LanternOnBelt ? 1 : 0, dt * 4);
        // Lower the single-hand hold onto the belt before raising the two working hands.
        bool activeHands = Slots != HandSlots.None && (!LanternOnBelt || beltBlend == 1);
        HandLift = Mathf.MoveToward(HandLift, activeHands ? 1 : 0, dt * 4);
        Hands.Root.Visible = !j.Fly && HandLift > 0;
        string motion = Pose switch { "walk" or "run" => "walk", "lantern" or "knife_ready" when speed > .1f => "walk", "carry" => "carry", "push" => "push", "row" => "row", "sit" or "velo" => "sit", _ => j.Crouching ? "crouch" : "idle" };
        for (int figureIndex = 0; figureIndex < 2; figureIndex++)
        {
            if (figureIndex == 1 && HandLift == 0) continue;
            var h = figureIndex == 0 ? Figure : Hands;
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
        if (Pose is "push" or "velo")
        {
            var skeleton = Figure.Root.GetNode<Skeleton3D>("Skeleton3D");
            foreach (string boneName in new[] { "spine", "upperChest" })
            {
                int bone = skeleton.FindBone(boneName);
                skeleton.SetBonePoseRotation(bone, skeleton.GetBoneRest(bone).Basis.GetRotationQuaternion() * new Quaternion(Vector3.Right, Pose == "push" ? .45f : .12f));
            }
        }
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
        WallClearance = (activeHands || HandLift > 0) && CraneClimb.I?.OnLadder != true ? Clearance() : 1;
        // A conservative immediate contraction also protects the first frame of a teleport against a wall.
        ReachScale = Math.Clamp((WallClearance - .08f) / .65f, .22f, 1);
        // Keep the forearm cut behind the near plane; the arms emerge from below the camera.
        float viewScale = ReachScale * 1.25f;
        Hands.Root.Scale = Vector3.One * viewScale;
        Hands.Root.Position = new Vector3(lag, -1.47f * viewScale, .14f * ReachScale);
        if (Pose is "push" or "velo") Hands.Root.Position += Vector3.Down * .30f * viewScale;
        if (animateWhileFlying && j.Fly) Hands.Root.GlobalTransform = Main.I.Cam.GlobalTransform * Hands.Root.Transform;
        float poseTime = Pose == "row" && Rowing.I?.Boat != null ? Rowing.I.Rower.Phase * MathF.Tau / 2.5f : clock;
        if (HandLift > 0) PoseHands(Hands, handIK, poseTime, Pose, dt, handTargets, slots: Slots);
        if (activeHands) PoseHands(Figure, bodyIK, clock, Pose, dt, bodyTargets, true, Slots);
        if (Pose == "carry" && (ProofLoad ?? Goods.I?.Carried?.Obj) is { } obj) ContactLoad(obj);
        if (Pose == "push" && Handcarts.I?.PlayerGrip(0) is { } cartLeft && Handcarts.I.PlayerGrip(1) is { } cartRight) ContactPoints(cartLeft, cartRight);
        if (Pose == "row" && Rowing.I?.PlayerGrip(0) is { } oarLeft && Rowing.I.PlayerGrip(1) is { } oarRight) ContactPoints(oarLeft, oarRight);
        if (Pose == "velo" && Velocipedes.I?.PlayerGrip(0) is { } barLeft && Velocipedes.I.PlayerGrip(1) is { } barRight) ContactPoints(barLeft, barRight);
        if (Pose == "climb" && CraneClimb.I?.OnLadder == true)
        {
            var ladder = Movers.Railway.I.LadderAt(CraneClimb.I.On);
            var inward = ladder.Head - ladder.Foot; inward.Y = 0; inward = inward.Normalized();
            var side = new Vector3(inward.Z, 0, -inward.X);
            float rung = .35f + MathF.Round((j.Y + 1.5f - .35f) / .3f) * .3f;
            var centre = ladder.Foot + inward * .50f; centre.Y = rung;
            ContactPoints(centre + side * .14f, centre - side * .14f);
        }
        // Lower the complete rig out of frame before hiding it; reverse the same eased lift on use.
        Hands.Root.Position += Vector3.Down * (.9f * (1 - Mathf.SmoothStep(0, 1, HandLift)));
        bodyLantern.Visible = Deeds.I?.Lit == true || ProofLantern || Pose == "lantern";
        if (Figure.Socket(LanternOnBelt ? "hipL" : "gripL") is { } grip)
        {
            var viewGrip = LanternOnBelt ? grip : Hands.Socket("gripL") ?? grip;
            float blend = 1 - MathF.Exp(-dt * 14);
            bodyLanternAt = lanternPlaced ? bodyLanternAt.Lerp(grip, blend) : grip;
            lanternAt = lanternPlaced ? lanternAt.Lerp(viewGrip, blend) : viewGrip;
            lanternPlaced = true;
            bodyLantern.Rotation = new Vector3(0, 0, MathF.Sin(clock * 3) * .06f);
            bodyLantern.GlobalPosition = bodyLanternAt - bodyLantern.GlobalBasis.Orthonormalized() * Vector3.Up * .086f;
        }
    }
    private float Clearance()
    {
        float distance = 1;
        var cam = animateWhileFlying && Jef.I.Fly ? Main.I.Cam : Jef.I.Cam;
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
    private static void PoseHands(Human h, HumanLayers ik, float t, string pose, float dt, Vector3[] previous, bool body = false, HandSlots slots = HandSlots.Both)
    {
        var sk = h.Root.GetNode<Skeleton3D>("Skeleton3D");
        string? fingers = pose switch { "carry" => "crate_hold", "give" => "sack_pass_give", "take" => "sack_pass_take", _ => null };
        if (fingers != null && People2.Clips.TryGetValue(fingers, out var clip))
            for (int b = 0; b < People2.BoneNames.Length; b++)
            {
                string name = People2.BoneNames[b];
                if (!(name.StartsWith("thumb") || name.StartsWith("index") || name.StartsWith("middle") || name.StartsWith("ring")) || pose == "lantern" && name.EndsWith("R")) continue;
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
                case "lantern": if (side == 0) target = new(.28f, 1.35f, .46f); break;
                case "knife_ready": if (side == 1) target = new(-.24f, 1.32f, .49f); break;
                case "carry": target = new(sign * .24f, 1.27f, .48f); break;
                case "push": case "velo": target = new(sign * .28f, 1.28f, .48f); break;
                case "climb": target = new(sign * .20f, 1.50f + MathF.Sin(t * 3 + side * MathF.PI) * .12f, .52f); break;
                case "vault": target = new(sign * .25f, 1.30f, .50f); break;
                case "swim": target = body
                    ? new Vector3(sign * .22f, 1.48f + .25f * MathF.Sin(t * 3 + side * MathF.PI), .13f + .15f * MathF.Cos(t * 3 + side * MathF.PI))
                    : new Vector3(sign * (.22f + .10f * MathF.Sin(t * 3)), 1.30f + .10f * MathF.Cos(t * 3 + side * MathF.PI), .49f + .07f * MathF.Sin(t * 3 + side * MathF.PI)); break;
                case "row": target = new(sign * .27f, 1.30f, .50f + .06f * MathF.Sin(t * 2.5f)); break;
            }
            bool used = (slots & (side == 0 ? HandSlots.Left : HandSlots.Right)) != 0;
            if (body && !used) continue;
            if (!body && !used) target = new Vector3(sign * .22f, .48f, .12f);
            if (side == 0 && (slots == HandSlots.Left || pose == "knife_ready" && (Arms.I?.ProofLantern == true || Deeds.I?.Lit == true))) target = new(.28f, 1.35f + wave * .007f, .46f);
            if (previous[side] != Vector3.Zero) target = previous[side].Lerp(target, 1 - MathF.Exp(-dt * 18));
            previous[side] = target;
            string hand = side == 0 ? "handL" : "handR";
            Quaternion rotation;
            bool lanternLeft = side == 0 && pose == "knife_ready" && (slots & HandSlots.Left) != 0;
            if (pose is "lantern" or "push" or "velo" or "climb" or "row" || lanternLeft)
            {
                var fingerDirection = pose == "push" ? new Vector3(-sign, 0, 0) : Vector3.Back;
                var palm = Vector3.Down;
                var from = new Basis(Vector3.Down, new Vector3(-sign, 0, 0), Vector3.Down.Cross(new Vector3(-sign, 0, 0)));
                var to = new Basis(fingerDirection, palm, fingerDirection.Cross(palm));
                rotation = (to * from.Inverse()).GetRotationQuaternion() * sk.GetBoneGlobalRest(sk.FindBone(hand)).Basis.GetRotationQuaternion();
            }
            else rotation = new Quaternion(Vector3.Right, -1.15f) * sk.GetBoneGlobalRest(sk.FindBone(hand)).Basis.GetRotationQuaternion();
            ik.Arm(side, target, rotation, body ? null : ViewElbow(h, side));
        }
        People2Shoulders.Apply(h.Root.GetNode<Skeleton3D>("Skeleton3D"));
        if (pose is "lantern" or "push" or "velo" or "climb" or "row")
            for (int side = 0; side < 2; side++)
                if ((slots & (side == 0 ? HandSlots.Left : HandSlots.Right)) != 0) CloseGrip(sk, side, pose == "lantern" ? "rope" : "handle");
        if (pose == "knife_ready" && (slots & HandSlots.Left) != 0) CloseGrip(sk, 0, "rope");
    }
    private static void CloseGrip(Skeleton3D sk, int side, string size)
    {
        if (I == null) return;
        foreach (var pose in I.gripPoses[(size, side)]) sk.SetBonePoseRotation(pose.Bone, pose.Rotation);
    }
    private (int Bone, Quaternion Rotation)[] BuildGrip(Skeleton3D sk, int side, string size)
    {
        var result = new System.Collections.Generic.List<(int, Quaternion)>();
        var grip = grips.GetProperty(size); string suffix = side == 0 ? "L" : "R"; float sign = side == 0 ? 1 : -1;
        foreach (string finger in new[] { "index", "middle", "ring" })
        {
            float previous = 0; var curls = grip.GetProperty("curls").GetProperty(finger);
            for (int k = 1; k <= 3; k++)
            {
                int bone = sk.FindBone(finger + k + suffix); var basis = sk.GetBoneGlobalRest(bone).Basis;
                var direction = basis.Y; float angle = MathF.Atan2(-sign * direction.X, -direction.Y);
                float change = Mathf.DegToRad(curls[k - 1].GetSingle()) - (angle - previous); previous = angle;
                result.Add((bone, sk.GetBoneRest(bone).Basis.GetRotationQuaternion() * new Quaternion(basis.Inverse() * Vector3.Forward, sign * change)));
            }
        }
        var thumbDirection = sk.GetBoneGlobalRest(sk.FindBone("thumb2" + suffix)).Basis.Y.Normalized();
        var flex = thumbDirection.Cross(-new Vector3(.55f * sign, 0, .85f).Normalized()).Normalized();
        var across = thumbDirection.Cross(Vector3.Forward).Normalized(); var thumb = grip.GetProperty("thumb");
        for (int k = 1; k <= 3; k++)
        {
            int bone = sk.FindBone("thumb" + k + suffix); var basis = sk.GetBoneGlobalRest(bone).Basis;
            var turn = k == 1 ? new Quaternion(basis.Inverse() * across, Mathf.DegToRad(thumb[0].GetSingle())) * new Quaternion(basis.Inverse() * flex, Mathf.DegToRad(thumb[1].GetSingle()))
                : new Quaternion(basis.Inverse() * flex, Mathf.DegToRad(thumb[k].GetSingle()));
            result.Add((bone, sk.GetBoneRest(bone).Basis.GetRotationQuaternion() * turn));
        }
        return result.ToArray();
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
        float gripY = loadBounds.End.Y - Math.Min(.10f, loadBounds.Size.Y * .2f);
        var left = obj.ToGlobal(new Vector3(loadBounds.Position.X, gripY, loadBounds.End.Z - .015f));
        var right = obj.ToGlobal(new Vector3(loadBounds.End.X, gripY, loadBounds.End.Z - .015f));
        LoadGripError = ContactPoints(left, right);
    }
    private float ContactPoints(Vector3 left, Vector3 right)
    {
        float error = 0;
        var bodySkeleton = Figure.Root.GetNode<Skeleton3D>("Skeleton3D");
        var viewSkeleton = Hands.Root.GetNode<Skeleton3D>("Skeleton3D");
        Vector3 ShoulderCentre(Human human, Skeleton3D skeleton) => skeleton.ToGlobal((skeleton.GetBoneGlobalPose(skeleton.FindBone("armUpL")).Origin + skeleton.GetBoneGlobalPose(skeleton.FindBone("armUpR")).Origin) * .5f);
        // Match the physical body's shoulders before reaching for a real world handle, including a low saddle.
        Hands.Root.GlobalPosition += ShoulderCentre(Figure, bodySkeleton) - ShoulderCentre(Hands, viewSkeleton);
        BodyGripError = ViewGripError = 0;
        for (int side = 0; side < 2; side++)
        {
            var target = side == 0 ? left : right;
            string handName = side == 0 ? "handL" : "handR", gripName = side == 0 ? "gripL" : "gripR";
            var worldRotation = bodySkeleton.GlobalBasis.Orthonormalized().GetRotationQuaternion() * bodySkeleton.GetBoneGlobalPose(bodySkeleton.FindBone(handName)).Basis.GetRotationQuaternion();
            foreach (var (h, ik) in new[] { (Figure, bodyIK), (Hands, handIK) })
            {
                var sk = h.Root.GetNode<Skeleton3D>("Skeleton3D");
                int hand = sk.FindBone(handName), grip = sk.FindBone(gripName);
                var rotation = sk.GlobalBasis.Orthonormalized().GetRotationQuaternion().Inverse() * worldRotation;
                var offset = sk.GetBoneGlobalPose(hand).AffineInverse() * sk.GetBoneGlobalPose(grip).Origin;
                ik.Arm(side, sk.ToLocal(target) - rotation * offset, rotation, h == Hands ? ViewElbow(h, side) : null);
                float miss = sk.ToGlobal(sk.GetBoneGlobalPose(grip).Origin).DistanceTo(target);
                error = Math.Max(error, miss);
                if (h == Figure) BodyGripError = Math.Max(BodyGripError, miss); else ViewGripError = Math.Max(ViewGripError, miss);
            }
        }
        return error;
    }
    private static Vector3 ViewElbow(Human h, int side) => h.Root.GlobalBasis.Orthonormalized().Inverse() *
        (Jef.I.Cam.GlobalBasis.Z * 2 + Jef.I.Cam.GlobalBasis.X * (side == 0 ? -.25f : .25f) - Vector3.Up * 1.5f);
    internal bool LanternViewVisible => !LanternOnBelt || Jef.I.Cam.ToLocal(lanternAt).Y > -.75f;
    internal Vector3? LanternGrip => lanternPlaced ? lanternAt : null;
    public override void _ExitTree()
    {
        if (MainMenu.I is { } menu) menu.WorldReplaced -= Replaced;
        Figure?.Dispose(); Hands?.Dispose();
        CharacterSheet.MakePreview = null; I = null;
    }
}
