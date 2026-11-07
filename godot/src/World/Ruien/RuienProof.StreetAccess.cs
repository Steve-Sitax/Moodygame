using System;
using System.Linq;
using Godot;

namespace Scheldemist.World.Ruien;

public partial class RuienProof
{
    private void StreetAccess()
    {
        var space=GetViewport().World3D.DirectSpaceState;
        foreach(var w in Ruien.I!.Data.Areas.SelectMany(a=>a.Ways).Where(w=>w.Retired))
        {
            int total=0,bad=0;float lo=float.PositiveInfinity,hi=float.NegativeInfinity;
            var h=w.Hole;
            for(float x=h.Position.X+.08f;x<h.End.X;x+=.2f)
                for(float z=h.Position.Y+.08f;z<h.End.Y;z+=.2f)
                {
                    total++;
                    var ray=PhysicsRayQueryParameters3D.Create(new Vector3(x,.5f,z),new Vector3(x,-.7f,z),Solid.Layer);
                    var hit=space.IntersectRay(ray);
                    if(hit.Count==0){bad++;continue;}
                    float y=hit["position"].AsVector3().Y;lo=Math.Min(lo,y);hi=Math.Max(hi,y);
                    if(y<-.03f||y>.23f)bad++;
                }
            Check("retired "+w.Id+" has continuous street paving",bad==0,$"{total} rays, bad {bad}, y {lo}..{hi}");
            Check("retired "+w.Id+" has no moving lids",!RuienHatch.All.ContainsKey(w.Id));
        }
        Check("street grates are ventilation only",!Ruien.I.Data.Areas.SelectMany(a=>a.Ways).Any(w=>w.Kind=="ladder"));
        Check("Sint-Paulus street house retired",!RuienEntrance.All.Any(s=>s.Id=="re29_sint_paulus"));
        Check("Rijnkaai house follows quay",RuienEntrance.All.Single(s=>s.Id=="re28_rijnkaai").Out.DistanceTo(Vector2.Left)<.001f);
        var clear=space.IntersectRay(PhysicsRayQueryParameters3D.Create(new Vector3(150.7f,.4f,272.92f),new Vector3(150.7f,-.5f,272.92f),Solid.Layer));
        Check("retired Sint-Paulus site has street ground",clear.Count>0 && MathF.Abs(clear["position"].AsVector3().Y)<.1f);
    }
}
