using System;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using Godot;
using Scheldemist.Native.World;
using Scheldemist.World;
using Scheldemist.World.Ruien;

public partial class StartupCacheProof : Node
{
    public override void _Ready()
    {
        try
        {
            var fakeMain=new Scheldemist.Main();
            typeof(Scheldemist.Main).GetProperty("I")!.SetValue(null,fakeMain);
            string folder=ProjectSettings.GlobalizePath("user://startup-cache-tests/"+Guid.NewGuid().ToString("N"));Directory.CreateDirectory(folder);
            var town=new Node3D();AddChild(town);
            using var box=new BoxMesh();
            var source=new ArrayMesh();source.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,box.GetMeshArrays());
            string sourcePath=Path.Combine(folder,"source.res");ResourceSaver.Save(source,sourcePath);source.TakeOverPath(sourcePath);
            var item=new MeshInstance3D{Name="geometry",Mesh=source};town.AddChild(item);
            var keyMethod=typeof(NativeCutCache).GetMethod("Key",BindingFlags.Static|BindingFlags.NonPublic)!;
            string Key()=>(string)keyMethod.Invoke(null,new object[]{town,true,true})!;
            void Check(bool ok,string label){if(!ok)throw new Exception(label);}
            Check(StartupCacheCode.Revision(typeof(Scheldemist.Main).Assembly).Length==64 && StartupCacheCode.Revision(typeof(NativeCutCache).Assembly).Length==64,"Build-time geometry revisions present");
            string first=Key(); Check(first==Key(),"Stable input key");
            item.Position=Vector3.Right; Check(first!=Key(),"Moved geometry invalidates");item.Position=Vector3.Zero;
            var timestamp=System.IO.File.GetLastWriteTimeUtc(sourcePath);
            var changed=new ArrayMesh();using var wide=new BoxMesh{Size=new Vector3(3,2,1)};changed.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,wide.GetMeshArrays());
            ResourceSaver.Save(changed,sourcePath);System.IO.File.SetLastWriteTimeUtc(sourcePath,timestamp);
            Check(first!=Key(),"Changed bytes with preserved timestamp invalidate");
            string resultPath=Path.Combine(folder,"result.res");changed.SetMeta("native_solid_stand_in",new[]{Vector3.One});ResourceSaver.Save(changed,resultPath);
            string Digest()=>Convert.ToHexString(SHA256.HashData(System.IO.File.ReadAllBytes(resultPath)));
            void Manifest(bool extra=false)=>System.IO.File.WriteAllText(Path.Combine(folder,"complete.json"),JsonSerializer.Serialize(new { Key="fixture",Werf=4,Notes=new[]{"test"},Entries=extra?new[]{new{Node="geometry",File="result.res",Sha256=Digest(),Copies=false},new{Node="missing",File="missing.res",Sha256="bad",Copies=false}}:new[]{new{Node="geometry",File="result.res",Sha256=Digest(),Copies=false}}}));
            var read=typeof(NativeCutCache).GetMethod("TryRead",BindingFlags.Static|BindingFlags.NonPublic)!;
            bool Read()=>(bool)read.Invoke(null,new object?[]{town,folder,"fixture",null})!;
            Manifest();Check(Read(),"Valid generation loads");
            Check(item.Mesh.GetAabb()==changed.GetAabb() && item.Mesh.GetMeta("native_solid_stand_in").AsVector3Array().SequenceEqual(new[]{Vector3.One}),"Geometry and collision metadata restored");
            item.Mesh=source;Manifest(true);Check(!Read()&&item.Mesh==source,"Incomplete generation has no partial mutations");
            Manifest();System.IO.File.AppendAllText(resultPath,"damaged");Check(!Read()&&item.Mesh==source,"Corrupt generation rejected before mutation");
            GD.Print("STARTUP_CACHE_PASS: stable keys, placement and content invalidation, metadata restoration, corrupt/incomplete atomic fallback");
            Scheldemist.Render.Psx.EnsureGlobals();Ruien.EnsureGlobals();
            foreach(string name in new[]{"psx_fog_color","psx_hemi_sky","psx_hemi_ground"})RenderingServer.GlobalShaderParameterAdd(name,RenderingServer.GlobalShaderParameterType.Vec4,Vector4.Zero);
            foreach(string name in new[]{"psx_time","psx_fog_near","psx_fog_far"})RenderingServer.GlobalShaderParameterAdd(name,RenderingServer.GlobalShaderParameterType.Float,0f);
            using var emptyImage=Image.CreateEmpty(1,1,false,Image.Format.Rgba8);
            using var emptyTexture=ImageTexture.CreateFromImage(emptyImage);
            foreach(string name in new[]{"ruien_lights","ruien_cover"})RenderingServer.GlobalShaderParameterAdd(name,RenderingServer.GlobalShaderParameterType.Sampler2D,emptyTexture.GetRid());
            var entrance=RuienEntrance.Load().First(s=>s.Underpass!=null);
            var buildStructure=typeof(RuienEntrance).GetMethod("BuildStructure",BindingFlags.Static|BindingFlags.NonPublic)!;
            var cachedStructure=typeof(RuienEntrance).GetMethod("CachedStructure",BindingFlags.Static|BindingFlags.NonPublic)!;
            string Geometry(Node3D root)
            {
                using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
                void Add(Variant value)=>hash.AppendData(GD.VarToBytes(value));
                foreach(var node in BakedWorld.All(root))
                {
                    Add(node.GetClass());if(node is Node3D n)Add(n.Transform);
                    if(node is MeshInstance3D mi && mi.Mesh is ArrayMesh mesh)
                        for(int surface=0;surface<mesh.GetSurfaceCount();surface++)
                        {Add(mesh.SurfaceGetArrays(surface));Add(mesh.SurfaceGetName(surface));Add(mesh.SurfaceGetMaterial(surface)?.ResourceName??"");}
                    if(node is CollisionShape3D shape)
                    {if(shape.Shape is ConcavePolygonShape3D concave){Add(concave.Data);Add(concave.BackfaceCollision);}else if(shape.Shape is BoxShape3D boxShape)Add(boxShape.Size);}
                    if(node is CollisionObject3D body){Add(body.CollisionLayer);Add(body.CollisionMask);}
                }
                return Convert.ToHexString(hash.GetHashAndReset());
            }
            var fresh=(Node3D)buildStructure.Invoke(null,new object[]{entrance})!;
            string geometry=Geometry(fresh);fresh.Free();
            for(int i=0;i<2;i++)
            {
                var cached=(Node3D)cachedStructure.Invoke(null,new object[]{entrance})!;
                Check(Geometry(cached)==geometry,"Entrance cached mesh, UV, normals, transforms, materials and collision match");cached.Free();
            }
            entrance.Width+=.15f;RuienEntrance.Frames(entrance);
            var altered=(Node3D)cachedStructure.Invoke(null,new object[]{entrance})!;
            Check(Geometry(altered)!=geometry,"Changed entrance spec invalidates");altered.Free();
            var stairArea=RuienData.Load().Areas.First(a=>a.Ways.Any(w=>w.Kind=="keeper_stair"));
            var way=stairArea.Ways.First(w=>w.Kind=="keeper_stair");var gallery=stairArea.StairZone(way);
            way.Retired=false; // Exercise a live hatch as well as the fixed cached masonry.
            var stairMethod=typeof(RuienStair).GetMethod("CachedBuild",BindingFlags.Static|BindingFlags.NonPublic)!;
            Node3D Stair()=>(Node3D)stairMethod.Invoke(null,new object?[]{way,gallery})!;
            var stairFresh=RuienStair.Build(way,gallery);string stairGeometry=Geometry(stairFresh);stairFresh.Free();
            for(int i=0;i<2;i++)
            {
                var cached=Stair();
                Check(Geometry(cached)==stairGeometry,"Stair mesh, charts, transforms, materials and collision round trip");
                Check(BakedWorld.All(cached).OfType<RuienHatch>().Single().Way==way,"Live hatch retains current Way");
                foreach(var mi in BakedWorld.All(cached).OfType<MeshInstance3D>())
                    for(int si=0;si<mi.Mesh.GetSurfaceCount();si++)
                    {var material=mi.Mesh.SurfaceGetMaterial(si);Check(material==RuienMaterials.Get(material.ResourceName),"Stair materials rebound to live shared materials");}
                cached.Free();
            }
            way.Top+=new Vector3(.05f,0,0);
            var changedStair=Stair();Check(Geometry(changedStair)!=stairGeometry,"Edited stair invalidates cache");changedStair.Free();
            GD.Print("STARTUP_STAIR_CACHE_PASS: exact structure/collision round trips, current hatch and shared materials, changed way invalidation");
            using var dirt=Image.CreateEmpty(48,48,false,Image.Format.Rgba8);dirt.Fill(new Color(.3f,.2f,.3f,1));
            dirt.SavePng(Path.Combine(folder,"dirt.png"));System.IO.File.WriteAllText(Path.Combine(folder,"dirt.json"),"{\"x0\":0,\"z0\":0,\"w\":12,\"h\":12}");
            var plan=new NativeSquareDressing.Plan("proof",new(.3f,.7f,2,.5f,Array.Empty<NativeSquareDressing.Area>(),Array.Empty<NativeSquareDressing.Path>(),Array.Empty<NativeSquareDressing.Spot>()),Array.Empty<NativeSquareDressing.Thing>());
            var razed=new NativeRazedHouses.Result(1,0,0,Array.Empty<string>()){Razed=new[]{new[]{new Vector2(2,2),new Vector2(8,2),new Vector2(8,8),new Vector2(2,8)}}};
            var ground=typeof(NativeSquareDressing).GetMethod("BuildGround",BindingFlags.Static|BindingFlags.NonPublic)!;
            int expected=(int)ground.Invoke(null,new object[]{plan,razed,folder})!;
            byte[] pixels=NativeSquareDressing.Dirt!.GetImage().GetData();
            typeof(NativeCutCache).GetProperty("CurrentKey",BindingFlags.Static|BindingFlags.NonPublic)!.SetValue(null,Guid.NewGuid().ToString());
            for(int i=0;i<2;i++)Check(NativeSquareDressing.Ground(plan,razed,folder)==expected && pixels.SequenceEqual(NativeSquareDressing.Dirt!.GetImage().GetData()),"Ground cache is pixel-exact");
            var newPlan=plan with{Ground=plan.Ground with{Base=.9f}};
            NativeSquareDressing.Ground(newPlan,razed,folder);Check(!pixels.SequenceEqual(NativeSquareDressing.Dirt!.GetImage().GetData()),"Changed ground settings invalidate");
            GD.Print("STARTUP_DERIVED_CACHE_PASS: entrance geometry/collision round trips, spec invalidation, lossless ground and settings invalidation");
            town.Free();fakeMain.Free();GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
