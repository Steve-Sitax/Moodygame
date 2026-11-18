using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;
using Scheldemist.Models;
using Scheldemist.Render;

// Offline authoring: the game loads one content-tracked scene, with shared tree meshes and one static body.
public partial class RiverSceneryBuild : Node
{
    private const string Dir = "res://assets/river-20261117";
    private static readonly Psx.Kind Opaque = new(false, false, false, false, true, false, 0, true, false, true, Relief: 1, Far: true);

    private static ShaderMaterial Surface(string name, string? picture = null)
    {
        var m = NetRackGeometry.Material(name, picture);
        m.Shader = Psx.ShaderOf(Opaque);
        m.SetShaderParameter("fog_reach", 2.6f);
        m.SetShaderParameter("bump_scale", .24f);
        return m;
    }

    private static void Box(NetRackGeometry.Builder b, Vector3 centre, Vector3 size, float bevel, Material material, Color colour, Basis? basis = null, Func<Vector3, Vector2>? map = null)
    {
        using var mesh = BevelMesh.Box(size, bevel, material);
        var arrays = mesh.SurfaceGetArrays(0);
        var p = arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
        var n = arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
        var frame = basis ?? Basis.Identity;
        Vector2 UV(Vector3 v, Vector3 normal)
        {
            // Map adjoining pieces in the same building space so courses meet at gables and corners.
            v = centre + frame * v;
            if (map != null) return map(v);
            normal = frame * normal;
            return Math.Abs(normal.Y) > .8f ? new(v.X / 2, v.Z / 2) : Math.Abs(normal.X) > .8f ? new(v.Z / 2, -v.Y / 2) : new(v.X / 2, -v.Y / 2);
        }
        for (int i = 0; i < p.Length; i += 3)
            b.Triangle(centre + frame * p[i], centre + frame * p[i+1], centre + frame * p[i+2], frame*n[i], frame*n[i+1], frame*n[i+2], UV(p[i],n[i]), UV(p[i+1],n[i]), UV(p[i+2],n[i]), colour);
    }

    public override async void _Ready()
    {
        try
        {
            if (DisplayServer.GetName() == "headless") throw new InvalidOperationException("Build with the Forward+ renderer: the dummy renderer cannot serialize MultiMesh transforms.");
            Scheldemist.Native.Game.NativeGlobals.Ensure();
            Psx.EnsureGlobals();
            DirAccess.MakeDirRecursiveAbsolute(Dir);
            var root = new Node3D { Name = "scheldt_scenery" }; AddChild(root);
            var solid = new StaticBody3D { Name = "scheldt_collision", CollisionLayer = Solid.Layer, CollisionMask = 0 }; root.AddChild(solid);
            var mud = ResourceLoader.Load<ArrayMesh>("res://world/town/resources/r001391.res").SurfaceGetMaterial(1);
            var faces = ResourceLoader.Load<ArrayMesh>("res://world/town/resources/r001370.res").GetFaces();
            var bankMaterial = Surface("far_bank_earth", "res://assets/textures/plan-84/10/earth_bare");
            bankMaterial.Shader = new Shader { Code = bankMaterial.Shader.Code.Replace("UV = UV * uv_xform.xy + uv_xform.zw;", "UV = world.xz / 4.0;") };
            ResourceSaver.Save(bankMaterial, Dir + "/bank-ground.res");
            float Height(Vector3[] surface, float x, float z)
            {
                float y = float.NegativeInfinity;
                for (int i=0; i<surface.Length; i+=3)
                {
                    var a=surface[i]; var b=surface[i+1]; var c=surface[i+2];
                    float den=(b.Z-c.Z)*(a.X-c.X)+(c.X-b.X)*(a.Z-c.Z); if(Math.Abs(den)<.0001f)continue;
                    float u=((b.Z-c.Z)*(x-c.X)+(c.X-b.X)*(z-c.Z))/den, v=((c.Z-a.Z)*(x-c.X)+(a.X-c.X)*(z-c.Z))/den;
                    if(u>=0&&v>=0&&u+v<=1)y=Math.Max(y,u*a.Y+v*b.Y+(1-u-v)*c.Y);
                }
                return y;
            }
            float Ground(float x,float z)=>Height(faces,x,z);
            var oldBed=ResourceLoader.Load<ArrayMesh>("res://world/town/resources/r001391.res").GetFaces();
            var nearBank=new Dictionary<float,float>();var farBank=new Dictionary<float,float>();
            float Bed(float x,float z)
            {
                float deep=-14.5f+.3f*MathF.Sin(x*.018f)*MathF.Cos(z*.022f)+.18f*MathF.Sin(z*.071f+x*.025f);
                if(!nearBank.TryGetValue(x,out float near)){near=Height(oldBed,x,-79.99f);nearBank[x]=near=float.IsFinite(near)?near-.04f:-7.85f;}
                if(z>=-80){float old=Height(oldBed,x,z);return float.IsFinite(old)?old-.04f:near;}
                if(z>-132)return Mathf.Lerp(near,deep,Mathf.SmoothStep(0,1,(-z-80)/52));
                if(z>=-216)return deep;
                if(!farBank.TryGetValue(x,out float far))farBank[x]=far=Ground(x,-264)-.04f;
                if(!float.IsFinite(far))return deep;
                if(z>=-264)return Mathf.Lerp(deep,far,Mathf.SmoothStep(0,1,(-z-216)/48));
                float ground=Ground(x,z);return float.IsFinite(ground)?ground-.04f:far;
            }
            Vector3 Normal(float x,float z)=>new Vector3(Bed(x-.1f,z)-Bed(x+.1f,z),.2f,Bed(x,z-.1f)-Bed(x,z+.1f)).Normalized();
            using(var b=new NetRackGeometry.Builder())
            {
                for(float x=-720;x<492;x+=12)for(float z=-264;z<0;z+=12)
                {
                    var a=new Vector3(x,Bed(x,z),z);var c=new Vector3(x+12,Bed(x+12,z+12),z+12);var d=new Vector3(x,Bed(x,z+12),z+12);var e=new Vector3(x+12,Bed(x+12,z),z);
                    b.Triangle(a,c,e,Normal(x,z),Normal(x+12,z+12),Normal(x+12,z),new(x/4,z/4),new((x+12)/4,(z+12)/4),new((x+12)/4,z/4),Colors.White);
                    b.Triangle(a,d,c,Normal(x,z),Normal(x,z+12),Normal(x+12,z+12),new(x/4,z/4),new(x/4,(z+12)/4),new((x+12)/4,(z+12)/4),Colors.White);
                }
                b.Finish(mud,"continuous_scheldt_bed");ResourceSaver.Save(b.Mesh,Dir+"/bed.res");root.AddChild(new MeshInstance3D{Name="scheldt_bed",Mesh=b.Mesh});
                solid.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=b.Mesh.GetFaces(),BackfaceCollision=true}});
            }
            var trees=ResourceLoader.Load<PackedScene>("res://assets/game-models/trees.scn").Instantiate<Node3D>();
            var rng=new Random(187317);int count=0;
            var treeMaterials=new Dictionary<Material,Material>();
            foreach(string kind in new[]{"tree_elm","tree_lime","tree_plane","tree_willow"})
            {
                var mesh=(ArrayMesh)trees.GetNode<MeshInstance3D>(kind).Mesh.Duplicate();
                for(int s=0;s<mesh.GetSurfaceCount();s++)
                {
                    var source=(BaseMaterial3D)mesh.SurfaceGetMaterial(s);
                    if(!treeMaterials.TryGetValue(source,out var mat))
                    {
                        bool leaf=source.Transparency!=BaseMaterial3D.TransparencyEnum.Disabled;
                        mat=BakedWorld.PsxMaterial(source,Opaque with{Relief=0,Scissor=leaf,TwoSided=true,VertexColor=source.VertexColorUseAsAlbedo},0,2.6,leaf?.3:0);
                        treeMaterials[source]=mat;
                    }
                    mesh.SurfaceSetMaterial(s,mat);
                }
                ResourceSaver.Save(mesh,Dir+"/"+kind+".res");
                var frames=new List<Transform3D>();
                for(int i=0;i<34;i++)
                {
                    float x=-620+(float)rng.NextDouble()*1040,z=-335-(float)rng.NextDouble()*195,y=Ground(x,z);if(!float.IsFinite(y)||y<-.1f)continue;
                    float scale=.8f+(float)rng.NextDouble()*.5f;var at=new Vector3(x,y-.08f,z);
                    frames.Add(new(new Basis(Vector3.Up,(float)rng.NextDouble()*Mathf.Tau).Scaled(Vector3.One*scale),at));
                    solid.AddChild(new CollisionShape3D{Name="bank_trunk_"+count++,Position=at+new Vector3(0,2*scale,0),Shape=new CylinderShape3D{Radius=.25f*scale,Height=4*scale}});
                }
                var mm=new MultiMesh{TransformFormat=MultiMesh.TransformFormatEnum.Transform3D,Mesh=mesh,InstanceCount=frames.Count};
                var buffer=new float[frames.Count*12];
                for(int i=0;i<frames.Count;i++)MultiMeshData.Transform(buffer,i*12,frames[i]);
                MultiMeshData.Write(mm,buffer);
                root.AddChild(new MultiMeshInstance3D{Name="distant_"+kind,Multimesh=mm});
            }
            trees.Free();
            var wall=Surface("bank_brick","res://assets/textures/plan-84/8/brick_brabant");
            var roof=Surface("bank_slate","res://assets/textures/plan-84/8/slate_ardennes");
            var stone=Surface("bank_foundation","res://assets/textures/plan-84/3/bluestone_ashlar");
            var wood=Surface("bank_joinery","res://assets/textures/plan-84/6/wood_single");
            var metal=Surface("bank_zinc");
            for(int i=0;i<12;i++)
            {
                float x=-530+i*76+(float)rng.NextDouble()*18,z=-380-(i%3)*48;
                float w=6+i%3,h=3.4f+(i%2)*1.8f,d=5.5f;var rotation=new Basis(Vector3.Up,(i%3-1)*.12f);
                var corners=(from dx in new[]{-w/2-.2f,w/2+.2f} from dz in new[]{-d/2-.4f,d/2+.4f} select rotation*new Vector3(dx,0,dz)).ToArray();
                var levels=corners.Select(p=>Ground(x+p.X,z+p.Z)).ToArray();if(levels.Any(y=>!float.IsFinite(y)||y<0))continue;
                float y=levels.Max()+.03f, foot=levels.Min()-y-.15f;
                var house=new Node3D{Name="bank_house_"+i,Transform=new(rotation,new(x,y,z))};root.AddChild(house);
                using var b=new NetRackGeometry.Builder();var tint=new Color(.94f+i%3*.025f,.91f+i%2*.025f,.87f);
                Box(b,new(0,h/2,0),new(w,h,d),.012f,wall,tint);
                foreach(int end in new[]{-1,1}) {var n=new Vector3(end,0,0);b.Triangle(new(end*w/2,h,-d/2),new(end*w/2,h+1.8f,0),new(end*w/2,h,d/2),n,n,n,new(-d/4,-h/2),new(0,-(h+1.8f)/2),new(d/4,-h/2),tint);}
                Box(b,new(w*.28f,h+1.3f,0),new(.6f,2.2f,.65f),.008f,wall,tint);b.Finish(wall,"brick_walls_and_chimney");
                Box(b,new(0,(foot+.28f)/2,0),new(w+.14f,.28f-foot,d+.14f),.012f,stone,new(.8f,.83f,.82f));
                foreach(int side in new[]{-1,1})for(int k=-1;k<=1;k++){if(side==1&&k==-1&&h<4)continue;Box(b,new(k*w*.3f,h*.62f-.75f,side*(d/2+.07f)),new(1.1f,.12f,.25f),.007f,stone,new(.8f,.83f,.82f));}
                b.Finish(stone,"foundation_and_sills");
                float rise=1.8f,half=d/2+.3f,angle=MathF.Atan2(rise,d/2),outerRise=rise*half/(d/2),length=MathF.Sqrt(outerRise*outerRise+half*half),eave=h+rise-outerRise;
                // The source includes a metal flashing strip at its upper edge. Use only slate, once per pitch.
                Vector2 RoofUv(Vector3 v)=>new(v.X/3.4f,.025f+Math.Abs(v.Z)/half*.96f);
                foreach(int side in new[]{-1,1})Box(b,new(0,h+rise-outerRise/2,side*half/2),new(w+.6f,.12f,length),.002f,roof,new(.73f,.76f,.78f),new Basis(Vector3.Right,side*angle),RoofUv);
                Box(b,new(0,h+rise+.03f,0),new(w+.65f,.14f,.18f),.003f,roof,new(.73f,.76f,.78f),map:RoofUv);b.Finish(roof,"slate_roof");
                foreach(int side in new[]{-1,1})for(int k=-1;k<=1;k++)
                {
                    if(side==1&&k==-1&&h<4)continue;
                    var at=new Vector3(k*w*.3f,h*.62f,side*(d/2+.025f));b.Box(at,new(.85f,1.25f,.06f),.002f,wood,new(.13f,.16f,.16f));
                    foreach(float dx in new[]{-.48f,0,.48f})b.Box(at+new Vector3(dx,0,side*.05f),new(.065f,1.4f,.1f),.002f,wood,new(.72f,.72f,.66f));
                    foreach(float dy in new[]{-.7f,0,.7f})b.Box(at+new Vector3(0,dy,side*.05f),new(1,.065f,.1f),.002f,wood,new(.72f,.72f,.66f));
                }
                b.Box(new(-w*.32f,.95f,d/2+.04f),new(.85f,1.9f,.12f),.003f,wood,new(.43f,.39f,.33f));b.Finish(wood,"window_frames_and_door");
                foreach(int side in new[]{-1,1})
                {
                    var outlet=new Vector3(w/2+.15f,0,side*(d/2+.55f));var world=house.Transform*outlet;outlet.Y=Ground(world.X,world.Z)-y+.07f;
                    b.Tube(new[]{new Vector3(-w/2-.3f,eave,side*half),new Vector3(w/2+.3f,eave,side*half)},.065f,new(.4f,.42f,.41f),8);
                    b.Tube(new[]{new Vector3(w/2+.15f,eave,side*half),new Vector3(outlet.X,outlet.Y+.1f,side*half),outlet},.045f,new(.4f,.42f,.41f),8);
                }
                b.Finish(metal,"eaves_and_downpipes");ResourceSaver.Save(b.Mesh,Dir+"/house-"+i+".res");house.AddChild(new MeshInstance3D{Mesh=b.Mesh});
                var hull=(from dx in new[]{-w/2,w/2} from dz in new[]{-d/2,d/2} from dy in new[]{foot,h} select new Vector3(dx,dy,dz)).Concat(new[]{new Vector3(-w/2,h+rise,0),new Vector3(w/2,h+rise,0)}).ToArray();
                solid.AddChild(new CollisionShape3D{Name="bank_house_collision_"+i,Transform=house.Transform,Shape=new ConvexPolygonShape3D{Points=hull}});
            }
            // Keep trunks and crowns clear of the new houses, including their eaves and outlets.
            var houses=root.GetChildren().OfType<Node3D>().Where(n=>n.Name.ToString().StartsWith("bank_house_")).ToArray();
            int treeIndex=0;
            foreach(var node in root.GetChildren().OfType<MultiMeshInstance3D>())
            {
                var mm=node.Multimesh;var buffer=MultiMeshData.Read(mm);
                for(int i=0;i<mm.InstanceCount;i++,treeIndex++)
                {
                    var frame=mm.GetInstanceTransform(i);var at=frame.Origin;
                    bool Clear(Vector3 p)=>houses.All(h=>{var box=h.GetChild<MeshInstance3D>(0).Mesh.GetAabb().Grow(2);var q=h.Transform.AffineInverse()*p;return q.X<box.Position.X||q.X>box.End.X||q.Z<box.Position.Z||q.Z>box.End.Z;});
                    while(!Clear(at))at.Z-=14;
                    at.Y=Ground(at.X,at.Z)-.08f;frame.Origin=at;MultiMeshData.Transform(buffer,i*12,frame);
                    solid.GetNode<CollisionShape3D>("bank_trunk_"+treeIndex).Position=at+new Vector3(0,2*frame.Basis.Scale.Y,0);
                }
                MultiMeshData.Write(mm,buffer);
            }
            void Own(Node n){foreach(var c in n.GetChildren()){c.Owner=root;Own(c);}}Own(root);
            await ToSignal(GetTree(), SceneTree.SignalName.ProcessFrame);
            foreach(var n in root.GetChildren().OfType<MultiMeshInstance3D>())
                if(n.Multimesh.Buffer.Length != n.Multimesh.InstanceCount*12 || n.Multimesh.GetInstanceTransform(0).Origin.Z > -300)
                    throw new InvalidOperationException("Missing serialized tree transforms: "+n.Name);
            var scene=new PackedScene();scene.Pack(root);ResourceSaver.Save(scene,Dir+"/scenery.scn");
            GD.Print("RIVER_SCENERY_BUILT trees="+count+" bed triangles=4444 static bodies=1");GetTree().Quit();
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
