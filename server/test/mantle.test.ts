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
});
