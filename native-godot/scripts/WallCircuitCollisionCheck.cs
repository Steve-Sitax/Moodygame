using Godot;
using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text.Json;
using System.Collections.Generic;

// Isolated fresh-resource check using the gameplay collision extractor; never starts actors or writes scenes.
public partial class WallCircuitCollisionCheck : Node
{
    public override void _Ready()
    {
        try
        {
            string folder=ProjectSettings.GlobalizePath("res://proof/wall-circuit");
            var manifest=JsonDocument.Parse(File.ReadAllText(Path.Combine(folder,"mesh-manifest.json"))).RootElement;
            var extractor=typeof(Scheldemist.World.Solid).GetMethod("FacesOf",BindingFlags.Instance|BindingFlags.NonPublic)!;
            var records=new List<object>();long triangles=0;
            foreach(var entry in manifest.EnumerateObject())
            {
                var mesh=ResourceLoader.Load<Mesh>(entry.Name,cacheMode:ResourceLoader.CacheMode.Ignore);
                using var solid=new Scheldemist.World.Solid();
                var faces=(Vector3[])extractor.Invoke(solid,new object[]{mesh})!;
                if(faces.Length%3!=0||faces.Any(p=>!p.IsFinite()))throw new IOException("Invalid collision: "+entry.Name);
                if(faces.Length>0)
                {
                    using var shape=new ConcavePolygonShape3D{BackfaceCollision=true};shape.SetFaces(faces);
                    if(!shape.GetFaces().SequenceEqual(faces))throw new IOException("Collision roundtrip differs: "+entry.Name);
                }
                triangles+=faces.Length/3;records.Add(new{resource=entry.Name,triangles=faces.Length/3});
            }
            File.WriteAllText(Path.Combine(folder,"installed-collision.json"),JsonSerializer.Serialize(new{passed=true,meshResources=records.Count,triangles,method="Fresh saved meshes through gameplay Solid.FacesOf and ConcavePolygonShape3D roundtrip; no actor navigation simulation",meshes=records},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"Collision check PASS: {records.Count} meshes, {triangles} triangles");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
