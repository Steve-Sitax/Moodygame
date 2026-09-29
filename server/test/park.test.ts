import { describe, expect, it } from "vitest";
import { blankSave } from "./blank-save.ts";
import { setWeather } from "../src/day.ts";
import { parkAction, parkWork, ensureParkWalkers } from "../src/town/park.ts";
import { PARK_KEEPER, PARK_CLEAN_PAY } from "../../shared/parkWork.ts";
import { ParkEcology, type ParkEnvironment, type ParkHabitat } from "../../shared/parkWildlife.ts";
import { readFileSync } from "node:fs";
import { walkMap } from "../src/town/walkmap.ts";
import { asPlayer } from "../src/player/current.ts";

const setup=()=>{const db=blankSave();db.prepare("UPDATE player SET day=2,hour=13,minute=0,money_c=100 WHERE id=1").run();setWeather(db,"clear");return db;};
const money=(db:ReturnType<typeof setup>)=>(db.prepare("SELECT money_c FROM player WHERE id=1").get() as {money_c:number}).money_c;
const habitat=JSON.parse(readFileSync(new URL('../../client/public/models/park_plants.json',import.meta.url),'utf8')) as ParkHabitat;
const fair:ParkEnvironment={hour:13,rain:0,storm:0,people:[],dogs:[],cats:[],boats:[],food:[]};

describe("Stadspark work is engine-owned",()=>{
  it("scatters daily piles across the park, persists them, and preserves claimed work during migration",()=>{
    const db=setup();try {
      const first=parkWork(db);expect(first.piles).toHaveLength(28);
      expect(parkWork(db).piles).toEqual(first.piles);
      expect(Math.max(...first.piles.map(p=>p.x))-Math.min(...first.piles.map(p=>p.x))).toBeGreaterThan(45);
      expect(Math.max(...first.piles.map(p=>p.z))-Math.min(...first.piles.map(p=>p.z))).toBeGreaterThan(35);
      expect(first.piles.every(p=>walkMap().reachable(p.x,p.z))).toBe(true);
      parkAction(db,"take",{at:PARK_KEEPER});const before=parkWork(db);
      const raw=db.prepare("SELECT value_json FROM world_state WHERE key='stadspark-work-v1'").get() as {value_json:string};
      const old=JSON.parse(raw.value_json);delete old.layoutVersion;
      for(const p of old.piles)if(p.owner===null){p.x=-300;p.z=300;}
      db.prepare("UPDATE world_state SET value_json=? WHERE key='stadspark-work-v1'").run(JSON.stringify(old));
      const migrated=parkWork(db);
      expect(migrated.piles.filter(p=>p.owner===1)).toEqual(before.piles.filter(p=>p.owner===1));
      expect(migrated.shift).toEqual(before.shift);
      db.prepare("UPDATE player SET day=3 WHERE id=1").run();expect(parkWork(db).piles).not.toEqual(first.piles);
    }finally{db.close();}
  });
  it("reserves ten reachable piles, checks scooping, pays exactly once, and survives re-reading",()=>{
    const db=setup();
    try {
      expect(()=>parkAction(db,"take",{at:{x:0,z:0}})).toThrow();
      parkAction(db,"take",{at:PARK_KEEPER});
      const s=parkWork(db);expect(s.shift?.ids).toHaveLength(10);
      for(const p of s.piles.filter(p=>p.owner===1)) {
        expect(walkMap().reachable(p.x,p.z)).toBe(true);
        expect(()=>parkAction(db,"clean",{id:p.id,at:p},1000)).toThrow();
        parkAction(db,"prepare",{id:p.id,at:p},1000);
        expect(()=>parkAction(db,"clean",{id:p.id,at:p},1200)).toThrow();
        parkAction(db,"clean",{id:p.id,at:p},3000);
        expect(()=>parkAction(db,"clean",{id:p.id,at:p},4000)).toThrow();
      }
      expect(money(db)).toBe(100+PARK_CLEAN_PAY);
      expect(parkWork(db).shift?.paid).toBe(true);
      expect(()=>parkAction(db,"take",{at:PARK_KEEPER})).toThrow();
    }finally{db.close();}
  });
  it("separates players' reservations and prevents keeper cleanup of claimed work",()=>{
    const db=setup();try {
      parkAction(db,"take",{at:PARK_KEEPER});
      const p=parkWork(db).piles.find(p=>p.owner===1)!;
      parkAction(db,"keeper",{id:p.id,at:p});expect(parkWork(db).piles.some(q=>q.id===p.id)).toBe(true);
      asPlayer(2,()=>{expect(()=>parkAction(db,"prepare",{id:p.id,at:p})).toThrow();parkAction(db,"take",{at:PARK_KEEPER});expect(parkWork(db).shift?.ids).not.toContain(p.id);});
      expect(parkWork(db).shift?.ids).toContain(p.id);
    }finally{db.close();}
  });
  it("closes at night/in a gale and never pays abandoned work",()=>{
    const db=setup();try {
      setWeather(db,"storm");expect(()=>parkAction(db,"take",{at:PARK_KEEPER})).toThrow();
      setWeather(db,"clear");parkAction(db,"take",{at:PARK_KEEPER});parkAction(db,"cancel",{at:PARK_KEEPER});
      expect(money(db)).toBe(100);expect(parkWork(db).piles.every(p=>p.owner===null)).toBe(true);
      expect(()=>parkAction(db,"take",{at:PARK_KEEPER})).toThrow();
      db.prepare("UPDATE player SET hour=20 WHERE id=1").run();expect(parkWork(db).open).toBe(false);
    }finally{db.close();}
  });
  it("adds dogs to real wealthy households only once, preserving homes",()=>{
    const db=setup();try {
      ensureParkWalkers(db);const rows=db.prepare("SELECT data_json FROM resident WHERE id LIKE 'bk%'").all() as Array<{data_json:string}>;
      const owners=rows.map(r=>JSON.parse(r.data_json)).filter(r=>r.dog&&r.sched.day.some((s:unknown[])=>s[3]==="park"));
      expect(owners.length).toBeGreaterThan(0);expect(owners.every(r=>Number.isFinite(r.home.sx))).toBe(true);
      ensureParkWalkers(db);expect(db.prepare("SELECT data_json FROM resident WHERE id LIKE 'bk%'").all()).toEqual(rows);
    }finally{db.close();}
  });
});
describe("park wildlife",()=>{
  it("geese approach food, fly from boats, land and shelter; squirrels stop to eat",()=>{
    const sim=new ParkEcology(habitat),geese=sim.animals.filter(a=>a.species==="goose");
    expect(geese).toHaveLength(6);const g=geese[0],food={x:g.x+1,z:g.z};
    sim.update(.1,{...fair,food:[food]});expect(g.mode).toBe("feed");expect(g.target).toEqual(food);
    sim.update(.2,{...fair,boats:[{x:g.x,z:g.z}]});expect(g.mode).toBe("flight");
    for(let left=g.duration+.1;left>0;left-=30)sim.update(Math.min(30,left),fair);expect(g.mode).toBe("swim");
    sim.update(.1,{...fair,rain:1});expect(g.mode).toBe("shelter");
    const s=sim.animals.find(a=>a.species==="squirrel")!;
    s.mode="forage";s.target={x:s.x,z:s.z};s.timer=5;
    sim.update(.1,fair);expect(s.mode).toBe("feed");const at=[s.x,s.z];
    sim.update(.5,fair);expect([s.x,s.z]).toEqual(at);
  });
  it("flies away from a boat and lands on another water habitat",()=>{
    const sim=new ParkEcology(habitat),bird=sim.animals.find(a=>a.species==="duck"&&!a.young&&!a.female)!;
    const home=bird.home;sim.update(.1,{...fair,boats:[{x:bird.x,z:bird.z}]});expect(bird.mode).toBe("flight");expect(bird.home).not.toBe(home);
    for(let left=bird.duration+.1;left>0;left-=30)sim.update(Math.min(30,left),fair);expect(bird.mode).toBe("swim");expect(bird.y).toBeCloseTo(-.34,1);
  });
  it("climbs a real trunk when threatened, stays there in a gale, and descends later",()=>{
    const sim=new ParkEcology(habitat),s=sim.animals.find(a=>a.species==="squirrel")!;
    sim.update(6,{...fair,people:[{x:s.x,z:s.z}]});expect(["climb","perch"]).toContain(s.mode);expect(s.y).toBeGreaterThan(1);
    sim.update(25,{...fair,storm:1});expect(s.mode).toBe("perch");
    sim.update(30,fair);expect(Number.isFinite(s.y)).toBe(true);
  });
  it("mothers defend young from a nearby cat; hard rain stops discretionary flights",()=>{
    const sim=new ParkEcology(habitat),young=sim.animals.find(a=>a.species==="duck"&&a.young)!;
    const mother=sim.animals[young.parent!];young.x=mother.x+.2;young.z=mother.z+.2;
    sim.update(.1,{...fair,cats:[{x:young.x+.8,z:young.z}]});expect(mother.mode).toBe("defend");
    const wet=new ParkEcology(habitat);wet.update(20,{...fair,rain:1,storm:1});
    expect(wet.animals.filter(a=>a.species!=="squirrel").every(a=>a.mode==="shelter")).toBe(true);
  });
  it("keeps unfledged families on their pond and floats visiting adults on the current tide",()=>{
    const sim=new ParkEcology(habitat),young=sim.animals.find(a=>a.young)!;
    const mother=sim.animals[young.parent!],home=mother.home;
    sim.update(12,{...fair,boats:[{x:mother.x,z:mother.z}]});
    expect(mother.home).toBe(home);expect(young.home).toBe(home);
    expect(mother.mode).not.toBe("flight");expect(young.mode).not.toBe("flight");
    const visitor=sim.animals.find(a=>a.species==="duck"&&!a.young&&!a.female)!;
    visitor.home=sim.habitat.birds.length-1;visitor.timer=100;visitor.mode="swim";
    const h=sim.habitat.birds[visitor.home];visitor.x=h[0];visitor.z=h[1];visitor.target={x:h[0],z:h[1]};
    sim.update(.1,{...fair,waterLevels:sim.habitat.birds.map(()=>-4.1)});
    expect(visitor.y).toBeCloseTo(-4.1);
  });
  it("moves off from a person first, flies when he keeps coming; flocks live on the docks and far birds step coarsely",()=>{
    const sim=new ParkEcology(habitat),bird=sim.animals.find(a=>a.species==="duck"&&!a.young&&!a.female&&a.home<sim.parkHomes)!;
    bird.mode="swim";bird.timer=100;
    const at={x:bird.x,z:bird.z};
    // standing 4.5 m off: it swims away, it does not fly
    const still={x:bird.x+4.5,z:bird.z};
    for(let i=0;i<20;i++)sim.update(.1,{...fair,people:[still]});
    expect(bird.mode).not.toBe("flight");expect(Math.hypot(bird.x-still.x,bird.z-still.z)).toBeGreaterThan(4.5);
    // walking in on it: it flies
    let p={x:bird.x+3.5,z:bird.z};
    for(let i=0;i<30&&(bird.mode as string)!=="flight";i++){p={x:p.x-.12,z:p.z};sim.update(.1,{...fair,people:[p]});}
    expect(bird.mode).toBe("flight");expect(Math.hypot(at.x-bird.x,at.z-bird.z)).toBeLessThan(40);
    // the town's water has its own flocks, and the homes beyond the park are theirs to fly to
    expect(sim.animals.filter(a=>a.home>=sim.parkHomes).length).toBeGreaterThanOrEqual(20);
    expect(sim.habitat.birds.length).toBeGreaterThan(sim.parkHomes+5);
    // far from the player, a bird is stepped once a second, not ten times
    const far=sim.animals.find(a=>a.home>=sim.parkHomes&&!a.young&&Math.hypot(a.x+300,a.z-300)>200)!;far.mode="swim";far.timer=100;far.target={x:far.x+3,z:far.z};
    const x0=far.x;sim.update(.5,{...fair,focus:{x:-300,z:300}});expect(far.x).toBe(x0);
    sim.update(.6,{...fair,focus:{x:-300,z:300}});expect(far.x).not.toBe(x0);
  });
  it("uses the oak's actual branch anchors for perching birds and climbing squirrels",()=>{
    const sim=new ParkEcology(habitat),bird=sim.animals.find(a=>a.species==="songbird")!;
    for(const other of sim.animals)if(other!==bird&&other.species==="songbird")other.mode="forage";
    expect(bird.y).toBeGreaterThan(5);bird.timer=0;
    sim.update(.1,fair);expect(bird.mode).toBe("flight");
    sim.update(bird.duration+.1,fair);expect(["forage","perch"]).toContain(bird.mode);
    const squirrel=sim.animals.find(a=>a.species==="squirrel"&&habitat.trees[a.home][2]==="old_oak")!;
    sim.update(12,{...fair,storm:1});expect(squirrel.mode).toBe("perch");expect(squirrel.y).toBeGreaterThan(5);
  });
});
