using System;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Game;
using Scheldemist.Native.World;
using Scheldemist.Render;
namespace Scheldemist.Native.Interiors;
public partial class FurnitureMaterialIntake : Node
{
    public override void _Ready(){try{Repair();GetTree().Quit();}catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}}
    public static void Repair()
    {
        NativeGlobals.Ensure();int count=0;var label=new MeshInstance3D{Name="Furniture"};
        foreach(string file in Directory.GetFiles(ProjectSettings.GlobalizePath("res://assets/furniture/resources"),"*.res"))
        {
            string path="res://assets/furniture/resources/"+Path.GetFileName(file);
            if(ResourceLoader.Load<Resource>(path) is not BaseMaterial3D standard)continue;
            var material=NativeTownMaterials.FromStandard(standard,label);var kind=Psx.KindOf(material.Shader)!.Value;
            material.Shader.SetMeta("native_psx_kind",JsonSerializer.Serialize(kind));
            string shaderPath="res://assets/furniture/resources/world-shader-"+(kind.Unlit?"unlit":"lit")+(kind.TwoSided?"-two":"-back")+".res";
            if(ResourceSaver.Save(material.Shader,shaderPath,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(shaderPath);
            material.Shader.TakeOverPath(shaderPath);
            if(ResourceSaver.Save(material,path,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(path);
            material.TakeOverPath(path);count++;
        }
        label.Free();GD.Print("Furniture materials baked onto the existing town shader path: "+count);
    }
}
