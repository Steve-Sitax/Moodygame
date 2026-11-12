using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.Native.World;

/// <summary>Opt-in layer isolation at an actual review camera; restores every changed render property.</summary>
public static class NativeRuienWaterReview
{
    public static async Task Profile(NativeTownGame game, string output)
    {
        var meshes=game.View.FindChildren("*","MeshInstance3D",true,false).OfType<MeshInstance3D>().Where(m=>m.IsVisibleInTree()&&m.Mesh is {} mesh&&mesh.GetSurfaceCount()>0).ToArray();
        var water=meshes.Where(m=>m.GetActiveMaterial(0) is ShaderMaterial s&&s.Shader?.ResourcePath=="res://shaders/ruien_water.gdshader").ToArray();
        var river=meshes.Where(m=>m.Name.ToString()=="river_sheet").ToArray();
        var mist=meshes.Where(m=>m.Name.ToString().StartsWith("mist_")).ToArray();
        foreach(var (name,selected) in new[]{("normal",Array.Empty<MeshInstance3D>()),("no_ruien_water",water),("no_river",river),("no_mist",mist)})
        {
            var layers=selected.Select(m=>m.Layers).ToArray();
            try
            {
                foreach(var mesh in selected)mesh.Layers=0;
                for(int i=0;i<8;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
                using var timing=new Scheldemist.World.Ruien.RuienFrameProfile(game.GetTree());
                for(int i=0;i<32;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
                File.WriteAllText(Path.Combine(output,"frame-profile-"+name+".json"),System.Text.Json.JsonSerializer.Serialize(timing.Finish(name)));
            }
            finally{for(int i=0;i<selected.Length;i++)selected[i].Layers=layers[i];}
        }
    }

    public static async Task Motion(NativeTownGame game, string output, string name)
    {
        var samples = new System.Collections.Generic.List<object>();
        ulong started = Time.GetTicksMsec();
        for (int i = 0; i < 16; i++)
        {
            while (Time.GetTicksMsec() - started < (ulong)(i * 200))
                await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame);
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var image = game.GetViewport().GetTexture().GetImage();
            image.Resize(960, 960 * image.GetHeight() / image.GetWidth(), Image.Interpolation.Lanczos);
            string file = name + "__motion_" + i.ToString("D2") + ".png";
            image.SavePng(Path.Combine(output, file));
            samples.Add(new { file, elapsedMs = Time.GetTicksMsec() - started });
        }
        File.WriteAllText(Path.Combine(output, name + "__motion.json"), System.Text.Json.JsonSerializer.Serialize(samples));
    }

    public static async Task Capture(NativeTownGame game, string output, string name)
    {
        var meshes=game.View.FindChildren("*","MeshInstance3D",true,false).OfType<MeshInstance3D>().Where(m=>m.IsVisibleInTree() && m.Mesh is {} mesh && mesh.GetSurfaceCount()>0).ToArray();
        var mist=meshes.Where(m=>m.Name.ToString().StartsWith("mist_")).ToArray();
        var river=meshes.Where(m=>m.Name.ToString()=="river_sheet").ToArray();
        var water=meshes.Where(m=>m.GetActiveMaterial(0) is ShaderMaterial s && s.Shader?.ResourcePath=="res://shaders/ruien_water.gdshader").ToArray();
        async Task Save(string tag)
        {
            for(int i=0;i<24;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            using var image=game.GetViewport().GetTexture().GetImage();
            image.Resize(960,960*image.GetHeight()/image.GetWidth(),Image.Interpolation.Lanczos);
            image.SavePng(Path.Combine(output,name+"__diagnostic_"+tag+".png"));
        }
        async Task Hide(string tag,MeshInstance3D[] selected)
        {
            var layers=selected.Select(m=>m.Layers).ToArray();
            try{foreach(var m in selected)m.Layers=0;await Save(tag);}
            finally{for(int i=0;i<selected.Length;i++)selected[i].Layers=layers[i];}
        }
        async Task ShaderVariant(string tag,string from,string to)
        {
            var original=water.Select(m=>m.MaterialOverride).ToArray();
            try
            {
                Shader? shader=null;
                foreach(var m in water)
                {
                    var material=(ShaderMaterial)m.GetActiveMaterial(0).Duplicate();
                    string code=material.Shader.Code;
                    if(!code.Contains(from,StringComparison.Ordinal))throw new InvalidOperationException("Water diagnostic anchor missing: "+tag);
                    material.Shader=shader??=new Shader{Code=code.Replace(from,to,StringComparison.Ordinal)};
                    m.MaterialOverride=material;
                }
                await Save(tag);
            }
            finally{for(int i=0;i<water.Length;i++)water[i].MaterialOverride=original[i];}
        }
        File.WriteAllLines(Path.Combine(output,name+"__diagnostic_layers.txt"),
            mist.Concat(river).Concat(water).Select(m=>$"{m.GetPath()} visible={m.IsVisibleInTree()} layers={m.Layers} bounds={m.GlobalTransform*m.GetAabb()}"));
        await Save("baseline");
        if(game.Flag("ruien-review-underlay"))
        {
            var cover=mist.Concat(water).Distinct().ToArray();var coverLayers=cover.Select(m=>m.Layers).ToArray();
            try
            {
                foreach(var m in cover)m.Layers=0;
                await Save("no_water_or_mist");
                File.WriteAllLines(Path.Combine(output,name+"__underlay_picks.txt"),Scheldemist.Dev.GeometryPick.At(game.View,game.Cam,new[]{new Vector2(.5f,.5f),new Vector2(.55f,.6f)}));
                var solid=meshes.Where(m=>m.GetParent()?.Name.ToString()=="ruien_network_l95"&&!cover.Contains(m)).ToArray();
                await Hide("no_l95_solid",solid);
                await Hide("only_l95",meshes.Except(solid).ToArray());
                var copies=game.View.FindChildren("*","MultiMeshInstance3D",true,false).OfType<MultiMeshInstance3D>().Where(m=>m.IsVisibleInTree()).ToArray();
                var layers=copies.Select(m=>m.Layers).ToArray();
                try{foreach(var m in copies)m.Layers=0;await Save("no_copies");}
                finally{for(int i=0;i<copies.Length;i++)copies[i].Layers=layers[i];}
                File.WriteAllLines(Path.Combine(output,name+"__underlay_solids.txt"),solid.SelectMany(m=>Enumerable.Range(0,m.Mesh.GetSurfaceCount()).Select(s=>$"{m.GetPath()} surface={s} name={(m.Mesh as ArrayMesh)?.SurfaceGetName(s)} material={m.GetActiveMaterial(s)?.ResourceName} bounds={m.GlobalTransform*m.GetAabb()}")));
            }
            finally{for(int i=0;i<cover.Length;i++)cover[i].Layers=coverLayers[i];}
            return;
        }
        await Hide("no_mist",mist);
        await Hide("no_river",river);
        await Hide("no_ruien_water",water);
        await ShaderVariant("black_water","ALBEDO = col;","ALBEDO = vec3(0.0);");
        await ShaderVariant("no_reflections","col = mix(col, refl, fres) + glint * (1.0 - hit * 0.6) + streak * fres * 0.08;","// reflection disabled for this diagnostic frame");
        await ShaderVariant("no_screen_reflection","refl = mix(miss, refl, hit);","refl = miss;");
        await ShaderVariant("no_glint","glint * (1.0 - hit * 0.6)","vec3(0.0)");
        await ShaderVariant("no_streak","streak * fres * 0.08","vec3(0.0)");
        await ShaderVariant("no_transmission","vec3 col = below * tr + murk * lit * (1.0 - tr);","vec3 col = murk * lit;");
    }
}
