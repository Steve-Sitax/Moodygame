using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

public static class NativeRuienGaugeProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        var ruien = Ruien.I!;
        var previousCamera = game.Cam;
        var jef = Jef.I;
        var feet = new Vector3(jef.X,jef.Y,jef.Z);
        float yaw = jef.Yaw, pitch = jef.Pitch;
        bool frozen = jef.Frozen, testing = jef.TestInput;
        float? held = Tide.Held;
        float river = Tide.River;
        var (clockHour,weather) = (GameState.I.HourF,GameState.I.Weather);
        var (litHour,litWeather) = (Daylight.I.Hour,Daylight.I.Weather);
        var hud = game.GetTree().Root.FindChildren("*","CanvasLayer",true,false).OfType<CanvasLayer>()
            .Select(h => (Layer:h, h.Visible)).ToArray();
        var camera = new Camera3D { Near=.025f, Fov=66, CullMask=previousCamera.CullMask & ~Arms.BodyLayer,
            Environment=previousCamera.Environment };
        game.View.AddChild(camera);
        camera.MakeCurrent();
        game.Cam=camera;
        var space = game.View.FindWorld3D().DirectSpaceState;
        async Task Frame() => await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
        async Task WaitFor(Func<bool> ready, string missing)
        {
            var until=DateTime.UtcNow.AddSeconds(75);
            while (!ready() && DateTime.UtcNow<until) await Frame();
            if (!ready()) throw new InvalidOperationException(missing);
        }
        async Task Photo(string name)
        {
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            using var image = game.View.GetTexture().GetImage();
            if (image.SavePng(Path.Combine(output,name)) != Error.Ok) throw new IOException(name);
        }
        void Place(Vector3 eye, Vector3 look, bool movePlayer=true)
        {
            camera.LookAtFromPosition(eye,look);
            if (!movePlayer) return;
            var angles = camera.GlobalBasis.GetEuler(EulerOrder.Yxz);
            jef.Place(eye.X,eye.Z,angles.Y,angles.X,eye.Y-Jef.Eye);
        }
        Godot.Collections.Dictionary Ray(Vector3 a, Vector3 b)
        {
            using var ray = PhysicsRayQueryParameters3D.Create(a,b,Solid.Layer);
            ray.HitBackFaces = true;
            return space.IntersectRay(ray);
        }
        try
        {
            jef.Frozen=true; jef.TestInput=true;
            foreach (var entry in hud) entry.Layer.Visible=false;
            Place(new Vector3(-148.66f,-2.00f,76.00f), new Vector3(-144.94f,-4.46f,76.95f));
            await WaitFor(() => game.View.HasNode(RuienTideGauge.Installed),"O2 staff failed to load");
            var staff=game.View.GetNode<Node3D>(RuienTideGauge.Installed);
            var board=staff.GetNode<MeshInstance3D>("Staff");
            var indicator=staff.GetNode<MeshInstance3D>("Float");
            var sheet=game.View.GetNode<MeshInstance3D>("ruien_o2/water_gallery");
            var area=ruien.Data.Areas.First(a=>a.Id=="o2");
            float sill=area.Gates.First(g=>g.Id=="O2").Sill;
            var front=staff.GlobalBasis.Z;
            if (Math.Abs(staff.GlobalPosition.Y-sill)>.001f || !board.IsVisibleInTree() ||
                (board.Layers&camera.CullMask)==0 || board.Mesh.GetSurfaceCount()<3 ||
                staff.FindChildren("*","CollisionObject3D",true,false).Count!=0)
                throw new InvalidOperationException("O2 scale datum, visible mesh or collision changed");
            // Probe the full width and height, including edges, on the live installed collider.
            for (int xi=0;xi<=8;xi++)
            for (int yi=0;yi<=32;yi++)
            {
                var at=staff.ToGlobal(new Vector3(Mathf.Lerp(-.165f,.165f,xi/8f),Mathf.Lerp(-.041f,1.084f,yi/32f),0));
                var hit=Ray(at+front*.17f,at-front*.10f);
                if (hit.Count==0 || hit["collider"].AsGodotObject() is not StaticBody3D support ||
                    support.Name!="ruien_o2_solid" || MathF.Abs((hit["position"].AsVector3()-at).Dot(front))>.055f)
                    throw new InvalidOperationException($"Unsupported O2 staff at {xi},{yi}");
            }
            // Stand on the opposite gallery ledge. Pick a clear sightline around the vertical gate fittings.
            Vector3 target=staff.ToGlobal(new Vector3(0,.69f,.06f));
            Vector3? approach=null;
            foreach (float along in new[]{.75f,1.1f,0f,-.55f})
            {
                foreach (float depth in new[]{3.70f,3.38f,3.90f})
                {
                    var xy=staff.ToGlobal(new Vector3(along,0,depth));
                    var ground=Ray(new Vector3(xy.X,-3.17f,xy.Z),new Vector3(xy.X,-3.85f,xy.Z));
                    if (ground.Count==0 || ground["normal"].AsVector3().Y<.80f) continue;
                    var eye=ground["position"].AsVector3()+Vector3.Up*Jef.Eye;
                    if (Ray(eye,target).Count==0) { approach=eye; break; }
                }
                if (approach!=null) break;
            }
            if (approach==null) throw new InvalidOperationException("No dry viewing position for the O2 gauge");
            Place(approach.Value,target);
            await WaitFor(()=>!ruien.PendingVisuals(camera.GlobalPosition).Any(),"O2 gallery visual streaming");
            await Scheldemist.Dev.Kit.I.Light(13,"clear",false);
            var observed=new List<object>();
            foreach (var (name,external,expected) in new[]{("low",Tide.LwMin,area.WaterMin),
                         ("high",Tide.HwMax,area.WaterMin+area.WaterRise)})
            {
                Tide.Hold(external);
                Tide.Advance(20);
                ruien._Process(0);
                for (int j=0;j<4;j++) await Frame();
                var buoy=indicator.ToGlobal(new Vector3(-.141f,0,.049f));
                var sensed=ruien.WaterAt(buoy.X,buoy.Z);
                if (sensed==null || Math.Abs(buoy.Y-sensed.Value)>.001f || Math.Abs(buoy.Y-expected)>.001f ||
                    Math.Abs(sheet.GlobalPosition.Y-buoy.Y)>.001f || !sheet.IsVisibleInTree() || !indicator.IsVisibleInTree() ||
                    (indicator.Layers&camera.CullMask)==0 || indicator.Mesh.GetSurfaceCount()<2)
                    throw new InvalidOperationException($"O2 {name}: buoy {buoy.Y}, wet {sensed}, gallery {sheet.GlobalPosition.Y}, expected {expected}");
                if (name=="low") await Photo("gauge-approach.png");
                // A swimmer can also approach the face. Keep a common viewing position so both marks can be compared.
                var close=staff.ToGlobal(new Vector3(.10f,.82f,1.11f));
                if (Ray(close,target).Count!=0) throw new InvalidOperationException("Obstructed O2 gauge close-up");
                Place(close,staff.ToGlobal(new Vector3(0,.77f,.018f)),false);
                await Frame(); await Frame(); await Photo("gauge-"+name+".png");
                observed.Add(new { tide=name, riverY=external, sheetY=sheet.GlobalPosition.Y, floatY=buoy.Y,
                    centimetresAboveSill=MathF.Round((buoy.Y-sill)*100,2) });
            }

            // At low water a swimmer's eye clears the waterline and looks slightly upward at the face.
            // Check all four fixing heads and the pointer against the gate fittings before photographing.
            Tide.Hold(Tide.LwMin);
            Tide.Advance(20);
            ruien._Process(0);
            var sideShots = new List<object>();
            foreach (var (condition,hour,sky) in new[]{("rain",13,"rain"),("night",23,"clear")})
            {
                await Scheldemist.Dev.Kit.I.Light(hour,sky,false);
                for (int n=0;n<4;n++) await Frame();
                foreach (var (side,across) in new[]{("gate",-.55f),("gallery",.72f)})
                {
                    var focus=staff.ToGlobal(new Vector3(0,.64f,.035f));
                    var probes = new List<Vector3>();
                    foreach (float x in new[]{-.145f,.145f})
                    foreach (float y in new[]{-.023f,1.054f}) probes.Add(staff.ToGlobal(new Vector3(x,y,.062f)));
                    probes.Add(indicator.ToGlobal(new Vector3(-.055f,0,.084f)));
                    bool clear=false;
                    foreach (float depth in new[]{1.03f,1.13f,1.20f})
                    {
                        var eye=staff.ToGlobal(new Vector3(across,0,depth));
                        if (ruien.WaterAt(eye.X,eye.Z) is not {} surface) continue;
                        eye.Y=surface+.13f;
                        Place(eye,focus,false);
                        if (probes.All(p=>camera.IsPositionInFrustum(p) && Ray(eye,p).Count==0))
                        { clear=true; break; }
                    }
                    if (!clear) throw new InvalidOperationException($"Obstructed gauge from the {side} side in {condition}");
                    await Frame(); await Frame();
                    if (Daylight.I.Weather!=sky || MathF.Abs(Daylight.I.Hour-hour)>.2f)
                        throw new InvalidOperationException($"O2 {condition} lighting failed to settle");
                    string file=$"gauge-{side}-{condition}.png";
                    await Photo(file);
                    var at=camera.GlobalPosition;
                    sideShots.Add(new{file,side,hour,weather=sky,eye=new[]{at.X,at.Y,at.Z},waterY=sheet.GlobalPosition.Y});
                }
            }
            File.WriteAllText(Path.Combine(output,"gauge.json"),JsonSerializer.Serialize(new
            {
                sluice="O2", datum="sluice sill", sillY=sill, supportRays=9*33,
                standingEye=new[]{approach.Value.X,approach.Value.Y,approach.Value.Z}, readings=observed, sideShots
            },new JsonSerializerOptions{WriteIndented=true}));
            GD.Print("O2 tide staff verified on dry approach and at both retained water levels");
        }
        finally
        {
            try { await Scheldemist.Dev.Kit.I.Light(clockHour,weather,false); }
            finally
            {
                Daylight.I.SetTime(litHour); Daylight.I.SetWeather(litWeather); Daylight.I.Settle();
                game.Cam=previousCamera; previousCamera.MakeCurrent(); camera.QueueFree();
                jef.Place(feet.X,feet.Z,yaw,pitch,feet.Y); jef.Frozen=frozen; jef.TestInput=testing;
                Tide.Hold(held); Tide.River=river; ruien._Process(0);
                foreach (var entry in hud) entry.Layer.Visible=entry.Visible;
            }
        }
    }
}
