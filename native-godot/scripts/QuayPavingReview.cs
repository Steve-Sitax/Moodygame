using Godot;
using System;
using System.IO;
using System.Linq;
using Scheldemist.Native.Game;
using Scheldemist.Render;

// Read-only native scenery captures. No player data or editor layouts are opened.
public partial class QuayPavingReview : Node3D
{
 public override async void _Ready()
 {
  try {
   var args=OS.GetCmdlineUserArgs(); string mode=args.Contains("--after")?"after":"before";
   string output=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/"+mode);Directory.CreateDirectory(output);
   NativeGlobals.Ensure(); Scheldemist.Paths.NativeDataRoot=ProjectSettings.GlobalizePath("res://world/data");
   Psx.LoadShared(ProjectSettings.GlobalizePath("res://world/town/maps"));
   RenderingServer.GlobalShaderParameterSet("psx_fog_near",9000f);RenderingServer.GlobalShaderParameterSet("psx_fog_far",10000f);
   GetViewport().Msaa3D=Viewport.Msaa.Msaa4X;
   var env=new Godot.Environment{BackgroundMode=Godot.Environment.BGMode.Color,BackgroundColor=new(.22f,.25f,.29f),TonemapMode=Godot.Environment.ToneMapper.Filmic};AddChild(new WorldEnvironment{Environment=env});
   var sun=new DirectionalLight3D{RotationDegrees=new(-55,-35,0),LightEnergy=1.1f,ShadowEnabled=true};AddChild(sun);
      var town=ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();AddChild(town);
   if(mode=="before") foreach(var n in Scheldemist.World.BakedWorld.All(town).OfType<MeshInstance3D>())
    if(n.Name=="ground_quay"||n.Name=="track_setts"||n.Name=="track_rails"||n.Name=="ruts") {
     string original=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/"+(n.Name=="ruts"?"option-a/":"")+"originals/"+Path.GetFileName(n.Mesh.ResourcePath));
     if(File.Exists(original))n.Mesh=ResourceLoader.Load<ArrayMesh>(original);
    }
      if(mode=="before") {
    string matOriginal=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/originals/r000038.res");
    if(File.Exists(matOriginal))foreach(var n in Scheldemist.World.BakedWorld.All(town).OfType<MeshInstance3D>().Where(n=>n.Mesh!=null))
     for(int s=0;s<n.Mesh.GetSurfaceCount();s++)if(n.GetActiveMaterial(s)?.ResourcePath=="res://world/town/resources/r000038.res")n.SetSurfaceOverrideMaterial(s,ResourceLoader.Load<ShaderMaterial>(matOriginal));
    string streetOriginal=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/option-a/originals/r000024.res");
    if(File.Exists(streetOriginal))foreach(var n in Scheldemist.World.BakedWorld.All(town).OfType<MeshInstance3D>().Where(n=>n.Mesh!=null))
     for(int s=0;s<n.Mesh.GetSurfaceCount();s++)if(n.GetActiveMaterial(s)?.ResourcePath=="res://world/town/resources/r000024.res")n.SetSurfaceOverrideMaterial(s,ResourceLoader.Load<ShaderMaterial>(streetOriginal));
   }
   Scheldemist.Native.World.NativeDirt.Lay(town);
   var cam=new Camera3D{Current=true,Fov=65,Near=.03f,Far=1200};AddChild(cam);
      if(args.Contains("--bump-audit")) {
    output=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/bump");Directory.CreateDirectory(output);
    var paving=Scheldemist.World.BakedWorld.All(town).OfType<MeshInstance3D>().Where(n=>n.Name=="ground_quay"||n.Name=="ground_cobble").ToArray();
    var materials=paving.Select(n=>(ShaderMaterial)n.Mesh.SurfaceGetMaterial(0)).Distinct().ToArray();
    var domes=materials.Select(m=>m.GetShaderParameter("relief_dome")).ToArray();
    var depths=materials.Select(m=>m.GetShaderParameter("relief_depth")).ToArray();var bumps=materials.Select(m=>m.GetShaderParameter("relief_bump")).ToArray();
    foreach(var m in materials){File.WriteAllText(Path.Combine(output,Path.GetFileName(m.ResourcePath)+".gdshader"),m.Shader.Code);((Texture2D)m.GetShaderParameter("relief_h")).GetImage().SavePng(Path.Combine(output,Path.GetFileName(m.ResourcePath)+"-height.png"));}
    foreach(string variant in new[]{"normal","no-parallax","no-bump","flat","candidate"}) {
     for(int i=0;i<materials.Length;i++){materials[i].SetShaderParameter("relief_depth",variant=="candidate"?.014f:variant is "no-parallax" or "flat"?0f:depths[i]);materials[i].SetShaderParameter("relief_bump",variant=="candidate"?1.6f:variant is "no-bump" or "flat"?0f:bumps[i]);materials[i].SetShaderParameter("relief_dome",variant=="candidate"?1f:domes[i]);}
     foreach(var site in new[]{("quay",new Vector3(24,1.62f,9),new Vector3(24,0,12)),("corner",new Vector3(171,1.62f,108),new Vector3(170,0,111)),("cobble",new Vector3(-145,1.62f,270),new Vector3(-145,0,273))}) {
      cam.Position=site.Item2;cam.LookAt(site.Item3);
      for(int i=0;i<12;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
      await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
      GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,site.Item1+"-"+variant+".png"));
     }
    }
    GD.Print("BUMP_AUDIT_CAPTURED");GetTree().Quit();return;
   }
   var shots=new (string name,Vector3 eye,Vector3 target)[]{
    ("rijnkaai-tracks",new(18,3.8f,14),new(26,0,7)),
    ("vliet-west",new(-103,4.5f,13),new(-90,0,8)),
    ("vliet-east",new(-61,4,15),new(-66,0,7)),
    ("werf-basin",new(-205,5,-10),new(-196,0,-22)),
    ("bassin-corner",new(79,4,110),new(69,0,116)),
    ("rijnkaai-low",new(20,.35f,8),new(27,0,7)),
    ("bassin-return",new(171,2,108),new(170,0,116)),
    ("rail-close",new(28,.20f,2.98f),new(28,.024f,3.32f)),
    ("rail-across-low",new(28,.06f,2.98f),new(28,.015f,3.32f)),
    ("paved-wheel-wear",new(24,2.2f,11),new(27,0,8)),
    ("quay-coping",new(28,.6f,2),new(28,0,0))};
      if(args.Contains("--other-textures")) {
    output=ProjectSettings.GlobalizePath("res://../.scratch/quay-paving/other-textures");Directory.CreateDirectory(output);
    shots=new (string,Vector3,Vector3)[]{
     ("street-cobbles",new(-145,1.62f,270),new(-145,0,273)),
     ("timber-crates",new(165,.8f,110),new(167,.15f,114)),
     ("flagstones",new(-118,1.62f,33),new(-118,0,36)),
     ("quay-coping",new(28,.6f,2),new(28,0,0)),
     ("warehouse-timber",new(-99,2,9),new(-89,1.5f,7)),
     ("stone-steps",new(211.3f,1.2f,29.7f),new(212.3f,.65f,32.5f)),
     ("wall-stone",new(217,3.2f,38),new(219,3.2f,39)),
     ("brick-drain",new(202.6f,1.15f,41.3f),new(200.3f,.9f,43.7f)),
     ("roof-gutter",new(202.2f,10.9f,41.6f),new(200.2f,10.1f,43.6f))};
   }
   foreach(string weather in new[]{"day","rain","night"}) {
    bool night=weather=="night";
    sun.LightEnergy=night?.015f:weather=="rain"?.45f:1.1f;
    RenderingServer.GlobalShaderParameterSet("psx_hemi_sky",night?new Vector4(.006f,.008f,.014f,1):new Vector4(.28f,.30f,.32f,1));
    RenderingServer.GlobalShaderParameterSet("psx_hemi_ground",night?new Vector4(.001f,.001f,.002f,1):new Vector4(.035f,.032f,.028f,1));
    RenderingServer.GlobalShaderParameterSet("psx_wet",weather=="rain"?.85f:0f);RenderingServer.GlobalShaderParameterSet("psx_rain",weather=="rain"?.85f:0f);
    var lamp=new OmniLight3D{LightEnergy=night?2.4f:0,LightColor=new(1,.69f,.35f),OmniRange=12,ShadowEnabled=true};AddChild(lamp);
    foreach(var shot in shots) {
     cam.Position=shot.eye;cam.LookAt(shot.target);lamp.Position=shot.eye+new Vector3(0,2,0);
     for(int i=0;i<12;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
     await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
     var picture=GetViewport().GetTexture().GetImage();
     if(picture.SavePng(Path.Combine(output,shot.name+"-"+weather+".png"))!=Error.Ok||picture.SaveJpg(Path.Combine(output,shot.name+"-"+weather+".jpg"),.92f)!=Error.Ok)throw new IOException(shot.name);
    }
    lamp.QueueFree();
   }
   GD.Print("QUAY_REVIEW_PASS "+mode);GetTree().Quit();
  }catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
 }
}









