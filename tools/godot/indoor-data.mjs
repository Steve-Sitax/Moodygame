// Read public browser plans only; do not construct Three.js scenes or bake shared assets.
import { readFileSync,writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { LINES,loopPath } from '../../shared/omnibusLines.ts';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
function fn(text,name){const start=text.indexOf('export function '+name);if(start<0)throw Error(name);const brace=text.indexOf('{',start);let level=1,end=brace+1;for(;level&&end<text.length;end++){if(text[end]==='{')level++;if(text[end]==='}')level--;}return stripTypeScriptTypes(text.slice(start,end).replace('export ',''));}
const track=read('client/src/world/tracks.ts');
const tracks=Function(fn(track,'smoothLine')+'\nconst BAND=2.2;\n'+fn(track,'trackKeepOut')+'\nreturn trackKeepOut;')();
const city=JSON.parse(read('shared/city.json'));
const keepouts=tracks(city.decor);
for(const line of LINES){const p=loopPath(line.route,5);for(let i=0;i<p.x.length;i+=8)keepouts.push({minX:p.x[i]-1.9,maxX:p.x[i]+1.9,minZ:p.z[i]-1.9,maxZ:p.z[i]+1.9});}
const market=read('client/src/game/market.ts');const fields=market.slice(market.indexOf('const FIELDS:'),market.indexOf('export function marketKeepOut'));
// Only field bounds, never row geometry or placement rules.
for(const m of fields.matchAll(/bounds:\s*(\[[\s\S]*?\])/g)){const rects=Function('return '+m[1])();for(const r of rects)keepouts.push({minX:r.minX-.5,maxX:r.maxX+.5,minZ:r.minZ-.5,maxZ:r.maxZ+.5});}
writeFileSync(new URL('../../godot/assets/indoor-keepouts.json',import.meta.url),JSON.stringify(keepouts)+'\n');
console.log('indoor keepouts: '+keepouts.length);
