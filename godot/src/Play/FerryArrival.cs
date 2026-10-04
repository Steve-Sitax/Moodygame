using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Models;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>The St. Anna opening, with floors measured from her model and the floating Werf landing.</summary>
[GamePart(927)]
public partial class FerryArrival:Node
{
    public static FerryArrival I {get;private set;}=null!;
    public string Stage {get;private set;}="gone";
    public bool Ashore {get;private set;}=true;
    public float Time {get;private set;}
    public int PassengersOff {get;private set;}
    public float WorstFootError {get;private set;}
    public int MissingFootSamples {get;private set;}
    public Vector2 MissingAt {get;private set;}
    public int MissingPerson {get;private set;}
    public Vector3 VesselPosition=>ferry.Position;
    public bool OnDeck=>Jef.I.Drive==drive;
    public bool VisibleVessel=>ferry!=null&&ferry.IsVisibleInTree();
    public float VesselSpeed=>speed;
    public float VesselHeading=>yaw;
    public event Action<string,ArrivalReply>? Answered;
    private sealed class Passenger {public Human? Human;public Vector2 P;public Vector2[] Way=Array.Empty<Vector2>();public int Step,PortStep;public float At,Speed,Wait,Push;public bool Off;}
    private readonly Passenger[] people=new Passenger[5];
    private readonly Func<float,bool> drive;
    private readonly Func<float,float,float,bool> waterFree;
    private Func<float,float,float,float>? oldFloor;
    private MeshDeck ferryDeck=null!,landingDeck=null!;
    private Node3D ferry=null!,landing=null!,plank=null!,quayPlank=null!,passengers=null!;
    private Human? ferryman;
    private Vector2 ferrymanAt;
    private float side=2.304f,portZ=4.5f,deckY=1.35f,x=-244.5f,z=-63.25f,yaw=-MathF.PI/2,phaseT,speed;
    private bool reporting,guide;
    private int epoch,nag;
    public FerryArrival(){I=this;drive=Drive;waterFree=WaterFree;Solid.Leave.Add(n=>n.Name.ToString() is "landing_stage" or "pontoon_section" or "pontoon_gangway");}
    public override void _Ready()
    {
        var model=ModelLibrary.Get("ferry",new(TwoSided:true,Affine:.6));if(model==null)return;
        var gang=ModelExtras.Get("ferry","ferry","gangway");if(gang is {} g){side=g.GetProperty("x").GetSingle();portZ=-g.GetProperty("y").GetSingle();deckY=g.GetProperty("deck").GetSingle();}
        ferryDeck=new(model.Roots["ferry"],-3.4f,3.4f,1,10.6f,1.1f);
        ferryDeck.ConnectedTo(new(0,4.5f));
        var obstacles=new List<float[]>();var solids=ModelExtras.Get("ferry","landing_stage","solids");if(solids is {} list)foreach(var r in list.EnumerateArray())obstacles.Add(new[]{r[0].GetSingle(),r[1].GetSingle(),-r[3].GetSingle(),-r[2].GetSingle()});
        // LandingStage uses its model's flat deck_top and solids. Rays through the 22 mm plank seams are not holes a foot can fall through.
        landingDeck=MeshDeck.Flat(-2.05f,2.05f,-59.75f,-5.9f,1.8f,obstacles.ToArray(),.25f);
        ferry=model.Copy("ferry")!;landing=model.Copy("landing_stage")!;Main.I.View.AddChild(ferry);Main.I.View.AddChild(landing);ferry.Transform=Transform3D.Identity;landing.Transform=Transform3D.Identity;ferry.Visible=false;
        foreach(var n in BakedWorld.All(Main.I.World))if(n is Node3D n3&&(n3.Name.ToString() is "landing_stage" or "pontoon_section" or "pontoon_gangway"))n3.Visible=false;
        Movers.BoatLamps.I?.AddFerry(()=>ferry.GlobalTransform,()=>ferry.IsVisibleInTree());
        foreach(var f in Movers.Boats.I.Floats)if(f.Kind=="pontoon_section")f.Outer.Visible=false;
        Material? wood=null,rope=null;foreach(var n in BakedWorld.All(model.Scene))if(n is MeshInstance3D{Mesh:not null} m)for(int i=0;i<m.Mesh.GetSurfaceCount();i++){var mat=m.Mesh.SurfaceGetMaterial(i);if(mat?.ResourceName=="wood"||mat?.ResourceName=="deck")wood=mat;if(mat?.ResourceName=="rope")rope=mat;}
        var mesh=new BoxMesh{Size=new(1,.06f,1)};plank=MakePlank(wood,rope??wood);Main.I.View.AddChild(plank);
        quayPlank=new Node3D{Name="arrival_quay_plank"};quayPlank.AddChild(new MeshInstance3D{Mesh=mesh,MaterialOverride=wood});Main.I.View.AddChild(quayPlank);
        passengers=new Node3D{Name="arrival_passengers"};Main.I.View.AddChild(passengers);
        string[] kinds={"fishwife_a","old_man","docker_sack","tourist_lady","gentleman"};float[] ats={4.2f,6.4f,8.4f,10.6f,12.6f},speeds={1.05f,.9f,1.1f,.95f,1.1f};
        for(int i=0;i<people.Length;i++){var h=Humans.Make(kinds[i]);if(h!=null)passengers.AddChild(h.Root);people[i]=new(){Human=h,At=ats[i],Speed=speeds[i]};h?.SetPace(speeds[i]);}
        ferrymanAt=ferryDeck.Nearest(new(side-.9f,portZ-1.2f));ferryman=Humans.Make("docker_a");if(ferryman!=null)ferry.AddChild(ferryman.Root);
        oldFloor=Jef.I.TransportFloor;Jef.I.TransportFloor=Floor;UpdateModels(0);
        Movers.Boats.I.PlayerWaterBlocks.Add(waterFree);
        if(MainMenu.I is {} menu)menu.WorldReplaced+=Replaced;
        if(Main.I.Arg("ridetest")=="")ServerLink.I?.WhenUp(()=>_=Ask());
    }
    private void Replaced(string how,ClientState? client){epoch++;Stop();if(Main.I.Arg("ridetest")=="")_=Ask();}
    public async Task Ask(bool creator=true)
    {
        var api=ServerLink.I?.Api;if(api==null)return;int e=epoch;
        try{var r=await api.Arrival();if(e!=epoch)return;Answered?.Invoke("asked",r);if(r.Stage!="ferry"){Stop();return;}
            if(r.Creator&&creator){if(!CharacterSheet.IsOpen)CharacterSheet.Open(profile=>_=Made(),null,"Before you step ashore in Antwerp");return;}Start();}
        catch(ApiException ex){GameState.I.Say(ex.Message);}
    }
    private async Task Made(){try{var r=await ServerLink.I!.Api!.ArrivalMade();Answered?.Invoke("made",r);Start();}catch(ApiException ex){GameState.I.Say(ex.Message);}}
    public void Start()
    {
        ShipWalk.I.Clear();Stage="waiting";Ashore=false;Time=phaseT=speed=0;nag=PassengersOff=MissingFootSamples=0;WorstFootError=0;guide=false;guideOnce=false;guideWay=null;guideAt=0;x=-244.5f;z=-63.25f;yaw=-MathF.PI/2;ferry.Visible=plank.Visible=passengers.Visible=true;
        Vector2[] locals={new(-.6f,3.4f),new(.6f,6),new(-.9f,6.2f),new(-.3f,7.6f),new(.5f,8.4f)};UpdateModels(0);
        for(int i=0;i<people.Length;i++)
        {
            var p=people[i];var local=ferryDeck.Nearest(locals[i]);var at=ferry.Transform*new Vector3(local.X,ferryDeck.Floor(local.X,local.Y),local.Y);p.P=new(at.X,at.Z);p.Step=0;p.Off=false;p.Wait=p.Push=0;
            var way=new List<Vector2>();foreach(var point in ferryDeck.Path(local,new(side-1.05f,portZ))){var w=ferry.Transform*new Vector3(point.X,deckY,point.Y);way.Add(new(w.X,w.Z));}p.PortStep=way.Count;way.Add(PortPoint(side-.25f));way.Add(new(-249,-59.18f));way.AddRange(StagePath(new(-249,-59.18f),new(-249,-6)));way.Add(new(-249,-6));way.Add(new(-249,4));p.Way=way.ToArray();
            p.Human?.Play("idle");if(p.Human!=null){p.Human.Root.Position=at;p.Human.Root.Visible=true;}
        }
        var start=ferryDeck.Nearest(new(-.2f,5.6f));var place=ferry.Transform*new Vector3(start.X,ferryDeck.Floor(start.X,start.Y),start.Y);Jef.I.Place(place.X,place.Z,MathF.PI+.25f,-.02f,place.Y);Jef.I.Drive=drive;Jef.I.Carry(place);Jef.I.DrivenEye=Jef.Eye;
    }
    // Passengers still on the pontoon when the ferry has gone walk on to the quay; frozen there they would block the way.
    private bool Walking(){if(passengers==null||!passengers.Visible)return false;foreach(var p in people)if(p.Step<p.Way.Length)return true;return false;}
    private void Stop(){Stage="gone";Ashore=true;if(ferry!=null)ferry.Visible=plank.Visible=passengers.Visible=false;if(Jef.I.Drive==drive)Jef.I.Drive=null;}
    private Vector2 PortPoint(float localX){var p=ferry.Transform*new Vector3(localX,deckY,portZ);return new(p.X,p.Z);}
    public Vector2 Port=>PortPoint(side-.3f);
    public List<Vector2> StagePath(Vector2 from,Vector2 to)
    {var path=landingDeck.Path(new(from.X+249,from.Y),new(to.X+249,to.Y));for(int i=0;i<path.Count;i++)path[i]=new(path[i].X-249,path[i].Y);return path;}
    public float Foot(float wx,float wz)
    {
        float water=Water.Level(-249,-30);
        if(Math.Abs(wx+249)<1.5f&&wz>=0&&wz<4.5f)return 0;
        if(wx>-249.8f&&wx<-248.2f&&wz>=-6.1f&&wz<=.1f)return Mathf.Lerp(water+1.8f,0,Math.Clamp((wz+6)/6,0,1));
        float land=landingDeck.Floor(wx+249,wz);if(landingDeck.Stand(wx+249,wz,.16f))return water+land;
        var port=PortPoint(side-.3f);if(Stage is "waiting" or "moored"&&Time>=3.4f&&Math.Abs(wx+249)<.8f&&wz>=Math.Min(port.Y,-59.53f)&&wz<=Math.Max(port.Y,-59.53f))
        {float t=Math.Clamp((wz-port.Y)/(-59.98f-port.Y),0,1);return Mathf.Lerp(Water.Level(x,z)+deckY,water+1.8f,t);}
        if(Stage is "waiting" or "moored" or "hauling"){var p=ferry.Transform.AffineInverse()*new Vector3(wx,Water.Level(x,z),wz);if(ferryDeck.Stand(p.X,p.Z,.16f))return Water.Level(x,z)+ferryDeck.Floor(p.X,p.Z);}
        return float.NegativeInfinity;
    }
    private float Floor(float wx,float wz,float feet){float f=Foot(wx,wz);return f<=feet+Jef.Step?Math.Max(f,oldFloor?.Invoke(wx,wz,feet)??float.NegativeInfinity):oldFloor?.Invoke(wx,wz,feet)??float.NegativeInfinity;}
    private bool WaterFree(float wx,float wz,float radius)
    {if(Stage!="gone"){var p=ferry.Transform.AffineInverse()*new Vector3(wx,ferry.Position.Y,wz);if(Math.Abs(p.X)<3.6f+radius&&Math.Abs(p.Z)<12.5f+radius)return false;}return !(Math.Abs(wx+249)<2.25f+radius&&wz>-58.2f&&wz<-5.9f);}
    private bool Drive(float dt)
    {
        var j=Jef.I;float dx=(j.KeyDown(Key.D)?1:0)-(j.KeyDown(Key.A)?1:0),dz=(j.KeyDown(Key.S)?1:0)-(j.KeyDown(Key.W)?1:0);if(j.Frozen)dx=dz=0;
        var step=new Vector2(dx,dz).LimitLength()*Jef.Walk*dt;float c=MathF.Cos(j.Yaw),s=MathF.Sin(j.Yaw);var to=new Vector2(j.X+step.X*c+step.Y*s,j.Z-step.X*s+step.Y*c);
        if(guide){var target=GuideTarget();var v=target-new Vector2(j.X,j.Z);if(v.LengthSquared()>.000001f)j.Yaw=MathF.Atan2(-v.X,-v.Y);to=new Vector2(j.X,j.Z)+v.Normalized()*Math.Min(1.1f*dt,v.Length());}
        float floor=Foot(to.X,to.Y);if(!float.IsFinite(floor)){to=new(to.X,j.Z);floor=Foot(to.X,to.Y);if(!float.IsFinite(floor)){to=new(j.X,j.Z-step.X*s+step.Y*c);floor=Foot(to.X,to.Y);}if(!float.IsFinite(floor)){to=new(j.X,j.Z);floor=Foot(j.X,j.Z);}}
        foreach(var passenger in people)if(passenger.Human?.Root.Visible==true&&!(Math.Abs(j.X-passenger.P.X)<.6f&&Math.Abs(j.Z-passenger.P.Y)<.6f)&&Math.Abs(to.X-passenger.P.X)<.22f+Jef.Radius&&Math.Abs(to.Y-passenger.P.Y)<.22f+Jef.Radius){to=new(j.X,j.Z);floor=Foot(j.X,j.Z);break;}
        if(float.IsFinite(floor))j.Carry(new(to.X,floor,to.Y));
        if(!Ashore&&j.Z>-58.93f)_=ReportAshore();
        if(Ashore&&j.Z>=-.1f){j.Drive=null;j.Place(j.X,Math.Max(.2f,j.Z),j.Yaw,j.Pitch,0);return false;}return true;
    }
    private async Task ReportAshore()
    {
        if(reporting||Ashore)return;reporting=true;int e=epoch;
        try{var r=await ServerLink.I!.Api!.ArrivalAshore();if(e!=epoch)return;Ashore=r.Stage=="ashore";Answered?.Invoke("ashore",r);if(Ashore)GameState.I.Say("Day work is given out at the Hessenatie's board on the Rijnkaai, along the quay past the Steen.");}
        catch(ApiException ex){GameState.I.Say(ex.Message);}finally{reporting=false;}
    }
    private static Node3D MakePlank(Material? wood,Material? rope)
    {
        var root=new Node3D{Name="arrival_plank"};var boards=new SurfaceTool();boards.Begin(Mesh.PrimitiveType.Triangles);
        void Box(Vector3 size,Vector3 at)=>boards.AppendFrom(new BoxMesh{Size=size},0,new Transform3D(Basis.Identity,at));
        Box(new(1,.06f,1),Vector3.Zero);for(int i=1;i<8;i++)Box(new(.87f,.035f,.015f),new(0,.045f,-.5f+i/8f));
        foreach(float side in new[]{-.46f,.46f}){Box(new(.06f,.1f,1),new(side,.035f,0));foreach(float z in new[]{-.45f,0,.45f})Box(new(.025f,.94f,.006f),new(side,.49f,z));}
        root.AddChild(new MeshInstance3D{Mesh=boards.Commit(),MaterialOverride=wood});var rails=new SurfaceTool();rails.Begin(Mesh.PrimitiveType.Triangles);
        var line=new CylinderMesh{TopRadius=.02f,BottomRadius=.02f,Height=.9f,RadialSegments=5};foreach(float side in new[]{-.46f,.46f})foreach(float height in new[]{.5f,.97f})rails.AppendFrom(line,0,new Transform3D(new Basis(Vector3.Right,MathF.PI/2),new(side,height,0)));
        root.AddChild(new MeshInstance3D{Mesh=rails.Commit(),MaterialOverride=rope});return root;
    }
    private static void Span(Node3D n,Vector3 a,Vector3 b,float width)
    {var delta=b-a;var forward=delta.Normalized();var right=Vector3.Right;var up=forward.Cross(right).Normalized();Scheldemist.Render.NodeUpdates.Transform(n,new(new Basis(right*width,up,forward*delta.Length()),(a+b)/2));}
    private void UpdateModels(float dt)
    {
        float water=Water.Level(x,z),landWater=Water.Level(-249,-30);Scheldemist.Render.NodeUpdates.Transform(ferry,new(new Basis(Vector3.Up,yaw),new(x,water,z)));Scheldemist.Render.NodeUpdates.Position(landing,new(-249,landWater,0));
        if(ferryman!=null){Scheldemist.Render.NodeUpdates.Position(ferryman.Root,new(ferrymanAt.X,ferryDeck.Floor(ferrymanAt.X,ferrymanAt.Y),ferrymanAt.Y));}
        var port=ferry.Transform*new Vector3(side-.3f,deckY,portZ);var end=new Vector3(-249,landWater+1.8f,-59.53f);float angle=Stage=="hauling"?Math.Clamp(phaseT/3.2f,0,1)*1.2f:Stage=="waiting"?(1-Math.Clamp((Time-.6f)/2.8f,0,1))*1.2f:Stage is "leaving" or "gone"?1.2f:0;
        var offset=end-port;end=port+new Vector3(offset.X,offset.Y+MathF.Sin(angle)*offset.Length(),offset.Z*MathF.Cos(angle));Span(plank,port,end,1);Span(quayPlank,new(-249,landWater+1.8f,-6),new(-249,0,.1f),1.5f);
    }
    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Play.FerryArrival");
        if(ferry==null)return;float dt=(float)Math.Min(delta,.05);UpdateModels(dt);ferryman?.Update(dt);if(Stage=="gone"&&!Walking()||!(GameState.I.Playing||Jef.I.TestInput))return;Time+=dt;phaseT+=dt;
        if(Stage=="waiting"&&Time>=3.4f){Stage="moored";phaseT=0;GameState.I.Say("Step ashore: walk down the gangway onto the landing stage.");}
        if(!Ashore&&Jef.I.Drive!=drive&&!Jef.I.Climbing&&Jef.I.Z>-58.93f)_=ReportAshore();
        if(!Ashore){if(nag==0&&Time>=35){nag++;GameState.I.Say("The ferryman: \"This is Antwerp. Down the plank with you, we go back across.\"");}if(nag==1&&Time>=75){nag++;GameState.I.Say("The ferryman: \"Come on, off you get. I have the next crossing to make.\"");}if(Time>=115&&!guideOnce){guideOnce=true;BeginGuide();guide=true;}}
        for(int i=0;i<people.Length;i++)
        {
            var p=people[i];if(p.Step>=p.Way.Length)continue;var v=p.Way[p.Step]-p.P;float distance=v.Length();bool walking=false;
            if(Time>=p.At&&distance>.06f){var direction=v.Normalized();bool hold=!p.Off&&p.Step>=p.PortStep&&p.Step<=p.PortStep+1&&Stage!="moored";if(i>0){var prev=people[i-1];var ahead=prev.P-p.P;if(prev.Step<prev.Way.Length&&ahead.Dot(direction)>0&&ahead.Length()<1.1f)hold=true;}var jef=new Vector2(Jef.I.X,Jef.I.Z)-p.P;bool blocked=jef.Dot(direction)>0&&jef.Dot(direction)<1&&Math.Abs(jef.X*direction.Y-jef.Y*direction.X)<.6f;
                if(!hold&&blocked&&p.Push<=0){p.Wait+=dt;if(p.Wait>3){p.Push=2;p.Wait=0;}}else if(!hold){p.Push=Math.Max(0,p.Push-dt);if(!blocked)p.Wait=0;float pace=p.Speed*(p.Step==p.PortStep+1?.7f:1);p.P+=direction*Math.Min(pace*dt,distance);p.Human?.SetPace(pace);walking=true;}
            }else if(Time>=p.At)p.Step++;
            if(!p.Off&&p.P.Y>-59.28f){p.Off=true;PassengersOff++;}
            float y=Foot(p.P.X,p.P.Y);if(!float.IsFinite(y)){if(MissingFootSamples==0){MissingAt=p.P;MissingPerson=i;if(Main.I.Arg("ridetest")!="")GD.Print($"ferry: missing foot {i} at {p.P} time {Time}");}MissingFootSamples++;y=p.Human?.Root.Position.Y??Water.Level(p.P.X,p.P.Y)+1.8f;}if(p.Human!=null){p.Human.Play(walking?"walk":"idle");p.Human.Update(dt);p.Human.Root.Position=new(p.P.X,y,p.P.Y);p.Human.Root.Rotation=new(0,MathF.Atan2(v.X,v.Y),0);if(float.IsFinite(Foot(p.P.X,p.P.Y)))WorstFootError=Math.Max(WorstFootError,Math.Abs(p.Human.Root.Position.Y-Foot(p.P.X,p.P.Y)));}
            if(p.Step>=p.Way.Length&&p.Human!=null)p.Human.Root.Visible=false;
        }
        if(Stage=="moored"&&Ashore&&PassengersOff==people.Length){Stage="hauling";phaseT=0;}
        else if(Stage=="hauling"&&phaseT>=4.2f){Stage="leaving";phaseT=0;}
        else if(Stage=="leaving")
        {speed=Math.Min(2.4f,speed+.16f*dt);float t=Math.Clamp((phaseT-4)/30,0,1);yaw+=(-MathF.PI/2-.4f*t-yaw)*Math.Min(1,dt*.4f);x+=MathF.Sin(yaw)*speed*dt;z+=MathF.Cos(yaw)*speed*dt-.35f*dt*Math.Max(0,1-phaseT/8);if(new Vector2(Jef.I.X-x,Jef.I.Z-z).Length()>150||x<-420||phaseT>240){Stage="gone";ferry.Visible=plank.Visible=false;}}
    }
    public override void _ExitTree(){Stop();Movers.Boats.I.PlayerWaterBlocks.Remove(waterFree);Jef.I.TransportFloor=oldFloor;if(MainMenu.I is {} menu)menu.WorldReplaced-=Replaced;}
}
