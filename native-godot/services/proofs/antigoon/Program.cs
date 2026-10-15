using Scheldemist.Native.Services;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
int checks=0;
void Check(bool condition,string name){if(!condition)throw new Exception(name);checks++;Console.WriteLine("PASS "+name);}
void Tick(AntigoonBrain b,double seconds,bool night,params AntigoonBrain.Player[] players){for(int i=0;i<(int)Math.Round(seconds/.05);i++)b.Step(.05,night,players);}
AntigoonBrain Make(){var b=new AntigoonBrain(new(0,0));b.Reveal();return b;}
var victim=new AntigoonBrain.Player(1,new(0,2));
var a=Make();int damage=0;a.HurtPlayer=(_,d)=>damage+=d;
Tick(a,.6,true,victim);Check(damage==0,"attack wind-up does not damage early");
Tick(a,.15,true,victim);Check(damage==AntigoonBrain.KickDamage&&a.Kicks[1]==1,"attack makes contact once at 0.62 seconds");
Tick(a,.5,true,victim);Check(damage==AntigoonBrain.KickDamage,"no repeated damage during one swing");
var b=Make();damage=0;b.HurtPlayer=(_,d)=>damage+=d;Tick(b,.5,true,victim);Tick(b,.6,true,victim with {At=new(0,5)});Check(damage==0,"stepping out of reach dodges attack");
var c=Make();damage=0;c.HurtPlayer=(_,d)=>damage+=d;Tick(c,.5,true,victim);c.Light=p=>p.Z>1?1:0;Tick(c,.6,true,victim);Check(damage==0,"light protects player during contact");
var d=Make();damage=0;d.HurtPlayer=(_,v)=>damage+=v;Tick(d,.5,true,victim);d.Sight=(_,_)=>false;Tick(d,.6,true,victim);Check(damage==0,"wall blocks attack contact");
var e=Make();e.Light=p=>p.Z>5?1:0;Tick(e,2,true,new AntigoonBrain.Player(1,new(0,12)));Check(e.Target==0&&e.Position.Distance(new(0,0))<=AntigoonBrain.WalkSpeed*2+.1,"does not chase a player inside protected light");
var f=Make();Tick(f,.1,true,new AntigoonBrain.Player(1,new(0,20)));Check(f.State=="notice"&&f.Position.Z<.01,"stops and stares at distant prey before charging");
Tick(f,AntigoonBrain.NoticeTime,true,new AntigoonBrain.Player(1,new(0,20)));double charge=f.Position.Z;Tick(f,1,true,new AntigoonBrain.Player(1,new(0,20)));Check(f.Position.Z-charge>4.6&&AntigoonBrain.RunSpeed>3.4,"runs faster than the player at 4.8 m/s");
f.Light=_=>1;Tick(f,.1,true,new AntigoonBrain.Player(1,new(0,20)));Check(f.State=="shield","new light interrupts pursuit and starts shielding");
var g=Make();g.Clear=p=>p.Z<3;Tick(g,2,true,new AntigoonBrain.Player(1,new(0,20)));Check(g.Position.Z<3,"never moves into blocked geometry");
var h=Make();Check(!h.Strike(new(1,new(0,7))),"remote melee rejected");Check(h.Strike(victim),"nearby melee accepted");Check(!h.Strike(victim)&&h.Health==105,"duplicate melee is rate limited");
for(int i=0;i<7;i++){Tick(h,.85,true);h.Strike(new(1,new(h.Position.X,h.Position.Z+1)));}Check(h.Health==0&&h.State=="death","eight valid strikes defeat Antigoon");Tick(h,2,true,victim);Check(h.State=="death"&&!h.Strike(victim),"death persists and rejects more strikes");
var k=Make();Tick(k,2,true,new AntigoonBrain.Player(1,new(0,20)));Tick(k,3,false);Check(k.State=="hidden"&&k.Position.Distance(k.Home)<.45,"returns home and hides in daylight");
var m=Make();damage=0;int target=0;m.HurtPlayer=(id,v)=>{target=id;damage+=v;};Tick(m,.8,true,new(7,new(0,2)),new(9,new(0,2.2)));Check(damage==AntigoonBrain.KickDamage&&target==7,"one shared swing hits only its selected multiplayer target");
var n=Make();n.Sight=(_,_)=>false;Check(!n.Strike(victim),"player cannot strike through a wall");
var dazzled=Make();dazzled.Light=p=>Math.Abs(p.X)<4&&Math.Abs(p.Z)<4?1:.3;Tick(dazzled,.2,true);Check(dazzled.State=="shield","a lamp's light makes him shield his eyes");
Tick(dazzled,8,true);Check(dazzled.State!="shield"&&dazzled.Position.Distance(new(0,0))>3.5,"he gropes out of the light and stops shielding in dim light");
var safe=Make();safe.Reach=p=>p.Z<10;Tick(safe,2,true,new AntigoonBrain.Player(1,new(0,12)));Check(safe.Target==0&&safe.State!="notice","a spot he cannot reach is a safe place");
var lunge=Make();damage=0;lunge.HurtPlayer=(_,v)=>damage+=v;Tick(lunge,.55,true,new AntigoonBrain.Player(1,new(0,2.1)));Check(lunge.Position.Z>.15&&lunge.Position.Z<.3&&lunge.State=="attack","he lunges into the kick's wind-up and stops at kicking distance");
// Reachability map: a lit street, a lit square cut off from it by a gate, a small yard, and open land at the edge.
bool Fits(P p)=>(p.X>=0&&p.X<=150&&p.Z>=0&&p.Z<=12)||(p.X>=0&&p.X<=60&&p.Z>=20&&p.Z<=50)||(p.X>=80&&p.X<=86&&p.Z>=20&&p.Z<=26)||p.Z>=60;
var lit=new[]{new P(10,1),new P(50,1),new P(100,1),new P(10,21),new P(30,21),new P(50,21),new P(82,21),new P(82,25),new P(83,23)};
var reach=AntigoonReach.Build(Fits,lit,-2,-2,160,80);
int lane=reach.Area(new(30,3)),square=reach.Area(new(30,30));
Check(lane!=0&&square!=0&&lane!=square&&reach.Areas==2,"lit street and lit square are separate areas he can roam");
Check(!reach.Reachable(new(83,23))&&!reach.Reachable(new(30,70)),"a small yard and open land at the edge are not his");
Check(reach.Near(new(20,13.4),1.5,lane)&&!reach.Near(new(20,16),1.5,lane)&&!reach.Near(new(30,19.5),1.5,lane),"he can kick into a doorway beside his street, not across into another area");
string file=Path.Combine(Path.GetTempPath(),"antigoon-reach-proof-"+Guid.NewGuid().ToString("N")+".bin");
try{reach.Save(file,"world-a");Check(AntigoonReach.Load(file,"world-a")?.Count==reach.Count&&AntigoonReach.Load(file,"world-b")==null,"reach map is kept per world and rebuilt for another");}
finally{File.Delete(file);}
Console.WriteLine($"ANTIGOON_BRAIN_PASS {checks} checks");
int before=checks;
var street=new AntigoonNightEvent();var giant=Make();giant.HurtPlayer=(id,_)=>street.KnockDown(id);
var witness=new AntigoonNightEvent.Witness("resident",new(0,6),new(0,45));
void EventTick(double seconds,bool night=true,params AntigoonNightEvent.Witness[] people)
{for(int i=0;i<(int)Math.Round(seconds/.05);i++){street.Step(.05,night,giant,people);giant.Step(.05,night,street.Targets());}}
EventTick(.1,true,witness);Check(street.Residents.Count==1&&street.Residents["resident"].Scream>0,"witness screams and enters temporary panic");
Check(street.Residents["resident"].At.Z>6,"frightened resident runs toward real home");
EventTick(5,true,witness);Check(street.Targets().Length==1,"occasional pursuit selects one fleeing resident");
giant.Light=p=>p.Z>10?1:0;EventTick(.1);Check(street.Targets().Length==0,"resident reaching light cancels chase");
giant.Light=_=>0;var person=street.Residents["resident"];person.At=new(0,1);street.KnockDown(person.TargetId);
Check(person.Phase=="down","caught resident is knocked to the ground");giant.Clear=_=>false;
EventTick(4);Check(person.Phase=="down","resident stays down while giant remains close");
giant.Clear=_=>true;giant.Restore(new(30,30),120);giant.Reveal();EventTick(.1);Check(person.Phase=="rise","resident gets up only once giant is far away");
EventTick(1.5);Check(person.Phase=="flee","recovered resident runs home");
person.At=person.Home;EventTick(.1);Check(person.Phase=="home"&&street.Targets().Length==0,"house threshold hides resident from pursuit");
EventTick(8.1);Check(!street.Owns("resident"),"home recovery releases normal schedule");
var walls=new AntigoonNightEvent{HumanPath=(_,_)=>null};var wgiant=Make();walls.Step(.1,true,wgiant,new[]{witness});
Check(walls.Residents["resident"].At==witness.At,"unreachable home never moves a resident through walls");
var hidden=new AntigoonNightEvent();wgiant.Sight=(_,_)=>false;hidden.Step(.1,true,wgiant,new[]{witness});Check(hidden.Residents.Count==0,"people behind walls do not see the giant");
int broken=0;var rocks=new AntigoonNightEvent{Lamps=()=>new[]{new AntigoonNightEvent.Lamp("a",new(0,20),4)},Extinguish=_=>broken++};var thrower=Make();
for(int i=0;i<61;i++){rocks.Step(.05,true,thrower,Array.Empty<AntigoonNightEvent.Witness>());thrower.Step(.05,true,Array.Empty<AntigoonBrain.Player>());}
Check(thrower.State=="throw"&&rocks.Rocks.Count==1&&broken==0,"rock throw has a wind-up and does not extinguish early");
for(int i=0;i<36;i++){rocks.Step(.05,true,thrower,Array.Empty<AntigoonNightEvent.Witness>());thrower.Step(.05,true,Array.Empty<AntigoonBrain.Player>());}
Check(broken==1&&rocks.Rocks.Count==0,"one rock extinguishes lamp at impact exactly once");
var interrupted=new AntigoonNightEvent{Lamps=rocks.Lamps,Extinguish=_=>broken++};thrower=Make();
for(int i=0;i<61;i++){interrupted.Step(.05,true,thrower,Array.Empty<AntigoonNightEvent.Witness>());thrower.Step(.05,true,Array.Empty<AntigoonBrain.Player>());}
thrower.Strike(new(1,new(thrower.Position.X,thrower.Position.Z+1)));interrupted.Step(.05,true,thrower,Array.Empty<AntigoonNightEvent.Witness>());
Check(interrupted.Rocks.Count==0,"interrupting the wind-up cancels unreleased stone");
var pursuit=new AntigoonNightEvent();var hunter=Make();hunter.HurtPlayer=(id,_)=>pursuit.KnockDown(id);
var distantHome=new AntigoonNightEvent.Witness("runner",new(0,5),new(0,200));
for(int i=0;i<600&&!pursuit.Residents.Values.Any(p=>p.Phase=="down");i++)
{pursuit.Step(.05,true,hunter,new[]{distantHome});hunter.Step(.05,true,pursuit.Targets());}
Check(pursuit.Residents["runner"].Phase=="down"&&hunter.AttackSerial>0,"pursuit catches a running resident and real attack contact knocks them down");
var patrol=Make();patrol.Patrol.Add(new(0,10));patrol.Patrol.Add(new(10,0));patrol.Clear=p=>p.Z<1;
Tick(patrol,6,true);Check(patrol.Position.X>1,"blocked patrol point yields to another street route");
var shield=Make();shield.Patrol.Add(new(0,12));shield.Light=p=>p.Z>=2&&p.Z<=6?1:0;
Tick(shield,3,true);Check(shield.State=="shield"&&shield.Position.Z>2.5,"light-blocked patrol advances slowly through light while shielding");
int shieldHits=0;shield.HurtPlayer=(_,_)=>shieldHits++;
Tick(shield,1,true,new AntigoonBrain.Player(1,new(1,shield.Position.Z+1)));Check(shield.State=="shield"&&shield.Target==0&&shieldHits==0,"shielding ignores nearby targets and causes no attacks");
Check(!shield.BeginThrow(new(0,9)),"shielding cannot throw a stone");
Tick(shield,8,true);Check(shield.Position.Z>6&&shield.State!="shield","shielding crosses a lit street and returns to roaming in darkness");
var roam=Make();Tick(roam,2,true);Check(roam.State=="walk"&&roam.Position.Distance(new(0,0))>3,"unoccupied giant keeps walking rather than freezing");
Console.WriteLine($"ANTIGOON_EVENT_PASS {checks-before} checks");
