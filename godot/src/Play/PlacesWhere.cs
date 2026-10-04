using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
namespace Scheldemist.Play;

/// <summary>main.ts day.where: report real room occupancy with each engine tick.</summary>
[GamePart(363)]
public partial class PlacesWhere : Node
{
    private sealed class Room { public string Id="";public float X,Z,Y,C,S,MinX,MaxX,MinZ,MaxZ; }
    private readonly List<Room> rooms=new();
    private Func<WhereReport> previous=null!;
    private Func<WhereReport> report=null!;
    public override void _Ready()
    {
        using var data=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach(var e in data.RootElement.GetProperty("counters").EnumerateArray())
        {
            var o=e.GetProperty("origin");var b=e.GetProperty("rect");float a=e.GetProperty("yaw").GetSingle();
            rooms.Add(new(){Id=e.GetProperty("id").GetString()!,X=o.GetProperty("x").GetSingle(),Z=o.GetProperty("z").GetSingle(),Y=e.GetProperty("floor_y").GetSingle(),C=MathF.Cos(a),S=MathF.Sin(a),MinX=b.GetProperty("minX").GetSingle(),MaxX=b.GetProperty("maxX").GetSingle(),MinZ=b.GetProperty("minZ").GetSingle(),MaxZ=b.GetProperty("maxZ").GetSingle()});
        }
        previous=GameState.I.Where;report=Current;GameState.I.Where=report;
    }
    private WhereReport Current()
    {
        var old=previous();string? at=null;
        if(HomeLife.I.Info?.Lease is {} lease && HomeLife.I.Frames.TryGetValue(lease.Home,out var home) && home.Inside)at="home:"+lease.Home;
        else if(Poesje.I.Inside)at="poesje";
        else if(LandmarkLife.I.Here is {} hall)at="landmark:"+hall;
        else foreach(var r in rooms)
        {
            if(MathF.Abs(Jef.I.Y-r.Y)>.6f)continue;
            float dx=Jef.I.X-r.X,dz=Jef.I.Z-r.Z,x=dx*r.C-dz*r.S,z=dx*r.S+dz*r.C;
            if(x>r.MinX&&x<r.MaxX&&z>r.MinZ&&z<r.MaxZ){at=r.Id;break;}
        }
        return at==null?old:new(at,old.Lantern);
    }
    public override void _ExitTree(){if(GameState.I.Where==report)GameState.I.Where=previous;}
}
