using Godot;
using System;
using System.Collections.Generic;
using System.Linq;
using Scheldemist.Native.Characters;

namespace Scheldemist.Native.Tools;

/// <summary>
/// Fits Quaternius Universal Animation Library clips (CC0) onto Antigoon's 46-bone rig and saves them as one
/// AnimationLibrary. Each mapped bone takes the source bone's world-space turn from its rest pose; rests are first
/// lined up bone by bone (head toward child), so an A-pose rig takes T-pose clips. The pelvis travel is scaled by
/// hip height. Run: godot --headless --path native-godot res://scripts/antigoon-retarget.tscn -- --source DIR
/// </summary>
public partial class AntigoonRetarget : Node
{
    public const string Output="res://assets/characters/antigoon/animations/antigoon-ual.res";
    private const float Fps=30;
    // Source clip -> name used in the game library.
    private static readonly (string File,string Clip,string As,bool Loop)[] Clips=
    {
        ("UAL1_Standard.glb","Idle_Loop","idle",true),("UAL1_Standard.glb","Walk_Loop","walk",true),
        ("UAL1_Standard.glb","Jog_Fwd_Loop","run",true),("UAL1_Standard.glb","Sprint_Loop","sprint",true),
        ("UAL1_Standard.glb","Jump_Start","jump_start",false),("UAL1_Standard.glb","Jump_Loop","jump_air",true),("UAL1_Standard.glb","Jump_Land","jump_land",false),
        ("UAL1_Standard.glb","Hit_Chest","hit",false),("UAL1_Standard.glb","Hit_Head","hit_head",false),("UAL1_Standard.glb","Death01","death",false),
        ("UAL1_Standard.glb","Punch_Enter","reach",false),("UAL1_Standard.glb","PickUp_Table","pick_up",false),
        ("UAL2_Standard.glb","OverhandThrow","throw",false),("UAL2_Standard.glb","Hit_Knockback","knockback",false),
        ("UAL2_Standard.glb","NinjaJump_Start","leap_start",false),("UAL2_Standard.glb","NinjaJump_Idle_Loop","leap_air",true),("UAL2_Standard.glb","NinjaJump_Land","leap_land",false),
        ("UAL2_Standard.glb","Zombie_Idle_Loop","menace",true),
    };
    private static readonly Dictionary<string,string> Rigify=new()
    {
        ["DEF-hips"]="pelvis",["DEF-spine.001"]="spine",["DEF-spine.003"]="chest",["DEF-neck"]="neck",["DEF-head"]="head",
    };
    private static readonly Dictionary<string,string> Unreal=new()
    {
        ["pelvis"]="pelvis",["spine_01"]="spine",["spine_03"]="chest",["neck_01"]="neck",["Head"]="head",
    };
    static AntigoonRetarget()
    {
        string[] fingers={"thumb","index","middle","ring","pinky"};
        foreach(var (side,s) in new[]{("L","l"),("R","r")})
        {
            foreach(var (from,to) in new[]{("shoulder","clavicle"),("upper_arm","upper_arm"),("forearm","forearm"),("hand","hand"),("thigh","thigh"),("shin","shin"),("foot","foot"),("toe","toe")})
                Rigify[$"DEF-{from}.{side}"]=$"{to}.{side}";
            foreach(var (from,to) in new[]{("clavicle","clavicle"),("upperarm","upper_arm"),("lowerarm","forearm"),("hand","hand"),("thigh","thigh"),("calf","shin"),("foot","foot"),("ball","toe")})
                Unreal[$"{from}_{s}"]=$"{to}.{side}";
            for(int j=0;j<5;j++)for(int k=1;k<=2;k++)
            {
                Rigify[j==0?$"DEF-thumb.0{k}.{side}":$"DEF-f_{fingers[j]}.0{k}.{side}"]=$"finger{j}.0{k}.{side}";
                Unreal[$"{fingers[j]}_0{k}_{s}"]=$"finger{j}.0{k}.{side}";
            }
        }
    }
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();int at=Array.IndexOf(args,"--source");
            if(at<0||at+1>=args.Length)throw new ArgumentException("Pass --source with the folder holding UAL1_Standard.glb and UAL2_Standard.glb.");
            string folder=args[at+1];
            var target=Load(AntigoonActor.ModelData(),"antigoon");
            var targetSkeleton=Find<Skeleton3D>(target);var targetPlayer=Find<AnimationPlayer>(target);
            string prefix=targetPlayer.GetAnimation("idle").TrackGetPath(0).ToString().Split(':')[0];
            var library=new AnimationLibrary();var sources=new Dictionary<string,Node3D>();
            foreach(var clip in Clips)
            {
                if(!sources.TryGetValue(clip.File,out var source))sources[clip.File]=source=Load(System.IO.File.ReadAllBytes(System.IO.Path.Combine(folder,clip.File)),clip.File);
                var animation=Fit(source,clip.Clip,targetSkeleton,prefix,clip.Loop);
                library.AddAnimation(clip.As,animation);
                GD.Print($"RETARGET {clip.File}:{clip.Clip} -> {clip.As}, {animation.Length:0.00} s, {animation.GetTrackCount()} tracks");
            }
            System.IO.Directory.CreateDirectory(ProjectSettings.GlobalizePath(Output.GetBaseDir()));
            var error=ResourceSaver.Save(library,Output,ResourceSaver.SaverFlags.Compress);
            if(error!=Error.Ok)throw new Exception("Save failed: "+error);
            GD.Print($"RETARGET_PASS {Clips.Length} clips -> {Output}");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
    private Node3D Load(byte[] data,string name)
    {
        using var document=new GltfDocument();using var state=new GltfState();
        var error=document.AppendFromBuffer(data,"",state);if(error!=Error.Ok)throw new Exception(name+": "+error);
        var scene=(Node3D)document.GenerateScene(state);scene.Name=name.Replace(".","_");AddChild(scene);return scene;
    }
    private static T Find<T>(Node root) where T:Node=>root.FindChildren("*",typeof(T).Name,true,false).OfType<T>().First();

    private Animation Fit(Node3D source,string clip,Skeleton3D target,string prefix,bool loop)
    {
        var skeleton=Find<Skeleton3D>(source);var player=Find<AnimationPlayer>(source);
        var names=Enumerable.Range(0,skeleton.GetBoneCount()).Select(skeleton.GetBoneName).ToHashSet();
        var map=(names.Contains("DEF-hips")?Rigify:Unreal).Where(p=>names.Contains(p.Key)&&target.FindBone(p.Value)>=0)
            .ToDictionary(p=>target.FindBone(p.Value),p=>skeleton.FindBone(p.Key));
        Transform3D SourceWorld(int bone)=>skeleton.GlobalTransform*skeleton.GetBoneGlobalPose(bone);
        // Rest poses in world space. The source faces wherever its toes point; turn it to face +Z like Antigoon.
        skeleton.ResetBonePoses();
        var sourceRest=map.Values.Distinct().ToDictionary(b=>b,b=>skeleton.GlobalTransform*skeleton.GetBoneGlobalRest(b));
        var targetRest=Enumerable.Range(0,target.GetBoneCount()).ToDictionary(b=>b,b=>target.GetBoneGlobalRest(b));
        int toe=target.FindBone("toe.L"),foot=target.FindBone("foot.L");
        var sourceToe=sourceRest[map[toe]].Origin-sourceRest[map[foot]].Origin;
        var face=new Basis(Vector3.Up,-Mathf.Atan2(sourceToe.X,sourceToe.Z));
        // Line up rests: turn each target bone so it points (head to mapped child) the way its source bone does.
        var align=new Dictionary<int,Quaternion>();
        for(int b=0;b<target.GetBoneCount();b++)
        {
            if(!map.TryGetValue(b,out int s)){continue;}
            int child=Enumerable.Range(0,target.GetBoneCount()).Where(c=>target.GetBoneParent(c)==b&&map.ContainsKey(c))
                .OrderBy(c=>target.GetBoneName(c).Contains("finger")?1:0).ThenBy(c=>target.GetBoneName(c).StartsWith("finger2")?0:1).DefaultIfEmpty(-1).First();
            if(child<0){align[b]=target.GetBoneParent(b) is var p&&align.TryGetValue(p,out var q)?q:Quaternion.Identity;continue;}
            var wantTarget=(targetRest[child].Origin-targetRest[b].Origin).Normalized();
            var wantSource=face*(sourceRest[map[child]].Origin-sourceRest[s].Origin).Normalized();
            align[b]=new Quaternion(wantTarget,wantSource);
        }
        int pelvis=target.FindBone("pelvis");
        float scale=targetRest[pelvis].Origin.Y/Math.Max(.01f,(face*sourceRest[map[pelvis]].Origin).Y);
        var animation=new Animation{LoopMode=loop?Animation.LoopModeEnum.Linear:Animation.LoopModeEnum.None};
        var sourceClip=player.GetAnimation(clip);animation.Length=sourceClip.Length;
        var rotationTracks=new Dictionary<int,int>();
        for(int b=0;b<target.GetBoneCount();b++)
        {
            int track=animation.AddTrack(Animation.TrackType.Rotation3D);animation.TrackSetPath(track,prefix+":"+target.GetBoneName(b));rotationTracks[b]=track;
        }
        int travel=animation.AddTrack(Animation.TrackType.Position3D);animation.TrackSetPath(travel,prefix+":pelvis");
        player.Play(clip);
        int frames=Math.Max(1,(int)Math.Round(sourceClip.Length*Fps));
        for(int f=0;f<=frames;f++)
        {
            double t=Math.Min(sourceClip.Length,f/Fps);player.Seek(t,true);
            var global=new Transform3D[target.GetBoneCount()];
            for(int b=0;b<target.GetBoneCount();b++)
            {
                int parent=target.GetBoneParent(b);var parentGlobal=parent>=0?global[parent]:Transform3D.Identity;
                Transform3D world;
                if(map.TryGetValue(b,out int s))
                {
                    // The source's turn from its rest, applied to the lined-up target rest.
                    var turn=(face*SourceWorld(s).Basis*sourceRest[s].Basis.Inverse()*face.Inverse()).GetRotationQuaternion();
                    var basis=new Basis(turn*align[b])*targetRest[b].Basis;
                    var origin=(parentGlobal*target.GetBoneRest(b)).Origin;
                    if(b==pelvis)origin=targetRest[b].Origin+face*(SourceWorld(s).Origin-sourceRest[s].Origin)*scale;
                    world=new Transform3D(basis.Orthonormalized(),origin);
                }
                else world=parentGlobal*target.GetBoneRest(b);
                global[b]=world;
                var local=parentGlobal.AffineInverse()*world;
                animation.RotationTrackInsertKey(rotationTracks[b],t,local.Basis.GetRotationQuaternion().Normalized());
                if(b==pelvis)animation.PositionTrackInsertKey(travel,t,local.Origin);
            }
        }
        return animation;
    }
}
