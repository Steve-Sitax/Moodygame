using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

public static partial class RuienDrainNetwork
{
    private static string Variant(Head h)=>h.Template.Name+":"+h.Flat+":"+h.Bend+":"+
        System.Text.Json.JsonSerializer.Serialize(h.Host.Zone.S);
    internal static IEnumerable<string> StartupFiles(Network net)
    {
        foreach(var group in net.Heads.GroupBy(h=>h.Template.Name))
            yield return net.Kit+"/"+group.Key+"_collision.res";
    }
    /// <summary>All fixed construction and all solids are ready before play.
    /// Only disk reads of finished visual resources follow the moving camera.</summary>
    public static RuienArea Prepare(Network net)
    {
        using var timing=Dev.StartupTiming.Split("ruien.drain-network");
        var result=RuienArea.Streamer("ruien_drainage");var root=result.Root;
        var templates=new Dictionary<(string,int),ArrayMesh>();var faces=new Dictionary<string,Vector3[]>();
        var rigidMeshes=new Dictionary<(string,int),string>();var rigidShapes=new Dictionary<string,ConcavePolygonShape3D>();
        string Descriptor(Head h)=>h.Curved?"drain-curved:"+h.Id:"drain-rigid:"+Variant(h);
        foreach(var h in net.Heads)
        {
            string descriptor=Descriptor(h);var frame=h.Curved?Transform3D.Identity:RigidFrame(h);var bounds=h.CutBox.Grow(3);
            for(int lod=0;lod<2;lod++)
            {
                int level=lod;string file;
                if(!h.Curved&&rigidMeshes.TryGetValue((descriptor,lod),out var previous))file=previous;
                else
                {
                    file=RuienGeometryCache.Prepare(net.Source,descriptor+":lod"+lod,()=>
                    {
                        if(!templates.TryGetValue((h.Template.Name,level),out var mesh))
                            templates[(h.Template.Name,level)]=mesh=ResourceLoader.Load<ArrayMesh>($"{net.Kit}/{h.Template.Name}_lod{level}.res");
                        return Warp(mesh,h.Curved?h:LocalVariant(h));
                    });
                    if(!h.Curved)rigidMeshes[(descriptor,lod)]=file;
                }
                result.Prepared(h.Id,file,net.Source+":"+h.Id+":lod"+lod,bounds,lod,frame);
            }
            ConcavePolygonShape3D shape;
            if(!h.Curved&&rigidShapes.TryGetValue(descriptor,out var shared))shape=shared;
            else
            {
                shape=RuienGeometryCache.Get(net.Source,descriptor+":collision",()=>
                {
                    if(!faces.TryGetValue(h.Template.Name,out var data))
                        faces[h.Template.Name]=data=ResourceLoader.Load<ConcavePolygonShape3D>($"{net.Kit}/{h.Template.Name}_collision.res").Data;
                    var pose=h.Curved?h:LocalVariant(h);
                    return new ConcavePolygonShape3D{Data=data.Select(pose.Map).ToArray(),BackfaceCollision=true};
                });
                if(!h.Curved)rigidShapes[descriptor]=shape;
            }
            var body=new StaticBody3D{Name="head_"+h.Id+"_solid",Transform=frame,CollisionLayer=Solid.Layer,CollisionMask=0};
            body.AddChild(new CollisionShape3D{Shape=shape});root.AddChild(body);
        }
        timing?.Next("heads");
        Dictionary<string,List<QuayNotch.Region>>? joins=null;
        IReadOnlyList<QuayNotch.Region> Cuts(string id)=>(joins??=JunctionCuts(net))[id];
        var profile=net.Templates.Values.First().Profile;var byId=net.Heads.ToDictionary(h=>h.Id);
        foreach(var c in net.Collectors)
        {
            var head=c.DestinationKind=="head"?byId[c.Destination]:null;
            for(float a=0;a<c.Length-.001f;a+=2)
            {
                float start=a,end=Math.Min(c.Length,a+2);string id=c.Id+"_"+((int)(a/2));
                var bounds=new Aabb(c.At(start),Vector3.Zero).Expand(c.At(end)).Grow(.7f);bounds.Size+=Vector3.Up*1.7f;
                string file=RuienGeometryCache.Prepare(net.Source,"collector:"+id,()=>CutPipe(PipeChunk(c,start,end,profile,head),Cuts(c.Id)));
                result.Prepared(id,file,net.Source+":"+id,bounds,0,Transform3D.Identity);
            }
            string cap=RuienGeometryCache.Prepare(net.Source,"collector-cap:"+c.Id,()=>CutPipe(CollectorCap(c,profile),Cuts(c.Id)));
            result.Prepared(c.Id+"_cap",cap,net.Source+":"+c.Id+":cap",new Aabb(c.At(0),Vector3.Zero).Grow(2),0,Transform3D.Identity);
        }
        timing?.Next("collectors");
        foreach(var inlet in net.Inlets)
        {
            var bounds=new Aabb(inlet.From,Vector3.Zero).Expand(inlet.To).Grow(.5f);
            string file=RuienGeometryCache.Prepare(net.Source,"gully:"+inlet.Id,()=>InletMesh(inlet));
            result.Prepared("gully_"+inlet.Id,file,net.Source+":gully:"+inlet.Id,bounds,0,Transform3D.Identity);
        }
        timing?.Next("inlets");return result;
    }
}
