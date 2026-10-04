// Godot player downloads: exports on the host system so native Node packages match the bundled runtime.
// node tools/godot/package.mjs --baked <folder> [--godot <mono-console-exe>] [--out <folder>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { root, run, buildServer } from './build-server.mjs';
const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(`--${name}`); if (i < 0) return fallback; if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`); return args[i + 1]; };
const system = {win32:'windows',linux:'linux',darwin:'mac'}[process.platform];
if (!system) throw new Error(`No Godot download for ${process.platform}`);
const expectedArch = system === 'mac' ? 'arm64' : 'x64';
if (process.arch !== expectedArch) throw new Error(`This export preset needs ${expectedArch}, running ${process.arch}`);
const baked = path.resolve(option('baked', path.join(root, 'godot/baked')));
for (const file of ['town.glb','town.json','town_walk.json','town_walk.bin','town_lights.json','town_tex','models']) {
  if (!fs.existsSync(path.join(baked, file))) throw new Error(`Missing baked asset: ${path.join(baked, file)}. Use the shared bake; this script never bakes.`);
}
const version = option('version', process.env.SCHELDEMIST_VERSION ?? execFileSync('git',['describe','--tags','--always'],{cwd:root,encoding:'utf8'}).trim());
if (!/^[A-Za-z0-9._-]+$/.test(version)) throw new Error('Version must contain only letters, digits, dots, dashes and underscores');
const outRoot = path.resolve(option('out', path.join(root,'godot/dist')));
const name = `Scheldemist-Godot-${version}-${system}-${process.arch}`;
const out = path.join(outRoot,name);
fs.mkdirSync(outRoot,{recursive:true});
// Generated packages must never be scanned or packed into the next export.
if (outRoot.startsWith(path.join(root, "godot") + path.sep)) fs.writeFileSync(path.join(outRoot,".gdignore"),"");
// Only ever replace a package folder that this script owns, directly under the output directory.
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
let engine = option('godot',process.env.GODOT ?? '');
if (!engine && process.platform === 'win32') {
  const winget = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft/WinGet/Packages');
  engine = fs.existsSync(winget) ? [...fs.globSync('GodotEngine.GodotEngine.Mono_*/Godot_v4.7.2-stable_mono_win64/*_console.exe',{cwd:winget})].map(p=>path.join(winget,p))[0] : '';
}
if (!engine) engine = 'godot';
const engineVersion = execFileSync(engine,['--version'],{encoding:'utf8'}).trim();
if (!engineVersion.startsWith('4.7.2.stable.mono')) throw new Error(`Need Godot 4.7.2 Mono; found ${engineVersion}`);
run('dotnet',['build','godot']);
run(engine,['--headless','--path',path.join(root,'godot'),'--import']);
const preset = {windows:'Windows',linux:'Linux',mac:'macOS'}[system];
const program = path.join(out,system === 'windows' ? 'Scheldemist.exe' : system === 'linux' ? 'Scheldemist' : 'Scheldemist.zip');
run(engine,['--headless','--path',path.join(root,'godot'),'--export-release',preset,program]);
if (!fs.existsSync(program)) throw new Error(`Godot did not produce ${program}; check the export log`);
if (system === 'mac') { run('ditto',['-x','-k',program,out]); fs.rmSync(program); }
if (system === 'linux') fs.chmodSync(program,0o755);
fs.mkdirSync(path.join(out,'baked'));
for (const file of ['town.glb','town.json','town_walk.json','town_walk.bin','town_lights.json','town_tex','models']) fs.cpSync(path.join(baked,file),path.join(out,'baked',file),{recursive:true});
// Game data the C# reads as plain files beside res:// (places, indoor keep-outs): an export does not pack them.
fs.cpSync(path.join(root,'godot','assets'),path.join(out,'assets'),{recursive:true,filter:src=>fs.statSync(src).isDirectory()||src.endsWith('.json')});
buildServer(out);
for (const [from,to] of [['LICENSE','LICENSE'],['assets/ATTRIBUTION.md','ATTRIBUTION.md'],['CHANGELOG.md','CHANGELOG.md']]) fs.copyFileSync(path.join(root,from),path.join(out,to));
const license = await fetch(`https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`);
if (!license.ok) throw new Error(`Could not fetch Node's licence (${license.status})`);
fs.writeFileSync(path.join(out,'runtime/LICENSE.txt'),await license.text());
for (const [url,file] of [
  ['https://raw.githubusercontent.com/godotengine/godot/4.7.2-stable/COPYRIGHT.txt','GODOT-COPYRIGHT.txt'],
  ['https://raw.githubusercontent.com/dotnet/runtime/v8.0.0/LICENSE.TXT','DOTNET-LICENSE.txt']
]) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not fetch runtime licence (${response.status})`);
  fs.writeFileSync(path.join(out,file),await response.text());
}
fs.writeFileSync(path.join(out,'PLAY.txt'),`Scheldemist (Godot port)\n\nUnzip the whole folder, then open ${system === 'windows' ? 'Scheldemist.exe' : system === 'mac' ? 'Scheldemist.app' : 'Scheldemist'}.\nNo Node, .NET or Godot installation is needed. The server starts and stops with the game.\nKeep every file in this folder together. Saves, settings and AI setup go in your own Scheldemist user-data folder, never in the download.\nThis is an unfinished port: see the release notes for the parts still being ported.\nAI software, logins and keys are yours to set up; none are included. No browser client is included for other players.\nThe app is unsigned: Windows SmartScreen or macOS Gatekeeper may ask before first opening.\n`);
const bytes = dir => fs.readdirSync(dir,{withFileTypes:true}).reduce((sum,e)=>sum+(e.isDirectory()?bytes(path.join(dir,e.name)):fs.statSync(path.join(dir,e.name)).size),0);
const parts = Object.fromEntries(fs.readdirSync(out,{withFileTypes:true}).map(e=>[e.name,e.isDirectory()?bytes(path.join(out,e.name)):fs.statSync(path.join(out,e.name)).size]));
const archive = `${out}.zip`;
fs.rmSync(archive,{force:true});
if (system === 'windows') run(path.join(process.env.SystemRoot ?? 'C:/Windows','System32/tar.exe'),['-a','-c','-f',archive,'-C',outRoot,name]);
else if(system === 'mac') run('ditto',['-c','-k','--keepParent',out,archive]);
else run('zip',['-q','-r',archive,name],outRoot);
const report = {system,arch:process.arch,version,node:process.version,godot:engineVersion,archive,zipBytes:fs.statSync(archive).size,unpackedBytes:bytes(out),parts};
fs.writeFileSync(`${out}.sizes.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT,`archive=${archive}\n`);
