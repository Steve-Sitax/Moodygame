using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

public partial class RuienEntranceSurvey : Node
{
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            var rows=new List<object>();
            foreach(var s in RuienEntrance.Load())
            {
                string original=s.ClosureSide;var options=new List<object>();
                foreach(string side in new[]{"end","street","back","left","right"})
                {
                    s.ClosureSide=side;RuienEntrance.Frames(s);var f=RuienEntrance.LinkFrame(s);
                    options.Add(new{side,at=new[]{f.Origin.X,f.Origin.Y,f.Origin.Z},dir=new[]{f.Basis.Z.X,f.Basis.Z.Z}});
                }
                rows.Add(new{id=s.Id,line=s.Line,depth=s.Depth,closure=s.Closure,connectArea=s.ConnectArea,originalSide=original,options});
            }
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));
            GD.Print("ENTRANCE SURVEY "+rows.Count);GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
