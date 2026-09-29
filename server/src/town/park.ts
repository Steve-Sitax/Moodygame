import type { Hono } from "hono";
import type { DB } from "../db.ts";
import CITY from "../../../shared/city.json" with { type: "json" };
import { PARK_KEEPER, PARK_FEED, PARK_CLEAN_COUNT, PARK_CLEAN_PAY, type ParkWorkState, type ParkWorkView } from "../../../shared/parkWork.ts";
import { clock, weather } from "../day.ts";
import { GameError, log } from "../game.ts";
import { pid, positionOf } from "../player/current.ts";
import { resident, dropTownCache } from "./store.ts";
import { tidy } from "./population.ts";
import type { Resident } from "./population.ts";
import { inPolygon } from "../../../shared/parkGeometry.ts";
import { walkMap } from "./walkmap.ts";

const KEY="stadspark-work-v1";
const distance=(a:{x:number;z:number},b:{x:number;z:number})=>Math.hypot(a.x-b.x,a.z-b.z);
const inPark=(p:{x:number;z:number})=>p.x>-355&&p.x< -248&&p.z>277&&p.z<342;
const open=(db:DB)=> {const c=clock(db);return c.hour>=7&&c.hour<18&&weather(db)!=="storm";};
function save(db:DB,s:ParkWorkState) {db.prepare("INSERT INTO world_state(key,value_json) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json").run(KEY,JSON.stringify(s));}
/** Scatter across reachable ground, persisted once. Never move a player's reserved piles. */
function scatter(s:ParkWorkState) {
  let seed=(s.day*2654435761+1873)>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const fixed=s.piles.filter(p=>p.owner!==null),moving=s.piles.filter(p=>p.owner===null);
  const placed=[...fixed];
  for(const p of moving) {
    for(let i=0;i<2500;i++) {
      const x=-354+random()*104,z=279+random()*62;
      const outline=(CITY as unknown as {decor:{park:{outline:number[][]}}}).decor.park.outline;
      if(!inPark({x,z})||!inPolygon(x,z,outline)||!walkMap().open(x,z,.45)||!walkMap().reachable(x,z)||placed.some(q=>distance(q,{x,z})<1.4))continue;
      p.x=x;p.z=z;break;
    }
    placed.push(p);
  }
  s.layoutVersion=2;
}
function read(db:DB):ParkWorkState {
  const day=clock(db).day;
  const row=db.prepare("SELECT value_json FROM world_state WHERE key=?").get(KEY) as {value_json:string}|undefined;
  if(row) {const s=JSON.parse(row.value_json) as ParkWorkState;if(s.day===day){if(s.layoutVersion!==2){scatter(s);save(db,s);}return s;}}
  const s:ParkWorkState={day,piles:[],next:0,shifts:{},dogs:{},fed:{},worker:{...PARK_KEEPER}};
  const lines=(CITY as unknown as {decor:{park:{lines:Array<{pts:number[][]}>}}}).decor.park.lines;
  for(const line of lines)for(const [x,z] of line.pts) {
    if(s.piles.length>=28)break;
    if(inPark({x,z})&&walkMap().open(x,z,.4)&&s.piles.every(p=>distance(p,{x,z})>2.4))s.piles.push({id:s.next++,x,z,owner:null});
  }
  scatter(s);save(db,s);return s;
}
function checkAt(at:unknown,near?:{x:number;z:number},reach=2.6, player=true):{x:number;z:number} {
  const p=at as {x:number;z:number};
  if(!p||!Number.isFinite(p.x)||!Number.isFinite(p.z)||!inPark(p))throw new GameError("You must be in the Stadspark.",409);
  const actual=positionOf(pid());
  if(player&&actual&&distance(actual,p)>3)throw new GameError("Walk there first.",409);
  if(near&&distance(p,near)>reach)throw new GameError("Come closer.",409);
  return p;
}
export function parkWork(db:DB):ParkWorkView {
  const s=read(db);return {day:s.day,piles:s.piles,shift:s.shifts[pid()]??null,worker:s.worker,open:open(db)};
}
/** A small persistent engine-owned job. Claims prevent the keeper/another player stealing a task's piles. */
export function parkAction(db:DB,action:string,body:Record<string,unknown>,now=Date.now()):string {
  return db.transaction(()=>{
    const s=read(db),who=String(pid()),at=checkAt(body.at,undefined,2.6,action!=="keeper"&&action!=="dog");
    if(!open(db)&&action!=="cancel")throw new GameError("The keeper works from seven until six, except in a gale.",409);
    const shift=s.shifts[who];
    if(action==="take") {
      checkAt(at,PARK_KEEPER);
      if(shift)throw new GameError(shift.paid?"You have finished today's round.":"Finish your round first.",409);
      const piles=s.piles.filter(p=>p.owner===null).sort((a,b)=>distance(a,at)-distance(b,at)).slice(0,PARK_CLEAN_COUNT);
      if(piles.length<PARK_CLEAN_COUNT)throw new GameError("Not enough left for a full round. Try again tomorrow.",409);
      for(const p of piles)p.owner=pid();
      s.shifts[who]={ids:piles.map(p=>p.id),cleaned:[],paid:false,ready:0,pending:null};save(db,s);
      return `The keeper lends you a scoop and bucket. Clear ${PARK_CLEAN_COUNT} dog droppings for ${PARK_CLEAN_PAY} c. The marked piles are yours.`;
    }
    if(action==="cancel") {
      checkAt(at,PARK_KEEPER);
      if(!shift||shift.paid)throw new GameError("No round in hand.",409);
      for(const p of s.piles)if(p.owner===pid())p.owner=null;
      // Keep the daily record: abandoning work cannot create unlimited paid rounds.
      shift.paid=true;save(db,s);return "You return the tools. No pay for an unfinished round.";
    }
    if(action==="prepare"||action==="clean") {
      if(!shift||shift.paid)throw new GameError("Ask the keeper for work first.",409);
      const pile=s.piles.find(p=>p.id===body.id&&p.owner===pid());
      if(!pile)throw new GameError("That pile is gone or belongs to another round.",409);
      checkAt(at,pile,2.1);
      if(action==="prepare") {shift.pending=pile.id;shift.ready=now+1600;save(db,s);return "Scooping…";}
      if(shift.pending!==pile.id||now<shift.ready)throw new GameError("Finish scooping first.",409);
      shift.cleaned.push(pile.id);shift.pending=null;s.piles=s.piles.filter(p=>p.id!==pile.id);
      if(shift.cleaned.length===PARK_CLEAN_COUNT) {
        shift.paid=true;db.prepare("UPDATE player SET money_c=money_c+? WHERE id=?").run(PARK_CLEAN_PAY,pid());
        log(db,"park_clean",null,`Cleared ten dog droppings in the Stadspark; earned ${PARK_CLEAN_PAY} c.`);
      }
      save(db,s);return shift.paid?`Ten cleared. The keeper pays you ${PARK_CLEAN_PAY} c.`:`${shift.cleaned.length}/${PARK_CLEAN_COUNT} cleared.`;
    }
    if(action==="feed") {
      if(!PARK_FEED.some(p=>distance(at,p)<2.6))throw new GameError("Feed the birds at the pond's edge.",409);
      if(now-(s.fed[who]??0)<12000)throw new GameError("Let them finish the last handful.",409);
      const paid=db.prepare("UPDATE player SET money_c=money_c-1 WHERE id=? AND money_c>=1").run(pid());
      if(!paid.changes)throw new GameError("A handful of the keeper's grain costs 1 c.",409);
      s.fed[who]=now;save(db,s);return "You scatter a handful of grain by the water.";
    }
    if(action==="dog") {
      const owner=typeof body.owner==="string"?resident(db,body.owner):null;
      if(!owner?.dog||!walkMap().open(at.x,at.z,.22)||now-(s.dogs[owner.id]??0)<180000||s.piles.length>=48)throw new GameError("No new droppings here.",409);
      s.dogs[owner.id]=now;s.piles.push({id:s.next++,x:at.x,z:at.z,owner:null});save(db,s);return "";
    }
    if(action==="keeper") {
      const p=s.piles.find(p=>p.id===body.id&&p.owner===null);
      if(!p||s.piles.filter(p=>p.owner===null).length<=PARK_CLEAN_COUNT)return "";
      checkAt(at,p,1.5,false);s.worker={...at};s.piles=s.piles.filter(q=>q.id!==p.id);save(db,s);return "";
    }
    throw new GameError("Unknown park action.",400);
  })();
}
/** Existing households keep their homes and identities. Their dogs use the ordinary town journey system. */
export function ensureParkWalkers(db:DB) {
  const key="stadspark-dog-walkers-v1";
  if(db.prepare("SELECT 1 FROM world_state WHERE key=?").get(key))return;
  const rows=db.prepare("SELECT id,data_json FROM resident WHERE trade='housewife' AND id LIKE 'bk%' ORDER BY id").all() as Array<{id:string;data_json:string}>;
  let count=0;
  const candidates=rows.map(row=>JSON.parse(row.data_json) as Resident).filter(r=>["wife_a","shopwife"].includes(r.kind)).sort((a,b)=>distance({x:a.home.sx,z:a.home.sz},PARK_KEEPER)-distance({x:b.home.sx,z:b.home.sz},PARK_KEEPER));
  for(const r of candidates) {
    if(r.stats.wealth<3||!r.sched.day.some(s=>s[3]==="park"))continue;
    r.dog??={name:["César","Fido","Belle"][count%3],look:["dog_grey","dog_spotted","dog_black"][count%3]};
    const start=13+count*.35,end=15.5+count*.35;
    r.sched.day=tidy([...r.sched.day.filter(s=>s[1]<=12||s[0]>=end+1),[12,start,"home"],[start,end,"stroll","park"],[end,end+1,"home"]]);
    db.prepare("UPDATE resident SET data_json=? WHERE id=?").run(JSON.stringify(r),r.id);
    if(++count===3)break;
  }
  db.prepare("INSERT INTO world_state(key,value_json) VALUES (?,?)").run(key,JSON.stringify({count}));dropTownCache(db);
}
export function mountPark(app:Hono,{db,payload}:{db:DB;payload:()=>unknown}) {
  ensureParkWalkers(db);
  app.get("/api/park",c=>c.json(parkWork(db)));
  app.post("/api/park/:action",async c=> {
    const body=await c.req.json();const text=parkAction(db,c.req.param("action"),body);
    return c.json({text,park:parkWork(db),state:payload()});
  });
}
