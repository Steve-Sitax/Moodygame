using System;
using System.IO;
using System.Diagnostics;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World.Ruien;
public partial class RuienCoverProof : Node
{
    public override void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];
            var data=RuienData.Load();var entries=RuienEntrance.All;
            var clock=Stopwatch.StartNew();RuienCover.FullSearchProof=true;var full=new RuienCover();full.Build(data,entries);long fullMs=clock.ElapsedMilliseconds;
            clock.Restart();RuienCover.CacheForProof=true;RuienCover.FullSearchProof=false;var indexed=new RuienCover();indexed.Build(data,entries);long indexedMs=clock.ElapsedMilliseconds;
            clock.Restart();var warm=new RuienCover();warm.Build(data,entries);long warmMs=clock.ElapsedMilliseconds;
            File.WriteAllBytes(warm.CacheEntry,new byte[]{0,1,2});var repaired=new RuienCover();repaired.Build(data,entries);
            string expected=full.CoverageDigest(),actual=indexed.CoverageDigest();bool match=expected==actual&&warm.CoverageDigest()==expected&&repaired.CoverageDigest()==expected;
            var gaps=new List<object>();int connectionSamples=0;
            foreach(var entry in entries.Where(e=>e.ConnectArea.Length>0))
            {
                var frame=RuienEntrance.LinkFrame(entry);
                var path=entry.ConnectPath.Length>1?entry.ConnectPath:new[]{frame.Origin,frame*new Vector3(0,0,entry.ConnectLength)};
                for(int k=0;k+1<path.Length;k++)
                {
                    int count=Math.Max(1,(int)MathF.Ceiling(path[k].DistanceTo(path[k+1])/.2f));
                    for(int i=0;i<=count;i++)
                    {
                        var p=path[k].Lerp(path[k+1],i/(float)count)+Vector3.Up*Scheldemist.Player.Jef.Eye;
                        float cover=Math.Max(full.At(p.X,p.Z)*(1-Mathf.SmoothStep(-.7f,-.05f,p.Y)),full.Closed(p.X,p.Y,p.Z));
                        connectionSamples++;if(cover<.95f)gaps.Add(new{id=entry.Id,at=p.ToString(),cover});
                    }
                }
            }
            match&=gaps.Count==0;
            File.WriteAllText(output,JsonSerializer.Serialize(new{areas=data.Areas.Count,entrances=entries.Count,match,expected,actual,fullMs,indexedMs,warmMs,corruptCacheRebuilt=repaired.CoverageDigest()==expected,connectionSamples,gaps},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"COVER PROOF: {data.Areas.Count} areas, match={match}, full={fullMs} ms, indexed={indexedMs} ms, cached={warmMs} ms");GetTree().Quit(match?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
