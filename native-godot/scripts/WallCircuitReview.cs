using Godot;
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
public static class WallCircuitReview
{
    public static async Task Run(Node3D host,Camera3D camera,DirectionalLight3D sun,Godot.Environment env,Label label)
    {
        string folder=ProjectSettings.GlobalizePath("res://proof/wall-circuit");
        var args=OS.GetCmdlineUserArgs();string mode=args.Contains("--circuit-candidate")?"candidate":args.Contains("--circuit-installed")?"installed":"before";
        if(args.Contains("--circuit-candidate")||args.Contains("--circuit-promote"))WallCircuitRepair.Apply(host,args.Contains("--circuit-promote"));
        if(args.Contains("--circuit-promote")){GD.Print("Wall circuit promoted");Finish(host);return;}
        if(args.Contains("--circuit-flat"))mode+="-flat";
        if(args.Contains("--circuit-nobump"))mode+="-nobump";
        if(args.Contains("--circuit-cull"))mode+="-cull";
        if(args.Contains("--circuit-raw"))mode+="-raw";
        if(args.Contains("--no-shadows"))mode+="-shadowless";
        if(args.Contains("--circuit-noweather"))mode+="-noweather";
        if(args.Contains("--circuit-nojunction"))mode+="-nojunction";
        if(args.Contains("--circuit-nocolor"))mode+="-nocolor";
        if(args.Contains("--circuit-atmosphere"))mode+="-atmosphere";
        if(args.Contains("--circuit-ids"))
        {
            mode+="-ids";
            void Ids(Node n){if(n is MeshInstance3D m&&m.Mesh!=null)for(int s=0;s<m.Mesh.GetSurfaceCount();s++){string name=m.Mesh.SurfaceGetMaterial(s)?.ResourceName??"";var color=name.Contains("quoin")?Colors.Red:name.Contains("stone")?Colors.Lime:name.Contains("brick")?Colors.Blue:name.Contains("plinth")?Colors.Cyan:Colors.Gray;m.SetSurfaceOverrideMaterial(s,new StandardMaterial3D{AlbedoColor=color,ShadingMode=BaseMaterial3D.ShadingModeEnum.Unshaded});}foreach(var child in n.GetChildren())Ids(child);}
            Ids(host);
        }
        if(args.Contains("--circuit-clay"))
        {
            mode+="-clay";
            void Clay(Node n){if(n is MeshInstance3D m&&m.Mesh!=null)for(int s=0;s<m.Mesh.GetSurfaceCount();s++)m.SetSurfaceOverrideMaterial(s,new StandardMaterial3D{AlbedoColor=new Color(.5f,.5f,.5f),Roughness=.8f});foreach(var child in n.GetChildren())Clay(child);}
            Clay(host);
        }
        if(args.Contains("--circuit-standard"))
        {
            mode+="-standard";
            void Standard(Node n){if(n is MeshInstance3D m&&m.Mesh!=null)for(int s=0;s<m.Mesh.GetSurfaceCount();s++)if(m.GetActiveMaterial(s) is ShaderMaterial sm)m.SetSurfaceOverrideMaterial(s,new StandardMaterial3D{AlbedoTexture=sm.GetShaderParameter("tex").AsGodotObject() as Texture2D,TextureFilter=BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic,Roughness=.8f});foreach(var child in n.GetChildren())Standard(child);}
            Standard(host);
        }
        var views=JsonDocument.Parse(File.ReadAllText(Path.Combine(folder,"coverage.json"))).RootElement.GetProperty("views");
        Directory.CreateDirectory(Path.Combine(folder,mode));
        Vector3 V(JsonElement v)=>new(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle());
        var nativeLights=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://world/town/lights.json"))).RootElement.GetProperty("spill");
        // Waters replaces the bake's cut river with a camera-centred sheet during gameplay.
        // Reproduce that scenery-only step so the proof does not expose holes in the old bake.
        var riverMaterial=(ShaderMaterial)ResourceLoader.Load<ShaderMaterial>("res://world/town/resources/r001378.res").Duplicate();riverMaterial.SetShaderParameter("river",1f);
        void HideBakedRiver(Node n){if(n is MeshInstance3D m&&m.Mesh?.ResourcePath=="res://world/town/resources/r001379.res")m.Visible=false;foreach(var child in n.GetChildren())HideBakedRiver(child);}
        HideBakedRiver(host);
        var river=new MeshInstance3D{Name="proof_runtime_river",Mesh=new PlaneMesh{Size=new Vector2(1200,1200),SubdivideWidth=239,SubdivideDepth=239,Material=riverMaterial},CustomAabb=new Aabb(new Vector3(-600,-3,-600),new Vector3(1200,6,1200)),CastShadow=GeometryInstance3D.ShadowCastingSetting.Off};host.AddChild(river);
        foreach(string weather in args.Contains("--circuit-baseline")||args.Contains("--circuit-day")?new[]{"day"}:new[]{"day","rain","night"})
        {
            bool night=weather=="night";sun.LightEnergy=night?.015f:weather=="rain"?.45f:1.1f;
            RenderingServer.GlobalShaderParameterSet("psx_wet",weather=="rain"?.85f:0f);
            RenderingServer.GlobalShaderParameterSet("psx_hemi_sky",night?new Vector4(.006f,.008f,.014f,1):new Vector4(.28f,.30f,.32f,1));
            RenderingServer.GlobalShaderParameterSet("psx_hemi_ground",night?new Vector4(.001f,.001f,.002f,1):new Vector4(.035f,.032f,.028f,1));
            env.BackgroundColor=night?new(.009f,.012f,.02f):new(.18f,.20f,.22f);
            var fogColor=env.BackgroundColor.SrgbToLinear();RenderingServer.GlobalShaderParameterSet("psx_fog_color",new Vector4(fogColor.R,fogColor.G,fogColor.B,1));
            RenderingServer.GlobalShaderParameterSet("psx_fill",night?new Vector4(.012f,.014f,.019f,1):new Vector4(1,1,1,1));
            RenderingServer.GlobalShaderParameterSet("psx_sun_dir",sun.GlobalBasis.Z.Normalized());
            RenderingServer.GlobalShaderParameterSet("psx_rain",weather=="rain"?.85f:0f);
            if(args.Contains("--circuit-atmosphere"))
            {
                // The same Daylight fog-table sample used by the junction atmosphere proof.
                var fog=Scheldemist.Render.Psx.Hex(night?0x1a1e25:0x51585a);
                RenderingServer.GlobalShaderParameterSet("psx_fog_near",weather=="rain"?5.4f:3f);
                RenderingServer.GlobalShaderParameterSet("psx_fog_far",night?19f:weather=="rain"?70f:28f);
                RenderingServer.GlobalShaderParameterSet("psx_fog_color",new Vector4(fog.R,fog.G,fog.B,1));
                env.BackgroundColor=fog.LinearToSrgb();env.TonemapMode=Godot.Environment.ToneMapper.Linear;
            }
            foreach(var view in views.EnumerateArray())
            {
                string? filter=args.FirstOrDefault(a=>a.StartsWith("--circuit-filter="))?.Substring("--circuit-filter=".Length);
                if(filter!=null&&!System.Text.RegularExpressions.Regex.IsMatch(view.GetProperty("name").GetString()!,filter))continue;
                if(args.Contains("--circuit-baseline")&&!view.GetProperty("baseline").GetBoolean())continue;
                if(weather!="day"&&!view.GetProperty("weather").GetBoolean())continue;
                camera.Position=V(view.GetProperty("eye"));var target=V(view.GetProperty("target"));camera.LookAt(target);camera.Fov=68;
                river.Position=new Vector3(MathF.Round(camera.Position.X/4)*4,Scheldemist.World.Tide.River,MathF.Round(camera.Position.Z/4)*4);
                string name=view.GetProperty("name").GetString()!;label.Text=mode+" | "+name+" | "+weather;
                var lights=new System.Collections.Generic.List<OmniLight3D>();
                // Use the game's directional spill shader, including lantern cap falloff. A point
                // shadow map inside the lantern cage creates opaque rings absent from gameplay.
                var fixtures=nativeLights.EnumerateArray().Where(f=>night&&f.GetProperty("kind").GetString()=="lamp"&&V(f.GetProperty("at")).DistanceTo(target)<f.GetProperty("range").GetSingle()).ToArray();
                using var spillImage=Image.CreateEmpty(Math.Max(fixtures.Length,1),4,false,Image.Format.Rgbaf);
                for(int fi=0;fi<fixtures.Length;fi++)
                {
                    var fixture=fixtures[fi];var at=V(fixture.GetProperty("at"));var color=fixture.GetProperty("color");
                    spillImage.SetPixel(fi,0,new Color(at.X,at.Y,at.Z,fixture.GetProperty("power").GetSingle()));
                    spillImage.SetPixel(fi,1,new Color(0,0,.15f,.2f));
                    spillImage.SetPixel(fi,2,new Color(color[0].GetSingle(),color[1].GetSingle(),color[2].GetSingle(),0));
                    spillImage.SetPixel(fi,3,new Color(fixture.GetProperty("range").GetSingle(),fixture.GetProperty("decay").GetSingle(),0,fixture.GetProperty("soft").GetSingle()));
                }
                using var spillTexture=ImageTexture.CreateFromImage(spillImage);
                RenderingServer.GlobalShaderParameterSet("psx_spill",spillTexture);RenderingServer.GlobalShaderParameterSet("psx_spill_n",fixtures.Length);
                if(night&&!args.Contains("--circuit-atmosphere")&&(fixtures.Length==0||name=="seg-06-base-close")){var inspection=new OmniLight3D{Position=camera.Position+Vector3.Up*.3f,LightColor=new(1,.76f,.5f),LightEnergy=.8f,OmniRange=7,ShadowEnabled=true};host.AddChild(inspection);lights.Add(inspection);label.Text+=" | inspection lamp";}
                for(int frame=0;frame<4;frame++)await host.ToSignal(host.GetTree(),SceneTree.SignalName.ProcessFrame);
                await host.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                host.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(folder,mode,name+"-"+weather+".png"));foreach(var lamp in lights)lamp.QueueFree();
            }
        }
        GD.Print("Complete circuit rendered: "+mode);Finish(host);
    }
    static void Finish(Node host)
    {
        host.GetTree().Quit();
        // This isolated proof process can hang releasing large Vulkan mesh buffers on shutdown.
        // All image/resource writes above are synchronous; never attach this watchdog to gameplay/editor.
        _=Task.Delay(5000).ContinueWith(_=>System.Environment.Exit(0));
    }
}
