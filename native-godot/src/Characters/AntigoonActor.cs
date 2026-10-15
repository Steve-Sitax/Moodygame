using Godot;
using System;
using System.Linq;
using System.IO;
using System.Security.Cryptography;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Characters;

/// <summary>Reusable visual/physical actor. Combat authority belongs to AntigoonBrain.</summary>
public partial class AntigoonActor : Node3D
{
    public const string ModelPath = "res://assets/characters/antigoon/packed/manifest.json";
    /// <summary>The verified model bytes (tools fit animations onto this rig).</summary>
    public static byte[] ModelData()=>ModelBytes();
    private static byte[] ModelBytes()
    {
        var manifest=JsonNode.Parse(Godot.FileAccess.GetFileAsString(ModelPath))!.AsObject();
        using var buffer=new MemoryStream(manifest["bytes"]!.GetValue<int>());
        foreach(var part in manifest["parts"]!.AsArray())
        {
            string name=part!["file"]!.GetValue<string>();
            if(name.Contains('/')||name.Contains('\\')||!name.StartsWith("part-"))throw new InvalidDataException("Invalid Antigoon bundle part.");
            byte[] data=Godot.FileAccess.GetFileAsBytes("res://assets/characters/antigoon/packed/"+name);
            if(data.Length!=part["bytes"]!.GetValue<int>()||Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant()!=part["sha256"]!.GetValue<string>())throw new InvalidDataException("Damaged Antigoon bundle: "+name);
            buffer.Write(data);
        }
        byte[] model=buffer.ToArray();
        if(model.Length!=manifest["bytes"]!.GetValue<int>()||Convert.ToHexString(SHA256.HashData(model)).ToLowerInvariant()!=manifest["sha256"]!.GetValue<string>())throw new InvalidDataException("Damaged Antigoon model.");
        return model;
    }
    public AnimationPlayer Animations { get; private set; } = null!;
    public Skeleton3D Skeleton { get; private set; } = null!;
    public int LodCount { get; private set; }
    public string State { get; private set; } = "";
    public bool TownLighting { get; set; }
    public AntigoonPose Pose {get;private set;}=null!;
    internal Rid BodyRid=>body.GetRid();
    public Vector3 ThrowOrigin()
    {
        int hand=Skeleton.FindBone("hand.R");return hand<0?GlobalPosition+Vector3.Up*4.1f:Skeleton.GlobalTransform*Skeleton.GetBoneGlobalPose(hand).Origin;
    }
    private StaticBody3D body = null!;
    private AudioStreamPlayer3D feet = null!;
    private Vector3 destination;
    private float facing;
    private int serial = -1;
    public int AttackSerial => serial;
    private bool placed, turning;
    private bool paused;
    public override void _Ready()
    {
        using var document = new GltfDocument(); using var data = new GltfState();
        var error = document.AppendFromBuffer(ModelBytes(), "", data);
        if (error != Error.Ok) throw new InvalidOperationException("Antigoon model could not load: " + error);
        foreach(var mesh in data.GetMeshes())
        {
            mesh.Mesh.GenerateLods(60,60,new Godot.Collections.Array());
            for(int s=0;s<mesh.Mesh.GetSurfaceCount();s++)LodCount+=mesh.Mesh.GetSurfaceLodCount(s);
        }
        var model = document.GenerateScene(data); model.Name = "AntigoonModel"; AddChild(model);
        if(TownLighting) AntigoonTownMaterials.Apply(model);
        Animations = model.FindChildren("*", "AnimationPlayer", true, false).OfType<AnimationPlayer>().First();
        Skeleton = model.FindChildren("*", "Skeleton3D", true, false).OfType<Skeleton3D>().First();
        // Optimized glTF clips omit constant tracks. Reset missing channels when leaving a walk/kick/death.
        // Otherwise the old lifted foot or root bend survives in the idle clip indefinitely.
        var reset=new Animation{Length=.001};var root=Animations.GetNode(Animations.RootNode);
        Skeleton.ResetBonePoses();
        for(int bone=0;bone<Skeleton.GetBoneCount();bone++)
        {
            var path=new NodePath(root.GetPathTo(Skeleton)+":"+Skeleton.GetBoneName(bone));
            void Track(Animation.TrackType type,Variant value){int track=reset.AddTrack(type);reset.TrackSetPath(track,path);reset.TrackInsertKey(track,0,value);}
            Track(Animation.TrackType.Position3D,Skeleton.GetBonePosePosition(bone));
            Track(Animation.TrackType.Rotation3D,Skeleton.GetBonePoseRotation(bone));
            Track(Animation.TrackType.Scale3D,Skeleton.GetBonePoseScale(bone));
        }
        foreach(var mesh in model.FindChildren("*","MeshInstance3D",true,false).OfType<MeshInstance3D>())
        {
            if(mesh.Mesh is not ArrayMesh blend)continue;
            for(int shape=0;shape<blend.GetBlendShapeCount();shape++)
            {
            int track=reset.AddTrack(Animation.TrackType.BlendShape);
            reset.TrackSetPath(track,new NodePath(root.GetPathTo(mesh)+":"+blend.GetBlendShapeName(shape)));reset.TrackInsertKey(track,0,0f);
            }
        }
        Animations.GetAnimationLibrary("").AddAnimation("RESET",reset);Animations.Deterministic=true;
        foreach (string name in Animations.GetAnimationList())
            Animations.GetAnimation(name).LoopMode = name is "idle" or "walk" or "run" or "laugh" or "smirk" or "angry"
                ? Animation.LoopModeEnum.Linear : Animation.LoopModeEnum.None;
        // CC0 Quaternius clips fitted to this rig (scripts/AntigoonRetarget.cs); they keep their own loop modes.
        if (ResourceLoader.Exists(Tools.AntigoonRetarget.Output)) Animations.AddAnimationLibrary("ual", ResourceLoader.Load<AnimationLibrary>(Tools.AntigoonRetarget.Output));
        body = new StaticBody3D { Name = "TorsoCollision", CollisionLayer = 1, CollisionMask = 0 }; AddChild(body);
        body.AddChild(new CollisionShape3D { Position = new Vector3(0, 2.6f, 0), Shape = new CapsuleShape3D { Radius = .62f, Height = 5.2f } });
        Pose=new AntigoonPose{Actor=this};Skeleton.AddChild(Pose);
        // A footfall is heard when a boot lands, not on a clock.
        Pose.Landed+=_=>{if(State is not ("hidden" or "death"))feet.Play();};
        feet = new AudioStreamPlayer3D { MaxDistance = 45, UnitSize = 7, VolumeDb = -5, PitchScale = .58f };
        feet.Stream = ResourceLoader.Load<AudioStream>("res://world/data/public/audio/kenney-impact/footstep_concrete_003.ogg");
        AddChild(feet);
        var sound=new AntigoonSound {Name="ThreatAudio"};AddChild(sound);
        SetState("idle");
    }
    /// <summary>Where the prey's neck is now (the client tells him); his fist goes there.</summary>
    public Func<Vector3?>? PreyNeck;
    // Grab timeline (seconds into the grab): bend and seize, lift, hold at his face and stare, throw.
    public const double GrabSeize = .8, GrabLifted = 1.5, GrabThrow = 2.6, GrabRelease = Services.AntigoonBrain.GrabRelease;
    private double grabClock;
    /// <summary>The point in front of his face where he holds his prey by the neck.</summary>
    public Vector3 HoldPoint()
    {
        int head = Skeleton.FindBone("head");
        var face = Skeleton.GlobalTransform * Skeleton.GetBoneGlobalRest(head).Origin;
        return face + GlobalBasis.Z * 1.15f - GlobalBasis.Y * .35f;
    }
    /// <summary>His right fist in the world.</summary>
    public Vector3 Fist() => Pose.FistWorld;
    private void GrabClips(double delta)
    {
        grabClock += delta;
        // Library clips where they exist: the pick-up bend, standing, the overhand throw (released at 0.5 s of it).
        var (clip, start, speed) = grabClock < GrabSeize ? ("ual/pick_up", 0.0, .95f) : grabClock < GrabThrow ? ("ual/idle", GrabSeize, 1f) : ("ual/throw", GrabThrow, 1f);
        if (Animations.CurrentAnimation != clip && Animations.HasAnimation(clip))
        {
            Animations.SpeedScale = speed; Animations.Play(clip, 0);
            Animations.Seek(clip == "ual/throw" ? Math.Max(0, .5 - (GrabRelease - grabClock)) : Math.Max(0, grabClock - start) * speed, true);
        }
        float reach = Mathf.Clamp((float)((grabClock - .15) / .5), 0, 1);
        // Lifted: the fist rises from the neck to his face; at the throw it lets the throw clip take the arm.
        float hold = Mathf.Clamp((float)((grabClock - GrabSeize) / (GrabLifted - GrabSeize)), 0, 1);
        float letGo = Mathf.Clamp((float)((grabClock - GrabThrow) / .2), 0, 1);
        Vector3? neck = PreyNeck?.Invoke();
        var target = neck is { } n && grabClock < GrabSeize ? n : HoldPoint();
        if (grabClock >= GrabSeize && neck is { } held && hold < 1) target = held.Lerp(HoldPoint(), Smooth(hold));
        Pose.Grip = (target, grabClock < GrabSeize ? reach : 1 - letGo, grabClock >= GrabSeize * .9 && grabClock < GrabRelease);
        Pose.LookAt = grabClock >= GrabSeize ? HoldPoint() : neck;
    }
    private static float Smooth(float x) { x = Mathf.Clamp(x, 0, 1); return x * x * (3 - 2 * x); }
    public void Snapshot(Vector3 position, float yaw, string state, double time, int attackSerial, bool visible)
    {
        destination = position; facing = yaw; Visible = visible;
        body.CollisionLayer = visible && state != "death" ? 1u : 0u;
        if (!placed || GlobalPosition.DistanceTo(position) > 12) { GlobalPosition = position; Rotation = new Vector3(0, yaw, 0); placed = true; }
        bool newAttack = attackSerial != serial; serial = attackSerial;
        if (State != state || state is "attack" or "grab" && newAttack) { SetState(state, time); grabClock = time; }
        if (state == "grab" && Math.Abs(grabClock - time) > .4) grabClock = time;
    }
    public void SetState(string state, double time = 0)
    {
        string before = Animations.CurrentAnimation;
        double phase = Animations.HasAnimation(before) && Animations.GetAnimation(before).Length > 0 ? Animations.CurrentAnimationPosition / Animations.GetAnimation(before).Length : 0;
        State = state;
        var (clip, speed) = Clip(state);
        if (!Animations.HasAnimation(clip)) clip = Animations.HasAnimation("ual/idle") ? "ual/idle" : "idle";
        Animations.SpeedScale = speed;
        // No cross-fade here: the pose dead-blends every change from the last pose and its motion.
        Animations.Play(clip, 0);
        double length = Animations.GetAnimation(clip).Length;
        // Walk, run and back keep their place in the stride, so the arms swing on as the gait changes.
        bool gait(string c) => c is "ual/walk" or "ual/run" or "ual/sprint";
        if (gait(before) && gait(clip)) time = phase * length;
        Animations.Seek(Animations.GetAnimation(clip).LoopMode == Animation.LoopModeEnum.Linear ? time % length : Math.Min(time, length), true);
    }
    /// <summary>The clip for a state: the CC0 library where it has the move, our own hand-made clip where it does not.</summary>
    private static (string Clip, float Speed) Clip(string state) => state switch
    {
        "hidden" or "idle" or "notice" => ("ual/idle", 1),
        "walk" => ("ual/walk", 1.15f),
        "run" or "retreat" => ("ual/run", 1.5f),
        "shield" => ("ual/walk", (float)(Services.AntigoonBrain.ShieldSpeed / Services.AntigoonBrain.WalkSpeed) * 1.15f),
        "hit" => ("ual/hit", 1),
        "recoil_light" => ("ual/hit_head", .8f),
        "death" => ("ual/death", 1),
        "throw" => ("ual/throw", .86f),
        // Hand-made: the library has no kick.
        _ => (state, 1),
    };
    /// <summary>The way he means to face (the host's heading); the body follows it step by step.</summary>
    public float Facing => facing;
    /// <summary>Proof aid: aim the body without a host snapshot.</summary>
    public void Face(float yaw) => facing = yaw;
    /// <summary>The body may turn this far past where his boots point; further only after a boot has stepped round.</summary>
    public const float TwistLimit = .35f;
    /// <summary>
    /// Turn the body toward `facing` at a giant's pace, never more than `TwistLimit` past his boots: the feet lead,
    /// the hips follow. Standing, his head covers the first 60 degrees before the body comes round at all.
    /// </summary>
    public void TurnStep(double delta)
    {
        bool moving = State is "walk" or "run" or "retreat" or "shield";
        float turn = Mathf.AngleDifference(Rotation.Y, facing);
        if (moving || State is "attack" or "grab" || Math.Abs(turn) > 1.05f) turning = true;
        else if (Math.Abs(turn) < .12f) turning = false;
        if (!turning) return;
        float rate = (State is "run" or "retreat" ? 3.2f : moving ? 2.2f : 1.6f) * (float)delta;
        float yaw = Rotation.Y + Math.Clamp(turn, -rate, rate);
        float lead = Mathf.AngleDifference(Pose.FeetYaw, yaw);
        if (Math.Abs(lead) > TwistLimit) yaw = Pose.FeetYaw + Math.Sign(lead) * TwistLimit;
        Rotation = new Vector3(0, yaw, 0);
    }
    /// <summary>The kicking boot lands: the street shakes under anyone close.</summary>
    public void Stomped()
    {
        if(Scheldemist.Player.Jef.I?.Body is {} body&&body.GlobalPosition.DistanceTo(GlobalPosition) is var d&&d<14)Scheldemist.Player.Jef.I.Jolt(.45f*(1-d/14),1.6f*(1-d/14));
    }
    public void Pause(bool on)
    {
        if(paused==on)return;paused=on;
        ProcessMode=on?ProcessModeEnum.Disabled:ProcessModeEnum.Inherit;
        foreach(var audio in FindChildren("*","AudioStreamPlayer",true,false).OfType<AudioStreamPlayer>())audio.StreamPaused=on;
        foreach(var audio in FindChildren("*","AudioStreamPlayer3D",true,false).OfType<AudioStreamPlayer3D>())audio.StreamPaused=on;
    }
    public override void _Process(double delta)
    {
        if (!placed || !Visible) return;
        GlobalPosition = GlobalPosition.Lerp(destination, 1 - Mathf.Exp(-(float)delta * 18));
        TurnStep(delta);
        if (State == "grab") GrabClips(delta); else Pose.Grip = null;
    }
}
