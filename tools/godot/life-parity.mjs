// Compare production C# puddles and gust fronts with the browser's production TypeScript.
// No engine, server, audio device or saved game is involved.
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import { execFileSync } from "node:child_process";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const scratch=path.join(root,"godot/baked/life-parity-scratch");
const out=path.join(root,"godot/baked/life-parity.json");
mkdirSync(scratch,{recursive:true});
let now=0;
class Vector2 {constructor(x=0,y=0){this.x=x;this.y=y;}set(x,y){this.x=x;this.y=y;}length(){return Math.hypot(this.x,this.y);}}
const ctx=vm.createContext({psxUniforms:{uPuddle:{value:0}},THREE:{Vector2},tempest:{level:0},sharedSeconds:()=>now,clamp01:x=>Math.max(0,Math.min(1,x))});
function run(file,tail){let source=readFileSync(path.join(root,file),"utf8").replace(/^import .*;\r?\n/gm,"").replace(/^export /gm,"").replace(/^if \(import.meta.env.DEV\).*$/gm,"");vm.runInContext(stripTypeScriptTypes(source,{mode:"transform"})+tail,ctx);}
run("client/src/world/puddlemask.ts","\nglobalThis.puddleAt=puddleAt;");
const share=readFileSync(path.join(root,"client/src/game/share.ts"),"utf8");
vm.runInContext(stripTypeScriptTypes(share.slice(share.indexOf("export function hash32"),share.indexOf("/** A row of dice")).replaceAll("export ",""),{mode:"transform"}),ctx);
run("client/src/world/alive/wind.ts","\nglobalThis.Wind=Wind;");
const puddles=[],gusts=[];
for(let i=0;i<1200;i++){const x=-350+i*.731,z=(i*47.123)%300,level=i%11/10,scale=[.75,1,1.15,1.3][i%4];ctx.psxUniforms.uPuddle.value=level;puddles.push({x,z,level,scale,expected:ctx.puddleAt(x,z,scale)});}
const wind=new ctx.Wind();
for(const weather of ["fog","mist","clear","rain","storm"])for(let i=0;i<120;i++){now=1728057300+i*.17;const x=-300+i*5.01,z=i%7*31,level=weather==="storm"?i%11/10:0;ctx.tempest.level=level;wind.update(0,weather,{x,z});gusts.push({time:now,weather,x,z,level,expected:wind.gustAt(x,z)});}
writeFileSync(path.join(scratch,"input.json"),JSON.stringify({puddles,gusts}));
const xmlEscape=s=>s.replaceAll("&","&amp;").replaceAll('"',"&quot;");
writeFileSync(path.join(scratch,"Parity.csproj"),`<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings></PropertyGroup><ItemGroup><Compile Include="${xmlEscape(path.join(root,"godot/src/Audio/Puddles.cs"))}" Link="Puddles.cs"/><Compile Include="${xmlEscape(path.join(root,"godot/src/Audio/StormGusts.cs"))}" Link="StormGusts.cs"/></ItemGroup></Project>`);
writeFileSync(path.join(scratch,"Program.cs"),`using System.Text.Json;using Scheldemist.Audio;using var doc=JsonDocument.Parse(File.ReadAllText(args[0]));double N(JsonElement e,string n)=>e.GetProperty(n).GetDouble();var p=doc.RootElement.GetProperty("puddles").EnumerateArray().Select(e=>Puddles.At(N(e,"x"),N(e,"z"),N(e,"level"),N(e,"scale"))).ToArray();var g=doc.RootElement.GetProperty("gusts").EnumerateArray().Select(e=>StormGusts.At(N(e,"time"),e.GetProperty("weather").GetString()!,N(e,"level"),N(e,"x"),N(e,"z"))).ToArray();Console.WriteLine(JsonSerializer.Serialize(new{p,g}));`);
try{
 const stdout=execFileSync("dotnet",["run","--project",path.join(scratch,"Parity.csproj"),"--",path.join(scratch,"input.json")],{cwd:root,encoding:"utf8",timeout:60000,windowsHide:true});
 const actual=JSON.parse(stdout.trim().split(/\r?\n/).at(-1));
 const rows=[{kind:"puddles",count:puddles.length,wet:puddles.filter(q=>q.expected>0).length,error:Math.max(...puddles.map((q,i)=>Math.abs(q.expected-actual.p[i])))},{kind:"gusts",count:gusts.length,active:gusts.filter(q=>q.expected>0).length,error:Math.max(...gusts.map((q,i)=>Math.abs(q.expected-actual.g[i])))}];
 const ok=rows.every(r=>r.error<1e-10);writeFileSync(out,JSON.stringify({ok,rows},null,2));console.log(JSON.stringify({ok,rows}));if(!ok)process.exitCode=1;
}finally{rmSync(scratch,{recursive:true,force:true});}
