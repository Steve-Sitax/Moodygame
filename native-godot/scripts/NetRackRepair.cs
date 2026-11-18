using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Native.Game;
using Scheldemist.World;

public partial class NetRackRepair : Node3D
{
    private string Output=>ProjectSettings.GlobalizePath("res://../.scratch/net-repair");
    public override async void _Ready()
    {
        try
        {
            NativeGlobals.Ensure();Scheldemist.Render.Psx.EnsureGlobals();Directory.CreateDirectory(Output);
            if(OS.GetCmdlineUserArgs().Contains("--finish-drying-ties")){FinishDryingTies();GetTree().Quit();return;}
            if(OS.GetCmdlineUserArgs().Contains("--navigation-check")){CheckNavigation();GetTree().Quit();return;}
            var town=ResourceLoader.Load<PackedScene>("res://world/town/scene.tscn").Instantiate<Node3D>();
            AddChild(town);
            var model=ResourceLoader.Load<PackedScene>("res://assets/game-models/trades.scn").Instantiate<Node3D>();
            if(OS.GetCmdlineUserArgs().Contains("--candidate")||OS.GetCmdlineUserArgs().Contains("--promote"))Make(town,model,OS.GetCmdlineUserArgs().Contains("--promote"));
            var nodes=BakedWorld.All(town).Where(n=>n.Name.ToString().Contains("nets",StringComparison.OrdinalIgnoreCase)||n.Name.ToString().Contains("drying_net",StringComparison.OrdinalIgnoreCase)).ToArray();
            var rows=new List<object>();
            foreach(var n in nodes.Concat(new[]{model.GetNode("tr_nets")}))
            {
                var m=n as MeshInstance3D;
                rows.Add(new{name=n.Name.ToString(),path=n.IsInsideTree()?n.GetPath().ToString():n.Name.ToString(),scene=n.SceneFilePath,transform=n is Node3D n3?n3.Transform.ToString():"",global=n is Node3D g&&g.IsInsideTree()?g.GlobalTransform.ToString():"",mesh=m?.Mesh?.ResourcePath,bounds=m?.Mesh?.GetAabb().ToString(),metadata=n.GetMetaList().ToDictionary(k=>k.ToString(),k=>n.GetMeta(k).ToString()),surfaces=m?.Mesh==null?null:Enumerable.Range(0,m.Mesh.GetSurfaceCount()).Select(s=>new{index=s,name=(m.Mesh as ArrayMesh)?.SurfaceGetName(s),material=m.Mesh.SurfaceGetMaterial(s)?.ResourcePath,vertices=m.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Vertex].AsVector3Array().Take(24).Select(v=>v.ToString()),triangles=m.Mesh.SurfaceGetArrays(s)[(int)Mesh.ArrayType.Index].AsInt32Array().Length/3}).ToArray()});
            }
            File.WriteAllText(Path.Combine(Output,"inspection.json"),JsonSerializer.Serialize(rows,new JsonSerializerOptions{WriteIndented=true}));
            File.WriteAllText(Path.Combine(Output,"net-shader.gdshader"),ResourceLoader.Load<Shader>("res://world/town/resources/r000211.res").Code);
            var poleVertices=new List<object>();
            foreach(var m in BakedWorld.All(town.GetNode("quayfurniture")).OfType<MeshInstance3D>().Where(n=>n.Mesh!=null&&n.Name!="vliet_drying_net"))
                for(int s=0;s<m.Mesh.GetSurfaceCount();s++)
                {
                    var a=m.Mesh.SurfaceGetArrays(s);var v=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var near=v.Select(p=>m.GlobalTransform*p).Where(p=>p.X>-148.5&&p.X< -144&&p.Z>77&&p.Z<78&&p.Y>.2f).Distinct().ToArray();
                    if(near.Length>0)poleVertices.Add(new{node=m.Name.ToString(),mesh=m.Mesh.ResourcePath,surface=s,points=near.Select(p=>new[]{p.X,p.Y,p.Z}).ToArray()});
                }
            File.WriteAllText(Path.Combine(Output,"drying-frame.json"),JsonSerializer.Serialize(poleVertices));
            model.Free();
            if(OS.GetCmdlineUserArgs().Contains("--headless-inspect")){town.Free();GetTree().Quit();return;}
            AddChild(new WorldEnvironment{Environment=new Godot.Environment{BackgroundMode=Godot.Environment.BGMode.Color,BackgroundColor=new(.38f,.43f,.47f),AmbientLightSource=Godot.Environment.AmbientSource.Color,AmbientLightColor=new(.45f,.48f,.5f),AmbientLightEnergy=.65f}});
            AddChild(new DirectionalLight3D{RotationDegrees=new(-40,-40,0),LightEnergy=1.4f,ShadowEnabled=true});
            RenderingServer.GlobalShaderParameterSet("psx_fog_near",9000f);RenderingServer.GlobalShaderParameterSet("psx_fog_far",10000f);
            RenderingServer.GlobalShaderParameterSet("psx_hemi_sky",new Vector4(.28f,.30f,.32f,1));RenderingServer.GlobalShaderParameterSet("psx_hemi_ground",new Vector4(.035f,.032f,.028f,1));
            var camera=new Camera3D{Current=true,Fov=58,Near=.025f};AddChild(camera);GetViewport().Msaa3D=Viewport.Msaa.Msaa4X;
            foreach(var (name,eye,at) in new[]{("menders-front",new Vector3(-145,1.6f,66.5f),new Vector3(-151,1.1f,67)),("menders-close",new Vector3(-149,1.3f,65.4f),new Vector3(-151,1.2f,65.4f)),("vliet-front",new Vector3(-145,1.6f,82),new Vector3(-146.3f,1.5f,77.4f))})
            {
                camera.GlobalPosition=eye;camera.LookAt(at);for(int i=0;i<10;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                using var shot=GetViewport().GetTexture().GetImage();shot.SavePng(Path.Combine(Output,(OS.GetCmdlineUserArgs().Contains("--candidate")?"candidate-":"before-")+name+".png"));
            }
            GD.Print("NET_RACK_INSPECTED");GetTree().Quit();
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
    private static string Hash(string path)=>Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(ProjectSettings.GlobalizePath(path))));
    private void CheckNavigation()
    {
        var root=ResourceLoader.Load<PackedScene>(Path.Combine(Output,"originals/node-07947.scn")).Instantiate<Node3D>();
        try
        {
            var prior=root.GetNode<MeshInstance3D>("vliet_drying_net");var frame=root.GetNode<MeshInstance3D>("quayfurniture_-3,1,0");
            var mesh=ResourceLoader.Load<ArrayMesh>("res://assets/props/net-racks-20261117/vliet-net.res");
            Scheldemist.Town.WalkMap Map(Vector3[] faces)
            {
                var free=Enumerable.Repeat((byte)1,8*8*16).ToArray();
                var map=Scheldemist.Town.WalkMap.FromNativeData(new Rect2(-150,74,8,8),free,new short[8*8*4],new short[free.Length]);
                map.AddTriangles(NetRackGeometry.Faces((ArrayMesh)frame.Mesh).Select(p=>frame.Transform*p).ToArray());
                map.AddTriangles(faces.Select(p=>prior.Transform*p).ToArray());return map;
            }
            var before=Map(NetRackGeometry.Faces((ArrayMesh)prior.Mesh));var after=Map(mesh.GetMeta("native_solid_stand_in").AsVector3Array());
            var changes=new List<object>();int opened=0,closed=0;
            for(int z=0;z<32;z++)for(int x=0;x<32;x++)
            {
                bool a=before.NativeCellFree(x,z),b=after.NativeCellFree(x,z);if(a==b)continue;
                float wx=-150+(x+.5f)/4,wz=74+(z+.5f)/4;
                if(wx< -148.3f||wx> -144.3f||Math.Abs(wz-77.425f)>.65f)throw new InvalidOperationException("Navigation change escaped the repaired curtain");
                if(b)opened++;else closed++;changes.Add(new{x=wx,z=wz,before=a,after=b});
            }
            if(closed!=0)throw new InvalidOperationException("Net repair closed an existing walking route");
            File.WriteAllText(Path.Combine(Output,"navigation.json"),JsonSerializer.Serialize(new{passed=true,opened,closed,changes,scope="8 m local fixture at original quarter-cell world alignment; unchanged frame obstacles included, zero-height quay support"},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print("NET_NAVIGATION_PASS: "+opened+" quarter cells opened alongside the thinner curtain; no cells closed");
        }
        finally{root.Free();}
    }
    private void FinishDryingTies()
    {
        const string path="res://assets/props/net-racks-20261117/vliet-net.res";
        var current=ResourceLoader.Load<ArrayMesh>(path);
        var root=ResourceLoader.Load<PackedScene>(Path.Combine(Output,"originals/node-07947.scn")).Instantiate<Node3D>();
        try
        {
            var fixedMesh=NetRackGeometry.Drying((ArrayMesh)root.GetNode<MeshInstance3D>("vliet_drying_net").Mesh);
            if(!current.GetMeta("native_solid_stand_in").AsVector3Array().SequenceEqual(fixedMesh.GetMeta("native_solid_stand_in").AsVector3Array()))throw new InvalidOperationException("Tie repair changed collision");
            for(int s=0;s<2;s++)if(!GD.VarToBytes(current.SurfaceGetArrays(s)).SequenceEqual(GD.VarToBytes(fixedMesh.SurfaceGetArrays(s))))throw new InvalidOperationException("Tie repair changed curtain or spar");
            var a=fixedMesh.SurfaceGetArrays(2);var points=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var normals=a[(int)Mesh.ArrayType.Normal].AsVector3Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
            if(points.Any(p=>!p.IsFinite())||normals.Any(n=>!n.IsFinite()||Math.Abs(n.Length()-1)>.01f))throw new InvalidOperationException("Invalid tie attributes");
            for(int i=0;i<ix.Length;i+=3)if((points[ix[i+1]]-points[ix[i]]).Cross(points[ix[i+2]]-points[ix[i]]).LengthSquared()<1e-18f)throw new InvalidOperationException("Degenerate tie");
            string backup=Path.Combine(Output,"vliet-before-final-ties.res");if(!File.Exists(backup))File.Copy(ProjectSettings.GlobalizePath(path),backup);
            if(ResourceSaver.Save(fixedMesh,path,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(path);
            File.WriteAllText(Path.Combine(Output,"ties.json"),JsonSerializer.Serialize(new{passed=true,collisionUnchanged=true,curtainAndSparUnchanged=true,visualTriangles=NetRackGeometry.Faces(fixedMesh).Length/3,collisionTriangles=92}));
            GD.Print("NET_TIES_FINISHED");
        }
        finally{root.Free();}
    }
    private void Make(Node3D town,Node3D model,bool promote)
    {
        const string solidPath="res://world/town/resources/r001552.res",netPath="res://world/town/resources/r001553.res",modelPath="res://assets/game-models/resources/r001374.res",rootPath="res://world/town/roots/node-07947.scn";
        string backups=Path.Combine(Output,"originals");Directory.CreateDirectory(backups);
        foreach(string path in new[]{solidPath,netPath,modelPath,rootPath}){string backup=Path.Combine(backups,Path.GetFileName(path));if(!File.Exists(backup))File.Copy(ProjectSettings.GlobalizePath(path),backup);else if(promote&&Hash(backup)!=Hash(path))throw new IOException("Asset changed since inspection: "+path);}
        var old=ResourceLoader.Load<ArrayMesh>(Path.Combine(backups,"r001552.res"));var structure=NetRackGeometry.Structure(old);var net=NetRackGeometry.Nets();var prototype=NetRackGeometry.Join(structure,net);
        prototype.SetMeta("native_solid_skip",Enumerable.Range(0,prototype.GetSurfaceCount()).ToArray());prototype.SetMeta("native_solid_stand_in",NetRackGeometry.Faces(old));
        var originalRoot=ResourceLoader.Load<PackedScene>(Path.Combine(backups,"node-07947.scn")).Instantiate<Node3D>();var dryOld=originalRoot.GetNode<MeshInstance3D>("vliet_drying_net");var dry=NetRackGeometry.Drying((ArrayMesh)dryOld.Mesh);
        var oldFrame=originalRoot.GetNode<MeshInstance3D>("quayfurniture_-3,1,0");var frameNode=town.GetNode<MeshInstance3D>("quayfurniture/quayfurniture_-3,1,0");var newFrame=NetRackGeometry.DryingFrame((ArrayMesh)oldFrame.Mesh,frameNode.GlobalTransform);
        var furniture=ResourceLoader.Load<PackedScene>("res://assets/game-models/quayfurniture.scn").Instantiate<Node3D>();var template=furniture.GetNode<MeshInstance3D>("nets_drying");string templatePath=template.Mesh.ResourcePath;
        string templateBackup=Path.Combine(backups,"drying-prototype.res");if(!File.Exists(templateBackup))File.Copy(ProjectSettings.GlobalizePath(templatePath),templateBackup);else if(promote&&Hash(templateBackup)!=Hash(templatePath))throw new IOException("Drying prototype changed");
        var dryTemplate=NetRackGeometry.DryingPrototype(ResourceLoader.Load<ArrayMesh>(templateBackup));furniture.Free();
        var preserved=Snapshot(town.GetNode<Node3D>("quayfurniture"));originalRoot.Free();
        var solidNode=town.GetNode<MeshInstance3D>("trades/trade_nets/nets_trades_solid");var netNode=town.GetNode<MeshInstance3D>("trades/trade_nets/nets_trades_decal");var dryNode=town.GetNode<MeshInstance3D>("quayfurniture/vliet_drying_net");
        solidNode.Mesh=structure;netNode.Mesh=net;dryNode.Mesh=dry;frameNode.Mesh=newFrame;model.GetNode<MeshInstance3D>("tr_nets").Mesh=prototype;
        var targets=new[]{(solidPath,structure),(netPath,net),(modelPath,prototype),("res://assets/props/net-racks-20261117/vliet-net.res",dry),("res://assets/props/net-racks-20261117/vliet-frame.res",newFrame),(templatePath,dryTemplate)};
        var report=new List<object>();
        foreach(var (path,mesh) in targets)
        {
            int count=NetRackGeometry.Faces(mesh).Length/3;
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                var a=mesh.SurfaceGetArrays(s);var v=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
                if(v.Length!=n.Length||v.Length!=uv.Length||v.Any(p=>!p.IsFinite())||n.Any(p=>!p.IsFinite()||Math.Abs(p.Length()-1)>.01f)||uv.Any(p=>!p.IsFinite()))throw new InvalidOperationException("Invalid net attributes: "+path);
                if(!(path.EndsWith("vliet-frame.res")&&s==0))for(int i=0;i<ix.Length;i+=3)if((v[ix[i+1]]-v[ix[i]]).Cross(v[ix[i+2]]-v[ix[i]]).LengthSquared()<1e-18f)throw new InvalidOperationException("Degenerate net triangle: "+path+" surface "+s);
            }
            int collision=mesh.HasMeta("native_solid_stand_in")?mesh.GetMeta("native_solid_stand_in").AsVector3Array().Length/3:0;
            report.Add(new{path,visualTriangles=count,collisionTriangles=collision,bounds=mesh.GetAabb().ToString()});
        }
        foreach(var (path,mesh) in targets)
        {
            string save=promote?path:Path.Combine(Output,"candidate-"+Path.GetFileName(path));Directory.CreateDirectory(Path.GetDirectoryName(ProjectSettings.GlobalizePath(save))!);
            if(ResourceSaver.Save(mesh,save,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(save);
            if(promote)mesh.TakeOverPath(path);
        }
        if(promote)
        {
            using var packed=new PackedScene();var root=town.GetNode<Node3D>("quayfurniture");if(packed.Pack(root)!=Error.Ok||ResourceSaver.Save(packed,rootPath,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException(rootPath);
            var reloaded=ResourceLoader.Load<PackedScene>(rootPath,null,ResourceLoader.CacheMode.Ignore).Instantiate<Node3D>();var after=Snapshot(reloaded);reloaded.Free();
            if(preserved.Count!=after.Count||preserved.Any(k=>!after.TryGetValue(k.Key,out var value)||k.Value!=value))throw new InvalidOperationException("Unrelated quay furniture changed");
            File.WriteAllText(Path.Combine(Output,"preservation.json"),JsonSerializer.Serialize(new{passed=true,checks=preserved.Count,unchanged=after},new JsonSerializerOptions{WriteIndented=true}));
        }
        File.WriteAllText(Path.Combine(Output,promote?"installed.json":"candidate.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
        GD.Print("NET_RACK_"+(promote?"PROMOTED":"CANDIDATE"));
    }
    private static Dictionary<string,string> Snapshot(Node root)
    {
        var rows=new Dictionary<string,string>();
        foreach(var n in BakedWorld.All(root))
        {
            string key=root.GetPathTo(n).ToString();rows[key]=n.GetClass()+"|"+(n is Node3D n3?n3.Transform+"|"+n3.Visible:"")+"|"+string.Join("|",n.GetMetaList().OrderBy(k=>k.ToString()).Select(k=>k+"="+n.GetMeta(k)));
            if(n is not MeshInstance3D{Mesh:not null} m||n.Name=="vliet_drying_net"||n.Name=="quayfurniture_-3,1,0")continue;
            using var h=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            for(int s=0;s<m.Mesh.GetSurfaceCount();s++){h.AppendData(GD.VarToBytes(m.Mesh.SurfaceGetArrays(s)));h.AppendData(System.Text.Encoding.UTF8.GetBytes(m.Mesh.SurfaceGetMaterial(s)?.ResourcePath??""));}
            rows[key+"/mesh"]=Convert.ToHexString(h.GetHashAndReset());
        }
        return rows;
    }
}
