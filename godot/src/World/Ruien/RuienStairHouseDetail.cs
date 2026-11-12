using System;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

public static partial class RuienStairHouse
{
    private static Color Weather(Vector3 p,float back,string family)
    {
        float grain=.5f+.25f*MathF.Sin(p.X*19+p.Z*7)+.25f*MathF.Sin(p.Z*13-p.Y*8);
        float foot=Math.Clamp((.82f-p.Y)/.8f,0,1);
        float pipe=MathF.Exp(-MathF.Pow((p.Z-back-.35f)/.17f,2))*Math.Clamp((MathF.Abs(p.X)-.85f)*4,0,1);
        float damp=foot*(.2f+.15f*grain)+pipe*.12f;
        float tone=.96f-damp;
        if(family=="house_slate")tone=.87f+.10f*grain;
        if(family=="house_iron")tone=.76f+.17f*grain;
        return new Color(tone,tone*(1-damp*.06f),tone*(1-damp*.18f),.42f+.4f*grain);
    }

    private static Image? brickHeight;
    // Relief follows the town's cross bond, including its alternating header courses. Using nominal brick boxes
    // here put joints through the photographed brick faces. The continuous backing and its bevelled corners stay.
    private static void BrickRelief(Parts parts,RuienEntrance.Spec spec,float back)
    {
        if(brickHeight==null)
        {
            brickHeight=ResourceLoader.Load<Texture2D>(HeightTexture).GetImage();
            if(brickHeight.IsCompressed())brickHeight.Decompress();
        }
        var im=brickHeight;
        float Sample(Vector2 uv)
        {
            float x=Mathf.PosMod(uv.X,1)*im.GetWidth(),y=Mathf.PosMod(uv.Y,1)*im.GetHeight();
            int ix=(int)x,iy=(int)y;
            float P(int a,int b)=>im.GetPixel(a%im.GetWidth(),b%im.GetHeight()).R;
            return Mathf.Lerp(Mathf.Lerp(P(ix,iy),P(ix+1,iy),x-ix),Mathf.Lerp(P(ix,iy+1),P(ix+1,iy+1),x-ix),y-iy);
        }
        void Field(Vector3 origin,Vector3 u,Vector3 normal,float a0,float a1,float y0,float y1)
        {
            if(a1-a0<.01f || y1-y0<.01f)return;
            var texU=(-normal).Cross(Vector3.Up);
            Vector2 UV(Vector3 p)=>new Vector2(p.Dot(texU),-p.Y)/BrickTile;
            float H(float a,float y)
            {
                float edge=Math.Min(Math.Min(a-a0,a1-a),Math.Min(y-y0,y1-y));
                return (.001f+.007f*Sample(UV(origin+u*a+Vector3.Up*y)))*Math.Clamp(edge/.025f,0,1);
            }
            int nx=(int)MathF.Ceiling((a1-a0)/.025f),ny=(int)MathF.Ceiling((y1-y0)/.025f);
            (Vector3 p,Vector3 n,Vector2 uv) At(int i,int j)
            {
                float a=Mathf.Lerp(a0,a1,i/(float)nx),y=Mathf.Lerp(y0,y1,j/(float)ny),h=H(a,y);
                var p=origin+u*a+Vector3.Up*y;const float e=.008f;
                var n=(normal-u*((H(a+e,y)-H(a-e,y))/(2*e))-Vector3.Up*((H(a,y+e)-H(a,y-e))/(2*e))).Normalized();
                return(p+normal*h,n,UV(p));
            }
            void Tri((Vector3 p,Vector3 n,Vector2 uv) a,(Vector3 p,Vector3 n,Vector2 uv) b,(Vector3 p,Vector3 n,Vector2 uv) c)
            {
                if((b.p-a.p).Cross(c.p-a.p).Dot(normal)>0)(b,c)=(c,b);
                foreach(var v in new[]{a,b,c}){parts.Relief.SetNormal(v.n);parts.Relief.SetUV(v.uv);parts.Relief.AddVertex(v.p);}
            }
            for(int i=0;i<nx;i++)for(int j=0;j<ny;j++)
            {
                var a=At(i,j);var b=At(i+1,j);var c=At(i+1,j+1);var d=At(i,j+1);
                Tri(a,b,c);Tri(a,c,d);
            }
        }
        foreach(float side in new[]{-1f,1f})
            Field(new Vector3(side*Half,0,0),Vector3.Back,Vector3.Right*side,back+.012f,-.012f,PlinthTop+.005f,Eaves-.23f);
        Field(new Vector3(0,0,back),Vector3.Right,Vector3.Forward,-Half+.012f,Half-.012f,PlinthTop+.005f,Eaves-.23f);
        float jamb=spec.DoorOpening.H+.25f;
        Field(Vector3.Zero,Vector3.Right,Vector3.Back,-Half+.012f,-jamb,PlinthTop+.005f,Eaves-.23f);
        Field(Vector3.Zero,Vector3.Right,Vector3.Back,jamb,Half-.012f,PlinthTop+.005f,Eaves-.23f);
        Field(Vector3.Zero,Vector3.Right,Vector3.Back,-jamb,jamb,spec.DoorOpening.Top+.20f,Eaves-.23f);
    }

    private static void Roof(SurfaceTool slate,SurfaceTool boarding,Material mat,Material wood,float side,float z0,float z1,float tan)
    {
        float xe=Half+.16f;
        var ridge=new Vector3(0,Ridge,0);
        var down=new Vector3(side,-tan,0).Normalized();
        var normal=new Vector3(side*tan,1,0).Normalized();
        var along=Vector3.Back;
        var basis=new Basis(down,normal,side>0?along:-along);
        float slope=xe/MathF.Cos(Mathf.DegToRad(PitchDeg));
        float length=z1-z0;
        // Board grain runs along the eaves. Ends are housed in the gables; exposed edges have 2 mm radii.
        int boards=(int)MathF.Ceiling(slope/.18f);
        for(int i=0;i<boards;i++)
        {
            float a=slope*i/boards,b=slope*(i+1)/boards;
            boarding.AppendFrom(BevelMesh.Box(new Vector3(b-a-.002f,.023f,length),.002f,wood),0,
                new Transform3D(basis,ridge+down*((a+b)/2)-normal*.024f+new Vector3(0,0,(z0+z1)/2)));
        }
        // 200 mm exposure, 390 mm slates, alternating half-width bond. The upper course sits over the heads below.
        const float exposure=.2f,width=1.6f/6;
        int rows=(int)MathF.Ceiling(slope/exposure);
        for(int row=rows-1;row>=0;row--)
        {
            float a=row*exposure,b=Math.Min(slope,a+.39f);
            for(float z=z0-(row%2)*width/2;z<z1;z+=width)
            {
                float q=Math.Max(z0,z+.0015f),r=Math.Min(z1,z+width-.0015f);
                if(r-q<.025f)continue;
                float lift=(rows-row)*.0047f;
                var mesh=BevelMesh.Box(new Vector3(b-a,.0045f,r-q),.001f,mat);
                var at=new Transform3D(basis,ridge+down*((a+b)/2)+normal*lift+new Vector3(0,0,(q+r)/2));
                // The slate photograph has eight courses per 1.6 m tile: keep its joints on the geometric courses.
                var arrays=mesh.SurfaceGetArrays(0);var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                var uv=new Vector2[vertices.Length];
                var originalUv=arrays[(int)Mesh.ArrayType.TexUV].AsVector2Array();
                var normals=arrays[(int)Mesh.ArrayType.Normal].AsVector3Array();
                for(int k=0;k<vertices.Length;k++)
                {
                    var v=at*vertices[k];float u=v.Z;
                    float vDown=(v-ridge).Dot(down);
                    // Crop one photographed slate onto each geometric slate. Only its tail below the 190 mm headlap
                    // is exposed; placing the full repeating picture here painted a second seam across each tile.
                    float texU=u-z0;
                    float texV=row*exposure+vDown-a-.19f;
                    uv[k]=MathF.Abs(normals[k].Y)>.95f?new Vector2(texU/SlateTile.X,texV/SlateTile.Y):originalUv[k]/SlateTile;
                }
                arrays[(int)Mesh.ArrayType.TexUV]=uv;
                var charted=new ArrayMesh();charted.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);
                slate.AppendFrom(charted,0,at);
            }
        }
        // Lead soakers up the parapets, capped by the existing stone rake. Thin sheet edges: 1 mm radius.
    }

    private static void Drain(Parts p,Material stone,Material iron,float side,float z,float invert)
    {
        void Box(SurfaceTool t,Material m,Vector3 at,Vector3 size,float r)
            =>t.AppendFrom(BevelMesh.Box(size,r,m),0,new Transform3D(Basis.Identity,at));
        float a=Half+.17f,b=Half+.56f,mid=(a+b)/2;
        // Open U channel: sloping invert from the shoe to a grated trapped gully, no raised flat splash plate.
        foreach(float dz in new[]{-.105f,.105f})
            Box(p.Stone,stone,new Vector3(side*mid,.005f,z+dz),new Vector3(b-a+.03f,.08f,.065f),.008f);
        var tilt=new Basis(Vector3.Back,-side*.045f);
        p.Stone.AppendFrom(BevelMesh.Box(new Vector3(b-a,.055f,.15f),.006f,stone),0,
            new Transform3D(tilt,new Vector3(side*mid,-.026f,z)));
        float x=side*b;
        foreach(float sd in new[]{-1f,1f})
        {
            if(sd==-side)
                foreach(float dz in new[]{-.18f,.18f})
                    Box(p.Stone,stone,new Vector3(x+sd*.18f,-.015f,z+dz),new Vector3(.08f,.15f,.10f),.010f);
            else Box(p.Stone,stone,new Vector3(x+sd*.18f,-.015f,z),new Vector3(.08f,.15f,.46f),.010f);
            Box(p.Stone,stone,new Vector3(x,-.015f,z+sd*.19f),new Vector3(.29f,.15f,.08f),.010f);
        }
        // The buried connection depth follows the receiving network, above any main-vault crown.
        Tube(p.Iron,new Vector3(x,-.02f,z),new Vector3(x,invert,z),.05f);
        foreach(float dz in new[]{-.14f,.14f})
            Box(p.Iron,iron,new Vector3(x,.015f,z+dz),new Vector3(.31f,.025f,.026f),.002f);
        for(int i=0;i<7;i++)
            Box(p.Iron,iron,new Vector3(x-.126f+i*.042f,.015f,z),new Vector3(.018f,.025f,.28f),.002f);
    }

    // Hollow 3 mm iron pipe, with a 1 mm rolled mouth; joints overlap, so no closed disc blocks a shoe or outlet.
    private static void Tube(SurfaceTool t,Vector3 a,Vector3 b,float radius)
    {
        var axis=(b-a).Normalized();float length=a.DistanceTo(b);
        var x=(MathF.Abs(axis.Y)<.9f?Vector3.Up:Vector3.Right).Cross(axis).Normalized();var z=x.Cross(axis);
        var section=new[]{new Vector2(0,radius-.003f),new Vector2(0,radius-.001f),new Vector2(.001f,radius),
            new Vector2(length-.001f,radius),new Vector2(length,radius-.001f),new Vector2(length,radius-.003f)};
        const int sides=16;
        Vector3 P(int i,Vector2 p)=>a+axis*p.X+(x*MathF.Cos(i*Mathf.Tau/sides)+z*MathF.Sin(i*Mathf.Tau/sides))*p.Y;
        for(int j=0;j<section.Length;j++)for(int i=0;i<sides;i++)
        {
            var q=section[j];var r=section[(j+1)%section.Length];
            var v0=P(i,q);var v1=P(i+1,q);var v2=P(i+1,r);var v3=P(i,r);
            var n=-(v1-v0).Cross(v2-v0).Normalized();
            foreach(var v in new[]{v0,v1,v2,v0,v2,v3}){t.SetNormal(n);t.SetUV(new Vector2(i*Mathf.Tau*radius/sides,v.Dot(axis)));t.AddVertex(v);}
        }
    }
}
