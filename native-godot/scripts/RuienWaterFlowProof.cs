using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;

public partial class RuienWaterFlowProof : Node
{
    public override void _Ready()
    {
        var errors = new List<string>();
        void Check(bool ok, string label) { if (!ok) errors.Add(label); }
        RuienWaterFlow Line(Vector2[] path, Vector2 ends) => new(new RuienData.WaterSheet { FlowGuide=path, FlowEnds=ends, FlowSpeed=.04f });
        var east = Line(new[]{new Vector2(-10,0), new Vector2(10,0)},new Vector2(20,0));
        Check(east.At(Vector2.Zero).DistanceTo(new Vector2(.04f,0)) < 1e-6f,"east outlet");
        var west = Line(new[]{new Vector2(-10,0), new Vector2(10,0)},new Vector2(0,20));
        Check(west.At(Vector2.Zero).DistanceTo(new Vector2(-.04f,0)) < 1e-6f,"west outlet");
        var split = Line(new[]{new Vector2(-10,0), new Vector2(10,0)},Vector2.Zero);
        Check(split.At(new Vector2(-5,0)).X < 0 && split.At(new Vector2(5,0)).X > 0 && split.At(Vector2.Zero).Length() < 1e-6f,"two-outlet divide");
        var bend = Line(new[]{new Vector2(0,0),new Vector2(10,0),new Vector2(10,10)},new Vector2(20,0));
        Check(bend.At(new Vector2(1,0)).X > .035f && bend.At(new Vector2(10,9)).Y > .035f,"bend follows channel");
        var reversed = Line(new[]{new Vector2(10,10),new Vector2(10,0),new Vector2(0,0)},new Vector2(0,20));
        Check(bend.At(new Vector2(10,9)).DistanceTo(reversed.At(new Vector2(10,9))) < 1e-6f,"path reversal invariant");
        var room = new RuienWaterFlow(new RuienData.WaterSheet { FlowTargets=new[]{new Vector3(0,5,0)},FlowSpeed=.018f });
        Check(room.At(Vector2.Zero).DistanceTo(new Vector2(0,.018f)) < 1e-6f,"room open portal");
        var data=RuienData.Load();int sheets=0,samples=0;
        foreach(var area in data.Areas) foreach(var sheet in area.Water)
        {
            var flow=new RuienWaterFlow(sheet);
            if(!flow.Varying)continue;
            sheets++;
            foreach(var p in sheet.FlowGuide.Concat(sheet.Outline))
            {
                var velocity=flow.At(p);samples++;
                Check(float.IsFinite(velocity.X)&&float.IsFinite(velocity.Y)&&velocity.Length()<=sheet.FlowSpeed+1e-5f,area.Id+"/"+sheet.Id+" finite bounded speed");
            }
        }
        Check(sheets==339,"all 339 planned water sheets loaded");
        var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];
        File.WriteAllText(output,JsonSerializer.Serialize(new{pass=errors.Count==0,sheets,samples,errors},new JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"WATER FLOW PROOF: {sheets} sheets, {samples} samples, {errors.Count} errors");
        GetTree().Quit(errors.Count==0?0:1);
    }
}
