import {describe,it,expect} from "vitest";
import {findMantle,type MantleWorld} from "../../shared/mantle.ts";

function obstacle(height:number,width:number,ceiling=Infinity,drop=false):MantleWorld {
  const floor=(x:number)=>x>=.6&&x<=.6+width?height:drop&&x>.6+width?-5:0;
  return {floor:(x,_z,max)=>floor(x)<=max?floor(x):0,
    clear:(x,y)=>y>=floor(x)-.04&&y+1.72<ceiling,
    stand:(x,y)=>Math.abs(y-floor(x))<.01&&y>=-.45};
}
describe("held-space climbing",()=>{
  it("steps onto a broad reachable obstacle and vaults a narrow one",()=>{
    const on=findMantle(obstacle(1.4,3),{x:0,y:0,z:0},1,0)!;
    expect(on.at(-1)?.y).toBe(1.4);
    const over=findMantle(obstacle(1.1,.25),{x:0,y:0,z:0},1,0)!;
    expect(over.at(-1)?.x).toBeGreaterThan(.85);expect(over.at(-1)?.y).toBe(0);
  });
  it("rejects tall walls, low ceilings, and unsafe landings",()=>{
    expect(findMantle(obstacle(2.2,3),{x:0,y:0,z:0},1,0)).toBeNull();
    expect(findMantle(obstacle(1.4,3,2.7),{x:0,y:0,z:0},1,0)).toBeNull();
    const w=obstacle(1.1,.2,Infinity,true);w.stand=()=>false;
    expect(findMantle(w,{x:0,y:0,z:0},1,0)).toBeNull();
  });
  it("does not turn jump height into unlimited climbing reach",()=>{
    expect(findMantle(obstacle(2.1,3),{x:0,y:.6,z:0},1,0,0)).toBeNull();
  });
  it("clears the highest top on the way, not only the first one",()=>{
    // a crate with a raised rim at its near edge: the lift goes over the rim, then onto the top
    const w:MantleWorld={floor:(x)=>x>=.6&&x<=.75?1.1:x>.75&&x<=3?.8:0,
      clear:(x,y)=>y>=(x>=.6&&x<=.75?1.1:x>.75&&x<=3?.8:0)-.04,stand:(x,y)=>x>.95&&x<3&&Math.abs(y-.8)<.01};
    const r=findMantle(w,{x:0,y:0,z:0},1,0)!;
    expect(r).not.toBeNull();expect(r[0].y).toBeGreaterThanOrEqual(1.2);expect(r.at(-1)?.y).toBe(.8);
  });
  it("vaults a railing over open water into it, never over a drop onto land",()=>{
    const rail=(water:boolean):MantleWorld=>({floor:(x)=>x>=.6&&x<=.7?1.11:x>1.2?-8:0,
      clear:(x,y)=>y>=(x>=.6&&x<=.7?1.11:x>1.2?-8:0)-.04&&!(x>1.2&&x<1.5&&y<0),
      stand:(x,y)=>x<.5&&y===0,water:water?(x)=>x>1.2?-.6:null:undefined});
    const r=findMantle(rail(true),{x:0,y:0,z:0},1,0)!;
    expect(r.at(-1)?.water).toBe(true);expect(r.at(-1)?.y).toBe(-.6);expect(r.at(-1)!.x).toBeGreaterThanOrEqual(1.5);
    expect(findMantle(rail(false),{x:0,y:0,z:0},1,0)?.at(-1)?.water).toBeFalsy();
  });
});
