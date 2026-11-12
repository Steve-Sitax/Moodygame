using System;
using System.Linq;
using Godot;
using Scheldemist.Models;

namespace Scheldemist.World.Ruien;

public static partial class RuienEntrance
{
    public static Node3D BuildConnection(Spec spec)=>BuildLink(spec);
    public static Transform3D LinkFrame(Spec s) => s.Local * s.ClosureWall *
        new Transform3D(Basis.Identity,new Vector3(s.ClosureOpening.C,s.ClosureOpening.Floor,0));

    // Imported masonry must give way to a connected native stair, just as the town's foundation does.
    // Work on copies of each LOD and of its collision; the authored resources remain untouched.
    public static bool TrimConnected(Godot.Collections.Array arrays,string area)
    {
        var regions=new System.Collections.Generic.List<QuayNotch.Region>();
        foreach(var s in All.Where(s=>s.ConnectArea==area))
        {
            regions.AddRange(StairBore(s));
            // Remove the passage air, not the host niche's full lining envelope. The latter left open strips
            // above and beside the new barrel when seen from the hall. These planes follow its inner facets.
            if(s.ConnectPath.Length>1)
            {regions.AddRange(RuienPassage.Segments(s.ConnectPath).Select(p=>new QuayNotch.Region(p.Box,RuienPassage.Air(p))));continue;}
            var inverse=LinkFrame(s).AffineInverse();const float half=.602f;
            var air=new System.Collections.Generic.List<Func<Vector3,float>>{
                p=>half-(inverse*p).X,p=>half+(inverse*p).X,p=>(inverse*p).Y+.25f,
                p=>(inverse*p).Z+.03f,p=>s.ConnectLength+s.ConnectHead+.03f-(inverse*p).Z};
            for(int i=0;i<48;i++)
            {
                float angle=(i+.5f)*MathF.PI/48,cos=MathF.Cos(angle),sin=MathF.Sin(angle);
                air.Add(p=>half*MathF.Cos(MathF.PI/96)-(inverse*p).X*cos-((inverse*p).Y-1.6f)*sin);
            }
            regions.Add(new QuayNotch.Region(BoxOf(LinkFrame(s),new Vector3(-.605f,-.253f,-.033f),new Vector3(.605f,2.205f,s.ConnectLength+s.ConnectHead+.033f)),air));
        }
        return QuayNotch.CutSurfaceRegions(arrays,Transform3D.Identity,regions)>0;
    }

    // The town cut reserves a construction envelope. A neighbouring vault must lose
    // only the stair's actual air: the envelope's flat top left sky above its sloping roof.
    private static System.Collections.Generic.IEnumerable<QuayNotch.Region> StairBore(Spec s)
    {
        var world=s.Local*s.Run;var inv=world.AffineInverse();
        float half=s.Width/2+.003f,rise=s.VaultRise+.003f;
        foreach(var (u0,u1,y0,y1) in new[]{
            (-s.Lining/2,s.TopLanding,s.Spring,s.Spring),
            (s.TopLanding,s.TopLanding+s.FlightLength,s.Spring,s.Spring-s.Drop),
            (s.TopLanding+s.FlightLength,s.RunLength+s.Lining/2,s.Spring-s.Drop,s.Spring-s.Drop)})
        {
            float slope=(y1-y0)/(u1-u0);
            var planes=new System.Collections.Generic.List<Func<Vector3,float>>{
                p=>(inv*p).X-u0+.003f,p=>u1+.003f-(inv*p).X,
                p=>(inv*p).Z+half,p=>half-(inv*p).Z,p=>(inv*p).Y+s.Drop+.45f};
            for(int i=0;i<48;i++)
            {
                float angle=(i+.5f)*MathF.PI/48,cos=MathF.Cos(angle),sin=MathF.Sin(angle);
                planes.Add(p=>{var q=inv*p;return MathF.Cos(MathF.PI/96)-cos*q.Z/half-sin*(q.Y-y0-slope*(q.X-u0))/rise;});
            }
            yield return new QuayNotch.Region(BoxOf(world,new Vector3(u0-.003f,-s.Drop-.45f,-half),
                new Vector3(u1+.003f,Math.Max(y0,y1)+rise,half)).Grow(.003f),planes);
        }
    }

    private static Node3D BuildLink(Spec s)
    {
        if(s.ConnectPath.Length>1)return RuienPassage.Build(s);
        var root=new Node3D{Name="connected_passage",Transform=s.Local.AffineInverse()*LinkFrame(s)};
        var brick=new SurfaceTool();var stone=new SurfaceTool();var paving=new SurfaceTool();var vault=new SurfaceTool();
        foreach(var t in new[]{brick,stone,paving,vault})t.Begin(Mesh.PrimitiveType.Triangles);
        float l=s.ConnectLength,start=Math.Min(s.Lining,l*.85f),end=l+s.ConnectHead+.06f;
        void Box(SurfaceTool t,Vector3 at,Vector3 size,float r,string family)
            =>t.AppendFrom(BevelMesh.Box(size,r,RuienMaterials.Get(family)),0,new Transform3D(Basis.Identity,at));
        Box(stone,new Vector3(0,-.13f,l/2),new Vector3(1.24f,.26f,l+.12f),.008f,"ruien_bluestone");
        foreach(float side in new[]{-1f,1f})
            Box(brick,new Vector3(side*.73f,.8f,(start+end)/2),new Vector3(.26f,1.6f,end-start),.008f,"ruien_brick_stretcher");
        RuienStair.Vault(vault,new Vector3(0,1.6f,start),new Vector3(0,1.6f,end),Vector3.Right,.6f,.6f,.24f);
        // Paving's weather follows the world position, not this short passage's local origin.
        RuienPaving.Rectangle(paving,Transform3D.Identity.Translated(new Vector3(0,0,l/2)),1.19f,l,LinkFrame(s).Origin);
        // A straight passage, like a curved one, ends against the host's vault.
        // Its lining must not continue over the maintenance ledge at head height.
        var hostAir=RuienPassage.HostAir(s);var frame=LinkFrame(s);
        float Trim(Vector3 p)=>hostAir(frame*p);
        RuienStair.Add(root,brick,"ruien_brick_stretcher",true,trim:Trim);
        RuienStair.Add(root,vault,"ruien_brick_stretcher",true,barrel:true,trim:Trim);
        RuienStair.Add(root,stone,"ruien_bluestone",true);
        RuienStair.Add(root,paving,"ruien_setts",true,metric:false);
        RuienPassage.EndWeb(root,new Transform3D(Basis.Identity,new Vector3(0,0,end)),frame,hostAir,.84f);
        return root;
    }

    // Native square dressing is installed after the baked town cuts; clear its new plants too.
    public static int ClearPlants(Node3D town)
    {
        using var batch=QuayNotch.BeginCutBatch(town);
        int n=0;
        foreach(var s in All)
        {
            var o=s.DoorOpening;var inv=s.Local.AffineInverse();
            var corridor=new Aabb(new Vector3(-o.H-.6f,-.3f,-.65f),new Vector3(2*o.H+1.2f,o.Top+1.3f,s.Approach+1.3f));
            n+=Drop(town,mi=>s.Foliage.Any(c=>mi.Name.ToString().StartsWith(c,StringComparison.Ordinal)),s.FoliageMaterials,inv,corridor);
            n+=HidePlants(town,s,inv,corridor);
        }
        return n;
    }
}

public static class RuienStreetClosure
{
    public static bool Trim(Godot.Collections.Array arrays,RuienData.Area area)
    {
        bool changed=false;
        foreach(var w in area.Ways.Where(w=>w.Retired))
        {
            var h=w.Hole.Grow(.36f);
            changed|=QuayNotch.CutSurfaceWith(arrays,Transform3D.Identity,_=>true,new(){
                p=>p.X-h.Position.X,p=>h.End.X-p.X,p=>p.Z-h.Position.Y,p=>h.End.Y-p.Z,p=>p.Y+.12f})>0;
        }
        return changed;
    }

    public static Node3D Cap(RuienData.Way w)
    {
        var root=new Node3D{Name="sealed_"+w.Id};var t=new SurfaceTool();t.Begin(Mesh.PrimitiveType.Triangles);
        // The old exported lining opens out beyond the lid rectangle. Bear the closure on that masonry as well;
        // a lid-sized cap left sky visible through the flared corners from the hall walk below.
        var h=w.Hole.Grow(1.0f);
        t.AppendFrom(BevelMesh.Box(new Vector3(h.Size.X,.26f,h.Size.Y),.008f,RuienMaterials.Get("ruien_bluestone")),0,
            new Transform3D(Basis.Identity,new Vector3(h.GetCenter().X,-.23f,h.GetCenter().Y)));
        RuienStair.Add(root,t,"ruien_bluestone",true);
        return root;
    }
}
