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
    public Vector3 ThrowOrigin()
    {
        int hand=Skeleton.FindBone("hand.R");return hand<0?GlobalPosition+Vector3.Up*4.1f:Skeleton.GlobalTransform*Skeleton.GetBoneGlobalPose(hand).Origin;
    }
    private StaticBody3D body = null!;
    private AudioStreamPlayer3D feet = null!;
    private Vector3 destination;
    private float facing;
    private double footTimer;
    private int serial = -1;
    private bool placed;
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
        foreach (string name in Animations.GetAnimationList())
            Animations.GetAnimation(name).LoopMode = name is "idle" or "walk" or "run" or "laugh" or "smirk" or "angry"
                ? Animation.LoopModeEnum.Linear : Animation.LoopModeEnum.None;
        body = new StaticBody3D { Name = "TorsoCollision", CollisionLayer = 1, CollisionMask = 0 }; AddChild(body);
        body.AddChild(new CollisionShape3D { Position = new Vector3(0, 2.6f, 0), Shape = new CapsuleShape3D { Radius = .62f, Height = 5.2f } });
        feet = new AudioStreamPlayer3D { MaxDistance = 45, UnitSize = 7, VolumeDb = -5, PitchScale = .58f };
        feet.Stream = AudioStreamOggVorbis.LoadFromFile(ProjectSettings.GlobalizePath("res://world/data/public/audio/kenney-impact/footstep_concrete_003.ogg"));
        AddChild(feet);
        var sound=new AntigoonSound {Name="ThreatAudio"};AddChild(sound);
        SetState("idle");
    }
    public void Snapshot(Vector3 position, float yaw, string state, double time, int attackSerial, bool visible)
    {
        destination = position; facing = yaw; Visible = visible;
        body.CollisionLayer = visible && state != "death" ? 1u : 0u;
        if (!placed || GlobalPosition.DistanceTo(position) > 12) { GlobalPosition = position; Rotation = new Vector3(0, yaw, 0); placed = true; }
        bool newAttack = attackSerial != serial; serial = attackSerial;
        if (State != state || state == "attack" && newAttack) SetState(state, time);
    }
    public void SetState(string state, double time = 0)
    {
        State = state;
        string clip = state switch { "retreat" => "run", "hidden" => "idle", _ => state };
        if (!Animations.HasAnimation(clip)) clip = "idle";
        Animations.Play(clip, .13);
        double length = Animations.GetAnimation(clip).Length;
        Animations.Seek(Animations.GetAnimation(clip).LoopMode == Animation.LoopModeEnum.Linear ? time % length : Math.Min(time, length), true);
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
        Rotation = new Vector3(0, Mathf.LerpAngle(Rotation.Y, facing, 1 - Mathf.Exp(-(float)delta * 12)), 0);
        if (State is "walk" or "run" or "retreat")
        {
            footTimer += delta;
            if (footTimer > (State == "walk" ? .6 : .36)) { footTimer = 0; feet.Play(); }
        }
        else footTimer = .25;
    }
}
