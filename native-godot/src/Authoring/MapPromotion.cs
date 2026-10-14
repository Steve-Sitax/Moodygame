using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
namespace Scheldemist.Native.Authoring;
public static class MapPromotion
{
    public static void Write(AuthorDistrict district,LayoutDocument document,IReadOnlyDictionary<string,AuthorAsset> assets,string? testDestination=null)
    {
        document.Validate(district.Id,assets);
        string path=testDestination??district.Scene.ResourcePath;
        if(testDestination==null&&!path.EndsWith(".objects.tscn",StringComparison.Ordinal))throw new InvalidOperationException("This district needs a native map seed before promotion.");
        string file=ProjectSettings.GlobalizePath(path);string directory=Path.GetDirectoryName(file)!;Directory.CreateDirectory(directory);
        string temporary=Path.Combine(directory,"map-"+Guid.NewGuid().ToString("N")+".tscn");var root=new Node3D{Name="Objects"};
        try
        {
            foreach(var placement in document.Objects)
            {
                var node=new AuthoredObject{ObjectId=placement.Id,Asset=assets[placement.Asset],Name="object_"+placement.Id};root.AddChild(node);node.Owner=root;node.Pose(placement);node.SeedPlacement=JsonSerializer.Serialize(placement);
            }
            var packed=new PackedScene();if(packed.Pack(root)!=Error.Ok||ResourceSaver.Save(packed,temporary)!=Error.Ok)throw new IOException("Could not write the map scene.");
            if(File.Exists(file))
            {
                string backup=Path.GetFullPath(Path.Combine(ProjectSettings.GlobalizePath("res://"),"..",".scratch","map-backups",Guid.NewGuid().ToString("N")));
                Directory.CreateDirectory(backup);File.Copy(file,Path.Combine(backup,Path.GetFileName(file)));
            }
            File.Move(temporary,file,true);packed.TakeOverPath(path);if(testDestination==null)district.Scene=packed;
        }
        finally{root.Free();if(File.Exists(temporary))File.Delete(temporary);}
    }
}
