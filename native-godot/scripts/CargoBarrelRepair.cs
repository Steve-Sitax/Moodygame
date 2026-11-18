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

// Offline repair of the standing cargo barrel. No new construction work runs in the game.
public partial class CargoBarrelRepair : Node3D
{
    private const string Props = "res://assets/game-models/props.scn";
    private const string Folder = "res://assets/props/cargo-barrel-20261117";
    private const int Staves = 24;
    private readonly ArrayMesh made = new();
    private SurfaceTool surface = null!;
    private int triangles;
    private static readonly float[] Heights = { 0,.0006f,.002f,.03f,.10f,.18f,.26f,.34f,.4075f,.475f,.5425f,.61f,.69f,.77f,.85f,.92f,.948f,.9494f,.95f };
    private static readonly float[] Ys = { .03f,.18f,.34f,.475f,.61f,.77f,.92f };
    private static readonly float[] Rs = { .265f,.30f,.323f,.33f,.323f,.30f,.265f };
    private sealed record V(Vector3 P, Vector3 N, Vector2 Uv, Color Colour);
    private static Vector3 At(float r,float a,float y) => new(r*MathF.Cos(a),y,r*MathF.Sin(a));
    private static float Radius(float y)
    {
        if(y<=Ys[0]||y>=Ys[^1])return .265f;
        int i=Array.FindLastIndex(Ys,v=>v<=y);float t=(y-Ys[i])/(Ys[i+1]-Ys[i]);
        float d0=i==0?(Rs[1]-Rs[0])/(Ys[1]-Ys[0]):(Rs[i+1]-Rs[i-1])/(Ys[i+1]-Ys[i-1]);
        float d1=i+1==Ys.Length-1?(Rs[^1]-Rs[^2])/(Ys[^1]-Ys[^2]):(Rs[i+2]-Rs[i])/(Ys[i+2]-Ys[i]);
        return (2*t*t*t-3*t*t+1)*Rs[i]+(t*t*t-2*t*t+t)*(Ys[i+1]-Ys[i])*d0+(-2*t*t*t+3*t*t)*Rs[i+1]+(t*t*t-t*t)*(Ys[i+1]-Ys[i])*d1;
    }
    private static float EndBevel(float y) => y<.002f?.002f-MathF.Sqrt(MathF.Max(0,.002f*.002f-(y-.002f)*(y-.002f))):y>.948f?EndBevel(.95f-y):0;
    private void Begin() { surface=new SurfaceTool();surface.Begin(Mesh.PrimitiveType.Triangles); }
    private void Tri(V a,V b,V c)
    {
        if((b.P-a.P).Cross(c.P-a.P).LengthSquared()<1e-16f)return;
        if((b.P-a.P).Cross(c.P-a.P).Dot(a.N+b.N+c.N)>0)(b,c)=(c,b);
        foreach(var v in new[]{a,b,c}){surface.SetNormal(v.N);surface.SetUV(v.Uv);surface.SetColor(v.Colour);surface.AddVertex(v.P);}
        triangles++;
    }
    private void Quad(V a,V b,V c,V d){Tri(a,b,c);Tri(a,c,d);}
    private void Finish(Material material,string name)
    {
        surface.Index();surface.Commit(made);surface.Dispose();int s=made.GetSurfaceCount()-1;made.SurfaceSetMaterial(s,material);made.SurfaceSetName(s,name);
    }
    private static Color WoodColour(int stave,float y)
    {
        float tint=.91f+.08f*(.5f+.5f*MathF.Sin(stave*7.31f));
        float damp=1-.11f*MathF.Exp(-y*15)*(0.75f+.25f*MathF.Sin(stave*4.19f));
        return new Color(tint*damp,tint*damp,tint*damp,1);
    }
    private void Wood()
    {
        Begin();
        for(int stave=0;stave<Staves;stave++)
        {
            float middle=Mathf.Tau*stave/Staves,half=Mathf.Pi/Staves-.0004f/.33f,bevel=.0015f/.30f;
            float[] angles={middle-half,middle-half+bevel*.293f,middle-half+bevel,middle,middle+half-bevel,middle+half-bevel*.293f,middle+half};
            float[] inset={.0015f,.00044f,0,0,0,.00044f,.0015f};
            var grid=new Vector3[Heights.Length,angles.Length];
            for(int j=0;j<Heights.Length;j++)for(int k=0;k<angles.Length;k++)grid[j,k]=At(Radius(Heights[j])-inset[k]-EndBevel(Heights[j]),angles[k],Heights[j]);
            V Outer(int j,int k)
            {
                var dy=grid[Math.Min(j+1,Heights.Length-1),k]-grid[Math.Max(j-1,0),k];
                var da=grid[j,Math.Min(k+1,angles.Length-1)]-grid[j,Math.Max(k-1,0)];
                return new(grid[j,k],dy.Cross(da).Normalized(),new(Heights[j]/2+stave*.173f,(angles[k]-angles[0])*.30f/.1171875f+(stave%5)*.127f),WoodColour(stave,Heights[j]));
            }
            for(int j=0;j<Heights.Length-1;j++)for(int k=0;k<angles.Length-1;k++)Quad(Outer(j,k),Outer(j+1,k),Outer(j+1,k+1),Outer(j,k+1));
            // Real recessed stave joints. Interior faces below the closed heads are hidden mating surfaces.
            foreach(int k in new[]{0,angles.Length-1})for(int j=0;j<Heights.Length-1;j++)
            {
                var normal=At(1,angles[k]+(k==0?-Mathf.Pi/2:Mathf.Pi/2),0);
                V Side(int row,bool inner){var p=inner?At(Radius(Heights[row])-.035f,angles[k],Heights[row]):grid[row,k];return new(p,normal,new(Heights[row]/2+stave*.173f,inner?.8f:.4f),WoodColour(stave,Heights[row]));}
                Quad(Side(j,false),Side(j+1,false),Side(j+1,true),Side(j,true));
            }
            foreach(bool top in new[]{false,true})
            {
                int j=top?Heights.Length-1:0;float y=Heights[j],head=top?.925f:.025f;var normal=top?Vector3.Up:Vector3.Down;
                for(int k=0;k<angles.Length-1;k++)
                {
                    V End(int col,bool inner){var p=inner?At(.2315f,angles[col],y):grid[j,col];return new(p,normal,new(p.X/2+stave*.173f,p.Z/.1171875f),WoodColour(stave,y));}
                    Quad(End(k,false),End(k+1,false),End(k+1,true),End(k,true));
                    float sign=top?1:-1;
                    var lip=new[]{(.2315f,y),(.23044f,y-sign*.00044f),(.23f,y-sign*.0015f),(.23f,head)};
                    V Inner(int col,int row)
                    {
                        int lo=Math.Max(0,row-1),hi=Math.Min(lip.Length-1,row+1);float dr=lip[hi].Item1-lip[lo].Item1,dy=lip[hi].Item2-lip[lo].Item2;
                        var n=new Vector3(dy*MathF.Cos(angles[col]),-dr,dy*MathF.Sin(angles[col])).Normalized()*sign;
                        return new(At(lip[row].Item1,angles[col],lip[row].Item2),n,new(lip[row].Item2/2+stave*.173f,col*.1f),WoodColour(stave,lip[row].Item2));
                    }
                    for(int row=0;row<lip.Length-1;row++)Quad(Inner(k,row),Inner(k,row+1),Inner(k+1,row+1),Inner(k+1,row));
                }
            }
        }
        // Seven separate head boards. Their narrow seams and the recessed head are geometry.
        foreach(bool top in new[]{false,true})for(int board=0;board<7;board++)Head(top,board);
        Finish(Material("wood", "res://assets/textures/plan-84/6/wood_single",.10f),"barrel_wood");
    }
    private void Head(bool top,int board)
    {
        const float r=.2302f;float z0=-r+board*2*r/7+.00035f,z1=-r+(board+1)*2*r/7-.00035f;
        var poly=Enumerable.Range(0,96).Select(i=>new Vector2(r*MathF.Cos(Mathf.Tau*i/96),r*MathF.Sin(Mathf.Tau*i/96))).ToList();
        List<Vector2> Clip(List<Vector2> p,Func<Vector2,float> side)
        {
            var q=new List<Vector2>();for(int i=0;i<p.Count;i++){var a=p[i];var b=p[(i+1)%p.Count];float fa=side(a),fb=side(b);if(fa>=0)q.Add(a);if((fa>=0)!=(fb>=0))q.Add(a.Lerp(b,fa/(fa-fb)));}return q;
        }
        poly=Clip(Clip(poly,p=>p.Y-z0),p=>z1-p.Y);if(poly.Count<3)return;
        var centre=poly.Aggregate(Vector2.Zero,(a,b)=>a+b)/poly.Count;float y=top?.925f:.025f,sign=top?1:-1;
        var inset=poly.Select(p=>new Vector2(p.X*.995f,Mathf.Lerp(p.Y,centre.Y,.028f))).ToArray();
        V Face(Vector2 p)=>new(new(p.X,y,p.Y),Vector3.Up*sign,new(p.X/2+board*.19f,p.Y/.1171875f),WoodColour(board,y));
        for(int i=1;i+1<inset.Length;i++)Tri(Face(inset[0]),Face(inset[i]),Face(inset[i+1]));
        for(int i=0;i<poly.Count;i++)
        {
            int k=(i+1)%poly.Count;var edge=poly[k]-poly[i];var n=new Vector3(edge.Y,sign*edge.Length(),-edge.X).Normalized();
            V Rim(Vector2 p,bool low)=>new(new(p.X,y-(low?.0012f:0)*sign,p.Y),n,new(p.X/2+board*.19f,p.Y/.1171875f),WoodColour(board,y));
            Quad(Rim(inset[i],false),Rim(inset[k],false),Rim(poly[k],true),Rim(poly[i],true));
        }
    }
    private void Iron()
    {
        Begin();
        foreach(var (low,high) in new[]{(.05f,.11f),(.25f,.30f),(.65f,.70f),(.84f,.90f)})
        {
            var profile=new[]{(low,.0005f),(low,.003f),(low+.0003f,.0037f),(low+.001f,.004f),(high-.001f,.004f),(high-.0003f,.0037f),(high,.003f),(high,.0005f)};
            for(int j=0;j<profile.Length-1;j++)for(int i=0;i<96;i++)
            {
                V P(int row,int col)
                {
                    var (y,extra)=profile[row];float a=Mathf.Tau*col/96;int before=Math.Max(0,row-1),after=Math.Min(profile.Length-1,row+1);
                    float dr=Radius(profile[after].Item1)+profile[after].Item2-Radius(profile[before].Item1)-profile[before].Item2;
                    float dy=profile[after].Item1-profile[before].Item1;var n=new Vector3(dy*MathF.Cos(a),-dr,dy*MathF.Sin(a)).Normalized();
                    return new(At(Radius(y)+extra,a,y),n,new(a*.30f/.5f,y/.5f),Colors.White);
                }
                Quad(P(j,i),P(j+1,i),P(j+1,i+1),P(j,i+1));
            }
        }
        Finish(Material("iron", "res://assets/textures/plan-84/10/iron_painted",.18f),"barrel_iron");
    }
    private static ShaderMaterial Material(string name,string picture,float bump)
    {
        var m=new ShaderMaterial{ResourceName="cargo_barrel_"+name,Shader=ResourceLoader.Load<Shader>("res://world/town/resources/r000557.res")};
        m.SetShaderParameter("tex",ResourceLoader.Load<Texture2D>(picture+"_colour.png"));m.SetShaderParameter("bump_map",ResourceLoader.Load<Texture2D>(picture+"_height.png"));
        m.SetShaderParameter("albedo",Colors.White);m.SetShaderParameter("bump_scale",bump);m.SetShaderParameter("affine",0f);m.SetShaderParameter("fog_reach",1f);
        return m;
    }
    private static Dictionary<string,string> Snapshot(Node root)
    {
        var rows=new Dictionary<string,string>();
        foreach(var node in BakedWorld.All(root))
        {
            string path=root.GetPathTo(node).ToString();
            string state=node.GetClass()+"|"+(node is Node3D n?n.Transform+"|"+n.Visible:"");
            foreach(var key in node.GetMetaList().OrderBy(k=>k.ToString()))state+="|"+key+"="+node.GetMeta(key);
            rows[path]=state;
            if(path=="barrel"||node is not MeshInstance3D{Mesh:not null} mesh)continue;
            using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
            for(int s=0;s<mesh.Mesh.GetSurfaceCount();s++)
            {
                hash.AppendData(GD.VarToBytes(mesh.Mesh.SurfaceGetArrays(s)));
                hash.AppendData(GD.VarToBytes(mesh.Mesh.SurfaceGetBlendShapeArrays(s)));
                string material=mesh.GetActiveMaterial(s)?.ResourcePath+"|"+mesh.GetActiveMaterial(s)?.ResourceName;
                hash.AppendData(System.Text.Encoding.UTF8.GetBytes(material));
            }
            rows[path+"/mesh"]=Convert.ToHexString(hash.GetHashAndReset());
        }
        return rows;
    }
    private void ValidateGeometry()
    {
        int count=0;
        for(int s=0;s<made.GetSurfaceCount();s++)
        {
            var a=made.SurfaceGetArrays(s);var v=a[(int)Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Mesh.ArrayType.Normal].AsVector3Array();var uv=a[(int)Mesh.ArrayType.TexUV].AsVector2Array();var ix=a[(int)Mesh.ArrayType.Index].AsInt32Array();
            if(v.Length!=n.Length||v.Length!=uv.Length)throw new InvalidOperationException("Missing barrel attributes");
            for(int i=0;i<v.Length;i++)if(!v[i].IsFinite()||!n[i].IsFinite()||!uv[i].IsFinite()||MathF.Abs(n[i].Length()-1)>.001f)throw new InvalidOperationException("Invalid barrel vertex");
            for(int i=0;i<ix.Length;i+=3)
            {
                var cross=(v[ix[i+1]]-v[ix[i]]).Cross(v[ix[i+2]]-v[ix[i]]);
                if(cross.LengthSquared()<1e-16f||cross.Dot(n[ix[i]]+n[ix[i+1]]+n[ix[i+2]])>1e-8f)throw new InvalidOperationException("Barrel degeneracy or reversed winding");count++;
            }
        }
        if(count!=triangles)throw new InvalidOperationException("Barrel triangle count changed");
    }
    public override async void _Ready()
    {
        try
        {
            NativeGlobals.Ensure();Scheldemist.Render.Psx.EnsureGlobals();
            string output=ProjectSettings.GlobalizePath("res://../.scratch/visual-quality/barrel");Directory.CreateDirectory(output);Directory.CreateDirectory(ProjectSettings.GlobalizePath(Folder));
            var scene=ResourceLoader.Load<PackedScene>(Props).Instantiate<Node3D>();var barrel=scene.GetNode<MeshInstance3D>("barrel");var original=barrel.Mesh!;
            Wood();Iron();ValidateGeometry();var before=original.GetAabb();var after=made.GetAabb();
            if(before.Position.DistanceTo(after.Position)>.00003f||before.Size.DistanceTo(after.Size)>.00003f)throw new InvalidOperationException($"Bounds changed: {before} -> {after}");
            var report=new{triangles,woodStaves=Staves,woodEdgeMetres=.002f,hoopEdgeMetres=.001f,originalBounds=before.ToString(),newBounds=after.ToString(),collision="Existing Goods one-box collider retained; 0 added physics triangles",source=Props};
            File.WriteAllText(Path.Combine(output,"candidate.json"),JsonSerializer.Serialize(report,new JsonSerializerOptions{WriteIndented=true}));
            if(OS.GetCmdlineUserArgs().Contains("--promote-barrel"))
            {
                var kept=Snapshot(scene);
                string backup=Path.Combine(output,"props-before.scn");if(File.Exists(backup))throw new IOException("Original backup already exists; verify before promoting again");File.Copy(ProjectSettings.GlobalizePath(Props),backup);
                if(ResourceSaver.Save(made,Folder+"/barrel-mesh.res",ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException("Saving barrel mesh");
                made.TakeOverPath(Folder+"/barrel-mesh.res");barrel.Mesh=made;
                using var packed=new PackedScene();if(packed.Pack(scene)!=Error.Ok||ResourceSaver.Save(packed,Props,ResourceSaver.SaverFlags.Compress)!=Error.Ok)throw new IOException("Saving props scene");
                var reloaded=ResourceLoader.Load<PackedScene>(Props,null,ResourceLoader.CacheMode.Ignore).Instantiate<Node3D>();
                var restored=Snapshot(reloaded);reloaded.Free();
                if(kept.Count!=restored.Count||kept.Any(row=>!restored.TryGetValue(row.Key,out var value)||value!=row.Value))throw new InvalidOperationException("Unrelated prop geometry, material, placement or metadata changed");
                File.WriteAllText(Path.Combine(output,"preservation.json"),JsonSerializer.Serialize(new{passed=true,checks=kept.Count,unchanged=kept},new JsonSerializerOptions{WriteIndented=true}));
                GD.Print("CARGO_BARREL_PROMOTED: "+triangles+" triangles");scene.Free();GetTree().Quit();return;
            }
            scene.Free();
            // Match the game's filtering/material conversion for the comparison model.
            string prior=Path.Combine(output,"props-before.scn");
            Scheldemist.Models.ModelLibrary.NativeScene=name=>ResourceLoader.Load<PackedScene>(name=="props"&&File.Exists(prior)?prior:"res://assets/game-models/"+name+".scn").Instantiate<Node3D>();
            original=((MeshInstance3D)Scheldemist.Models.ModelLibrary.Get("props",new(TwoSided:true,Affine:.6,VertexColor:true))!.Roots["barrel"]).Mesh!;
            AddChild(new WorldEnvironment{Environment=new Godot.Environment{BackgroundMode=Godot.Environment.BGMode.Color,BackgroundColor=new Color(.19f,.22f,.25f),AmbientLightSource=Godot.Environment.AmbientSource.Color,AmbientLightColor=new Color(.4f,.42f,.45f),AmbientLightEnergy=.5f}});
            RenderingServer.GlobalShaderParameterSet("psx_fog_near",9000f);RenderingServer.GlobalShaderParameterSet("psx_fog_far",10000f);
            AddChild(new DirectionalLight3D{RotationDegrees=new(-40,-40,0),LightEnergy=1.3f,ShadowEnabled=true});
            AddChild(new MeshInstance3D{Mesh=made});var old=new MeshInstance3D{Mesh=original,Position=new(-.95f,0,0)};AddChild(old);
            var camera=new Camera3D{Current=true,Fov=48,Near=.02f};AddChild(camera);GetViewport().Msaa3D=Viewport.Msaa.Msaa4X;
            foreach(var (name,at,look) in new[]{("front",new Vector3(1.15f,.74f,1.4f),new Vector3(-.3f,.5f,0)),("top",new Vector3(.65f,1.55f,.8f),new Vector3(0,.5f,0)),("below",new Vector3(.65f,-.25f,.7f),new Vector3(0,.25f,0)),("back",new Vector3(-.6f,.65f,-.9f),new Vector3(0,.5f,0))})
            {
                camera.Position=at;camera.LookAt(look);for(int i=0;i<5;i++)await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);await ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                using var shot=GetViewport().GetTexture().GetImage();shot.SavePng(Path.Combine(output,name+".png"));
            }
            Scheldemist.Models.ModelLibrary.FreeAll();
            GD.Print("CARGO_BARREL_CANDIDATE: "+triangles+" triangles; bounds retained");GetTree().Quit();
        }
        catch(Exception e){GD.PushError(e.ToString());GetTree().Quit(1);}
    }
}
