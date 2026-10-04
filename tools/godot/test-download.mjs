// A real Windows download check, not a source run. Unpack into a path with spaces, start the exported game,
// observe its own server, save and rendered test picture, then remove the unpacked game and test user data.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn,execFileSync} from 'node:child_process';
const archive=path.resolve(process.argv[2] ?? '');
const proof=path.resolve(process.argv[3] ?? 'godot/dist/windows-proof');
if(process.platform !== 'win32' || !fs.existsSync(archive)) throw new Error('Pass an existing Windows download zip');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'scheldemist download '));
const data=path.join(temp,'player data');
fs.mkdirSync(data);fs.mkdirSync(proof,{recursive:true});
let game;
const menus=process.argv.includes("--menus");
const port=menus ? 8866 : 8864;
try {
  execFileSync(path.join(process.env.SystemRoot ?? 'C:/Windows','System32/tar.exe'),['-xf',archive,'-C',temp]);
  const dir=fs.readdirSync(temp).find(n=>n.startsWith('Scheldemist-Godot-'));
  if(!dir)throw new Error('No game folder in zip');
  const exe=path.join(temp,dir,'Scheldemist.exe');
  // Ignore the machine's installed runtimes: the game must find its portable Node and self-contained .NET.
  const env={...process.env,SCHELDEMIST_USER_DATA:data};
  delete env.SCHELDEMIST_ROOT;delete env.SCHELDEMIST_NODE;delete env.SCHELDEMIST_DB;delete env.SCHELDEMIST_AI_CONFIG;
  const log=fs.openSync(path.join(proof,'game.log'),'w');
  game=spawn(exe,['--log-file',path.join(proof,'engine.log'),'--','--no-ai','--port',String(port),menus ? '--menutest' : '--nettest',proof],{cwd:temp,env,windowsHide:true,stdio:['ignore',log,log]});
  fs.closeSync(log);
  const ended=new Promise((resolve,reject)=>{game.on('exit',(code,signal)=>resolve({code,signal}));game.on('error',reject);});
  const deadline=Date.now()+55000;
  let answered=false;
  while(Date.now()<deadline && game.exitCode === null) {
    try { const response=await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(500)});if(response.ok)answered=true; }catch{}
    await new Promise(r=>setTimeout(r,100));
  }
  if(game.exitCode===null){game.kill();throw new Error('Exported game timed out after 55 seconds');}
  const exit=await ended;
  const report=JSON.parse(fs.readFileSync(path.join(proof,menus ? 'menutest.json' : 'nettest.json'),'utf8'));
  const saved=fs.existsSync(path.join(data,'game.sqlite'));
  const logText=fs.readFileSync(path.join(proof,'game.log'),'utf8');
  const loaded=logText.includes('town in:');
  const serverLog=fs.readFileSync(path.join(data,'godot-server.log'),'utf8');
  const compiled=serverLog.includes(`[server] http://127.0.0.1:${port}`);
  await new Promise(r=>setTimeout(r,300));
  let stillAnswers=false;
  try {stillAnswers=(await fetch(`http://127.0.0.1:${port}/api/state`,{signal:AbortSignal.timeout(500)})).ok;}catch{}
  const settingsInUserFolder=fs.existsSync(path.join(data,"settings.json"));
  const slotsInUserFolder=fs.existsSync(path.join(data,"saves/game"));
  const result={ok:exit.code===0 && report.ok && answered && saved && loaded && compiled && !stillAnswers && (!menus || (settingsInUserFolder && slotsInUserFolder)),exit,serverAnswered:answered,defaultUserSave:saved,townLoaded:loaded,serverStopped:!stillAnswers,gameTest:report.ok, settingsInUserFolder:menus ? settingsInUserFolder : null, saveSlotsInUserFolder:menus ? slotsInUserFolder : null,zipBytes:fs.statSync(archive).size};
  fs.writeFileSync(path.join(proof,'download-test.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
  if(!result.ok)throw new Error('Download check failed; see the proof folder');
} finally {
  if(game?.exitCode === null) {game.kill();await new Promise(r=>game.once('exit',r));}
  // This exact fresh folder is owned by this check, never a checkout or the player's normal data folder.
  if(path.dirname(temp)!==os.tmpdir() || !path.basename(temp).startsWith('scheldemist download '))throw new Error('Unexpected cleanup folder');
  fs.rmSync(temp,{recursive:true,force:true});
}
