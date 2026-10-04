using System;
using Godot;
using Scheldemist.Models;
using Scheldemist.Play;
namespace Scheldemist.Town;

public partial class Townspeople
{
    private readonly System.Collections.Generic.Dictionary<string,Node3D> cardTables=new();
    private Node3D? MakeLifeKit(Sim s, string kind)
    {
        var model = ModelLibrary.Get("lively", LifeLook); if (model == null) return null;
        var kit = new Node3D { Name = "street_kit_" + kind };
        void Add(string name, Vector3 at, float yaw = 0)
        {
            var piece = model.Copy(name); if (piece == null) return;
            piece.Position = at; piece.Rotation = new(0, yaw, 0); kit.AddChild(piece);
        }
        switch (kind)
        {
            case "hoops":
                var spin=new Node3D{Name="hoop_spin",Position=new(0,.3f,.5f)};var hoop=model.Copy("hoop");if(hoop!=null){hoop.Position=new(0,-.3f,0);spin.AddChild(hoop);}kit.AddChild(spin);Add("stick",Vector3.Zero);break;
            case "tops": Add("top", new(0,0,.7f)); break;
            case "marbles": break; // one shared ring on the street
            case "hopscotch": break; // one shared lane on the street
            case "rope": break; // the shared lane connects the two turners' actual hands
            case "bucket": Add("bucket", Vector3.Zero); Add("brush", new(-.35f,.05f,.35f)); break;
            case "chair": Add("chair", Vector3.Zero); Add("lace_stand", new(0,0,.65f)); break;
            case "flowers": Add("flowers", new(0,.95f,.3f)); break;
            case "wash": Add("bucket", new(.5f,0,.5f)); Add("brush", new(.2f,.25f,.45f)); break;
            case "pipe":
                kit.AddChild(new MeshInstance3D{Mesh=StreetWindows.PipeStem,Position=new(0,1.42f,.18f),Rotation=new(MathF.PI/2,0,0)});
                kit.AddChild(new MeshInstance3D{Mesh=StreetWindows.PipeBowl,Position=new(0,1.405f,.285f)});break;
            case "cards":
                if(s.Goal.Place is {} place&&!cardTables.ContainsKey(place)&&Place(place) is {} at)
                {
                    var shared=new Node3D{Name="street_cards",Position=new((float)at.X,(float)Walk!.BaseAt(at.X,at.Z),(float)at.Z)};
                    var table=ModelLibrary.Get("props")?.Copy("crate");if(table!=null){table.Scale=new(.65f,.45f,.65f);shared.AddChild(table);}
                    shared.AddChild(new MeshInstance3D{Mesh=StreetWindows.CardMesh,Position=new(0,.48f,0)});Main.I.View.AddChild(shared);cardTables[place]=shared;
                }
                break;
            default: kit.Free(); return null;
        }
        return kit;
    }
    private void AnimateLifeKit(Sim s, double dt)
    {
        if (!lifeProps.TryGetValue(s.R.Id, out var kit) || !GodotObject.IsInstanceValid(kit.prop)) return;
        if (s.Goal.Mode != "play") return;
        string kind = s.GameKind;
        if (kind == "tops"&&kit.prop.GetChildCount()>0&&kit.prop.GetChild(0) is Node3D top) top.RotateY((float)dt*12);
        else if (kind == "hoops" && kit.prop.GetChildCount() > 1 && kit.prop.GetChild(0) is Node3D hoop && kit.prop.GetChild(1) is Node3D stick && s.P is { } p)
        {
            float scale=p.Human.Scale*(float)p.Size;double f=Math.Sin(p.Yaw),z=Math.Cos(p.Yaw);
            var before=hoop.GlobalPosition;var at=new Vector3((float)(p.X+f*.85*scale/.72-Math.Cos(p.Yaw)*.18),0,(float)(p.Z+z*.85*scale/.72+Math.Sin(p.Yaw)*.18));at.Y=(float)Walk!.BaseAt(at.X,at.Z)+.3f;
            float roll=hoop.Rotation.X+before.DistanceTo(at)/.3f;hoop.GlobalTransform=new(Basis.FromEuler(new Vector3(roll,(float)p.Yaw,0)),at);
            if(p.Human.Hand(true) is {} hand)
            {
                var rim=at+new Vector3((float)-f*.24f,.18f,(float)-z*.24f);var direction=rim-hand;float length=direction.Length();
                if(length>.001f)stick.GlobalTransform=new(new Basis(new Quaternion(Vector3.Up,direction/length))*Basis.FromScale(new(1,Math.Max(.2f,length/.55f),1)),hand);
                stick.Visible=p.Shown;
            }
        }
    }
}
