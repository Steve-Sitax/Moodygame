using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Game;
using Scheldemist.World.Ruien;

/// <summary>Fast diagnostic pictures of an intake candidate; full-town review remains the acceptance check.</summary>
public partial class RuienMeshReview:Node3D
{
    private ImageTexture? cover,lights;
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            string folder=Arg("--folder"),output=Arg("--out"),area=Arg("--area");Directory.CreateDirectory(output);
            NativeGlobals.Ensure();Ruien.EnsureGlobals();
            using var coverImage=Image.CreateEmpty(1,1,false,Image.Format.Rgbaf);coverImage.Fill(new Color(1,0,.5f));cover=ImageTexture.CreateFromImage(coverImage);
            using var lightImage=Image.CreateEmpty(1,4,false,Image.Format.Rgbaf);lights=ImageTexture.CreateFromImage(lightImage);
            RenderingServer.GlobalShaderParameterAdd("ruien_cover",RenderingServer.GlobalShaderParameterType.Sampler2D,cover.GetRid());
            RenderingServer.GlobalShaderParameterAdd("ruien_lights",RenderingServer.GlobalShaderParameterType.Sampler2D,lights.GetRid());
            RenderingServer.GlobalShaderParameterSet("ruien_cover_box",new Vector4(-1000,-1000,2000,2000));
            RenderingServer.GlobalShaderParameterSet("ruien_fill",new Vector4(.66f,.6f,.504f,1));
            RenderingServer.GlobalShaderParameterSet("psx_fog_near",1000f);RenderingServer.GlobalShaderParameterSet("psx_fog_far",2000f);
            AddChild(new WorldEnvironment{Environment=new Godot.Environment{BackgroundMode=Godot.Environment.BGMode.Color,BackgroundColor=new Color(.025f,.025f,.025f),TonemapMode=Godot.Environment.ToneMapper.Filmic}});
            using var index=JsonDocument.Parse(File.ReadAllText(Path.Combine(folder,"area.json")));
            foreach(var key in index.RootElement.GetProperty("keys").EnumerateObject())
                foreach(var file in key.Value.GetProperty("lod0").EnumerateArray())
                {
                    var original=ResourceLoader.Load<ArrayMesh>(Path.Combine(folder,file.GetProperty("file").GetString()!));
                    var mesh=original;
                    if(args.Contains("--trim-entrances"))
                    {
                        mesh=new ArrayMesh();
                        for(int s=0;s<original.GetSurfaceCount();s++)
                        {
                            var arrays=original.SurfaceGetArrays(s);
                            RuienEntrance.TrimConnected(arrays,area);
                            if(arrays[(int)Mesh.ArrayType.Index].AsInt32Array().Length==0)continue;
                            mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,original.SurfaceGetFormat(s)&~Mesh.ArrayFormat.FlagCompressAttributes);
                            mesh.SurfaceSetName(mesh.GetSurfaceCount()-1,original.SurfaceGetName(s));
                        }
                    }
                    for(int i=0;i<mesh.GetSurfaceCount();i++)mesh.SurfaceSetMaterial(i,RuienMaterials.Get(mesh.SurfaceGetName(i)));
                    AddChild(new MeshInstance3D{Mesh=mesh});
                }
            if(args.Contains("--entrance-scene"))
            {
                var entrance=ResourceLoader.Load<PackedScene>(Arg("--entrance-scene")).Instantiate<Node3D>();
                if(args.Contains("--refresh-connection"))
                {
                    var spec=RuienEntrance.All.Single(e=>"entrance_"+e.Id==entrance.Name);
                    if(entrance.GetNodeOrNull<Node3D>("connected_passage") is {} old){entrance.RemoveChild(old);old.Free();}
                    entrance.AddChild(RuienEntrance.BuildConnection(spec));
                }
                foreach(var node in entrance.FindChildren("*","MeshInstance3D",true,false).OfType<MeshInstance3D>())
                    if(node.Mesh is ArrayMesh mesh)
                        for(int s=0;s<mesh.GetSurfaceCount();s++)
                            if(mesh.SurfaceGetMaterial(s) is {} material&&material.ResourceName.StartsWith("ruien_"))
                                mesh.SurfaceSetMaterial(s,RuienMaterials.Get(material.ResourceName));
                AddChild(entrance);
            }
            if(args.Contains("--connection"))
            {
                var spec=RuienEntrance.All.Single(e=>e.Id==Arg("--connection"));
                var entrance=new Node3D{Name="connection_"+spec.Id,Transform=spec.Local};
                entrance.AddChild(RuienEntrance.BuildConnection(spec));AddChild(entrance);
            }
            var camera=new Camera3D{Near=.035f,Far=300,Fov=78,Current=true};AddChild(camera);
            using var views=JsonDocument.Parse(File.ReadAllText(Arg("--views")));
            foreach(var shot in views.RootElement.GetProperty("shots").EnumerateArray().Where(s=>s.GetProperty("area").GetString()==area))
            {
                Vector3 Point(string key){var p=shot.GetProperty(key);return new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());}
                var at=Point("at");var look=Point("look");camera.GlobalPosition=at;
                camera.LookAt(look,MathF.Abs((look-at).Normalized().Y)>.98f?Vector3.Forward:Vector3.Up);
                if(args.Contains("--raking"))
                {
                    var lightAt=at+camera.GlobalBasis.X*1.2f+camera.GlobalBasis.Y*.5f;
                    lightImage.SetPixel(0,0,new Color(lightAt.X,lightAt.Y,lightAt.Z,8));
                    lightImage.SetPixel(0,1,new Color(0,0,0,0));
                    lightImage.SetPixel(0,2,new Color(.9f,.78f,.62f,0));
                    lightImage.SetPixel(0,3,new Color(8,0,0,0));lights.Update(lightImage);
                    RenderingServer.GlobalShaderParameterSet("ruien_light_n",1);
                    RenderingServer.GlobalShaderParameterSet("ruien_fill",new Vector4(.12f,.1f,.08f,1));
                }
                for(int i=0;i<12;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
                await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                using var image=GetViewport().GetTexture().GetImage();image.SavePng(Path.Combine(output,Path.GetFileNameWithoutExtension(shot.GetProperty("file").GetString())+".png"));
                if(args.Contains("--picks"))
                {
                    var points=shot.TryGetProperty("picks",out var chosen)
                        ?chosen.EnumerateArray().Select(p=>new Vector2(p[0].GetSingle(),p[1].GetSingle())).ToArray()
                        :new[]{new Vector2(.4f,.08f),new Vector2(.44f,.14f),new Vector2(.5f,.5f),
                            new Vector2(.38f,.12f),new Vector2(.43f,.14f),new Vector2(.50f,.16f),new Vector2(.50f,.20f),new Vector2(.55f,.17f),new Vector2(.60f,.20f),new Vector2(.70f,.27f)};
                    File.WriteAllLines(Path.Combine(output,Path.GetFileNameWithoutExtension(shot.GetProperty("file").GetString())+".picks.txt"),
                        Scheldemist.Dev.GeometryPick.At(this,camera,points));
                }
            }
            GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
