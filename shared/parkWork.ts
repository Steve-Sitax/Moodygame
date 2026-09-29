export const PARK_KEEPER = { x: -302.7, z: 299.5 };
/** Existing house 696's open street doorstep, north of the park. */
export const PARK_KEEPER_HOME = { x: -308.8, z: 259.7 };
export const PARK_FEED = [{ x: -306, z: 303 }, { x: -286, z: 292 }];
export const PARK_CLEAN_COUNT = 10;
export const PARK_CLEAN_PAY = 35;
export interface ParkMess { id: number; x: number; z: number; owner: number|null; }
export interface ParkShift { ids:number[]; cleaned:number[]; paid:boolean; ready:number; pending:number|null; }
export interface ParkWorkState {
  day:number; piles:ParkMess[]; next:number; shifts:Record<string,ParkShift>;
  dogs:Record<string,number>; fed:Record<string,number>; worker:{x:number;z:number};
}
export interface ParkWorkView { day:number; piles:ParkMess[]; shift:ParkShift|null; worker:{x:number;z:number}; open:boolean; }
