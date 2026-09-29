import {describe,it,expect} from "vitest";
import PARK from "../../client/public/models/park.json" with {type:"json"};
import {inPolygon,polygonDistance,parkObstacleTop,pondWater,pondSwimFree,POND_LEVEL,POND_BED} from "../../shared/parkGeometry.ts";

describe("park collision geometry",()=>{
  it("keeps the indexed obstacle query equal to the actual polygons, including cell edges",()=>{
    const groups=[[PARK.railing,1.35],[PARK.piers,1.94],[PARK.benches,.95],[PARK.rocks,1.5],[PARK.bridge_rails,1.65],[PARK.lanterns,4.5]] as const;
    for(const [polys] of groups)for(const poly of polys)for(const [x,z] of poly)for(const r of [0,.32,.52]) {
      let expected:number|null=null;
      for(const [others,y] of groups)if(others.some(p=>inPolygon(x,z,p)||(r>0&&polygonDistance(x,z,p)<r)))expected=Math.max(expected??-Infinity,y);
      expect(parkObstacleTop(x,z,r)).toBe(expected);
    }
  });
  it("provides swimming depth and open water beneath the bridge, keeping the island solid",()=>{
    expect(POND_LEVEL-POND_BED).toBeCloseTo(2.4);
    expect(pondSwimFree(-292.5975,307.2825,.32)).toBe(true);
    const land=PARK.island.land;
    const x=land.reduce((s,p)=>s+p[0],0)/land.length,z=land.reduce((s,p)=>s+p[1],0)/land.length;
    expect(pondWater(x,z)).toBe(false);expect(pondSwimFree(x,z,.32)).toBe(false);
  });
});
