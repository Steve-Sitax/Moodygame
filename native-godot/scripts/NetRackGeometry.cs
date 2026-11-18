using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Models;

// Offline authoring only. Knots and cords never become individual physics shapes.
public static class NetRackGeometry
{
    public sealed class Builder : IDisposable
    {
        public readonly ArrayMesh Mesh=new();
        private SurfaceTool tool=new();
        public int Triangles;
        public Builder(){tool.Begin(Godot.Mesh.PrimitiveType.Triangles);}
        public void Triangle(Vector3 a,Vector3 b,Vector3 c,Vector3 na,Vector3 nb,Vector3 nc,Vector2 ua,Vector2 ub,Vector2 uc,Color colour)
        {
            if((b-a).Cross(c-a).LengthSquared()<1e-18f)return;
            if((b-a).Cross(c-a).Dot(na+nb+nc)>0){(b,c)=(c,b);(nb,nc)=(nc,nb);(ub,uc)=(uc,ub);}
            foreach(var (p,n,uv) in new[]{(a,na,ua),(b,nb,ub),(c,nc,uc)}){tool.SetNormal(n);tool.SetUV(uv);tool.SetColor(colour);tool.AddVertex(p);}Triangles++;
        }
        public void Finish(Material material,string name)
        {
            tool.Index();tool.Commit(Mesh);int s=Mesh.GetSurfaceCount()-1;Mesh.SurfaceSetMaterial(s,material);Mesh.SurfaceSetName(s,name);tool.Dispose();tool=new SurfaceTool();tool.Begin(Godot.Mesh.PrimitiveType.Triangles);
        }
        public void Tube(IReadOnlyList<Vector3> line,float radius,Color colour,int sides=6,bool cap=true)
        {
            if(line.Count<2)return;
            var vertices=new Vector3[line.Count,sides];var normals=new Vector3[line.Count,sides];var along=new float[line.Count];
            var axis=(line[^1]-line[0]).Normalized();var reference=Math.Abs(axis.Y)>.85f?Vector3.Right:Vector3.Up;
            for(int j=0;j<line.Count;j++)
            {
                var t=(line[Math.Min(line.Count-1,j+1)]-line[Math.Max(0,j-1)]).Normalized();
                var u=t.Cross(reference).Normalized();if(u.LengthSquared()<.01f)u=t.Cross(Vector3.Forward).Normalized();var v=t.Cross(u);
                if(j>0)along[j]=along[j-1]+line[j].DistanceTo(line[j-1]);
                for(int k=0;k<sides;k++){float a=Mathf.Tau*k/sides;var n=u*MathF.Cos(a)+v*MathF.Sin(a);normals[j,k]=n;vertices[j,k]=line[j]+radius*n;}
            }
            for(int j=0;j<line.Count-1;j++)for(int k=0;k<sides;k++)
            {
                int l=(k+1)%sides;Vector2 U(int row,int col)=>new(along[row]/.2f,col/(float)sides);
                Triangle(vertices[j,k],vertices[j+1,k],vertices[j+1,l],normals[j,k],normals[j+1,k],normals[j+1,l],U(j,k),U(j+1,k),U(j+1,k+1),colour);
                Triangle(vertices[j,k],vertices[j+1,l],vertices[j,l],normals[j,k],normals[j+1,l],normals[j,l],U(j,k),U(j+1,k+1),U(j,k+1),colour);
            }
            if(cap)foreach(int row in new[]{0,line.Count-1})
            {
                var n=(row==0?line[0]-line[1]:line[^1]-line[^2]).Normalized();
                for(int k=0;k<sides;k++)Triangle(line[row],vertices[row,k],vertices[row,(k+1)%sides],n,n,n,Vector2.Zero,Vector2.Right,Vector2.Up,colour);
            }
        }
        public void Knot(Vector3 at,Color colour)
        {
            // Two tight turns, offset through the crossing: a flattened sheet bend, not a bead.
            var turn=Enumerable.Range(0,9).Select(i=>{float a=i*Mathf.Tau/8;return at+new Vector3(.0036f*MathF.Cos(a),.0042f*MathF.Sin(a),.0015f*MathF.Sin(a*2));}).ToArray();
            Tube(turn,.0011f,colour,4,false);
        }
        public void Box(Vector3 centre,Vector3 size,float bevel,Material material,Color colour,Basis? basis=null,bool openZ=false)
        {
            using var box=BevelMesh.Box(size,bevel,material);var a=box.SurfaceGetArrays(0);var p=a[(int)Godot.Mesh.ArrayType.Vertex].AsVector3Array();var n=a[(int)Godot.Mesh.ArrayType.Normal].AsVector3Array();var b=basis??Basis.Identity;
            Vector2 U(Vector3 v)=>size.Y>=Math.Max(size.X,size.Z)?new(v.Y/2,(Math.Abs(v.X)>Math.Abs(v.Z)?v.X:v.Z)/.1171875f):new(v.X/2,v.Z/.1171875f);
            for(int i=0;i<p.Length;i+=3){if(openZ&&Math.Abs(n[i].Z)>.999f)continue;Triangle(centre+b*p[i],centre+b*p[i+1],centre+b*p[i+2],b*n[i],b*n[i+1],b*n[i+2],U(p[i]),U(p[i+1]),U(p[i+2]),colour);}
        }
        public void Lathe(Vector3 centre,(float Radius,float Y)[] profile,Material material,Color colour,int sides=32)
        {
            for(int row=0;row<profile.Length-1;row++)for(int k=0;k<sides;k++)
            {
                Vector3 P(int r,int s){float a=Mathf.Tau*s/sides;return centre+new Vector3(profile[r].Radius*MathF.Cos(a),profile[r].Y,profile[r].Radius*MathF.Sin(a));}
                Vector3 N(int r,int s){int lo=Math.Max(0,r-1),hi=Math.Min(profile.Length-1,r+1);float dy=profile[hi].Y-profile[lo].Y,dr=profile[hi].Radius-profile[lo].Radius,a=Mathf.Tau*s/sides;return new Vector3(dy*MathF.Cos(a),-dr,dy*MathF.Sin(a)).Normalized();}
                Vector2 U(Vector3 p)=>new(p.X/2,p.Z/.1171875f);
                var p=P(row,k);var q=P(row+1,k);var r=P(row+1,k+1);var s=P(row,k+1);
                Triangle(p,q,r,N(row,k),N(row+1,k),N(row+1,k+1),U(p),U(q),U(r),colour);Triangle(p,r,s,N(row,k),N(row+1,k+1),N(row,k+1),U(p),U(r),U(s),colour);
            }
        }
        public void Dispose()=>tool.Dispose();
    }
    public static ShaderMaterial Material(string name,string? picture=null,Color? colour=null)
    {
        var m=new ShaderMaterial{ResourceName=name,Shader=ResourceLoader.Load<Shader>("res://world/town/resources/r000211.res")};
        m.SetShaderParameter("albedo",colour??Colors.White);m.SetShaderParameter("affine",0f);m.SetShaderParameter("fog_reach",1f);m.SetShaderParameter("bump_scale",.12f);
        if(picture!=null){m.SetShaderParameter("tex",ResourceLoader.Load<Texture2D>(picture+"_colour.png"));m.SetShaderParameter("bump_map",ResourceLoader.Load<Texture2D>(picture+"_height.png"));}
        return m;
    }
    public static readonly Color CordColour=new(.16f,.115f,.065f);
    public static void Panel(Builder b,float left,float width,float height,float top,float seed,float z=0,bool ties=true)
    {
        int columns=Math.Clamp((int)MathF.Round(width/.075f),8,48);const int rows=30;
        Vector3 P(float u,float v)
        {
            float sag=.055f*MathF.Sin(Mathf.Pi*u),length=height*(.96f+.04f*MathF.Sin(u*5+seed));
            float fold=(.035f*MathF.Sin(u*11+seed)+.018f*MathF.Sin(u*23-seed))*MathF.Sin(v*Mathf.Pi*.72f);
            return new(left+width*u,top-sag-v*length,z+fold+.035f*v);
        }
        for(int row=0;row<rows;row++)for(int col=0;col<=columns;col++)
        {
            float u=(col+(row%2)*.5f)/columns;if(u>1)continue;var at=P(u,row/(float)rows);
            foreach(int side in new[]{-1,1}){float next=u+side*.5f/columns;if(next<0||next>1)continue;var end=P(next,(row+1f)/rows);b.Tube(new[]{at,(at+end)*.5f+new Vector3(0,-.001f,.001f),end},.00165f,CordColour,6,false);}
            if(row>0&&col>0&&col<columns)b.Knot(at,CordColour*(.91f+.08f*MathF.Sin(col*1.7f+row*2.4f)));
        }
        foreach(float u in new[]{0f,1f})b.Tube(Enumerable.Range(0,rows+1).Select(i=>P(u,i/(float)rows)).ToArray(),.0033f,CordColour,8);
        foreach(float v in new[]{0f,1f})b.Tube(Enumerable.Range(0,columns*2+1).Select(i=>P(i/(float)(columns*2),v)).ToArray(),.0034f,CordColour,8);
        if(ties)for(int i=0;i<6;i++)
        {
            float u=i/5f;var p=P(u,0);
            b.Tube(new[]{p,p+new Vector3(-.008f,.034f,-.012f),p+new Vector3(0,.047f,-.02f),p+new Vector3(.008f,.035f,-.008f),p},.0022f,CordColour,6);
        }
    }
    public static ArrayMesh Nets()
    {
        using var b=new Builder();float[] xs={-2.6f,-.9f,.8f,2.5f};
        for(int i=0;i<3;i++)Panel(b,xs[i]+.08f,1.54f,1.64f,2.05f,i*2.1f,-.03f);
        // A folded net laid on the paving: five physical folds with uneven edge loops, no opaque mound.
        for(int row=0;row<=20;row++)
        {
            var line=new List<Vector3>();for(int c=0;c<=36;c++){float u=c/36f,v=row/20f;line.Add(new(-2.4f+1.2f*u,.018f+.17f*MathF.Pow(MathF.Sin(u*5*Mathf.Pi),2)*MathF.Sin(v*Mathf.Pi),.6f+1.2f*v+.025f*MathF.Sin(u*18+v*7)));}b.Tube(line,.0023f,CordColour,6);
        }
        for(int col=0;col<=24;col++)
        {
            var line=new List<Vector3>();for(int r=0;r<=24;r++){float u=col/24f,v=r/24f;line.Add(new(-2.4f+1.2f*u,.02f+.17f*MathF.Pow(MathF.Sin(u*5*Mathf.Pi),2)*MathF.Sin(v*Mathf.Pi),.6f+1.2f*v+.025f*MathF.Sin(u*18+v*7)));}b.Tube(line,.0023f,CordColour,6);
        }
        b.Finish(Material("net_mender_tarred_hemp"),"net_cords");b.Mesh.SetMeta("native_solid_skip",new[]{0});return b.Mesh;
    }
    public static ArrayMesh Structure(ArrayMesh original)
    {
        using var b=new Builder();var wood=Material("net_rack_weathered_wood","res://assets/textures/plan-84/6/wood_single");var shade=new Color(.98f,.94f,.84f);
        foreach(float x in new[]{-2.6f,-.9f,.8f,2.5f})b.Box(new(x,1.115f,0),new(.0707f,2.23f,.0707f),.003f,wood,shade,new Basis(Vector3.Up,Mathf.Pi/4));
        // Turned stool seats and chamfered splayed legs retain the original two stool positions.
        foreach(float x in new[]{-.3f,1.2f})
        {
            b.Lathe(new(x,0,1),new[]{(0f,.4f),(.146f,.4f),(.15f,.404f),(.15f,.436f),(.146f,.44f),(0f,.44f)},wood,shade,32);
            for(int k=0;k<3;k++){float a=k*Mathf.Tau/3;var from=new Vector3(x+.17f*MathF.Cos(a),.012f,1-.17f*MathF.Sin(a));var to=new Vector3(x+.08f*MathF.Cos(a),.4f,1-.08f*MathF.Sin(a));var d=to-from;var y=d.Normalized();var z=y.Cross(Vector3.Right).Normalized();var basis=new Basis(y.Cross(z),y,z);b.Box((from+to)*.5f,new(.035f,d.Length(),.035f),.002f,wood,shade,basis);}
        }
        // The sign's existing location and wording, with a proper board and rounded edges.
        foreach(float x in new[]{2.379f,4.021f})b.Box(new(x,.825f,.8f),new(.07f,1.65f,.07f),.003f,wood,shade);
        b.Box(new(3.2f,1.358f,.8f),new(1.562f,.484f,.06f),.003f,wood,shade,openZ:true);
        b.Box(new(3.2f,1.62f,.8f),new(1.562f,.04f,.07f),.003f,wood,shade);
        b.Finish(wood,"wooden_rack_and_seats");
        var sign=Material("net_mender_sign","res://assets/textures/plan-84/13/trades");
        foreach(int side in new[]{-1,1})
        {
            float z=.8f+side*.03f;var n=new Vector3(0,0,side);var p=new[]{new Vector3(2.422f,1.119f,z),new Vector3(3.978f,1.119f,z),new Vector3(3.978f,1.597f,z),new Vector3(2.422f,1.597f,z)};
            // Atlas coordinates use the same export orientation as the original lettering.
            var uv=new[]{new Vector2(73.5f/256,149.5f/256),new Vector2(143.5f/256,149.5f/256),new Vector2(143.5f/256,128.5f/256),new Vector2(73.5f/256,128.5f/256)};
            if(side<0)foreach(int i in Enumerable.Range(0,4))uv[i].X=(73.5f+143.5f)/256-uv[i].X;b.Triangle(p[0],p[1],p[2],n,n,n,uv[0],uv[1],uv[2],Colors.White);b.Triangle(p[0],p[2],p[3],n,n,n,uv[0],uv[2],uv[3],Colors.White);
        }
        b.Finish(sign,"painted_sign");
        // Header rope and lashings connect the hanging panel edges to the poles.
        for(int bay=0;bay<3;bay++)
        {
            float x0=-2.6f+bay*1.7f;b.Tube(Enumerable.Range(0,41).Select(i=>{float u=i/40f;return new Vector3(x0+1.7f*u,2.10f-.055f*MathF.Sin(u*Mathf.Pi),-.04f);}).ToArray(),.006f,CordColour,10);
        }
        foreach(float x in new[]{-2.6f,-.9f,.8f,2.5f})for(int wrap=0;wrap<3;wrap++)b.Tube(Enumerable.Range(0,25).Select(i=>{float a=i*Mathf.Tau/24;return new Vector3(x+.047f*MathF.Cos(a),2.10f+wrap*.009f,.047f*MathF.Sin(a));}).ToArray(),.003f,CordColour,6,false);
        b.Finish(Material("net_rack_header_rope"),"rope_lashings");
        // Wicker basket: continuous interwoven reeds, rounded rim and a woven floor.
        var wicker=new Color(.48f,.33f,.16f);
        for(int row=0;row<24;row++)
        {
            float y=.01f+row*.013f;b.Tube(Enumerable.Range(0,97).Select(i=>{float a=i*Mathf.Tau/96,r=.225f+.075f*y/.3f+.0035f*MathF.Sin(a*24+(row%2)*Mathf.Pi);return new Vector3(1.9f+r*MathF.Cos(a),y,1.1f+r*MathF.Sin(a));}).ToArray(),.0045f,wicker,6,false);
        }
        for(int k=0;k<24;k++)
        {
            float a=k*Mathf.Tau/24;b.Tube(Enumerable.Range(0,25).Select(i=>{float y=i*.013f,r=.225f+.075f*y/.3f+.004f*MathF.Sin(i*Mathf.Pi);return new Vector3(1.9f+r*MathF.Cos(a),y,1.1f+r*MathF.Sin(a));}).ToArray(),.004f,wicker,6);
        }
        b.Tube(Enumerable.Range(0,97).Select(i=>{float a=i*Mathf.Tau/96;return new Vector3(1.9f+.303f*MathF.Cos(a),.315f,1.1f+.303f*MathF.Sin(a));}).ToArray(),.007f,wicker,8,false);
        for(int k=-10;k<=10;k++){float x=k*.02f,z=MathF.Sqrt(.218f*.218f-x*x);b.Tube(new[]{new Vector3(1.9f+x,.015f,1.1f-z),new Vector3(1.9f+x,.015f,1.1f+z)},.005f,wicker,6);b.Tube(new[]{new Vector3(1.9f-z,.021f,1.1f+x),new Vector3(1.9f+z,.021f,1.1f+x)},.005f,wicker,6);}
        b.Finish(Material("net_mender_wicker"),"basket_reeds");
        // Keep the pre-existing low-poly obstacle geometry; decorative cord and reed triangles never enter physics.
        b.Mesh.SetMeta("native_solid_skip",Enumerable.Range(0,b.Mesh.GetSurfaceCount()).ToArray());b.Mesh.SetMeta("native_solid_stand_in",Faces(original));return b.Mesh;
    }
    public static ArrayMesh Drying(ArrayMesh original)
    {
        using var b=new Builder();Panel(b,-1.45f,2.9f,1.72f,-.075f,4,-.025f,false);
        b.Finish(Material("vliet_drying_hemp"),"drying_cords");
        var wood=Material("vliet_drying_spar","res://assets/textures/plan-84/6/wood_single");b.Box(new(0,-.03f,0),new(3.2f,.07f,.07f),.004f,wood,new(.8f,.76f,.66f));b.Finish(wood,"header_spar");
        for(int i=0;i<=10;i++)
        {
            float u=i/10f,x=-1.45f+u*2.9f;
            b.Tube(Enumerable.Range(0,17).Select(k=>{float a=k*Mathf.Tau/16;return new Vector3(x,-.035f+.047f*MathF.Cos(a),.044f*MathF.Sin(a));}).ToArray(),.0025f,CordColour,6,false);
            var hem=new Vector3(x,-.075f-.055f*MathF.Sin(Mathf.Pi*u),-.025f);
            b.Tube(new[]{new Vector3(x-.006f,-.078f,-.008f),hem+new Vector3(-.004f,0,0),hem+new Vector3(0,-.005f,0),hem+new Vector3(.004f,0,0),new Vector3(x+.006f,-.078f,-.008f)},.0022f,CordColour,6);
        }
        b.Finish(Material("vliet_net_lashings"),"spar_lashings");
        // Preserve a curtain obstacle with one coarse sheet following the repaired net's lower hem.
        // The original 8 mm cords had thousands of collision triangles and holes too small for a player.
        var collision=new List<Vector3>();
        for(int i=0;i<24;i++)
        {
            Vector3 P(int x,float y){float u=x/24f,sag=.055f*MathF.Sin(Mathf.Pi*u),hem=1.72f*(.96f+.04f*MathF.Sin(u*5+4));float fold=(.035f*MathF.Sin(u*11+4)+.018f*MathF.Sin(u*23-4))*MathF.Sin(y*Mathf.Pi*.72f);return new(-1.45f+u*2.9f,-.075f-sag-y*hem,-.025f+fold+.035f*y);}
            var a=P(i,0);var c=P(i+1,1);collision.AddRange(new[]{a,c,P(i,1),a,P(i+1,0),c});
        }
        collision.AddRange(Faces(original,1));b.Mesh.SetMeta("native_solid_skip",Enumerable.Range(0,b.Mesh.GetSurfaceCount()).ToArray());b.Mesh.SetMeta("native_solid_stand_in",collision.ToArray());return b.Mesh;
    }
    public static ArrayMesh DryingFrame(ArrayMesh original,Transform3D frame)
    {
        if(original.GetSurfaceCount()!=1)throw new InvalidOperationException("Unexpected drying frame surfaces");
        var a=original.SurfaceGetArrays(0);var points=a[(int)Godot.Mesh.ArrayType.Vertex].AsVector3Array();var ix=a[(int)Godot.Mesh.ArrayType.Index].AsInt32Array();if(ix.Length==0)ix=Enumerable.Range(0,points.Length).ToArray();
        bool InPost(Vector3 p,float x)=>Math.Abs(p.X-x)<.052f&&Math.Abs(p.Z-77.4249f)<.052f&&p.Y>=-.01f&&p.Y<2.64f;
        bool InHeader(Vector3 p)=>p.X> -147.92f&&p.X< -144.70f&&Math.Abs(p.Z-77.4249f)<.036f&&p.Y>2.51f&&p.Y<2.59f;
        var kept=new List<int>();int removed=0;
        for(int i=0;i<ix.Length;i+=3){var v=new[]{frame*points[ix[i]],frame*points[ix[i+1]],frame*points[ix[i+2]]};if(v.All(p=>InPost(p,-147.813f))||v.All(p=>InPost(p,-144.8127f))||v.All(InHeader)){removed++;continue;}kept.AddRange(ix.AsSpan(i,3).ToArray());}
        if(removed!=32)throw new InvalidOperationException("Expected exactly 32 old post/header triangles, found "+removed);
        var result=new ArrayMesh();a[(int)Godot.Mesh.ArrayType.Index]=kept.ToArray();result.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles,a);result.SurfaceSetMaterial(0,original.SurfaceGetMaterial(0));result.SurfaceSetName(0,original.SurfaceGetName(0));
        using var b=new Builder();var wood=Material("vliet_rack_posts","res://assets/textures/plan-84/6/wood_single");
        foreach(float x in new[]{-147.813f,-144.8127f})b.Box(new(x,1.315f,77.4249f),new(.0707f,2.63f,.0707f),.003f,wood,new(.91f,.86f,.75f),new Basis(Vector3.Up,Mathf.Pi/4));
        b.Finish(wood,"rounded_posts");var added=b.Mesh.SurfaceGetArrays(0);var p2=added[(int)Godot.Mesh.ArrayType.Vertex].AsVector3Array();var n2=added[(int)Godot.Mesh.ArrayType.Normal].AsVector3Array();var inverse=frame.AffineInverse();added[(int)Godot.Mesh.ArrayType.Vertex]=p2.Select(p=>inverse*p).ToArray();added[(int)Godot.Mesh.ArrayType.Normal]=n2.Select(n=>(inverse.Basis*n).Normalized()).ToArray();
        result.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles,added);result.SurfaceSetMaterial(1,wood);result.SurfaceSetName(1,"rounded_net_posts");
        // Every unrelated triangle is retained. Existing coarse obstacles include the former post/header shapes.
        result.SetMeta("native_solid_skip",new[]{0,1});result.SetMeta("native_solid_stand_in",Faces(original));return result;
    }
    public static ArrayMesh DryingPrototype(ArrayMesh original)
    {
        using var b=new Builder();var wood=Material("drying_rack_wood","res://assets/textures/plan-84/6/wood_single");
        foreach(float x in new[]{-1.8f,0,1.8f})b.Box(new(x,1.165f,0),new(.0707f,2.33f,.0707f),.003f,wood,new(.91f,.86f,.75f),new Basis(Vector3.Up,Mathf.Pi/4));
        b.Finish(wood,"drying_posts");
        for(int bay=0;bay<2;bay++)
        {
            float left=-1.8f+bay*1.8f;Panel(b,left+.08f,1.64f,1.65f,2.15f,bay*2.7f,-.03f);
            b.Tube(Enumerable.Range(0,41).Select(i=>{float u=i/40f;return new Vector3(left+1.8f*u,2.2f-.055f*MathF.Sin(u*Mathf.Pi),-.04f);}).ToArray(),.006f,CordColour,8);
        }
        b.Finish(Material("drying_rack_net"),"drying_net_cords");
        var collision=Faces(original,0);b.Mesh.SetMeta("native_solid_skip",Enumerable.Range(0,b.Mesh.GetSurfaceCount()).ToArray());b.Mesh.SetMeta("native_solid_stand_in",collision);return b.Mesh;
    }
    public static Vector3[] Faces(ArrayMesh mesh,int? only=null)
    {
        var list=new List<Vector3>();for(int s=0;s<mesh.GetSurfaceCount();s++){if(only!=null&&only!=s)continue;var a=mesh.SurfaceGetArrays(s);var v=a[(int)Godot.Mesh.ArrayType.Vertex].AsVector3Array();var ix=a[(int)Godot.Mesh.ArrayType.Index].AsInt32Array();list.AddRange(ix.Length==0?v:ix.Select(i=>v[i]));}return list.ToArray();
    }
    public static ArrayMesh Join(params ArrayMesh[] meshes)
    {
        var result=new ArrayMesh();foreach(var mesh in meshes)for(int s=0;s<mesh.GetSurfaceCount();s++){result.AddSurfaceFromArrays(Godot.Mesh.PrimitiveType.Triangles,mesh.SurfaceGetArrays(s));int n=result.GetSurfaceCount()-1;result.SurfaceSetMaterial(n,mesh.SurfaceGetMaterial(s));result.SurfaceSetName(n,mesh.SurfaceGetName(s));}return result;
    }
}
