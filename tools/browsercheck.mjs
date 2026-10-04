// Browser regression evidence on an already-running --fresh test stack. No player data reads.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const detail = process.argv.includes("--detail");
const arg = (name, fallback) => { const i=process.argv.indexOf(`--${name}`); return i<0?fallback:process.argv[i+1]; };
const vite = Number(arg("vite", "5375"));
if (vite < 5375 || vite > 5379) throw new Error("Use test Vite ports 5375..5379");
const resultFile = detail ? "details.json" : "results.json";
const out = path.resolve(root, arg("out", "docs/godot-browsercheck"));
if (!out.startsWith(path.join(root,"docs/godot-browsercheck")+path.sep) && out!==path.join(root,"docs/godot-browsercheck")) throw new Error("Evidence must stay in docs/godot-browsercheck");
mkdirSync(out, { recursive: true });
const chromePath = ["C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].find(existsSync);
if (!chromePath) throw new Error("Chrome not found");
const profile = path.join(root, ".test-stacks/chrome-browsercheck");
const chrome = spawn(chromePath, ["--headless=new", "--enable-gpu", "--ignore-gpu-blocklist", "--remote-debugging-port=9475", `--user-data-dir=${profile}`, "--no-first-run", "--window-size=1280,800", "--mute-audio", "about:blank"], { windowsHide: true, stdio: "ignore" });
const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, id = 0;
const pending = new Map();
const report = { checks: {}, views: [], errors: [] };
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const key = ++id;
    const timeout = setTimeout(() => { pending.delete(key); reject(new Error(`${method} timeout`)); }, 120000);
    pending.set(key, value => { clearTimeout(timeout); resolve(value); });
    ws.send(JSON.stringify({ id: key, method, params }));
  });
}
async function ev(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
}
async function check(name, expression) {
  report.checks[name] = await ev(expression);
  writeFileSync(path.join(out, resultFile), JSON.stringify(report, null, 2));
  console.log(name, JSON.stringify(report.checks[name]).slice(0, 3000));
}
async function shot(name) {
  await sleep(500);
  const png = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(path.join(out, `${name}.png`), Buffer.from(png.result.data, "base64"));
  report.views.push(name);
}
async function watchJob() {
  await check("jobTaken", `t.job({type:'watch'})`);
  await check("jobBefore", `fetch('/api/jobs').then(r=>r.json()).then(j=>({active:S.jobs.active,run:S.jobs.run?.hud(),money:j.player.money_c}))`);
  for (let n = 0; n < 20; n++) {
    if (await ev(`!S.jobs.active || S.jobs.run?.ended`)) break;
    await ev(`t.run(30); 1`);
    await sleep(300);
  }
  await sleep(1500);
  await check("jobAfter", `fetch('/api/jobs').then(r=>r.json()).then(j=>({job:j.jobs.find(j=>j.title==='Test: watch'),player:j.player}))`);
}
try {
  for (let n = 0; n < 60 && !ws; n++) {
    try {
      const page = (await (await fetch("http://127.0.0.1:9475/json")).json()).find(p => p.type === "page");
      if (page) { ws = new WebSocket(page.webSocketDebuggerUrl); await new Promise(r => ws.addEventListener("open", r)); }
    } catch { await sleep(500); }
  }
  if (!ws) throw new Error("Chrome did not start");
  ws.addEventListener("message", e => {
    const m = JSON.parse(e.data);
    if (m.id) { pending.get(m.id)?.(m); pending.delete(m.id); }
    if (m.method === "Runtime.exceptionThrown") report.errors.push(m.params.exceptionDetails.text);
  });
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  for (const action of ["ashore", "made"]) {
    const r = await fetch(`http://127.0.0.1:${vite}/api/arrival/${action}`, { method: "POST", signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Test arrival ${action}: HTTP ${r.status}`);
  }
  await send("Page.navigate", { url: `http://127.0.0.1:${vite}/` });
  let ready = false;
  for (let n = 0; n < 240; n++) {
    ready = await ev(`!!window.__scheldemist?.t && !document.querySelector('#boot:not(.gone)')`).catch(() => false);
    if (ready) break;
    await sleep(1000);
  }
  if (!ready) throw new Error("Town did not load");
  await check("loaded", `({boot:__scheldemistBoot.marks, canvas:[document.querySelector('canvas').width,document.querySelector('canvas').height]})`);
  await check("graphics", `(()=>{const g=document.createElement('canvas').getContext('webgl2'),e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'})()`);
  await check("arrival", `S = window.__scheldemist; S.ferry.info()`);
  await ev(`window.S=__scheldemist; window.t=S.t; S.free(true); fetch('/api/arrival/ashore',{method:'POST'}).then(()=>1)`);
  await ev(`t.light(13,'clear')`);
  await sleep(20000);
  // Run work before long visual checks: ordinary live events can later close the town.
  if (!detail) await watchJob();
  await check("paths", `S.paths()`);
  await check("shaders", `S.shaders()`);
  for (const place of ["vismarkt", "grote markt", "cathedral", "handschoenmarkt", "rijnkaai"]) {
    await check(`go:${place}`, `(()=>{const p=t.places().find(p=>p.key===${JSON.stringify(place)});return {target:p,result:t.go([p.x,p.z],{back:6}),at:[S.player.x,S.player.z]}})()`);
    await ev(`t.run(2);1`);
    await check(`stuck:${place}`, `S.stuck({seconds:12})`);
    if (detail) {
      await ev(`t.light(13,'clear')`);
      const turn = await ev(`S.frameProf({n:90,turn:2})`);
      await ev(`S.key('KeyW',true);1`);
      const live = await ev(`S.frameProf({live:6})`);
      await ev(`S.key('KeyW',false);1`);
      report.perf ??= [];
      report.perf.push({place,liveMean:live.frame.mean,turnMean:turn.frame.mean});
      console.log("perf", place, live.frame.mean);
    }
    await shot(place.replaceAll(" ", "_"));
  }
  for (const [name,from,to] of [["townhall_close",[-257,63],[-257,60.69]], ["cathedral_close",[-262,147],[-262,149.53]], ["vleeshuis_close",[-121.95,90],[-121.95,92.4]]]) {
    await ev(`t.light(13,'clear')`);
    await check(name, `(()=>{t.go(${JSON.stringify(from)},{back:0});t.face(${JSON.stringify(to)});S.step(.2);return {at:[S.player.x,S.player.z],target:${JSON.stringify(to)}}})()`);
    await shot(name);
  }
  await ev(`t.light(13,'clear')`);
  await check("speaker", `(()=>{t.go([-254,96],{back:0});const r=S.town.data.residents.find(r=>r.id.startsWith('r')&&r.age>=18);window.speaker=r;return {id:r.id,name:r.name,summon:t.summon(r.id),meet:t.meet(r.id)}})()`);
  await shot("npc_close");
  await ev(`S.jobs.talk.open({id:speaker.id,def:{name:speaker.name}}); 1`);
  for (let n=0;n<80;n++) { if(await ev(`S.jobs.talk.isOpen && !S.jobs.talk.busy`)) break; await sleep(250); }
  await check("talkBefore", `({text:document.querySelector('.talk')?.innerText,busy:S.jobs.talk.busy,choices:S.jobs.talk.choices,free:S.jobs.talk.freeOk})`);
  await shot("talk_choices");
  await ev(`window.dispatchEvent(new KeyboardEvent('keydown',{code:'Digit1',key:'1',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Digit1',key:'1',bubbles:true}));1`);
  await sleep(1000);
  await check("talkAfter", `({text:document.querySelector('.talk')?.innerText,busy:S.jobs.talk.busy,lines:S.jobs.talk.devLines()})`);
  await shot("talk_reply");
  await ev(`S.jobs.talk.close();1`);
  report.corePass = report.checks.paths.length === 0 && report.checks.shaders.problems.length === 0
    && Object.entries(report.checks).filter(([k])=>k.startsWith('stuck:')).every(([,v])=>v.stuck.length===0)
    && report.checks.talkBefore.choices.length > 0 && report.checks.talkAfter.lines.some(l=>l.who==='You')
    && (detail || report.checks.jobAfter.job.status==='done');
  if (!report.corePass) process.exitCode=1;
  if (report.perf) writeFileSync(path.join(out, "perf.json"), JSON.stringify({rows:report.perf},null,2));
} catch (e) {
  report.errors.push(String(e));
  console.error(e);
  process.exitCode = 1;
} finally {
  if (ws) { await send('Runtime.evaluate',{expression:`void window.__scheldemist?.t.done()`}).catch(()=>{}); ws.close(); }
  if (chrome.pid) { try { execFileSync("taskkill", ["/PID", String(chrome.pid), "/F", "/T"], {stdio:"ignore"}); } catch {} }
  await sleep(1500);
  rmSync(profile, { recursive:true, force:true });
  writeFileSync(path.join(out, resultFile), JSON.stringify(report, null, 2));
}
