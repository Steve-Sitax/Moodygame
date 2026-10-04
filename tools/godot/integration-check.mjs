// Sequential, disposable integration runs. Never opens a player's database.
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const opt = (key, fallback) => { const i = args.indexOf('--' + key); return i < 0 ? fallback : args[i + 1]; };
const mode = opt('mode', 'placestest');
if (!['jobtest', 'placestest', 'deedstest', 'ridetest', 'playtest', 'eventtest', 'peopletest', 'soundtest'].includes(mode)) throw new Error('Unknown integration test');
const out = path.resolve(root, 'godot/baked', opt('out', 'integrate2/' + mode));
if (!out.startsWith(path.join(root, 'godot/baked') + path.sep)) throw new Error('Output must stay in this worktree');
const exe = opt('godot', 'C:/Users/steve/AppData/Local/Microsoft/WinGet/Packages/GodotEngine.GodotEngine.Mono_Microsoft.Winget.Source_8wekyb3d8bbwe/Godot_v4.7.2-stable_mono_win64/Godot_v4.7.2-stable_mono_win64_console.exe');
const port = Number(opt('port', '8940'));
if (!Number.isInteger(port) || port < 8940 || port > 8948) throw new Error('Use ports 8940..8948; map uses the next port');
fs.mkdirSync(out, { recursive: true });
const db = path.join(out, 'test.sqlite');
if (fs.existsSync(db)) throw new Error('Choose a fresh output directory');
const lock = 'D:/Code/MoodyGame-godot/godot/baked/PERF-LOCK';
async function run(argv, seconds, name) {
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) throw new Error('Timeout must be 1..3600 seconds');
  const deadline = Date.now() + 900000;
  while (fs.existsSync(lock)) {
    if (Date.now() > deadline) throw new Error('PERF-LOCK remained held; no Godot started');
    await new Promise(resolve => setTimeout(resolve, 10000));
  }
  const start = Date.now();
  const child = spawn(exe, argv, { cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SCHELDEMIST_USER_DATA: path.join(out, 'user'), SCHELDEMIST_TOWN_SEED: '1873', SCHELDEMIST_MAP_PORT: String(port + 1) } });
  const log = fs.createWriteStream(path.join(out, name + '.log'));
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  let timedOut = false;
  const stop = () => { if (child.exitCode === null && child.pid) { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }); } catch {} } };
  const timer = setTimeout(() => { timedOut = true; stop(); }, seconds * 1000);
  try {
    const code = await new Promise((resolve, reject) => { child.on('error', reject); child.on('close', resolve); });
    const result = { mode: name, code, timedOut, seconds: (Date.now() - start) / 1000 };
    fs.writeFileSync(path.join(out, name + '-run.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
    return code !== 0 || timedOut ? 1 : 0;
  } finally { clearTimeout(timer); stop(); log.end(); }
}
try {
  if (!args.includes('--no-import') && await run(['--headless', '--audio-driver', 'Dummy', '--path', 'godot', '--import', '--quit'], 180, 'import')) process.exitCode = 1;
  else {
    const extra = args.indexOf('--extra');
    process.exitCode = await run(['--audio-driver', 'Dummy', ...(opt('driver', '') ? ['--rendering-driver', opt('driver', '')] : []), '--path', 'godot', '--', '--town', opt('town', 'D:/Code/MoodyGame-godot/godot/baked/next/town.glb'), '--models', opt('models', 'D:/Code/MoodyGame-godot/godot/baked/models'), '--no-ai', ...(mode === 'ridetest' ? [] : ['--no-mainmenu']), '--port', String(port), '--db', db, '--prefs', path.join(out, 'settings.json'), '--dev', '--hour', '13.75', '--weather', 'clear', '--' + mode, out, ...(extra < 0 ? [] : args.slice(extra + 1))], Number(opt('timeout', '1200')), mode);
  }
} finally { for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(db + suffix, { force: true }); }
