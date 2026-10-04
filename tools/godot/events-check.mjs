// The event port's isolated, bounded console run. No existing save is opened or copied.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const arg = (name, fallback) => { const i = args.indexOf('--' + name); return i < 0 ? fallback : args[i + 1]; };
const out = path.resolve(arg('out', path.join(root, 'godot/baked/eventtest')));
const timeout = Number(arg('timeout', '600'));
if (!Number.isFinite(timeout) || timeout < 1 || timeout > 3600) throw new Error('Timeout must be 1..3600 seconds per batch');
fs.mkdirSync(out, { recursive: true });
const exe = arg('godot', 'C:/Users/steve/AppData/Local/Microsoft/WinGet/Packages/GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe');
const lock = 'D:/Code/MoodyGame-godot/godot/baked/PERF-LOCK';
const guard = async () => { const deadline = Date.now() + 900000; while (fs.existsSync(lock)) { if (Date.now() > deadline) throw new Error('PERF-LOCK remained held; no Godot started'); await new Promise(r => setTimeout(r, 10000)); } };
const run = (argv, name, seconds, environment = {}, directory = out) => new Promise(resolve => {
  const driver = arg('driver', '');
  const child = spawn(exe, driver && !argv.includes('--headless') ? ['--rendering-driver', driver, ...argv] : argv, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...environment } });
  let text = '', timedOut = false;
  const started = Date.now();
  const output = fs.createWriteStream(path.join(directory, name + '.log'));
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output.write(chunk); text += chunk.toString(); });
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(name + ' timed out');
    if (process.platform === 'win32') { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch {} }
    else child.kill('SIGKILL');
  }, seconds * 1000);
  child.on('error', e => { console.error(e.message); clearTimeout(timer); output.end(); resolve(1); });
  child.on('close', exitCode => {
    clearTimeout(timer); output.end();
    const logErrors = (text.match(/ERROR:|ObjectDisposedException/g) ?? []).length;
    const code = exitCode === 0 && !timedOut && logErrors === 0 ? 0 : 1;
    fs.writeFileSync(path.join(directory, name + '-run.json'), JSON.stringify({ exitCode, code, timedOut, logErrors, seconds: (Date.now() - started) / 1000 }, null, 2));
    console.log(name + ': exit ' + exitCode + (timedOut ? ' (timeout)' : '') + ', log errors ' + logErrors);
    resolve(code);
  });
});
await guard();
if (!args.includes('--no-import') && await run(['--headless', '--audio-driver', 'Dummy', '--path', 'godot', '--import', '--quit'], 'import', 90)) process.exit(1);
// Every original kind and supplementary proof still runs. Bound each fresh-world batch,
// rather than cutting off the long full suite during its thirteenth event kind.
const full = [
  'musicians,fish_auction,quarrel,scuffle',
  'street_robbery,wedding,funeral,emigrant_ship',
  'house_fire,tempest,hiring,ballad',
  'tavern_brawl,burglary,smuggling,night_watch',
  'family_ui,puppets,actions,crowd100,omnibus,lamps,dreams',
  'wedding_inside,funeral_inside,sermon',
];
const selection = arg('only', '');
const batches = selection ? [selection] : full;
const reports = [];
let code = 0;
for (let index = 0; index < batches.length; index++) {
  await guard();
  const directory = selection ? out : path.join(out, 'batch-' + (index + 1));
  fs.mkdirSync(directory, { recursive: true });
  const db = path.join(directory, 'test.sqlite');
  if (fs.existsSync(db)) throw new Error('The test database already exists: choose a fresh output directory.');
  // A crash before the new report must never reuse an earlier batch's proof.
  for (const name of ['eventtest.json', 'eventtest-run.json']) fs.rmSync(path.join(directory, name), { force: true });
  const options = ['--audio-driver', 'Dummy', '--path', 'godot', '--', '--town', arg('town', 'D:/Code/MoodyGame-godot/godot/baked/next/town.glb'), '--models', arg('models', 'D:/Code/MoodyGame-godot/godot/baked/models'), '--no-ai', '--no-mainmenu', '--port', arg('port', '8920'), '--db', db, '--prefs', path.join(directory, 'settings.json'), '--eventtest', directory, '--eventonly', batches[index]];
  let result;
  const started = Date.now();
  try { result = await run(options, 'eventtest', timeout, { SCHELDEMIST_USER_DATA: path.join(directory, 'user'), SCHELDEMIST_TOWN_SEED: '1873', SCHELDEMIST_MAP_PORT: arg('map-port', '8929') }, directory); }
  finally { for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(db + suffix, { force: true }); }
  const file = path.join(directory, 'eventtest.json');
  const report = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { ok: false, failures: ['No completed event report'], stages: [] };
  const runtime = path.join(directory, 'eventtest-run.json');
  reports.push({ selection: batches[index], directory, seconds: (Date.now() - started) / 1000, code: result, runtime: fs.existsSync(runtime) ? JSON.parse(fs.readFileSync(runtime, 'utf8')) : null, report });
  if (result || !report.ok) code = 1;
}
if (!selection) fs.writeFileSync(path.join(out, 'eventtest.json'), JSON.stringify({ ok: code === 0, failures: reports.flatMap(b => b.report.failures), stages: reports.flatMap(b => b.report.stages), batches: reports }, null, 2));
process.exitCode = code;
