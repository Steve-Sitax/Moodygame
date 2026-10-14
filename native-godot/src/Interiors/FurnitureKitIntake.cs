using System;
using System.IO;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.World;
namespace Scheldemist.Native.Interiors;

/// <summary>Explicit intake of the furn-kit manifest; native scenes are the only runtime dependency.</summary>
public partial class FurnitureKitIntake : Node
{
    public override void _Ready()
    {
        try {Import(Scheldemist.Native.Game.NativeArguments.Arg("kit-dir"));GetTree().Quit();}catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
    public static void Import(string directory)
    {
        if(directory=="")throw new InvalidOperationException("Pass --kit-dir with the reviewed furniture manifest folder.");
        using var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(directory,"furniture.json")));
        if(manifest.RootElement.GetProperty("version").GetInt32()!=1)throw new InvalidDataException("Unsupported furniture kit manifest.");
        if(manifest.RootElement.GetProperty("pieces").EnumerateArray().Any(p=>p.GetProperty("texture").GetProperty("px").GetInt32()<1024))
            throw new InvalidDataException("Review the production kit first: geometry-only and fast texture builds cannot be shipped.");
        DirAccess.MakeDirRecursiveAbsolute("res://assets/furniture");var catalog=ResourceLoader.Load<AuthorCatalog>("res://assets/library/furniture-catalog.tres");
        DirAccess.MakeDirRecursiveAbsolute("res://assets/furniture/resources");
        var textures=new Dictionary<string,Texture2D>();
        foreach(var family in manifest.RootElement.GetProperty("pieces").EnumerateArray().GroupBy(p=>p.GetProperty("glb").GetString()!))
        {
            if(Path.GetFileName(family.Key)!=family.Key)throw new InvalidDataException("The manifest family must be a file name.");
            var state=new GltfState();var document=new GltfDocument();var error=document.AppendFromFile(Path.Combine(directory,family.Key),state);if(error!=Error.Ok)throw new IOException(error.ToString());
            var source=document.GenerateScene(state);
            var saved=new HashSet<ulong>();int resourceNumber=0;
            void Save(Resource resource,string path)
            {
                var result=ResourceSaver.Save(resource,path,ResourceSaver.SaverFlags.Compress);
                if(result!=Error.Ok)throw new IOException("Cannot save "+path+": "+result);
                resource.TakeOverPath(path);
            }
            void Externalize(Resource resource)
            {
                if(!saved.Add(resource.GetInstanceId()))return;
                if(resource is BaseMaterial3D material)
                {
                    material.TextureFilter=BaseMaterial3D.TextureFilterEnum.LinearWithMipmapsAnisotropic;
                    foreach(var property in material.GetPropertyList())
                    {
                        if(property["type"].AsInt32()!=(int)Variant.Type.Object)continue;
                        string name=property["name"].AsString();
                        if(material.Get(name).AsGodotObject() is not Texture2D texture)continue;
                        using var image=texture.GetImage();
                        if(image.IsCompressed()&&image.Decompress()!=Error.Ok)throw new IOException("Cannot decode furniture texture.");
                        string hash=Convert.ToHexString(SHA256.HashData(image.SavePngToBuffer())).ToLowerInvariant();
                        if(!textures.TryGetValue(hash,out var native))
                        {
                            if(!image.HasMipmaps()&&image.GenerateMipmaps()!=Error.Ok)throw new IOException("Cannot mipmap furniture texture.");
                            native=ImageTexture.CreateFromImage(image);textures.Add(hash,native);
                            Save(native,"res://assets/furniture/resources/texture-"+hash+".res");
                        }
                        material.Set(name,native);
                    }
                }
                if(resource is Mesh mesh)
                    for(int i=0;i<mesh.GetSurfaceCount();i++)if(mesh.SurfaceGetMaterial(i) is {} surfaceMaterial)Externalize(surfaceMaterial);
                Save(resource,"res://assets/furniture/resources/"+Path.GetFileNameWithoutExtension(family.Key)+"-r"+(resourceNumber++).ToString("D4")+".res");
            }
            try
            {
                foreach(var mesh in BakedWorld.All(source).OfType<MeshInstance3D>())
                {
                    if(mesh.Mesh is {} geometry)Externalize(geometry);
                    if(mesh.MaterialOverride is {} material)Externalize(material);
                    for(int i=0;i<mesh.GetSurfaceOverrideMaterialCount();i++)if(mesh.GetSurfaceOverrideMaterial(i) is {} surface)Externalize(surface);
                }
                foreach(var piece in family)
                {
                    string id=piece.GetProperty("id").GetString()!;if(!LayoutDocument.ValidId(id))throw new InvalidDataException("Invalid kit id.");
                    string node=piece.GetProperty("node").GetString()!;var original=BakedWorld.All(source).OfType<Node3D>().Single(n=>n.Name.ToString()==node);
                    var visual=(Node3D)original.Duplicate();visual.Transform=Transform3D.Identity;
                    foreach(var far in BakedWorld.All(visual).OfType<Node3D>().Where(n=>n.Name.ToString().EndsWith("_far")))far.Visible=false;
                    var root=new Node3D{Name=node};root.AddChild(visual);
                    var body=new StaticBody3D{Name="Solid",CollisionLayer=2,CollisionMask=0};root.AddChild(body);
                    foreach(var collision in piece.GetProperty("collision").EnumerateArray())body.AddChild(new CollisionShape3D{Name="Shape",Shape=new BoxShape3D{Size=Vector(collision.GetProperty("size"))},Position=Vector(collision.GetProperty("at")),Rotation=new(0,Mathf.DegToRad(collision.GetProperty("yaw").GetSingle()),0)});
                    foreach(var child in BakedWorld.All(root).Where(n=>n!=root))child.Owner=root;var scene=new PackedScene();scene.Pack(root);string path="res://assets/furniture/"+id+".tscn";ResourceSaver.Save(scene,path);scene.TakeOverPath(path);root.Free();
                    var points=piece.GetProperty("points").EnumerateArray().ToArray();var seats=points.Where(p=>p.GetProperty("kind").GetString()=="seat").ToArray();
                    var use=points.FirstOrDefault(p=>p.GetProperty("kind").GetString() is "sleep" or "use");
                    string kind=id.StartsWith("bed")||id.StartsWith("mattress")?"bed":id.StartsWith("chair")?"chair":id.StartsWith("stool")?"stool":id.StartsWith("bench")?"bench":id.StartsWith("counter")?"counter":id.StartsWith("stove")||id.StartsWith("range")?"stove":id.StartsWith("clock")?"clock":id.StartsWith("table")||id.StartsWith("desk")?"table":id=="armoire"?"cupboard":id=="shelf-wall"?"shelf":id;
                    var asset=new AuthorAsset{Id=id,Title=piece.GetProperty("title").GetString()!,Category=piece.GetProperty("category").GetString()!,Scene=ResourceLoader.Load<PackedScene>(path),FurnitureKind=kind,Footprint=Vector(piece.GetProperty("footprint")),FootprintOffset=Vector(piece.GetProperty("footprintOffset")),SeatPoints=seats.Select(p=>{var at=Vector(p.GetProperty("at"));return new Vector3(at.X,0,at.Z);}).ToArray(),SeatHeight=seats.Length>0?Vector(seats[0].GetProperty("at")).Y:.46f,UsePoint=use.ValueKind!=JsonValueKind.Undefined?Vector(use.GetProperty("at")):Vector3.Up*.5f,StandPoint=new(0,0,.7f)};
                    string assetPath="res://assets/library/"+id+".tres";ResourceSaver.Save(asset,assetPath);asset.TakeOverPath(assetPath);
                    for(int i=catalog.Assets.Count-1;i>=0;i--)if(catalog.Assets[i].Id==id)catalog.Assets.RemoveAt(i);catalog.Assets.Add(asset);
                }
            }
            finally {source.Free();}
        }
        ResourceSaver.Save(catalog,"res://assets/library/furniture-catalog.tres");
        var receipt=new {format=1,contract="docs/furniture.md",pieces=manifest.RootElement.GetProperty("pieces").EnumerateArray().Select(p=>p.GetProperty("id").GetString()).ToArray(),mipmaps=true,
            sources=manifest.RootElement.GetProperty("pieces").EnumerateArray().Select(p=>p.GetProperty("glb").GetString()!).Append("furniture.json").Distinct().Order(StringComparer.Ordinal).Select(file=>new{file,sha256=Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(Path.Combine(directory,file)))).ToLowerInvariant()}).ToArray()};
        File.WriteAllText(ProjectSettings.GlobalizePath("res://assets/furniture/intake.json"),JsonSerializer.Serialize(receipt,new JsonSerializerOptions{WriteIndented=true})+"\n");
        FurnitureMaterialIntake.Repair();
        GD.Print("Reviewed furniture kit imported as native scenes; stable library aliases retained.");
    }
    private static Vector3 Vector(JsonElement array)=>new(array[0].GetSingle(),array[1].GetSingle(),array[2].GetSingle());
}
